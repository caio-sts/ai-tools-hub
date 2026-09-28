import type { RawSkill, RepoRef, TreeFile } from '../../src/types.ts';
import {
  capPerPublisherPerConcept,
  hasReadme,
  includeSkill,
  isRepoInternal,
  normalizeConcept,
  publisherOf,
} from '../../src/lib/inclusion.ts';
import type { FetchLike } from './discover.ts';
import { RateLimitedError, isRateLimited } from './budget.ts';
import { fetchPathCommits, type PathHistoryDeps } from './path-history.ts';

const API = 'https://api.github.com';

export interface EnumerateDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
  onCoreResponse?: (res: Response) => void;
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

/** One recursive tree call per repo, at `ref`. Missing (404) and empty (409) repos yield []. */
export async function fetchTree(
  repo: string,
  token: string,
  deps: EnumerateDeps = {},
  ref = 'HEAD',
): Promise<TreeFile[]> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const log = deps.log ?? (() => {});
  const res = await fetchImpl(`${API}/repos/${repo}/git/trees/${ref}?recursive=1`, {
    headers: ghHeaders(token),
  });
  deps.onCoreResponse?.(res);
  if (isRateLimited(res)) throw new RateLimitedError(`tree ${repo}`);
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

export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const KEY_RE = /^([A-Za-z0-9_.-]+):(.*)$/;
const BLOCK_SCALAR_RE = /^[|>][-+]?$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((part) => unquote(part));
  }
  return unquote(t);
}

/** YAML subset covering every field in the reference ALLOWED_FIELDS; no YAML dependency. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { frontmatter: {}, body: src.trim() };
  const close = /\n---[ \t]*(\n|$)/.exec(src.slice(3));
  if (close === null) return { frontmatter: {}, body: src.trim() };
  const head = src.slice(4, 3 + close.index);
  const body = src.slice(3 + close.index + close[0].length).trim();
  const lines = head === '' ? [] : head.split('\n');
  const fm: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#') || indentOf(line) > 0) {
      i += 1;
      continue;
    }
    const key = KEY_RE.exec(line);
    if (key === null) {
      i += 1;
      continue;
    }
    const name = key[1];
    const inline = key[2].trim();

    if (BLOCK_SCALAR_RE.test(inline)) {
      i += 1;
      const block: string[] = [];
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
        block.push(lines[i].trim());
        i += 1;
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop();
      fm[name] = inline.startsWith('|') ? block.join('\n') : block.join(' ').trim();
      continue;
    }

    if (inline !== '') {
      fm[name] = coerce(inline);
      i += 1;
      continue;
    }

    i += 1;
    const child: string[] = [];
    while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
      if (lines[i].trim() !== '') child.push(lines[i].trim());
      i += 1;
    }
    if (child.length === 0) {
      fm[name] = '';
      continue;
    }
    if (child[0].startsWith('- ')) {
      fm[name] = child.filter((c) => c.startsWith('- ')).map((c) => unquote(c.slice(2)));
      continue;
    }
    const map: Record<string, unknown> = {};
    for (const c of child) {
      const entry = KEY_RE.exec(c);
      if (entry !== null) map[entry[1]] = coerce(entry[2]);
    }
    fm[name] = map;
  }

  return { frontmatter: fm, body };
}

/** No commit history for the path: score it as maximally stale rather than inventing freshness. */
export const UNKNOWN_UPDATED_DAYS = 3650;

const RAW_PAUSE_MS = 50;

/** The concept a skill occupies for the publisher cap: its declared name, else its directory. */
function conceptOf(path: string, frontmatter: Record<string, unknown>): string {
  const declared = frontmatter.name;
  if (typeof declared === 'string' && declared.trim() !== '') return normalizeConcept(declared);
  const segments = path.split('/');
  return normalizeConcept(segments[segments.length - 2] ?? path);
}

export interface RepoSnapshot {
  repo: RepoRef;
  /** The commit this run reads the repo at (enrichment's default-branch oid). */
  oid: string;
  tree: TreeFile[];
}

/**
 * Stage 1 for one repo, at one pinned commit. `RawSkill.sha` is the per-path commit when the path
 * has history, otherwise the snapshot oid — a COMMIT sha either way, never a blob sha, because
 * raw.githubusercontent.com resolves commits only. Makes no core request.
 */
export async function enumerateSkills(
  snapshot: RepoSnapshot,
  token: string,
  deps: EnumerateDeps & PathHistoryDeps = {},
): Promise<RawSkill[]> {
  const { repo, oid, tree } = snapshot;
  const log = deps.log ?? (() => {});
  const wait =
    deps.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  if (tree.length === 0) return [];

  // Spec 6.4 "has a README" is a repo-level fact — check it once, before spending any requests.
  if (!hasReadme(tree)) {
    log(`${repo.repo}: excluded, no repository README (inclusion filter 6.4)`);
    return [];
  }

  const files: TreeFile[] = filterSkillFiles(tree);
  log(`${repo.repo}: ${files.length} candidate skills from ${tree.length} tree entries`);
  if (files.length === 0) return [];

  const commits = await fetchPathCommits(
    repo.repo,
    oid,
    files.map((file) => file.path),
    token,
    deps,
  );
  const raws: RawSkill[] = [];

  for (const file of files) {
    const commit = commits.get(file.path);
    const ref = commit?.sha ?? oid;

    const text = await fetchRawFile(repo.repo, ref, file.path, deps);
    if (text === null) {
      log(`${repo.repo}:${file.path} vanished between tree and raw fetch`);
      continue;
    }

    const parsed = parseFrontmatter(text);
    const verdict = includeSkill({
      repo: repo.repo,
      path: file.path,
      hasReadme: true,
      description: parsed.frontmatter.description,
    });
    if (verdict !== 'included') {
      log(`${repo.repo}:${file.path} excluded: ${verdict}`);
      continue;
    }

    raws.push({
      repo: repo.repo,
      path: file.path,
      sha: ref,
      blobSha: file.sha,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      updatedDays: commit?.updatedDays ?? UNKNOWN_UPDATED_DAYS,
    });
    await wait(RAW_PAUSE_MS);
  }

  // Spec 6.3 trap 4: one 846-path monorepo must not ship the same concept a dozen times.
  return capPerPublisherPerConcept(raws, (raw) => ({
    publisher: publisherOf(raw.repo),
    concept: conceptOf(raw.path, raw.frontmatter),
  }));
}

// isRepoInternal is re-exported by the inclusion module; referenced here so the import is used
// by filterSkillFiles above and by nothing else.
void isRepoInternal;
