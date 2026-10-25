import { pathToFileURL } from 'node:url';
import type { Skill } from '../src/types.ts';
import { loadCollections, loadMeta, loadSkills } from '../src/lib/data.ts';
import { applyListing, compareForRank } from '../src/lib/rank.ts';
import { loadTaxonomy } from '../src/lib/taxonomy.ts';
import type { FetchLike } from './harvest/discover.ts';
import { postGraphql, splitRepo } from './harvest/enrich.ts';
import { parseFrontmatter } from './harvest/enumerate.ts';
import { isSupportedLanguage } from './harvest/language.ts';
import { writeCatalog, writeMeta } from './harvest/run.ts';

export const BLOB_BATCH_SIZE = 50;

/** One alias per row: its SKILL.md at the commit the row was indexed at. */
export function buildBlobQuery(skills: Skill[]): string {
  const fields = skills.map((skill, i) => {
    const { owner, name } = splitRepo(skill.repo);
    const expression = JSON.stringify(`${skill.sha}:${skill.path}`);
    return `b${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { object(expression: ${expression}) { ... on Blob { text } } }`;
  });
  return `{\n${fields.join('\n')}\n}`;
}

/** SKILL.md text by row id; null when it could not be read. */
export type FetchBlobs = (skills: Skill[]) => Promise<Map<string, string | null>>;

type BlobData = Record<string, { object: { text?: string } | null } | null>;

/** A failed batch leaves its rows unreadable, which keeps them: never drop what was not read. */
export function graphqlBlobs(token: string, fetchImpl: FetchLike = fetch, log = console.log): FetchBlobs {
  return async (skills) => {
    const texts = new Map<string, string | null>();
    for (let start = 0; start < skills.length; start += BLOB_BATCH_SIZE) {
      const batch = skills.slice(start, start + BLOB_BATCH_SIZE);
      let data: BlobData = {};
      try {
        const res = await postGraphql(buildBlobQuery(batch), token, fetchImpl);
        data = ((await res.json()) as { data?: BlobData }).data ?? {};
      } catch (error) {
        log(`backfill: rows ${start}-${start + batch.length - 1} unreadable: ${(error as Error).message}`);
      }
      batch.forEach((skill, i) => texts.set(skill.id, data[`b${i}`]?.object?.text ?? null));
      if ((start / BLOB_BATCH_SIZE) % 20 === 0) log(`backfill: read ${start + batch.length} of ${skills.length}`);
    }
    return texts;
  };
}

export interface BackfillResult {
  kept: number;
  dropped: string[];
  unreadable: number;
}

/** Applies the language rule to every stored row once (spec 2026-10-24 D4). */
export async function backfillLanguage(dataDir: string, fetchBlobs: FetchBlobs, write: boolean): Promise<BackfillResult> {
  const stored = loadSkills(dataDir);
  const texts = await fetchBlobs(stored);
  const kept: Skill[] = [];
  const dropped: string[] = [];
  let unreadable = 0;
  for (const skill of stored) {
    const text = texts.get(skill.id) ?? null;
    if (text === null) unreadable += 1;
    const parsed = text === null ? null : parseFrontmatter(text);
    if (parsed === null || isSupportedLanguage(parsed.frontmatter.name, parsed.frontmatter.description, parsed.body)) {
      kept.push(skill);
    } else {
      dropped.push(skill.id);
    }
  }
  const result = { kept: kept.length, dropped, unreadable };
  if (!write) return result;

  // Same steps as apply-assignments: listing is derived, so it is recomputed over what remains.
  const previouslyListed = new Set(stored.filter((skill) => skill.listed).map((skill) => skill.id));
  const skills = applyListing([...kept].sort(compareForRank), previouslyListed, loadTaxonomy().minimumMass);
  await writeCatalog(dataDir, { skills, collections: loadCollections(dataDir) });
  await writeMeta(dataDir, { ...loadMeta(dataDir), skillCount: skills.length });
  return result;
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is required, e.g. GITHUB_TOKEN=$(gh auth token)');
  const write = !process.argv.includes('--dry-run');
  const { kept, dropped, unreadable } = await backfillLanguage('data', graphqlBlobs(token), write);
  const byRepo = new Map<string, number>();
  for (const id of dropped) {
    const repo = id.split('@')[0]!;
    byRepo.set(repo, (byRepo.get(repo) ?? 0) + 1);
  }
  console.log(`backfill: kept ${kept} (${unreadable} unreadable, kept), dropped ${dropped.length}${write ? '' : ' — dry run, nothing written'}`);
  for (const [repo, count] of [...byRepo].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${count}\t${repo}`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
