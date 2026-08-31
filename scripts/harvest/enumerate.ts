import type { TreeFile } from '../../src/types.ts';
import { isRepoInternal } from '../../src/lib/inclusion.ts';
import type { FetchLike } from './discover.ts';

const API = 'https://api.github.com';

export interface EnumerateDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'ai-tools-hub-harvest',
    'x-github-api-version': '2022-11-28',
  };
}

interface TreeEntry {
  path?: string;
  mode?: string;
  sha?: string;
  type?: string;
}

/** One recursive tree call per repo. Missing (404) and empty (409) repos yield []. */
export async function fetchTree(
  repo: string,
  token: string,
  deps: EnumerateDeps = {},
): Promise<TreeFile[]> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const log = deps.log ?? (() => {});
  const res = await fetchImpl(`${API}/repos/${repo}/git/trees/HEAD?recursive=1`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404 || res.status === 409) return [];
  if (!res.ok) throw new Error(`tree ${repo}: HTTP ${res.status}`);
  const body = (await res.json()) as { truncated?: boolean; tree?: TreeEntry[] };
  if (body.truncated === true) log(`tree ${repo}: TRUNCATED, result is partial`);
  const out: TreeFile[] = [];
  for (const entry of body.tree ?? []) {
    if (
      typeof entry.path !== 'string' ||
      typeof entry.mode !== 'string' ||
      typeof entry.sha !== 'string' ||
      typeof entry.type !== 'string'
    ) {
      continue;
    }
    out.push({ path: entry.path, mode: entry.mode, sha: entry.sha, type: entry.type });
  }
  return out;
}

/** A skill is a directory containing SKILL.md; a bare root SKILL.md is a repo README. */
export function isSkillPath(path: string): boolean {
  return path.endsWith('/SKILL.md');
}

/**
 * Crawler trap (a): git symlinks carry mode 120000 and point at another path.
 * One sampled repo had 458 of 846 SKILL.md paths as symlinks; counting them doubles totals.
 */
export function isSymlink(file: TreeFile): boolean {
  return file.mode === '120000';
}

/**
 * Crawler trap (b): identical content committed at several paths inflates headline counts.
 * Tree entries arrive path-sorted, so keeping the first occurrence is deterministic.
 */
export function dedupeByBlobSha(files: TreeFile[]): TreeFile[] {
  const seen = new Set<string>();
  const out: TreeFile[] = [];
  for (const file of files) {
    if (seen.has(file.sha)) continue;
    seen.add(file.sha);
    out.push(file);
  }
  return out;
}

/**
 * Tree entries to real, distributable skills. `isRepoInternal` is the inclusion filter's own
 * rule (spec 6.4), imported rather than restated. Dedupe runs LAST so an internal copy sharing
 * a blob with a real skill can never win the slot.
 */
export function filterSkillFiles(files: TreeFile[]): TreeFile[] {
  const kept = files.filter(
    (file) =>
      file.type === 'blob' &&
      !isSymlink(file) &&
      isSkillPath(file.path) &&
      !isRepoInternal(file.path),
  );
  return dedupeByBlobSha(kept);
}

const RAW = 'https://raw.githubusercontent.com';

/**
 * Content comes from raw.githubusercontent.com: unauthenticated, CORS *, no core-bucket cost.
 * `ref` must be a branch, tag or COMMIT sha — raw.githubusercontent.com does not resolve blob
 * shas, and passing one 404s silently. Callers pin a commit sha (see enumerateSkills).
 */
export async function fetchRawFile(
  repo: string,
  ref: string,
  path: string,
  deps: EnumerateDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetchImpl(`${RAW}/${repo}/${ref}/${encoded}`, {
    headers: { 'user-agent': 'ai-tools-hub-harvest' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`raw ${repo}:${path}: HTTP ${res.status}`);
  return await res.text();
}
