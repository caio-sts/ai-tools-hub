import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Skill } from '../src/types.ts';
import { NEVER_CRAWLED, loadCollections, loadSkills } from '../src/lib/data.ts';
import { sleep, type FetchLike } from './harvest/discover.ts';
import { postGraphql, splitRepo } from './harvest/enrich.ts';
import { parseFrontmatter } from './harvest/enumerate.ts';
import { languageVerdict, loadLanguageDetector, type LanguageVerdict } from './harvest/language.ts';
import { rewriteCatalog } from './harvest/run.ts';

/** Blob text is heavier than enrich's fields; 25 keeps a query well inside GitHub's ~10 s. */
export const BLOB_BATCH_SIZE = 25;

/** Verdicts by row id: a re-run resumes, and the --write run reuses the dry run's reading. */
export const DEFAULT_CACHE_FILE = 'node_modules/.cache/backfill-language.json';

const ATTEMPTS = 4;

/** GitHub asks for at least a minute after a secondary rate limit that names no retry-after. */
const RATE_LIMIT_WAIT_MS = 60_000;

const DATA_FILES = ['skills.json', 'collections.json', 'meta.json'];

/** One alias per row: its SKILL.md at the commit the row was indexed at. */
export function buildBlobQuery(skills: Skill[]): string {
  const fields = skills.map((skill, i) => {
    const { owner, name } = splitRepo(skill.repo);
    const expression = JSON.stringify(`${skill.sha}:${skill.path}`);
    return `b${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { object(expression: ${expression}) { ... on Blob { text } } }`;
  });
  return `{\n${fields.join('\n')}\n}`;
}

/** SKILL.md text by row id, null for a blob GitHub no longer has. Throws if the batch is unreadable. */
export type FetchBlobBatch = (batch: Skill[]) => Promise<Map<string, string | null>>;

type BlobData = Record<string, { object: { text?: string } | null } | null>;
type GraphqlError = { type?: string; message?: string };

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_WAIT_MS;
}

export function graphqlBlobBatch(
  token: string,
  fetchImpl: FetchLike = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): FetchBlobBatch {
  return async (batch) => {
    const query = buildBlobQuery(batch);
    let failure = '';
    let delay = 0;
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      if (attempt > 1) await wait(delay);
      delay = 2000 * attempt;
      try {
        const res = await postGraphql(query, token, fetchImpl);
        if (res.status === 403 || res.status === 429) {
          failure = `HTTP ${res.status}`;
          delay = retryAfterMs(res);
          continue;
        }
        if (!res.ok) {
          failure = `HTTP ${res.status}`;
          if (res.status < 500) break;
          continue;
        }
        const payload = (await res.json()) as { data?: BlobData | null; errors?: GraphqlError[] };
        // NOT_FOUND is a blob GitHub no longer has; any other error means the row was not read.
        const fatal = (payload.errors ?? []).find((error) => error.type !== 'NOT_FOUND');
        const data = payload.data;
        if (data && fatal === undefined) {
          return new Map(batch.map((skill, i) => [skill.id, data[`b${i}`]?.object?.text ?? null]));
        }
        failure = fatal ? `${fatal.type ?? 'error'}: ${fatal.message ?? ''}` : 'no data';
        if (fatal?.type === 'RATE_LIMITED') delay = RATE_LIMIT_WAIT_MS;
      } catch (error) {
        failure = (error as Error).message;
      }
    }
    throw new Error(`backfill: GraphQL ${failure}`);
  };
}

type Verdict = LanguageVerdict | 'missing';

function readCache(file: string): Map<string, Verdict> {
  if (!existsSync(file)) return new Map();
  return new Map(Object.entries(JSON.parse(readFileSync(file, 'utf8')) as Record<string, Verdict>));
}

function writeCache(file: string, verdicts: Map<string, Verdict>): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(Object.fromEntries(verdicts)), 'utf8');
}

