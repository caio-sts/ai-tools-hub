import type { RepoRef } from '../../src/types.ts';
import { MIN_STARS, passesRepoGate } from '../../src/lib/inclusion.ts';
export type FetchLike = typeof globalThis.fetch;

/** Measured GitHub `search` bucket limit: 30 requests per minute (spec 6.2). */
export const SEARCH_PER_MINUTE = 30;

/** Measured GitHub `code_search` bucket limit: 10 requests per minute (spec 6.2). */
export const CODE_SEARCH_PER_MINUTE = 10;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PacerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Pacer {
  take(): Promise<void>;
}

/** Sliding 60-second window; take() blocks until a slot is free. One pacer per bucket. */
export function createPacer(perMinute: number, deps: PacerDeps = {}): Pacer {
  const now = deps.now ?? (() => Date.now());
  const wait = deps.sleep ?? sleep;
  const hits: number[] = [];
  return {
    async take(): Promise<void> {
      for (;;) {
        const t = now();
        while (hits.length > 0 && t - hits[0] >= 60_000) hits.shift();
        if (hits.length < perMinute) {
          hits.push(t);
          return;
        }
        await wait(60_000 - (t - hits[0]) + 50);
      }
    },
  };
}

/** Topic sweeps. Content categories are NEVER seeded from topics (spec 3.4). */
export const DISCOVERY_TOPICS = [
  'claude-skills',
  'agent-skills',
  'openclaw-skills',
  'claude-code',
  'mcp-server',
] as const;

/**
 * Star partitions beat the hard 1,000-result cap on /search/repositories.
 * The lowest band is derived from MIN_STARS so the swept band and the admitted band
 * cannot drift apart.
 */
export const STAR_PARTITIONS: readonly string[] = ['>=1000', '100..999', `${MIN_STARS}..99`];

export function buildSearchQueries(
  topics: readonly string[] = DISCOVERY_TOPICS,
  partitions: readonly string[] = STAR_PARTITIONS,
): string[] {
  const out: string[] = [];
  for (const topic of topics) {
    for (const partition of partitions) {
      out.push(`topic:${topic} stars:${partition}`);
    }
  }
  return out;
}

const API = 'https://api.github.com';

/**
 * Discovery-local repo shape. It carries `isOrg`, which the shared `RepoRef` deliberately does
 * not: the org flag only exists to feed `passesRepoGate` here, and A5's enrichment is the
 * authority on collection metadata afterwards.
 */
export interface RepoSeed {
  repo: string;
  stars: number;
  isOrg: boolean;
}

export interface SearchPage {
  items: RepoSeed[];
  totalCount: number;
}

export interface RequestDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'ai-tools-hub-harvest',
    'x-github-api-version': '2022-11-28',
  };
}

function backoffMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter !== null && retryAfter.trim() !== '') return Number(retryAfter) * 1000;
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset !== null && reset.trim() !== '') {
    const ms = Number(reset) * 1000 - Date.now();
    if (ms > 0) return ms;
  }
  return 2000 * attempt;
}

interface RepoItem {
  full_name?: string;
  stargazers_count?: number;
  owner?: { type?: string };
}

function toSeed(item: RepoItem): RepoSeed | null {
  if (typeof item.full_name !== 'string') return null;
  return {
    repo: item.full_name,
    stars: item.stargazers_count ?? 0,
    isOrg: item.owner?.type === 'Organization',
  };
}

