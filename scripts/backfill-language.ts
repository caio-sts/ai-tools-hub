import { pathToFileURL } from 'node:url';
import type { Skill } from '../src/types.ts';
import { loadCollections, loadSkills } from '../src/lib/data.ts';
import { sleep, type FetchLike } from './harvest/discover.ts';
import { postGraphql, splitRepo } from './harvest/enrich.ts';
import { parseFrontmatter } from './harvest/enumerate.ts';
import { languageVerdict, type LanguageVerdict } from './harvest/language.ts';
import { rewriteCatalog } from './harvest/run.ts';

/** Blob text is heavier than enrich's fields; 25 keeps a query well inside GitHub's ~10 s. */
export const BLOB_BATCH_SIZE = 25;

/** Older than any real push, so the crawl queues the repo first among changed ones. */
export const EPOCH = '1970-01-01T00:00:00Z';

const ATTEMPTS = 3;

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

export function graphqlBlobBatch(
  token: string,
  fetchImpl: FetchLike = fetch,
  wait: (ms: number) => Promise<void> = sleep,
): FetchBlobBatch {
  return async (batch) => {
    const query = buildBlobQuery(batch);
    let failure = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      if (attempt > 1) await wait(2000 * (attempt - 1));
      try {
        const res = await postGraphql(query, token, fetchImpl);
        if (!res.ok) {
          failure = `HTTP ${res.status}`;
          if (res.status < 500) break;
          continue;
        }
        const payload = (await res.json()) as { data?: BlobData | null; errors?: unknown };
        const data = payload.data;
        if (data) return new Map(batch.map((skill, i) => [skill.id, data[`b${i}`]?.object?.text ?? null]));
        failure = `no data: ${JSON.stringify(payload.errors ?? null).slice(0, 200)}`;
      } catch (error) {
        failure = (error as Error).message;
      }
    }
    throw new Error(`backfill: GraphQL ${failure}`);
  };
}

export interface BackfillResult {
  kept: number;
  dropped: Array<{ id: string; repo: string; verdict: LanguageVerdict }>;
  unreadable: number;
}

/**
 * Applies the language rule to every stored row once (spec 2026-10-24 D4). Judges batch by batch;
 * any unreadable batch aborts before anything is written. A blob GitHub no longer has is kept.
 */
export async function backfillLanguage(
  dataDir: string,
  fetchBatch: FetchBlobBatch,
  write: boolean,
  log: (message: string) => void = console.log,
): Promise<BackfillResult> {
  const stored = loadSkills(dataDir);
  const kept: Skill[] = [];
  const dropped: BackfillResult['dropped'] = [];
  let unreadable = 0;
  for (let start = 0; start < stored.length; start += BLOB_BATCH_SIZE) {
    const batch = stored.slice(start, start + BLOB_BATCH_SIZE);
    const texts = await fetchBatch(batch);
    for (const skill of batch) {
      const text = texts.get(skill.id) ?? null;
      if (text === null) {
        unreadable += 1;
        kept.push(skill);
        continue;
      }
      const { frontmatter, body } = parseFrontmatter(text);
      const verdict = languageVerdict(frontmatter.name, frontmatter.description, body);
      if (verdict === 'supported') kept.push(skill);
      else dropped.push({ id: skill.id, repo: skill.repo, verdict });
    }
    if ((start / BLOB_BATCH_SIZE) % 40 === 0) log(`backfill: judged ${start + batch.length} of ${stored.length}`);
  }

  const result = { kept: kept.length, dropped, unreadable };
  if (!write) return result;

  // A dropped row may have taken an English sibling's slot (concept cap, REPO_CAP); re-reading the
  // repo through the crawl restores it.
  const lost = new Set(dropped.map((entry) => entry.repo));
  const collections = loadCollections(dataDir).map((c) => (lost.has(c.repo) ? { ...c, pushedAt: EPOCH } : c));
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
  const { kept, dropped, unreadable } = await backfillLanguage('data', graphqlBlobBatch(token), write);
  console.log(`backfill: kept ${kept} (${unreadable} unreadable, kept), dropped ${dropped.length}${write ? '' : ' — dry run, nothing written'}`);
  console.log('by rule:', tally(dropped.map((d) => d.verdict)).map(([rule, n]) => `${rule} ${n}`).join(', '));
  for (const [repo, count] of tally(dropped.map((d) => d.repo)).slice(0, 15)) console.log(`  ${count}\t${repo}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
