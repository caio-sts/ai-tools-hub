import type { TreeFile } from '../../src/types.ts';
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