function dataSnapshot(dataDir: string): string {
  return DATA_FILES.map((file) => statSync(join(dataDir, file)).mtimeMs).join(',');
}

export interface BackfillOptions {
  write: boolean;
  cacheFile?: string;
  batchSize?: number;
  log?: (message: string) => void;
}

export interface BackfillResult {
  kept: number;
  dropped: Array<{ id: string; repo: string; verdict: LanguageVerdict }>;
  missing: number;
}

/**
 * Applies the language rule to every stored row once (spec 2026-10-24 D4). Any unreadable batch
 * aborts before anything is written; verdicts so far stay in the cache for the re-run.
 */
export async function backfillLanguage(
  dataDir: string,
  fetchBatch: FetchBlobBatch,
  { write, cacheFile = DEFAULT_CACHE_FILE, batchSize = BLOB_BATCH_SIZE, log = console.log }: BackfillOptions,
): Promise<BackfillResult> {
  await loadLanguageDetector();
  const snapshot = dataSnapshot(dataDir);
  const stored = loadSkills(dataDir);
  const verdicts = readCache(cacheFile);
  const pending = stored.filter((skill) => !verdicts.has(skill.id));
  log(`backfill: ${stored.length - pending.length} verdicts cached in ${cacheFile}, ${pending.length} to read`);
  try {
    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      const texts = await fetchBatch(batch);
      for (const skill of batch) {
        const text = texts.get(skill.id) ?? null;
        if (text === null) {
          verdicts.set(skill.id, 'missing');
          continue;
        }
        const { frontmatter, body } = parseFrontmatter(text);
        verdicts.set(skill.id, languageVerdict(frontmatter.name, frontmatter.description, body));
      }
      if ((start / batchSize) % 40 === 0) {
        writeCache(cacheFile, verdicts);
        log(`backfill: read ${start + batch.length} of ${pending.length}`);
      }
    }
  } finally {
    writeCache(cacheFile, verdicts);
  }

  const kept: Skill[] = [];
  const dropped: BackfillResult['dropped'] = [];
  let missing = 0;
  for (const skill of stored) {
    const verdict = verdicts.get(skill.id)!;
    if (verdict === 'missing') missing += 1;
    if (verdict === 'missing' || verdict === 'supported') kept.push(skill);
    else dropped.push({ id: skill.id, repo: skill.repo, verdict });
  }
  const result = { kept: kept.length, dropped, missing };
  if (!write) return result;

  if (dataSnapshot(dataDir) !== snapshot) throw new Error(`${dataDir} changed while the backfill was reading; run it again`);
  // A dropped row may have taken an English sibling's slot (concept cap, REPO_CAP); re-reading the
  // repo through the crawl restores it.
  const lost = new Set(dropped.map((entry) => entry.repo));
  const collections = loadCollections(dataDir).map((c) => (lost.has(c.repo) ? { ...c, pushedAt: NEVER_CRAWLED } : c));
  await rewriteCatalog(dataDir, stored, kept, collections);
  return result;
}

export function parseBackfillArgs(args: string[]): { write: boolean } {
  for (const arg of args) {
    if (arg !== '--write') throw new Error(`unknown argument ${arg}: the only flag is --write (default: dry run)`);
  }
  return { write: args.includes('--write') };
}

function tally(keys: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]);
}

async function main(): Promise<void> {
  const { write } = parseBackfillArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required, e.g. GITHUB_TOKEN=$(gh auth token)');
  const { kept, dropped, missing } = await backfillLanguage('data', graphqlBlobBatch(token), { write });
  console.log(`backfill: kept ${kept} (${missing} no longer on GitHub, kept), dropped ${dropped.length}${write ? '' : ' — dry run, nothing written'}`);
  console.log('by rule:', tally(dropped.map((d) => d.verdict)).map(([rule, n]) => `${rule} ${n}`).join(', '));
  for (const [repo, count] of tally(dropped.map((d) => d.repo)).slice(0, 15)) console.log(`  ${count}\t${repo}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