export async function searchPage(
  query: string,
  page: number,
  token: string,
  deps: RequestDeps = {},
): Promise<SearchPage> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const wait = deps.sleepImpl ?? sleep;
  const url =
    `${API}/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=stars&order=desc&per_page=100&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetchImpl(url, { headers: ghHeaders(token) });
    if (res.ok) {
      const body = (await res.json()) as { total_count?: number; items?: RepoItem[] };
      const items: RepoSeed[] = [];
      for (const item of body.items ?? []) {
        const seed = toSeed(item);
        if (seed !== null) items.push(seed);
      }
      return { items, totalCount: body.total_count ?? items.length };
    }
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await wait(backoffMs(res, attempt));
      continue;
    }
    throw new Error(`search "${query}" page ${page}: HTTP ${res.status}`);
  }
  throw new Error(`search "${query}" page ${page}: retries exhausted`);
}

/**
 * Spec 6.1: "one code-search pass for `path:.claude-plugin filename:marketplace.json` — the
 * highest-signal structured seed". This is the ONLY user of the code_search 10/min bucket, and
 * it needs the fine-grained PAT: GITHUB_TOKEN cannot do global code search (spec 6.2).
 */
export const MARKETPLACE_CODE_QUERY = 'path:.claude-plugin filename:marketplace.json';

interface CodeItem {
  repository?: RepoItem;
}

export async function codeSearchPage(
  page: number,
  token: string,
  deps: RequestDeps = {},
): Promise<SearchPage> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const wait = deps.sleepImpl ?? sleep;
  const url =
    `${API}/search/code?q=${encodeURIComponent(MARKETPLACE_CODE_QUERY)}` +
    `&per_page=100&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetchImpl(url, { headers: ghHeaders(token) });
    if (res.ok) {
      const body = (await res.json()) as { total_count?: number; items?: CodeItem[] };
      const seen = new Map<string, RepoSeed>();
      for (const item of body.items ?? []) {
        const seed = item.repository === undefined ? null : toSeed(item.repository);
        if (seed !== null && !seen.has(seed.repo)) seen.set(seed.repo, seed);
      }
      const items = [...seen.values()];
      return { items, totalCount: body.total_count ?? items.length };
    }
    // 422 is code search's own 1,000-result cap past page 10 — the end of the seed, not a fault.
    if (res.status === 422) return { items: [], totalCount: 0 };
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await wait(backoffMs(res, attempt));
      continue;
    }
    throw new Error(`code search page ${page}: HTTP ${res.status}`);
  }
  throw new Error(`code search page ${page}: retries exhausted`);
}

export interface DiscoverDeps extends RequestDeps {
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * The marketplace seed finds repos that carry no `topic:` at all, which the sweeps can never
 * reach. Its results still face the same repo gate; the seed buys recall, not an exemption.
 * Star counts on code-search results are best-effort — A5's enrichment is the authority.
 */
export async function discoverMarketplaceRepos(
  token: string,
  deps: DiscoverDeps = {},
): Promise<RepoSeed[]> {
  const log = deps.log ?? (() => {});
  const pacer = createPacer(CODE_SEARCH_PER_MINUTE, { now: deps.now, sleep: deps.sleepImpl });
  const found = new Map<string, RepoSeed>();

  for (let page = 1; page <= 10; page += 1) {
    await pacer.take();
    const { items, totalCount } = await codeSearchPage(page, token, deps);
    for (const seed of items) {
      const previous = found.get(seed.repo);
      if (previous === undefined || seed.stars > previous.stars) found.set(seed.repo, seed);
    }
    log(`marketplace seed page ${page}: ${items.length} repos of ${totalCount} file hits`);
    if (items.length === 0 || page * 100 >= totalCount) break;
  }

  return [...found.values()];
}

/**
 * Union of the star-partitioned topic sweeps and the marketplace code-search seed, deduped by
 * repo and filtered through the published repo gate (spec 6.4). Returns the shared `RepoRef`
 * shape; `isOrg` was only ever a gate input and does not leave this module.
 */
export async function discoverRepos(token: string, deps: DiscoverDeps = {}): Promise<RepoRef[]> {
  const log = deps.log ?? (() => {});
  const pacer = createPacer(SEARCH_PER_MINUTE, { now: deps.now, sleep: deps.sleepImpl });
  const found = new Map<string, RepoSeed>();

  const remember = (seed: RepoSeed): void => {
    const previous = found.get(seed.repo);
    if (previous === undefined) {
      found.set(seed.repo, seed);
      return;
    }
    found.set(seed.repo, {
      repo: seed.repo,
      stars: Math.max(previous.stars, seed.stars),
      isOrg: previous.isOrg || seed.isOrg,
    });
  };

  for (const query of buildSearchQueries()) {
    for (let page = 1; page <= 10; page += 1) {
      await pacer.take();
      const { items, totalCount } = await searchPage(query, page, token, deps);
      for (const seed of items) remember(seed);
      log(`${query} page ${page}: ${items.length} of ${totalCount}`);
      if (items.length < 100 || page * 100 >= totalCount) break;
    }
  }

  for (const seed of await discoverMarketplaceRepos(token, deps)) remember(seed);

  const admitted = [...found.values()].filter((seed) => passesRepoGate(seed));
  log(`discovery: ${admitted.length} repos admitted of ${found.size} found (floor ${MIN_STARS})`);

  return admitted
    .map(({ repo, stars }) => ({ repo, stars }))
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
}
