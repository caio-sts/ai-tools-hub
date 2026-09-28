# Budgeted, Resumable Crawl — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a full-discovery harvest finish — across several runs if needed — by narrowing discovery, cutting each repo to ~1 core request, stopping before any quota or the job timeout, and resuming where the last run stopped.

**Architecture:** A per-run `Budget` watches the core and GraphQL quotas and a wall clock. `runHarvest` walks an ordered queue (never-read repos by stars, then changed repos by stalest stored `pushedAt`), checking the budget between repos. Each repo is read at one pinned commit oid taken from GraphQL enrichment: one tree read, plus per-path commits in GraphQL batches of 50. Every clean stop writes what it has, so the stored `pushedAt` is the resume cursor.

**Tech Stack:** Node ≥ 22.18 running `.ts` directly (type stripping), TypeScript 5.9, Vitest 3, Astro, GitHub Actions, GitHub REST + GraphQL APIs.

**Spec:** [`docs/specs/2026-09-27-budgeted-crawl-design.md`](../specs/2026-09-27-budgeted-crawl-design.md) — read it before starting.

## Global Constraints

- Harvest scripts run as `node scripts/harvest/run.ts` with Node type stripping: **erasable TypeScript only** — no `enum`, no `namespace`, no constructor parameter properties; use `import type` for type-only imports; import paths end in `.ts`.
- Budget defaults: core reserve **200**, GraphQL reserve **200**, time budget from `HARVEST_TIME_BUDGET_MIN` (unset = no limit); `crawl.yml` sets **35**, `timeout-minutes` stays **50**.
- Path-commit GraphQL batch size: **50** paths per query.
- Discovery topics: `claude-skills`, `agent-skills`, `openclaw-skills` at `>=1000`, `100..999`, `10..99`; `claude-code` at `>=1000`, `100..999` only; **no `mcp-server`**. A topic may only raise its floor: overrides are subsets of `STAR_PARTITIONS`.
- Cron: **daily**, `'37 6 * * *'`.
- On-disk row shapes of `skills.json` and `collections.json` do not change. `meta.json` gains `discoveredCount: number`.
- Comments: ultraconcise; no comment that only restates the code.
- Commits: conventional `type(scope): subject`, body says why, and every message ends with the trailer
  `Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5`.
- Every `vitest` invocation runs `astro build` once in `tests/global-setup.ts` (~30–60 s). That is expected.

## Typecheck across the chain

Tasks 1–5 keep `npm run typecheck` green. **Tasks 6–8 change `enrichCollections`, `enumerateSkills` and `runHarvest` signatures in sequence: typecheck is expected to fail after Task 6 and Task 7, and must be green again at the end of Task 8.** In those tasks, verify with the task's own test files.

## File map

| File | Change | Responsibility |
|---|---|---|
| `scripts/harvest/budget.ts` | **create** | Quota/time guard, rate-limit detection, env parsing |
| `scripts/harvest/path-history.ts` | **create** | Per-path last commit via batched GraphQL |
| `scripts/harvest/enumerate.ts` | modify | `fetchTree` by ref + budget hooks; `enumerateSkills` over a pinned snapshot; REST path/head commit fetchers removed |
| `scripts/harvest/enrich.ts` | modify | Pinned oid per repo; `EnrichResult`; GraphQL quota reporting |
| `scripts/harvest/discover.ts` | modify | Per-topic star partitions |
| `scripts/harvest/run.ts` | modify | Queue order, budgeted loop, write rules, stuck-crawl error, logging, env |
| `src/types.ts`, `src/lib/data.ts` | modify | `Meta.discoveredCount` |
| `src/lib/format.ts` | modify | `coverage()` label helper |
| `src/lib/i18n/home.ts` | modify | `stats.coverageOf` |
| `src/pages/[lang]/index.astro`, `src/pages/[lang]/methodology.astro` | modify | "N of M" while partial |
| `.github/workflows/crawl.yml` | modify | Daily, time budget, `cancelled()`, issue reuse |
| `README.md`, `docs/specs/2026-08-29-ai-tools-hub-design.md` | modify | Amend scheduling and §6 |
| tests under `tests/harvest/`, `tests/lib/`, `tests/build/`, `tests/workflows/`, `tests/types.test.ts` | create/modify | as each task says |

---

### Task 1: The budget guard

**Files:**
- Create: `scripts/harvest/budget.ts`
- Test: `tests/harvest/budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type StopReason = 'core quota' | 'graphql quota' | 'time budget' | 'rate limited'`
  - `interface BudgetLimits { coreReserve: number; graphqlReserve: number; timeBudgetMs: number | null }`
  - `const DEFAULT_LIMITS: BudgetLimits`
  - `interface Budget { observeCore(res: Response): void; observeGraphql(remaining: number): void; exhausted(): StopReason | null }`
  - `function createBudget(limits?: Partial<BudgetLimits>, now?: () => number): Budget`
  - `function isRateLimited(res: Response): boolean`
  - `class RateLimitedError extends Error` (constructor takes `what: string`)
  - `function timeBudgetFromEnv(value: string | undefined): number | null`

- [ ] **Step 1: Write the failing test**

Create `tests/harvest/budget.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  RateLimitedError,
  createBudget,
  isRateLimited,
  timeBudgetFromEnv,
} from '../../scripts/harvest/budget.ts';

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers });
}

describe('createBudget', () => {
  it('ships the reserves the spec fixes, and no time limit by default', () => {
    expect(DEFAULT_LIMITS).toEqual({ coreReserve: 200, graphqlReserve: 200, timeBudgetMs: null });
  });

  it('is not exhausted before any response has been observed', () => {
    expect(createBudget().exhausted()).toBeNull();
  });

  it('stops on the core quota once x-ratelimit-remaining drops below the reserve', () => {
    const budget = createBudget();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '200' }));
    expect(budget.exhausted()).toBeNull();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '199' }));
    expect(budget.exhausted()).toBe('core quota');
  });

  it('ignores a response without a usable rate-limit header', () => {
    const budget = createBudget();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '10' }));
    budget.observeCore(res(200));
    budget.observeCore(res(200, { 'x-ratelimit-remaining': 'soon' }));
    expect(budget.exhausted()).toBe('core quota');
  });

  it('stops on the GraphQL quota, and ignores the -1 "unknown" sentinel', () => {
    const budget = createBudget();
    budget.observeGraphql(-1);
    expect(budget.exhausted()).toBeNull();
    budget.observeGraphql(150);
    expect(budget.exhausted()).toBe('graphql quota');
  });

  it('stops on elapsed time only when a time budget is set', () => {
    let t = 0;
    const timed = createBudget({ timeBudgetMs: 1000 }, () => t);
    const untimed = createBudget({}, () => t);
    t = 999;
    expect(timed.exhausted()).toBeNull();
    t = 1000;
    expect(timed.exhausted()).toBe('time budget');
    t = 10_000_000;
    expect(untimed.exhausted()).toBeNull();
  });

  it('honours custom reserves', () => {
    const budget = createBudget({ coreReserve: 5 });
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '5' }));
    expect(budget.exhausted()).toBeNull();
  });
});

describe('isRateLimited', () => {
  it('recognises the primary limit, the secondary limit and 429', () => {
    expect(isRateLimited(res(429))).toBe(true);
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '0' }))).toBe(true);
    expect(isRateLimited(res(403, { 'retry-after': '60' }))).toBe(true);
  });

  it('does not mistake a plain 403 or a success for a rate limit', () => {
    expect(isRateLimited(res(403))).toBe(false);
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '4000' }))).toBe(false);
    expect(isRateLimited(res(200, { 'x-ratelimit-remaining': '0' }))).toBe(false);
  });
});

describe('RateLimitedError', () => {
  it('names what was refused', () => {
    const error = new RateLimitedError('tree owner/repo');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RateLimitedError');
    expect(error.message).toBe('tree owner/repo: rate limited');
  });
});

describe('timeBudgetFromEnv', () => {
  it('reads minutes and returns milliseconds', () => {
    expect(timeBudgetFromEnv('35')).toBe(2_100_000);
    expect(timeBudgetFromEnv('0.5')).toBe(30_000);
  });

  it('means "no limit" when unset or blank', () => {
    expect(timeBudgetFromEnv(undefined)).toBeNull();
    expect(timeBudgetFromEnv('')).toBeNull();
    expect(timeBudgetFromEnv('  ')).toBeNull();
  });

  it('refuses a value it cannot honour, instead of running unbounded', () => {
    expect(() => timeBudgetFromEnv('abc')).toThrow('HARVEST_TIME_BUDGET_MIN');
    expect(() => timeBudgetFromEnv('0')).toThrow('HARVEST_TIME_BUDGET_MIN');
    expect(() => timeBudgetFromEnv('-5')).toThrow('HARVEST_TIME_BUDGET_MIN');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harvest/budget.test.ts`
Expected: FAIL — `Failed to load url ../../scripts/harvest/budget.ts` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `scripts/harvest/budget.ts`:

```ts
export type StopReason = 'core quota' | 'graphql quota' | 'time budget' | 'rate limited';

export interface BudgetLimits {
  coreReserve: number;
  graphqlReserve: number;
  /** null = no time limit. */
  timeBudgetMs: number | null;
}

export const DEFAULT_LIMITS: BudgetLimits = { coreReserve: 200, graphqlReserve: 200, timeBudgetMs: null };

/** Checked between repos, never inside one (spec §3.4). */
export interface Budget {
  observeCore(res: Response): void;
  observeGraphql(remaining: number): void;
  exhausted(): StopReason | null;
}

export function createBudget(limits: Partial<BudgetLimits> = {}, now: () => number = Date.now): Budget {
  const { coreReserve, graphqlReserve, timeBudgetMs } = { ...DEFAULT_LIMITS, ...limits };
  const started = now();
  let core = Number.POSITIVE_INFINITY;
  let graphql = Number.POSITIVE_INFINITY;

  return {
    observeCore(res) {
      const header = res.headers.get('x-ratelimit-remaining');
      if (header === null || header.trim() === '') return;
      const remaining = Number(header);
      if (Number.isFinite(remaining)) core = remaining;
    },
    observeGraphql(remaining) {
      if (remaining >= 0) graphql = remaining;
    },
    exhausted() {
      if (core < coreReserve) return 'core quota';
      if (graphql < graphqlReserve) return 'graphql quota';
      if (timeBudgetMs !== null && now() - started >= timeBudgetMs) return 'time budget';
      return null;
    },
  };
}

/** Primary limit (remaining 0), secondary limit (retry-after), or 429. */
export function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  return res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null;
}

export class RateLimitedError extends Error {
  constructor(what: string) {
    super(`${what}: rate limited`);
    this.name = 'RateLimitedError';
  }
}

export function timeBudgetFromEnv(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`HARVEST_TIME_BUDGET_MIN must be a positive number of minutes, got "${value}"`);
  }
  return minutes * 60_000;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/harvest/budget.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/harvest/budget.ts tests/harvest/budget.test.ts
git commit -m "feat(harvest): add a quota and time budget the crawl can stop on

The crawl ran into the 50-minute job timeout with no way to stop itself.
The budget reads x-ratelimit-remaining and the GraphQL remaining points,
plus an optional wall-clock limit, so a run can stop cleanly between repos.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 2: `fetchTree` reads a pinned ref and reports its quota

**Files:**
- Modify: `scripts/harvest/enumerate.ts:1-65` (imports, `EnumerateDeps`, `fetchTree`)
- Test: `tests/harvest/fetch-tree.test.ts`

**Interfaces:**
- Consumes: `isRateLimited`, `RateLimitedError` from Task 1.
- Produces:
  - `EnumerateDeps` gains `onCoreResponse?: (res: Response) => void`.
  - `fetchTree(repo: string, token: string, deps?: EnumerateDeps, ref?: string): Promise<TreeFile[]>` — `ref` defaults to `'HEAD'`; throws `RateLimitedError` when rate-limited.

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('fetchTree', …)` block of `tests/harvest/fetch-tree.test.ts`, and add the import `import { RateLimitedError } from '../../scripts/harvest/budget.ts';` at the top:

```ts
  it('reads the tree at a pinned commit oid when one is given', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify({ truncated: false, tree: [] }), { status: 200 });
    });
    await fetchTree('owner/repo', 'tok', { fetchImpl }, '9892f18037231b42bdbdb6cc6ecdb2f5d58eff0e');
    expect(urls).toEqual([
      'https://api.github.com/repos/owner/repo/git/trees/9892f18037231b42bdbdb6cc6ecdb2f5d58eff0e?recursive=1',
    ]);
  });

  it('hands every response to the core-quota observer', async () => {
    const seen: string[] = [];
    const fetchImpl = stubFetch(
      () =>
        new Response(JSON.stringify({ truncated: false, tree: [] }), {
          status: 200,
          headers: { 'x-ratelimit-remaining': '4321' },
        }),
    );
    await fetchTree('owner/repo', 'tok', {
      fetchImpl,
      onCoreResponse: (res) => seen.push(res.headers.get('x-ratelimit-remaining') ?? ''),
    });
    expect(seen).toEqual(['4321']);
  });

  it('throws RateLimitedError, not a plain HTTP error, when the quota is spent', async () => {
    const fetchImpl = stubFetch(
      () => new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    );
    await expect(fetchTree('owner/repo', 'tok', { fetchImpl })).rejects.toBeInstanceOf(RateLimitedError);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/harvest/fetch-tree.test.ts`
Expected: FAIL — the pinned-oid test gets a `HEAD` URL; the observer test sees `[]`; the 403 test rejects with `Error: tree owner/repo: HTTP 403`.

- [ ] **Step 3: Implement**

In `scripts/harvest/enumerate.ts`, add to the imports:

```ts
import { RateLimitedError, isRateLimited } from './budget.ts';
```

Add the observer to `EnumerateDeps`:

```ts
export interface EnumerateDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
  onCoreResponse?: (res: Response) => void;
}
```

Replace the doc comment and the head of `fetchTree` (through the `if (!res.ok)` line) with:

```ts
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
```

The rest of the function body is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/harvest/fetch-tree.test.ts tests/harvest/enumerate.test.ts`
Expected: PASS — the existing `HEAD` URL test still passes because `ref` defaults to `'HEAD'`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/harvest/enumerate.ts tests/harvest/fetch-tree.test.ts
git commit -m "feat(harvest): read a tree at a pinned ref and report its quota

Reading the tree at HEAD while pinning content to a separately fetched
commit left a window for a push to land in between. fetchTree now takes
the ref, reports each response to the core-quota observer, and raises
RateLimitedError instead of a generic HTTP error when the quota is spent.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 3: Per-path last commit via batched GraphQL

**Files:**
- Create: `scripts/harvest/path-history.ts`
- Test: `tests/harvest/path-history.test.ts`

**Interfaces:**
- Consumes: `splitRepo`, `GITHUB_GRAPHQL_URL` from `scripts/harvest/enrich.ts`; `isRateLimited`, `RateLimitedError` from Task 1; `FetchLike` type from `scripts/harvest/discover.ts`.
- Produces:
  - `const PATH_BATCH_SIZE = 50`
  - `interface PathCommit { sha: string; updatedDays: number }` (this becomes the only definition; Task 7 deletes the one in `enumerate.ts`)
  - `interface PathHistoryDeps { fetchImpl?: FetchLike; now?: () => number; onGraphqlRemaining?: (remaining: number) => void }`
  - `function buildPathHistoryQuery(repo: string, oid: string, paths: string[]): string`
  - `function parsePathHistory(payload: PathHistoryPayload, paths: string[], nowMs: number): { commits: Map<string, PathCommit>; remaining: number }`
  - `function fetchPathCommits(repo: string, oid: string, paths: string[], token: string, deps?: PathHistoryDeps): Promise<Map<string, PathCommit>>`

- [ ] **Step 1: Write the failing test**

Create `tests/harvest/path-history.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RateLimitedError } from '../../scripts/harvest/budget.ts';
import {
  PATH_BATCH_SIZE,
  buildPathHistoryQuery,
  fetchPathCommits,
  parsePathHistory,
} from '../../scripts/harvest/path-history.ts';

const OID = '9892f18037231b42bdbdb6cc6ecdb2f5d58eff0e';
const NOW = Date.parse('2026-08-29T00:00:00Z');
const ALIAS_RE = /^ +(p\d+): history\(first: 1, path: ("(?:[^"\\]|\\.)*")\)/gm;

describe('buildPathHistoryQuery', () => {
  it('asks one aliased history per path, at the pinned commit, with the rate limit', () => {
    const query = buildPathHistoryQuery('owner/repo', OID, ['skills/a/SKILL.md', 'skills/b/SKILL.md']);
    expect(query).toContain('rateLimit { cost remaining }');
    expect(query).toContain('repository(owner: "owner", name: "repo")');
    expect(query).toContain(`object(oid: "${OID}")`);
    expect(query).toContain('... on Commit {');
    expect(query).toContain('p0: history(first: 1, path: "skills/a/SKILL.md") { nodes { oid committedDate } }');
    expect(query).toContain('p1: history(first: 1, path: "skills/b/SKILL.md") { nodes { oid committedDate } }');
  });

  it('escapes a path so it cannot break out of the string literal', () => {
    const query = buildPathHistoryQuery('owner/repo', OID, ['weird "name"/SKILL.md']);
    expect(query).toContain('path: "weird \\"name\\"/SKILL.md"');
  });

  it('caps a batch at 50 paths and refuses an empty one', () => {
    const many = Array.from({ length: PATH_BATCH_SIZE + 1 }, (_, i) => `s${i}/SKILL.md`);
    expect(PATH_BATCH_SIZE).toBe(50);
    expect(() => buildPathHistoryQuery('owner/repo', OID, many)).toThrow('exceeds PATH_BATCH_SIZE 50');
    expect(() => buildPathHistoryQuery('owner/repo', OID, many.slice(0, 50))).not.toThrow();
    expect(() => buildPathHistoryQuery('owner/repo', OID, [])).toThrow('empty batch');
  });
});

describe('parsePathHistory', () => {
  const paths = ['a/SKILL.md', 'b/SKILL.md'];

  it('maps each alias back onto its path, with the age in whole days', () => {
    const { commits, remaining } = parsePathHistory(
      {
        data: {
          rateLimit: { cost: 1, remaining: 4970 },
          repository: {
            object: {
              p0: { nodes: [{ oid: 'c0ffee1', committedDate: '2026-07-15T00:00:00Z' }] },
              p1: { nodes: [{ oid: 'beef', committedDate: '2026-09-30T00:00:00Z' }] },
            },
          },
        },
      },
      paths,
      NOW,
    );
    expect(remaining).toBe(4970);
    expect(commits.get('a/SKILL.md')).toEqual({ sha: 'c0ffee1', updatedDays: 45 });
    // A commit dated after "now" never reports a negative age.
    expect(commits.get('b/SKILL.md')).toEqual({ sha: 'beef', updatedDays: 0 });
  });

  it('leaves a path with no history out, so the caller falls back to the pinned oid', () => {
    const { commits } = parsePathHistory(
      { data: { rateLimit: { cost: 1, remaining: 10 }, repository: { object: { p0: { nodes: [] }, p1: null } } } },
      paths,
      NOW,
    );
    expect(commits.size).toBe(0);
  });

  it('returns nothing when the repository vanished since enrichment', () => {
    const { commits, remaining } = parsePathHistory({ data: { rateLimit: null, repository: null } }, paths, NOW);
    expect(commits.size).toBe(0);
    expect(remaining).toBe(-1);
  });

  it('raises RateLimitedError on a RATE_LIMITED GraphQL error', () => {
    expect(() =>
      parsePathHistory({ data: null, errors: [{ type: 'RATE_LIMITED', message: 'API rate limit exceeded' }] }, paths, NOW),
    ).toThrow(RateLimitedError);
  });

  it('throws loudly when the response carries no data', () => {
    expect(() => parsePathHistory({ errors: [{ message: 'Something went wrong' }] }, paths, NOW)).toThrow(
      'path history: GraphQL response carried no data (Something went wrong)',
    );
  });
});

function graphqlStub(remaining: number, status = 200, headers: Record<string, string> = {}) {
  const queries: string[] = [];
  const reported: number[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const query = (JSON.parse(String(init?.body)) as { query: string }).query;
    queries.push(query);
    if (status !== 200) return new Response('', { status, headers });
    const object: Record<string, unknown> = {};
    for (const [, alias] of query.matchAll(ALIAS_RE)) {
      object[alias!] = { nodes: [{ oid: `sha-${alias}`, committedDate: '2026-08-28T00:00:00Z' }] };
    }
    return new Response(JSON.stringify({ data: { rateLimit: { cost: 1, remaining }, repository: { object } } }), {
      status: 200,
    });
  }) as typeof fetch;
  return { queries, reported, fetchImpl };
}

describe('fetchPathCommits', () => {
  it('splits 51 paths into two queries and merges the answers', async () => {
    const paths = Array.from({ length: 51 }, (_, i) => `s${i}/SKILL.md`);
    const { queries, reported, fetchImpl } = graphqlStub(4900);

    const commits = await fetchPathCommits('owner/repo', OID, paths, 'tok', {
      fetchImpl,
      now: () => NOW,
      onGraphqlRemaining: (r) => reported.push(r),
    });

    expect(queries).toHaveLength(2);
    expect([...queries[0]!.matchAll(ALIAS_RE)]).toHaveLength(50);
    expect([...queries[1]!.matchAll(ALIAS_RE)]).toHaveLength(1);
    expect(commits.size).toBe(51);
    expect(commits.get('s50/SKILL.md')).toEqual({ sha: 'sha-p0', updatedDays: 1 });
    expect(reported).toEqual([4900, 4900]);
  });

  it('makes no request for an empty path list', async () => {
    const { queries, fetchImpl } = graphqlStub(4900);
    expect((await fetchPathCommits('owner/repo', OID, [], 'tok', { fetchImpl })).size).toBe(0);
    expect(queries).toHaveLength(0);
  });

  it('raises RateLimitedError on a rate-limited HTTP response', async () => {
    const { fetchImpl } = graphqlStub(0, 403, { 'x-ratelimit-remaining': '0' });
    await expect(fetchPathCommits('owner/repo', OID, ['a/SKILL.md'], 'tok', { fetchImpl })).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it('throws on any other non-OK response', async () => {
    const { fetchImpl } = graphqlStub(0, 502);
    await expect(fetchPathCommits('owner/repo', OID, ['a/SKILL.md'], 'tok', { fetchImpl })).rejects.toThrow(
      'path history owner/repo: GraphQL HTTP 502',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/harvest/path-history.test.ts`
Expected: FAIL — module `scripts/harvest/path-history.ts` does not exist.

- [ ] **Step 3: Write the implementation**

Create `scripts/harvest/path-history.ts`:

```ts
import { RateLimitedError, isRateLimited } from './budget.ts';
import type { FetchLike } from './discover.ts';
import { GITHUB_GRAPHQL_URL, splitRepo } from './enrich.ts';

/**
 * One GraphQL query answers 50 "last commit touching this path" lookups for 1 point, where REST
 * spends one core request each. Measured identical sha and date to `commits?path=&per_page=1`.
 */
export const PATH_BATCH_SIZE = 50;

export interface PathCommit {
  sha: string;
  updatedDays: number;
}

export interface PathHistoryDeps {
  fetchImpl?: FetchLike;
  now?: () => number;
  onGraphqlRemaining?: (remaining: number) => void;
}

interface HistoryNode {
  oid?: string;
  committedDate?: string;
}

export interface PathHistoryPayload {
  data?: {
    rateLimit?: { remaining: number } | null;
    repository?: { object?: Record<string, { nodes?: HistoryNode[] } | null> | null } | null;
  } | null;
  errors?: Array<{ type?: string; message: string }> | null;
}

export function buildPathHistoryQuery(repo: string, oid: string, paths: string[]): string {
  if (paths.length === 0) throw new Error('path history: cannot build a query for an empty batch');
  if (paths.length > PATH_BATCH_SIZE) {
    throw new Error(`path history: batch of ${paths.length} exceeds PATH_BATCH_SIZE ${PATH_BATCH_SIZE}`);
  }
  const { owner, name } = splitRepo(repo);
  const aliases = paths.map(
    (path, index) =>
      `        p${index}: history(first: 1, path: ${JSON.stringify(path)}) { nodes { oid committedDate } }`,
  );
  return [
    'query PathHistory {',
    '  rateLimit { cost remaining }',
    `  repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {`,
    `    object(oid: ${JSON.stringify(oid)}) {`,
    '      ... on Commit {',
    ...aliases,
    '      }',
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}

export function parsePathHistory(
  payload: PathHistoryPayload,
  paths: string[],
  nowMs: number,
): { commits: Map<string, PathCommit>; remaining: number } {
  if ((payload.errors ?? []).some((error) => error.type === 'RATE_LIMITED')) {
    throw new RateLimitedError('path history');
  }
  const data = payload.data;
  if (!data) {
    const detail = (payload.errors ?? []).map((error) => error.message).join('; ') || 'no data field';
    throw new Error(`path history: GraphQL response carried no data (${detail})`);
  }

  const commits = new Map<string, PathCommit>();
  const object = data.repository?.object ?? null;
  if (object !== null) {
    paths.forEach((path, index) => {
      const node = object[`p${index}`]?.nodes?.[0];
      if (typeof node?.oid !== 'string' || typeof node.committedDate !== 'string') return;
      const ms = nowMs - Date.parse(node.committedDate);
      commits.set(path, { sha: node.oid, updatedDays: Math.max(0, Math.floor(ms / 86_400_000)) });
    });
  }
  return { commits, remaining: data.rateLimit?.remaining ?? -1 };
}

export async function fetchPathCommits(
  repo: string,
  oid: string,
  paths: string[],
  token: string,
  deps: PathHistoryDeps = {},
): Promise<Map<string, PathCommit>> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const out = new Map<string, PathCommit>();

  for (let i = 0; i < paths.length; i += PATH_BATCH_SIZE) {
    const batch = paths.slice(i, i + PATH_BATCH_SIZE);
    const res = await fetchImpl(GITHUB_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        authorization: `bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': 'ai-tools-hub-harvest',
      },
      body: JSON.stringify({ query: buildPathHistoryQuery(repo, oid, batch) }),
    });
    if (isRateLimited(res)) throw new RateLimitedError(`path history ${repo}`);
    if (!res.ok) throw new Error(`path history ${repo}: GraphQL HTTP ${res.status}`);
    const { commits, remaining } = parsePathHistory((await res.json()) as PathHistoryPayload, batch, now());
    deps.onGraphqlRemaining?.(remaining);
    for (const [path, commit] of commits) out.set(path, commit);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/harvest/path-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/harvest/path-history.ts tests/harvest/path-history.test.ts
git commit -m "feat(harvest): fetch per-path last commits in GraphQL batches of 50

One REST call per SKILL.md was the dominant cost: a single 903-skill repo
spent 18% of an hour's core quota. One aliased GraphQL query answers 50
paths for 1 point, and returned the same sha and date as REST on every
path checked.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 4: `meta.discoveredCount`

**Files:**
- Modify: `src/types.ts:85-90` (`Meta`)
- Modify: `src/lib/data.ts:9-14` (`EMPTY_META`), `src/lib/data.ts:54-63` (`loadMeta`)
- Modify: `scripts/harvest/run.ts:421-427` (meta literal), `scripts/harvest/run.ts:563-564` (`validateCatalog`)
- Test: `tests/lib/data.test.ts`, `tests/harvest/persistence.test.ts`, `tests/harvest/catalog-shape.test.ts`, `tests/harvest/apply-assignments.test.ts`, `tests/harvest/run-harvest.test.ts:153-158`, `tests/types.test.ts:101-106`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Meta.discoveredCount: number`; `loadMeta` returns it (legacy files: `= sourceCount`); `validateCatalog` reports `'meta.discoveredCount is below meta.sourceCount'`.

- [ ] **Step 1: Write the failing tests**

In `tests/lib/data.test.ts`, replace the whole `'normalises a partial meta.json instead of returning undefined fields'` test (lines 60-64) with:

```ts
  it('normalises a partial meta.json instead of returning undefined fields', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'meta.json'), '{"skillCount":7}', 'utf8');
    expect(loadMeta(dir)).toEqual({
      crawledAt: NEVER_CRAWLED,
      classifiedAt: null,
      skillCount: 7,
      sourceCount: 0,
      discoveredCount: 0,
    });
  });

  it('reads a meta.json written before discoveredCount existed as a complete catalog', async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, 'meta.json'),
      '{"crawledAt":"2026-08-31T02:43:59.295Z","classifiedAt":null,"skillCount":101,"sourceCount":3}',
      'utf8',
    );
    expect(loadMeta(dir).discoveredCount).toBe(3);
  });

  it('keeps discoveredCount when meta.json carries it', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'meta.json'), '{"skillCount":1,"sourceCount":3,"discoveredCount":4400}', 'utf8');
    expect(loadMeta(dir).discoveredCount).toBe(4400);
  });
```

In `tests/harvest/persistence.test.ts`, add `discoveredCount: 5,` after `sourceCount: 3,` in the round-trip `meta` literal.

In `tests/harvest/catalog-shape.test.ts`, change the `meta()` helper on line 56 to:

```ts
  return { crawledAt: '2026-08-29T00:00:00.000Z', classifiedAt: null, skillCount: 1, sourceCount: 1, discoveredCount: 1, ...overrides };
```

and add a test next to the other meta checks:

```ts
  it('refuses a coverage figure that claims fewer discovered repos than it holds', () => {
    expect(problems([], [], meta({ skillCount: 0, sourceCount: 0, discoveredCount: 0 }))).toEqual([]);
    const found = problems([], [], meta({ skillCount: 0, sourceCount: 0, discoveredCount: -1 }));
    expect(found).toContain('meta.discoveredCount is below meta.sourceCount');
  });
```

(`problems(skills, collections, meta)` is the helper the neighbouring tests already call, e.g. at line 117.)

In `tests/harvest/apply-assignments.test.ts`, inside `describe('applyAssignmentsToCatalog …')`, next to `'stamps classifiedAt…'`, add:

```ts
  it('keeps discoveredCount, because it rewrites meta.json through loadMeta', async () => {
    const dir = await seed({ [`tob/skills@${SHA}:${PATH}`]: ASSIGNMENT });
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 1, sourceCount: 1, discoveredCount: 4400 }, null, 2)}\n`,
      'utf8',
    );
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { discoveredCount: number };
    expect(meta.discoveredCount).toBe(4400);
  });
```

In `tests/harvest/run-harvest.test.ts`, the `toEqual` on lines 153-158 gains `discoveredCount: 2,`.

In `tests/types.test.ts`, the `meta: Meta` literal on lines 101-106 gains `discoveredCount: 1,`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/data.test.ts tests/harvest/persistence.test.ts tests/harvest/catalog-shape.test.ts tests/harvest/apply-assignments.test.ts tests/harvest/run-harvest.test.ts`
Expected: FAIL — `discoveredCount` is missing from `loadMeta` output, the new validation message is never produced, and the apply-assignments test reads `undefined`.

- [ ] **Step 3: Implement**

`src/types.ts`, `Meta`:

```ts
export interface Meta {
  crawledAt: string;
  classifiedAt: string | null;
  skillCount: number;
  sourceCount: number;
  /** Repos the last discovery admitted; sourceCount < discoveredCount means partial. */
  discoveredCount: number;
}
```

`src/lib/data.ts`, `EMPTY_META` gains `discoveredCount: 0,`. `loadMeta` becomes:

```ts
export function loadMeta(dataDir: string = DEFAULT_DATA_DIR): Meta {
  const parsed = readJson(dataDir, 'meta.json') as Partial<Meta> | null;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_META };
  const sourceCount = typeof parsed.sourceCount === 'number' ? parsed.sourceCount : 0;
  return {
    crawledAt: typeof parsed.crawledAt === 'string' ? parsed.crawledAt : NEVER_CRAWLED,
    classifiedAt: typeof parsed.classifiedAt === 'string' ? parsed.classifiedAt : null,
    skillCount: typeof parsed.skillCount === 'number' ? parsed.skillCount : 0,
    sourceCount,
    // Written before coverage existed: that crawl claimed to be complete.
    discoveredCount: typeof parsed.discoveredCount === 'number' ? parsed.discoveredCount : sourceCount,
  };
}
```

`scripts/harvest/run.ts`, the `meta` literal inside `runHarvest` gains `discoveredCount: collections.length,` (today every enriched repo is written, so this equals `sourceCount`; Task 8 changes both).

`scripts/harvest/run.ts`, `validateCatalog`, after the `sourceCount` check:

```ts
  if (meta.discoveredCount < meta.sourceCount) add('meta', 'meta.discoveredCount is below meta.sourceCount');
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/data.test.ts tests/harvest/persistence.test.ts tests/harvest/catalog-shape.test.ts tests/harvest/apply-assignments.test.ts tests/harvest/run-harvest.test.ts tests/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. If it flags another `Meta` literal, add `discoveredCount` to it with the same value as its `sourceCount`.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/lib/data.ts scripts/harvest/run.ts tests/lib/data.test.ts tests/harvest/persistence.test.ts tests/harvest/catalog-shape.test.ts tests/harvest/apply-assignments.test.ts tests/harvest/run-harvest.test.ts tests/types.test.ts
git commit -m "feat(data): record how many repos discovery admitted

A crawl that stops on its budget publishes a partial catalog, and the site
must be able to say so. loadMeta copies known fields only, and the
classification PR rewrites meta.json through it, so the field has to be
part of Meta or every classification would silently erase it.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 5: Per-topic star partitions; drop `mcp-server`

**Files:**
- Modify: `scripts/harvest/discover.ts:44-71`
- Test: `tests/harvest/queries.test.ts`, `tests/harvest/discover.test.ts:56`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DISCOVERY_TOPICS` (4 topics); `TOPIC_PARTITIONS: Readonly<Record<string, readonly string[]>>`; `buildSearchQueries(topics?, partitions?, overrides?)`.

- [ ] **Step 1: Write the failing tests**

Replace the body of `tests/harvest/queries.test.ts` from the import block down with:

```ts
import { describe, expect, it } from 'vitest';
import { MIN_STARS } from '../../src/lib/inclusion.ts';
import {
  buildSearchQueries,
  DISCOVERY_TOPICS,
  STAR_PARTITIONS,
  TOPIC_PARTITIONS,
} from '../../scripts/harvest/discover.ts';

describe('buildSearchQueries', () => {
  it('sweeps every topic across its star partitions', () => {
    const queries = buildSearchQueries();
    expect(queries).toHaveLength(11);
    expect(queries[0]).toBe('topic:claude-skills stars:>=1000');
    expect(queries[1]).toBe('topic:claude-skills stars:100..999');
    expect(queries[2]).toBe('topic:claude-skills stars:10..99');
    expect(queries).toContain('topic:openclaw-skills stars:100..999');
    expect(queries).toContain('topic:claude-code stars:100..999');
  });

  it('keeps claude-code above 100 stars and drops mcp-server entirely (2026-09-27 cut)', () => {
    const queries = buildSearchQueries();
    expect(queries).not.toContain('topic:claude-code stars:10..99');
    expect(queries.some((q) => q.includes('mcp-server'))).toBe(false);
  });

  it('partitions so no single query can hit the hard 1000-result cap silently', () => {
    expect([...STAR_PARTITIONS]).toEqual(['>=1000', '100..999', '10..99']);
    expect([...DISCOVERY_TOPICS]).toEqual(['claude-skills', 'agent-skills', 'openclaw-skills', 'claude-code']);
  });

  it('lets a topic raise its own floor, never lower it', () => {
    for (const partitions of Object.values(TOPIC_PARTITIONS)) {
      for (const partition of partitions) expect(STAR_PARTITIONS).toContain(partition);
    }
  });

  it('derives its lowest band from the one published stars floor', () => {
    expect(MIN_STARS).toBe(10);
    expect(STAR_PARTITIONS[STAR_PARTITIONS.length - 1]).toBe(`${MIN_STARS}..99`);
    for (const q of buildSearchQueries()) {
      expect(q).not.toContain('stars:0');
      expect(q).not.toContain('stars:1..');
    }
  });

  it('accepts explicit topics, partitions and overrides', () => {
    expect(buildSearchQueries(['x'], ['10..99'])).toEqual(['topic:x stars:10..99']);
    expect(buildSearchQueries(['x', 'y'], ['10..99', '>=1000'], { y: ['>=1000'] })).toEqual([
      'topic:x stars:10..99',
      'topic:x stars:>=1000',
      'topic:y stars:>=1000',
    ]);
  });
});
```

In `tests/harvest/discover.test.ts` line 56, change the routed query from `'topic:mcp-server stars:10..99'` to `'topic:openclaw-skills stars:10..99'` (that query is swept and not routed elsewhere in the test).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/harvest/queries.test.ts tests/harvest/discover.test.ts`
Expected: FAIL — 15 queries instead of 11, `TOPIC_PARTITIONS` is not exported, `mcp-server` is still swept.

- [ ] **Step 3: Implement**

In `scripts/harvest/discover.ts`, replace `DISCOVERY_TOPICS` and `buildSearchQueries` (keep `STAR_PARTITIONS` and its comment between them as is):

```ts
/** Topic sweeps. Content categories are NEVER seeded from topics (spec 3.4). */
export const DISCOVERY_TOPICS = ['claude-skills', 'agent-skills', 'openclaw-skills', 'claude-code'] as const;
```

```ts
/**
 * Per-topic bands, each a subset of STAR_PARTITIONS: a topic may raise its floor, never lower it.
 * claude-code 10..99 alone held 7,610 repos on 2026-09-27 (budgeted-crawl spec §3.1).
 */
export const TOPIC_PARTITIONS: Readonly<Record<string, readonly string[]>> = {
  'claude-code': ['>=1000', '100..999'],
};

export function buildSearchQueries(
  topics: readonly string[] = DISCOVERY_TOPICS,
  partitions: readonly string[] = STAR_PARTITIONS,
  overrides: Readonly<Record<string, readonly string[]>> = TOPIC_PARTITIONS,
): string[] {
  const out: string[] = [];
  for (const topic of topics) {
    for (const partition of overrides[topic] ?? partitions) {
      out.push(`topic:${topic} stars:${partition}`);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/harvest/queries.test.ts tests/harvest/discover.test.ts tests/harvest/marketplace-seed.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/harvest/discover.ts tests/harvest/queries.test.ts tests/harvest/discover.test.ts
git commit -m "feat(discover): drop mcp-server and keep claude-code above 100 stars

Discovery admitted 7,005 repos. mcp-server contributed 1,851 that no other
source finds, and only 3 of 12 sampled had a SKILL.md; MCP servers are out
of v1 scope anyway. claude-code yielded 7 of 12, so it stays, but its
10..99 band alone holds 7,610 repos.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 6: Enrichment returns the pinned oid and reports GraphQL quota

> Typecheck will fail after this task (`run.ts` still expects `Collection[]`). Task 8 restores it.

**Files:**
- Modify: `scripts/harvest/enrich.ts:25-189`
- Test: `tests/harvest/enrich-query.test.ts`, `tests/harvest/enrich-parse.test.ts`, `tests/harvest/enrich-collections.test.ts`

**Interfaces:**
- Consumes: `FetchLike` type from `discover.ts`.
- Produces:
  - fragment field `defaultBranchRef { target { oid } }`
  - `EnrichRepoNode.defaultBranchRef: { target: { oid: string } | null } | null`
  - `EnrichBatchResult.headOids: Map<string, string>` (only repos that have a default branch)
  - `interface EnrichDeps { fetchImpl?: FetchLike; onGraphqlRemaining?: (remaining: number) => void }`
  - `interface EnrichResult { collections: Collection[]; headOids: Map<string, string> }`
  - `enrichCollections(repos: RepoRef[], token: string, deps?: EnrichDeps): Promise<EnrichResult>`

- [ ] **Step 1: Write the failing tests**

`tests/harvest/enrich-query.test.ts`, inside the first test add:

```ts
    expect(query).toContain('  defaultBranchRef { target { oid } }');
```

`tests/harvest/enrich-parse.test.ts`: add `defaultBranchRef: { target: { oid: 'head-r0' } },` to the `r0` node and `defaultBranchRef: null,` to the `r1` node of the first test, then add at the end of that test:

```ts
    expect(result.headOids).toEqual(new Map([['anthropics/skills', 'head-r0']]));
```

If any test in that file compares the whole result object with `toEqual({ collections, missing, remaining })`, add `headOids: new Map()` (or the expected map) to it.

`tests/harvest/enrich-collections.test.ts`:
- In `node()`, add `defaultBranchRef: { target: { oid: \`oid-${nameWithOwner}\` } },`.
- In the first test, change `const collections = await enrichCollections(repos, 'ghp_test');` to
  `const { collections, headOids } = await enrichCollections(repos, 'ghp_test');` and add
  `expect(headOids.get('owner/repo-50')).toBe('oid-owner/repo-50');`.
- Add:

```ts
  it('reports the GraphQL points left after every batch', async () => {
    stubFetch(4900);
    const reported: number[] = [];
    const repos = Array.from({ length: 51 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    await enrichCollections(repos, 'ghp_test', { onGraphqlRemaining: (r) => reported.push(r) });
    expect(reported).toEqual([4900, 4900]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/harvest/enrich-query.test.ts tests/harvest/enrich-parse.test.ts tests/harvest/enrich-collections.test.ts`
Expected: FAIL — no `defaultBranchRef` in the query, `headOids` undefined, destructuring an array.

- [ ] **Step 3: Implement**

In `scripts/harvest/enrich.ts`:

Add the import `import type { FetchLike } from './discover.ts';`.

In `buildEnrichQuery`, after `'  owner { __typename }',` add:

```ts
    '  defaultBranchRef { target { oid } }',
```

`EnrichRepoNode` gains:

```ts
  defaultBranchRef: { target: { oid: string } | null } | null;
```

`EnrichBatchResult` gains:

```ts
  /** The commit every read of the repo in this run is pinned to. Empty repos have none. */
  headOids: Map<string, string>;
```

In `parseEnrichResponse`: declare `const headOids = new Map<string, string>();` next to `missing`; inside the `forEach`, after the `if (!node)` guard:

```ts
    const oid = node.defaultBranchRef?.target?.oid;
    if (typeof oid === 'string') headOids.set(ref.repo, oid);
```

and return `{ collections, missing, remaining: rate?.remaining ?? -1, headOids }`.

Replace `postEnrichQuery` and `enrichCollections`:

```ts
export interface EnrichDeps {
  fetchImpl?: FetchLike;
  onGraphqlRemaining?: (remaining: number) => void;
}

export interface EnrichResult {
  collections: Collection[];
  headOids: Map<string, string>;
}

async function postEnrichQuery(query: string, token: string, fetchImpl: FetchLike): Promise<EnrichPayload> {
  const res = await fetchImpl(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'ai-tools-hub-harvest',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`enrich: GraphQL HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as EnrichPayload;
}

export async function enrichCollections(
  repos: RepoRef[],
  token: string,
  deps: EnrichDeps = {},
): Promise<EnrichResult> {
  if (!token) {
    throw new Error('enrich: a CATALOG_PAT token is required');
  }
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const unique = dedupeRepos(repos);
  const curated = curatedSet();
  const collections: Collection[] = [];
  const headOids = new Map<string, string>();

  for (let i = 0; i < unique.length; i += ENRICH_BATCH_SIZE) {
    const batch = unique.slice(i, i + ENRICH_BATCH_SIZE);
    const payload = await postEnrichQuery(buildEnrichQuery(batch), token, fetchImpl);
    const result = parseEnrichResponse(payload, batch, curated);
    collections.push(...result.collections);
    for (const [repo, oid] of result.headOids) headOids.set(repo, oid);
    for (const repo of result.missing) {
      console.warn(`enrich: no repository node for ${repo} (renamed, deleted or now private)`);
    }
    deps.onGraphqlRemaining?.(result.remaining);
    if (result.remaining >= 0 && result.remaining < ENRICH_MIN_BUDGET) {
      throw new Error(
        `enrich: GraphQL budget down to ${result.remaining} points after ${collections.length} repos — failing loudly instead of committing a partial index`,
      );
    }
  }
  return { collections, headOids };
}
```

Enrichment still fails loudly on a drained budget: the queue cannot be ordered without every repo's `pushedAt`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/harvest/enrich-query.test.ts tests/harvest/enrich-parse.test.ts tests/harvest/enrich-collections.test.ts`
Expected: PASS. (`vi.stubGlobal('fetch', …)` still works: `globalThis.fetch` is read at call time.)

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/enrich.ts tests/harvest/enrich-query.test.ts tests/harvest/enrich-parse.test.ts tests/harvest/enrich-collections.test.ts
git commit -m "feat(enrich): return each repo's pinned commit and report GraphQL quota

The default-branch oid comes back in the same aliased query that already
fetches stars and pushedAt, at no extra cost. It replaces a REST head-commit
call per repo and pins the tree, path history and raw reads to one commit.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 7: `enumerateSkills` over a pinned snapshot

> Typecheck still fails after this task (`run.ts` passes a `RepoRef`). Task 8 restores it. `fetchHeadCommit` stays exported until Task 8: `run.ts` still imports it, and removing it here would break every test file that loads `run.ts`.

**Files:**
- Modify: `scripts/harvest/enumerate.ts:240-390` (remove `PathCommit` and `fetchPathCommit`; rewrite `enumerateSkills`)
- Modify: `tests/harvest/path-commit.test.ts` (drop the `fetchPathCommit` block; `path-history.test.ts` replaces it)
- Test: `tests/harvest/enumerate.test.ts`

**Interfaces:**
- Consumes: `fetchPathCommits`, `PathCommit`, `PathHistoryDeps` from Task 3.
- Produces:
  - `interface RepoSnapshot { repo: RepoRef; oid: string; tree: TreeFile[] }`
  - `enumerateSkills(snapshot: RepoSnapshot, token: string, deps?: EnumerateDeps & PathHistoryDeps): Promise<RawSkill[]>` — makes no core request; path commits via GraphQL; a path with no history is pinned to `snapshot.oid` with `UNKNOWN_UPDATED_DAYS`.
  - `fetchPathCommit` no longer exists. `fetchHeadCommit` still exists, unused by `enumerateSkills`; Task 8 removes it.

- [ ] **Step 1: Rewrite the tests**

Replace `tests/harvest/enumerate.test.ts` from the `interface RouteOptions` line to the end with:

```ts
const OID = '9892f18037231b42bdbdb6cc6ecdb2f5d58eff0e';
const ALIAS_RE = /^ +(p\d+): history\(first: 1, path: "([^"]+)"\)/gm;

interface RouteOptions {
  /** path -> [sha, committedDate]; a path left out has no history. */
  history?: Record<string, [string, string]>;
  raw?: (url: string) => Response;
}

function router(options: RouteOptions = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://api.github.com/graphql') {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      const object: Record<string, unknown> = {};
      for (const [, alias, path] of query.matchAll(ALIAS_RE)) {
        const hit = options.history?.[path!];
        object[alias!] = { nodes: hit === undefined ? [] : [{ oid: hit[0], committedDate: hit[1] }] };
      }
      return new Response(JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository: { object } } }), {
        status: 200,
      });
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return options.raw?.(url) ?? new Response(SKILL_MD, { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

const BASE = { sleepImpl: async () => {}, now: () => NOW } as const;

function snapshot(tree: unknown = TREE) {
  const entries = (tree as { tree: Array<{ path: string; mode: string; sha: string; type: string }> }).tree;
  return { repo: { repo: 'owner/repo', stars: 120 }, oid: OID, tree: entries };
}

describe('enumerateSkills', () => {
  it('returns one RawSkill per real skill, pinned to the per-path commit sha', async () => {
    const { urls, fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
    });

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });

    expect(skills).toEqual([
      {
        repo: 'owner/repo',
        path: 'skills/alpha/SKILL.md',
        sha: 'c0ffee1',
        blobSha: 'blob-a',
        frontmatter: {
          name: 'alpha',
          description: 'Scans lockfiles for malicious packages.',
        },
        body: 'Run it on every PR.',
        updatedDays: 45,
      },
    ]);
    expect(urls).toContain('https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md');
  });

  it('makes no core request: one GraphQL batch, then raw content only', async () => {
    const { urls, fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
    });
    await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });
    expect(urls.filter((u) => u.startsWith('https://api.github.com/') && !u.endsWith('/graphql'))).toEqual([]);
    expect(urls.filter((u) => u.endsWith('/graphql'))).toHaveLength(1);
  });

  it('pins a path with no history to the snapshot oid, never to a blob sha', async () => {
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });

    expect(skills[0]!.sha).toBe(OID);
    expect(skills[0]!.blobSha).toBe('blob-a');
    expect(skills[0]!.updatedDays).toBe(UNKNOWN_UPDATED_DAYS);
    expect(UNKNOWN_UPDATED_DAYS).toBe(3650);
    expect(urls).toContain(`https://raw.githubusercontent.com/owner/repo/${OID}/skills/alpha/SKILL.md`);
    expect(urls.some((u) => u.includes('/blob-a/'))).toBe(false);
  });

  it('skips a path whose content 404s between tree and raw fetch', async () => {
    const { fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
      raw: () => new Response('404: Not Found', { status: 404 }),
    });
    expect(await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl })).toEqual([]);
  });

  it('returns [] for a repo with no tree at all, without a request', async () => {
    const { urls, fetchImpl } = router();
    const skills = await enumerateSkills({ repo: { repo: 'owner/empty', stars: 50 }, oid: OID, tree: [] }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it('excludes a repo with no root README before spending any request', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills(
      snapshot({ truncated: false, tree: [{ path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' }] }),
      'tok',
      { ...BASE, fetchImpl, log: (m) => logs.push(m) },
    );

    expect(skills).toEqual([]);
    expect(urls).toHaveLength(0);
    expect(logs.join('\n')).toContain('README');
  });

  it('excludes a skill whose description fails the inclusion filter', async () => {
    const logs: string[] = [];
    const { fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
      raw: () => new Response('---\nname: alpha\ndescription: Helper.\n---\nBody.', { status: 200 }),
    });

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl, log: (m) => logs.push(m) });

    expect(skills).toEqual([]);
    expect(logs.join('\n')).toContain('weak-description');
  });

  it('caps one entry per publisher per concept', async () => {
    const tree = {
      truncated: false,
      tree: [
        { path: 'README.md', mode: '100644', sha: 'blob-readme', type: 'blob' },
        { path: 'packs/alpha/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
        { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
        { path: 'skills/omega/SKILL.md', mode: '100644', sha: 'blob-3', type: 'blob' },
      ],
    };
    const { fetchImpl } = router({
      raw: (url) =>
        new Response(
          url.includes('/omega/')
            ? '---\nname: Omega\ndescription: Renders build provenance attestations.\n---\nBody.'
            : '---\nname: Alpha\ndescription: Scans lockfiles for malicious packages.\n---\nBody.',
          { status: 200 },
        ),
    });

    const skills = await enumerateSkills(snapshot(tree), 'tok', { ...BASE, fetchImpl });

    expect(skills.map((s) => s.path)).toEqual(['packs/alpha/SKILL.md', 'skills/omega/SKILL.md']);
  });
});
```

In `tests/harvest/path-commit.test.ts`, delete the whole `describe('fetchPathCommit', …)` block and drop `fetchPathCommit` from the import; the `describe('fetchHeadCommit', …)` block stays until Task 8.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/harvest/enumerate.test.ts`
Expected: FAIL — `enumerateSkills` still fetches a tree itself and calls REST `commits?path=`.

- [ ] **Step 3: Implement**

In `scripts/harvest/enumerate.ts`:

Add imports:

```ts
import { fetchPathCommits, type PathHistoryDeps } from './path-history.ts';
```

Delete the `PathCommit` interface and `fetchPathCommit` with its doc comment (lines ~240-270). Keep `CommitItem` and `fetchHeadCommit`: `run.ts` still imports the latter until Task 8.

Replace the doc comment and body of `enumerateSkills` with:

```ts
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
```

`EnumerateDeps & PathHistoryDeps` both declare `fetchImpl?: FetchLike` and `now?: () => number` with the same types, so the intersection is sound.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/harvest`
Expected: PASS, every file (tests that load `run.ts` inject their own `enumerateSkills`, so its stale call site in `DEFAULT_DEPS` is not exercised).

Run: `grep -rn "fetchPathCommit\b" scripts tests src`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/enumerate.ts tests/harvest/enumerate.test.ts tests/harvest/path-commit.test.ts
git commit -m "refactor(enumerate): read skills from a pinned snapshot, with no core request

enumerateSkills fetched its own tree and one REST commit per SKILL.md, and
runHarvest then fetched the same tree again. It now receives the tree and
the pinned oid, and asks GraphQL for path history in batches. The REST
path-commit fetcher has no caller left and is removed.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 8: `runHarvest` — ordered queue, budgeted loop, write rules

**Files:**
- Modify: `scripts/harvest/run.ts` (imports; `partitionRepos`; `HarvestDeps`, `HarvestOptions`, `DEFAULT_DEPS`; `runHarvest`; `main`)
- Test: `tests/harvest/incremental.test.ts`, `tests/harvest/run-harvest.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Budget`, `BudgetLimits`, `StopReason`, `RateLimitedError`, `createBudget`, `timeBudgetFromEnv`); Task 2 (`fetchTree(repo, token, deps, ref)`); Task 6 (`EnrichResult`, `enrichCollections(repos, token, deps)`); Task 7 (`RepoSnapshot`, `enumerateSkills(snapshot, token, deps)`).
- Produces:
  - `partitionRepos(fresh, index)` — `crawl` ordered: never-read by stars desc (then repo name), then changed by stored `pushedAt` asc (then repo name).
  - `HarvestDeps`: `discoverRepos(token)`, `enrichCollections(repos, token): Promise<EnrichResult>`, `fetchTree(repo, ref, token)`, `enumerateSkills(snapshot, token)`, `fetchRawFile`, `fetchScriptContents`, `deriveSafety`, `now`, `log(message)`. **`fetchHeadCommit` is gone.**
  - `HarvestOptions` gains `limits?: Partial<BudgetLimits>` and `budget?: Budget`.
  - `interface HarvestSummary { read: number; unchanged: number; deferred: number; stopped: StopReason | null }`
  - `runHarvest(options): Promise<{ skills: Skill[]; collections: Collection[]; meta: Meta; summary: HarvestSummary }>`
  - `class StuckCrawlError extends Error`
  - `main` reads `HARVEST_TIME_BUDGET_MIN`.

- [ ] **Step 1: Update the queue-order test**

In `tests/harvest/incremental.test.ts`, replace the first `partitionRepos` test with:

```ts
  it('skips unchanged repos and queues never-read ones before changed ones', () => {
    const fresh = [
      collection('cached/repo', '2026-08-01T00:00:00Z'),
      collection('changed/repo', '2026-08-28T09:00:00Z'),
      collection('brand/new', '2026-08-29T09:00:00Z'),
    ];

    const { crawl, skipped } = partitionRepos(fresh, pushedAtIndex(previous));
    expect(skipped.map((c) => c.repo)).toEqual(['cached/repo']);
    expect(crawl.map((c) => c.repo)).toEqual(['brand/new', 'changed/repo']);
  });

  it('reads never-read repos by stars, and changed repos stalest data first', () => {
    const star = (repo: string, stars: number): Collection => ({ ...collection(repo, '2026-09-01T00:00:00Z'), stars });
    const index = new Map([
      ['old/data', '2026-01-01T00:00:00Z'],
      ['recent/data', '2026-08-01T00:00:00Z'],
    ]);
    const fresh = [star('recent/data', 9000), star('small/new', 10), star('old/data', 1), star('big/new', 500)];

    expect(partitionRepos(fresh, index).crawl.map((c) => c.repo)).toEqual([
      'big/new',
      'small/new',
      'old/data',
      'recent/data',
    ]);
  });
```

- [ ] **Step 2: Rewrite the runHarvest test harness and add the new cases**

In `tests/harvest/run-harvest.test.ts`:

Imports become:

```ts
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { RateLimitedError, type Budget } from '../../scripts/harvest/budget.ts';
import type { RepoSnapshot } from '../../scripts/harvest/enumerate.ts';
import { StuckCrawlError, runHarvest, type HarvestDeps } from '../../scripts/harvest/run.ts';
```

Replace `interface Spy` / `spy()` / `deps()` with:

```ts
interface Spy {
  enumerated: string[];
  treeRefs: string[];
  contentRefs: string[];
  licenseRefs: string[];
  safetyFrontmatter: Array<Record<string, unknown>>;
}

function spy(): Spy {
  return { enumerated: [], treeRefs: [], contentRefs: [], licenseRefs: [], safetyFrontmatter: [] };
}

interface DepsOptions {
  fresh?: Collection[];
  headOids?: Map<string, string>;
  rawsFor?: (repo: string) => RawSkill[];
  fetchTree?: HarvestDeps['fetchTree'];
}

function deps(s: Spy, options: DepsOptions = {}): Partial<HarvestDeps> {
  const fresh = options.fresh ?? [
    collection('cached/repo', '2026-08-01T00:00:00Z', 500),
    collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
  ];
  const headOids = options.headOids ?? new Map(fresh.map((c) => [c.repo, HEAD_COMMIT]));
  return {
    discoverRepos: async () => {
      throw new Error('discovery must not run when an allowlist is supplied');
    },
    enrichCollections: async () => ({ collections: fresh, headOids }),
    fetchTree:
      options.fetchTree ??
      (async (_repo, ref) => {
        s.treeRefs.push(ref);
        return tree;
      }),
    enumerateSkills: async (snapshot: RepoSnapshot) => {
      s.enumerated.push(snapshot.repo.repo);
      if (options.rawsFor) return options.rawsFor(snapshot.repo.repo);
      return snapshot.repo.repo === 'fresh/repo' ? [raw] : [];
    },
    fetchRawFile: async (_repo, ref) => {
      s.licenseRefs.push(ref);
      return 'MIT License\n';
    },
    fetchScriptContents: async (_repo, ref) => {
      s.contentRefs.push(ref);
      return new Map([['skills/fresh/scripts/run.py', 'import os\n']]);
    },
    deriveSafety: (_files, _contents, frontmatter) => {
      s.safetyFrontmatter.push(frontmatter);
      return { ...INERT, executesCode: true, scriptCount: 1, languages: ['python'], declaredTools: ['Bash'] };
    },
    now: () => new Date('2026-08-29T06:37:00.000Z'),
    log: () => {},
  };
}

/** Lets `repos` repos start, then reports the time budget spent. */
function budgetAllowing(repos: number): Budget {
  let checks = 0;
  return {
    observeCore() {},
    observeGraphql() {},
    exhausted: () => (checks++ < repos ? null : 'time budget'),
  };
}
```

Replace the two tests that mention the head commit (`'pins every raw fetch to the head COMMIT sha…'` and `'makes no raw request at all when the head commit sha cannot be resolved'`) with:

```ts
  it('reads the tree and pins every raw fetch to the enrichment oid, never the skill or blob sha', async () => {
    const dir = await seededDataDir();
    const s = spy();
    await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.treeRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).toEqual([HEAD_COMMIT]);
    expect(s.licenseRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).not.toContain(PATH_SHA);
    expect(s.contentRefs).not.toContain(BLOB_SHA);
  });

  it('treats a repo with no default branch as empty: no request, no skills, but a row', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills, collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['fresh/repo'],
      deps: deps(s, { headOids: new Map() }),
    });

    expect(s.treeRefs).toEqual([]);
    expect(s.enumerated).toEqual([]);
    expect(skills.find((k) => k.repo === 'fresh/repo')).toBeUndefined();
    expect(collections.map((c) => c.repo)).toContain('fresh/repo');
  });
```

In the first test (`'skips unchanged repos…'`), add after the `meta` expectation:

```ts
    expect(s.treeRefs).toEqual([HEAD_COMMIT]);
```

(one tree read, for `fresh/repo` only).

Add these tests at the end of the `describe('runHarvest', …)` block:

```ts
  it('stops cleanly on the budget, keeps what it read, and leaves never-read repos out', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('a/small', '2026-09-01T00:00:00Z', 5),
      collection('b/medium', '2026-09-01T00:00:00Z', 50),
      collection('c/large', '2026-09-01T00:00:00Z', 500),
    ];

    const { collections, meta, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(s, { fresh }),
      budget: budgetAllowing(2),
    });

    expect(s.enumerated).toEqual(['c/large', 'b/medium']);
    expect(collections.map((c) => c.repo)).toEqual(['b/medium', 'c/large']);
    expect(meta.sourceCount).toBe(2);
    expect(meta.discoveredCount).toBe(3);
    expect(summary).toEqual({ read: 2, unchanged: 0, deferred: 1, stopped: 'time budget' });
  });

  it('keeps the previous row and skills of a changed repo it did not reach, so it stays queued', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('cached/repo', '2026-09-20T00:00:00Z', 500),
      collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
    ];

    const { skills, collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(s, { fresh }),
      budget: budgetAllowing(1),
    });

    expect(s.enumerated).toEqual(['fresh/repo']);
    const cached = collections.find((c) => c.repo === 'cached/repo');
    expect(cached?.pushedAt).toBe('2026-08-01T00:00:00Z');
    expect(skills.map((k) => k.id)).toContain('cached/repo@old:SKILL.md');
  });

  it('discards a repo refused mid-read, commits the ones before it, and exits normally', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('first/repo', '2026-09-01T00:00:00Z', 900),
      collection('second/repo', '2026-09-01T00:00:00Z', 100),
    ];

    const { collections, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(s, {
        fresh,
        fetchTree: async (repo) => {
          if (repo === 'second/repo') throw new RateLimitedError(`tree ${repo}`);
          return tree;
        },
      }),
    });

    expect(collections.map((c) => c.repo)).toEqual(['first/repo']);
    expect(summary.stopped).toBe('rate limited');
    expect(summary.deferred).toBe(1);
  });

  it('gives a repo it read a row even when it yields zero skills, so it is not re-read', async () => {
    const dir = await seededDataDir();
    const fresh = [collection('empty/skills', '2026-09-01T00:00:00Z', 50)];

    const { collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['empty/skills'],
      deps: deps(spy(), { fresh, rawsFor: () => [] }),
    });

    expect(collections.map((c) => c.repo)).toEqual(['empty/skills']);
  });

  it('fails loudly, and writes nothing, when it cannot read a single repo of a non-empty queue', async () => {
    const dir = await seededDataDir();
    const before = await readFile(join(dir, 'meta.json'), 'utf8');
    const fresh = [collection('never/read', '2026-09-01T00:00:00Z', 50)];

    await expect(
      runHarvest({
        token: 'tok',
        dataDir: dir,
        allowlist: ['never/read'],
        deps: deps(spy(), { fresh }),
        budget: budgetAllowing(0),
      }),
    ).rejects.toBeInstanceOf(StuckCrawlError);
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toBe(before);
  });

  it('succeeds with nothing to do when every repo is unchanged', async () => {
    const dir = await seededDataDir();
    const fresh = [collection('cached/repo', '2026-08-01T00:00:00Z', 500)];

    const { summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo'],
      deps: deps(spy(), { fresh }),
      budget: budgetAllowing(0),
    });

    expect(summary).toEqual({ read: 0, unchanged: 1, deferred: 0, stopped: null });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/harvest/incremental.test.ts tests/harvest/run-harvest.test.ts`
Expected: FAIL — `StuckCrawlError` is not exported, `enrichCollections` result is treated as an array, the crawl order is unsorted, no `summary`.

- [ ] **Step 4: Implement `partitionRepos` ordering**

In `scripts/harvest/run.ts`, replace the body of `partitionRepos` after the loop (the `return`) with:

```ts
  // Never-read first (by stars), then changed repos whose stored data is oldest: the stored
  // pushedAt is the resume cursor (budgeted-crawl spec §3.3).
  const neverRead = crawl
    .filter((collection) => !index.has(collection.repo))
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
  const changed = crawl
    .filter((collection) => index.has(collection.repo))
    .sort((a, b) => index.get(a.repo)!.localeCompare(index.get(b.repo)!) || a.repo.localeCompare(b.repo));

  return { crawl: [...neverRead, ...changed], skipped };
```

- [ ] **Step 5: Implement deps, the loop and `main`**

In `scripts/harvest/run.ts`:

Imports — replace the `enumerate.ts` and `enrich.ts` import lines, and add `budget.ts`:

```ts
import {
  RateLimitedError,
  createBudget,
  timeBudgetFromEnv,
  type Budget,
  type BudgetLimits,
  type StopReason,
} from './budget.ts';
import { enumerateSkills, fetchRawFile, fetchTree, type EnumerateDeps, type RepoSnapshot } from './enumerate.ts';
import { detectRuntimes, enrichCollections, type EnrichResult } from './enrich.ts';
```

Replace `HarvestDeps`, `HarvestOptions` and `DEFAULT_DEPS` with:

```ts
export interface HarvestDeps {
  discoverRepos(token: string): Promise<RepoRef[]>;
  enrichCollections(repos: RepoRef[], token: string): Promise<EnrichResult>;
  fetchTree(repo: string, ref: string, token: string): Promise<TreeFile[]>;
  enumerateSkills(snapshot: RepoSnapshot, token: string): Promise<RawSkill[]>;
  fetchRawFile(repo: string, ref: string, path: string): Promise<string | null>;
  fetchScriptContents(repo: string, ref: string, files: TreeFile[]): Promise<Map<string, string>>;
  deriveSafety(files: TreeFile[], contents: Map<string, string>, frontmatter: Record<string, unknown>): Safety;
  now(): Date;
  log(message: string): void;
}

export interface HarvestOptions {
  token: string;
  dataDir: string;
  allowlist?: string[] | null;
  deps?: Partial<HarvestDeps>;
  limits?: Partial<BudgetLimits>;
  /** Injected by tests; otherwise built from `limits`. */
  budget?: Budget;
}

export interface HarvestSummary {
  read: number;
  unchanged: number;
  deferred: number;
  stopped: StopReason | null;
}

/** A guard stopped the run before it read anything: the crawler is stuck, not idle. */
export class StuckCrawlError extends Error {
  constructor(reason: StopReason, queued: number) {
    super(`harvest: stopped on ${reason} before reading any of ${queued} queued repos`);
    this.name = 'StuckCrawlError';
  }
}

function defaultDeps(budget: Budget): HarvestDeps {
  const log = (message: string): void => console.log(message);
  const core: EnumerateDeps = { log, onCoreResponse: (res) => budget.observeCore(res) };
  const onGraphqlRemaining = (remaining: number): void => budget.observeGraphql(remaining);
  return {
    discoverRepos: (token) => discoverRepos(token, { log }),
    enrichCollections: (repos, token) => enrichCollections(repos, token, { onGraphqlRemaining }),
    fetchTree: (repo, ref, token) => fetchTree(repo, token, core, ref),
    enumerateSkills: (snapshot, token) => enumerateSkills(snapshot, token, { ...core, onGraphqlRemaining }),
    fetchRawFile: (repo, ref, path) => fetchRawFile(repo, ref, path),
    fetchScriptContents: (repo, ref, files) => fetchScriptContents(repo, ref, files),
    deriveSafety,
    now: () => new Date(),
    log,
  };
}
```

Add, above `runHarvest`:

```ts
interface ReadContext {
  deps: HarvestDeps;
  token: string;
  assignments: Map<string, Assignment>;
  translations: Map<string, TranslationCarry>;
  indexedAt: string;
}

/** One repo at its pinned oid. A throw means nothing of this repo is kept. */
async function readRepo(collection: Collection, oid: string | null, context: ReadContext): Promise<Skill[]> {
  if (oid === null) return [];
  const { deps, token } = context;

  const tree = await deps.fetchTree(collection.repo, oid, token);
  const raws = await deps.enumerateSkills({ repo: { repo: collection.repo, stars: collection.stars }, oid, tree }, token);
  const treePaths = tree.filter((file) => file.type === 'blob').map((file) => file.path);

  const built: Skill[] = [];
  for (const raw of raws) {
    const scriptFiles = scriptFilesFor(tree, raw.path);
    const contents = await deps.fetchScriptContents(collection.repo, oid, scriptFiles);
    const safety = deps.deriveSafety(scriptFiles, contents, raw.frontmatter);

    const licensePath = siblingLicensePath(raw.path, treePaths);
    const siblingLicenseText = licensePath === null ? null : await deps.fetchRawFile(collection.repo, oid, licensePath);

    built.push(
      buildSkill({
        raw,
        collection,
        safety,
        treePaths,
        siblingLicenseText,
        assignment: context.assignments.get(identityKey(raw.repo, raw.path)),
        previousTranslation: context.translations.get(identityKey(raw.repo, raw.path)),
        indexedAt: context.indexedAt,
      }),
    );
  }
  return built;
}
```

Replace `runHarvest` with:

```ts
export async function runHarvest(
  options: HarvestOptions,
): Promise<{ skills: Skill[]; collections: Collection[]; meta: Meta; summary: HarvestSummary }> {
  const budget = options.budget ?? createBudget(options.limits);
  const deps: HarvestDeps = { ...defaultDeps(budget), ...(options.deps ?? {}) };
  const { token, dataDir } = options;
  const allowlist = options.allowlist ?? null;

  const repos: RepoRef[] =
    allowlist !== null && allowlist.length > 0
      ? allowlist.map((repo) => ({ repo, stars: 0 }))
      : await deps.discoverRepos(token);

  const { collections, headOids } = await deps.enrichCollections(repos, token);

  const previous: CatalogSnapshot = { skills: loadSkills(dataDir), collections: loadCollections(dataDir) };
  const previousMeta = loadMeta(dataDir);
  const assignments = assignmentsByIdentity(loadAssignments(dataDir));
  const translations = translationIndex(previous.skills);

  const { crawl, skipped } = partitionRepos(collections, pushedAtIndex(previous));
  const skills: Skill[] = carryForward(previous, skipped, assignments);
  const indexedAt = deps.now().toISOString();
  const context: ReadContext = { deps, token, assignments, translations, indexedAt };

  let stopped: StopReason | null = null;
  let next = 0;
  for (; next < crawl.length; next += 1) {
    stopped = budget.exhausted();
    if (stopped !== null) break;
    const collection = crawl[next]!;
    try {
      skills.push(...(await readRepo(collection, headOids.get(collection.repo) ?? null, context)));
    } catch (error) {
      if (error instanceof RateLimitedError) {
        stopped = 'rate limited';
        break;
      }
      throw error;
    }
  }

  const deferred = crawl.slice(next);
  if (next === 0 && deferred.length > 0) throw new StuckCrawlError(stopped ?? 'rate limited', deferred.length);

  // Budgeted-crawl spec §3.5: a changed repo not reached keeps its previous row (old pushedAt, so
  // it stays queued) and skills; a never-read one is left out until a run reaches it.
  const previousRows = new Map(previous.collections.map((collection) => [collection.repo, collection]));
  const deferredRepos = new Set(deferred.map((collection) => collection.repo));
  const kept = deferred.flatMap((collection) => previousRows.get(collection.repo) ?? []);
  skills.push(...carryForward(previous, kept, assignments));
  const rows = collections.flatMap((collection) =>
    deferredRepos.has(collection.repo) ? (previousRows.get(collection.repo) ?? []) : [collection],
  );

  skills.sort(compareForRank);

  // Survival (spec §5.1). The cap decides what is LISTED, never what is stored: every row stays
  // in skills.json and keeps being re-scored. `previous` is what the last committed run listed,
  // which is what makes eviction hysteretic instead of a rank-60 knife edge. applyListing
  // preserves the order it was given, so the sort above survives.
  const previouslyListed = new Set(previous.skills.filter((entry) => entry.listed).map((entry) => entry.id));
  const listed = applyListing(skills, previouslyListed, loadTaxonomy().minimumMass);

  const meta: Meta = {
    crawledAt: indexedAt,
    // Harvest never classifies; the classification PR owns this field (spec §6.1).
    classifiedAt: previousMeta.classifiedAt,
    skillCount: listed.length,
    sourceCount: rows.length,
    discoveredCount: collections.length,
  };

  await writeCatalog(dataDir, { skills: listed, collections: rows });
  await writeMeta(dataDir, meta);

  const summary: HarvestSummary = { read: next, unchanged: skipped.length, deferred: deferred.length, stopped };
  deps.log(
    `harvest: read ${summary.read}, unchanged ${summary.unchanged}, deferred ${summary.deferred}, stopped: ${stopped ?? 'queue drained'}`,
  );
  return { skills: listed, collections: rows, meta, summary };
}
```

`next` counts repos read successfully: the loop only advances past a repo that `readRepo` returned for, so `crawl.slice(next)` includes a repo refused mid-read.

In `main`, replace the `parseArgs` … `console.log` lines with:

```ts
  const { allowlist, dataDir } = parseArgs(argv);
  const timeBudgetMs = timeBudgetFromEnv(env['HARVEST_TIME_BUDGET_MIN']);
  const { meta } = await runHarvest({ token, dataDir, allowlist, limits: { timeBudgetMs } });
  console.log(
    `harvest: ${meta.skillCount} skills from ${meta.sourceCount} of ${meta.discoveredCount} sources at ${meta.crawledAt}`,
  );
  return 0;
```

The old import and loop that used `fetchHeadCommit` are gone with the replacements above. Now remove it for good: in `scripts/harvest/enumerate.ts` delete `CommitItem` and `fetchHeadCommit` with its doc comment, and delete `tests/harvest/path-commit.test.ts` (only its `fetchHeadCommit` block is left):

```bash
git rm tests/harvest/path-commit.test.ts
grep -rn "fetchHeadCommit\|CommitItem" scripts tests src   # expected: no output
```

- [ ] **Step 6: Run the harvest tests**

Run: `npx vitest run tests/harvest`
Expected: PASS, every file.

- [ ] **Step 7: Typecheck — must be green again**

Run: `npm run typecheck`
Expected: exit 0. This closes the chain opened in Task 6.

- [ ] **Step 8: Smoke-test the CLI against the real API, on a scratch data dir**

This only reads public data. Use your own `gh` token and a copy of `data/`, never the repo's `data/`:

```bash
SCRATCH=$(mktemp -d) && cp data/*.json "$SCRATCH"/
CATALOG_PAT=$(gh auth token) HARVEST_TIME_BUDGET_MIN=2 node scripts/harvest/run.ts --data-dir="$SCRATCH"
```

Expected: progress lines while it runs, a final `harvest: read N, unchanged M, deferred K, stopped: time budget` with `N > 0`, then `harvest: … skills from N' of D sources …`, and exit code 0. `git status --short data/` must print nothing.

- [ ] **Step 9: Commit**

```bash
git add scripts/harvest/run.ts scripts/harvest/enumerate.ts tests/harvest/incremental.test.ts tests/harvest/run-harvest.test.ts
git commit -m "feat(harvest): stop before any quota or the timeout, and resume next run

Every run restarted from zero, because nothing was written until the end
and the pushedAt skip only knew repos already stored. The loop now checks
the budget between repos, writes what it read on every clean stop, and
orders the queue by never-read first, then stalest stored data, so the
stored pushedAt is the resume cursor. Reading nothing from a non-empty
queue is an error: a stuck crawler must not look like a quiet one.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 9: `crawl.yml` — daily, time-budgeted, never silent

**Files:**
- Modify: `.github/workflows/crawl.yml`
- Test: `tests/workflows/crawl.test.ts`

**Interfaces:**
- Consumes: `HARVEST_TIME_BUDGET_MIN` read by `main` (Task 8).
- Produces: daily schedule; issue step on `failure() || cancelled()` that comments on an open `P1: crawl failed` issue or opens one.

- [ ] **Step 1: Update the tests**

In `tests/workflows/crawl.test.ts`:

Replace the `'runs weekly, off the hour, in an off-peak UTC window'` test with:

```ts
  it('runs daily, off the hour, in an off-peak UTC window', () => {
    const match = yml.match(/cron:\s*'(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*'/);
    expect(match).not.toBeNull();
    const minute = Number(match![1]);
    const hour = Number(match![2]);
    expect(minute).toBeGreaterThan(0);
    expect(minute).toBeLessThan(60);
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThanOrEqual(9);
  });
```

Replace the `'says in the file why it is the fallback and not the primary (spec §6.1)'` test with:

```ts
  it('says in the file that it is the primary schedule, and the local timer optional', () => {
    expect(yml).toContain('primary schedule');
    expect(yml).toContain('ops/install-schedule.sh');
    expect(yml).toContain('optional');
  });
```

Replace the `'opens an issue when the crawl fails'` test with:

```ts
  it('reports a failure or a timeout on one open issue instead of opening one a day', () => {
    // A timeout concludes `cancelled`, which `failure()` alone never sees.
    expect(yml).toContain('if: failure() || cancelled()');
    expect(yml).toContain('gh issue list --state open');
    expect(yml).toContain('gh issue comment');
    expect(yml).toContain('gh issue create');
    expect(yml).toContain('P1: crawl failed');
    expect(yml).toContain('issues: write');
  });

  it('stops the harvest on its own clock well before the job is killed', () => {
    const budget = Number(yml.match(/HARVEST_TIME_BUDGET_MIN:\s*'(\d+)'/)?.[1]);
    const timeout = Number(yml.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    expect(budget).toBe(35);
    expect(timeout).toBe(50);
    expect(timeout - budget).toBeGreaterThanOrEqual(10);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/workflows/crawl.test.ts`
Expected: FAIL — weekly cron, no `cancelled()`, no budget env.

- [ ] **Step 3: Edit the workflow**

In `.github/workflows/crawl.yml`, replace the `schedule:` block (comment and cron) with:

```yaml
  schedule:
    # Daily at 06:37 UTC. This is the primary schedule: it runs whether or not the maintainer's
    # machine is on, and each run stops on its own budget and resumes the next day. The local
    # timer from ops/install-schedule.sh is optional. Off the hour on purpose: schedule events at
    # :00 are dropped under load, and the commit below is the repository activity that keeps this
    # schedule from being auto-disabled after 60 days (spec §6.5).
    - cron: '37 6 * * *'
```

In the `Run the harvest` step's `env:`, after `ALLOWLIST`, add:

```yaml
          # Stop cleanly before timeout-minutes, leaving room for the largest repo and the commit.
          HARVEST_TIME_BUDGET_MIN: '35'
```

Replace the last step (`Open a P1 issue when the crawl fails`) with:

```yaml
      - name: Report the failure on the open P1 issue, or open one
        # A timeout concludes `cancelled`, not `failure`: without cancelled() it would be silent.
        if: failure() || cancelled()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
          OPEN=$(gh issue list --state open --search 'in:title "P1: crawl failed"' --json number --jq '.[0].number // empty')
          if [ -n "$OPEN" ]; then
            gh issue comment "$OPEN" --body "Failed again on $(date -u +%Y-%m-%d): $RUN_URL"
          else
            gh issue create \
              --title "P1: crawl failed" \
              --body "The daily harvest failed, so the catalog is going stale. A silent crawler is a P1 bug, not a maintenance chore (spec §13). Run: $RUN_URL"
          fi
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/workflows/crawl.test.ts`
Expected: PASS — including the untouched checks (no tabs, `workflow_dispatch`, PAT passing, `--allow-empty`, pinned actions, inputs routed through env).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/crawl.yml tests/workflows/crawl.test.ts
git commit -m "ci(crawl): run daily on a time budget, and report timeouts

The first real run was killed at 50 minutes and opened no issue, because
a timeout concludes cancelled and the step only ran on failure(). The job
now runs daily with a 35-minute harvest budget, reports on cancellation
too, and comments on the open P1 issue rather than opening one per day.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 10: The site says "N of M" while the catalog is partial

**Files:**
- Modify: `src/lib/format.ts` (add `coverage`)
- Modify: `src/lib/i18n/home.ts` (add `stats.coverageOf`, both locales)
- Modify: `src/pages/[lang]/index.astro:40`
- Modify: `src/pages/[lang]/methodology.astro:35-36`, `:136`
- Test: `tests/lib/format.test.ts`, `tests/lib/i18n-home.test.ts`, `tests/build/home.test.ts`, `tests/build/methodology.test.ts`

**Interfaces:**
- Consumes: `Meta.discoveredCount` (Task 4).
- Produces: `coverage(read: number, discovered: number, of: string, render: (n: number) => string): string`; i18n key `stats.coverageOf` (`en`: `of`, `pt`: `de`).

- [ ] **Step 1: Write the failing tests**

`tests/lib/format.test.ts` — add `coverage` to the import from `../../src/lib/format.ts`, and append:

```ts
describe('coverage()', () => {
  const render = (n: number) => String(n);

  it('reads "N of M" while the catalog holds fewer repos than discovery admitted', () => {
    expect(coverage(1830, 4400, 'of', render)).toBe('1830 of 4400');
    expect(coverage(1830, 4400, 'de', (n) => compactNumber(n, 'pt'))).toBe('1,8K de 4,4K');
  });

  it('reads the bare number once coverage is complete', () => {
    expect(coverage(4400, 4400, 'of', render)).toBe('4400');
    expect(coverage(3, 3, 'of', render)).toBe('3');
  });
});
```

`tests/lib/i18n-home.test.ts` — add `'stats.coverageOf',` to `KEYS`, between `'home.staleNote'` and `'stats.domains'`.

`tests/build/home.test.ts` — add `coverage` to the `format.ts` import, and replace the `sources` expectation on line 62 with:

```ts
    const of = (lang: 'en' | 'pt') => t('stats.coverageOf', lang);
    expect(statValue(en, 'sources')).toBe(
      coverage(meta.sourceCount, meta.discoveredCount, of('en'), (n) => compactNumber(n, 'en')),
    );
    expect(statValue(pt, 'sources')).toBe(
      coverage(meta.sourceCount, meta.discoveredCount, of('pt'), (n) => compactNumber(n, 'pt')),
    );
```

`tests/build/methodology.test.ts` — add the imports

```ts
import { loadMeta } from '../../src/lib/data.ts';
import { coverage } from '../../src/lib/format.ts';
import { t } from '../../src/lib/i18n/index.ts';
```

and a test:

```ts
  it('states source coverage the same way the home page does', () => {
    const meta = loadMeta();
    for (const lang of ['en', 'pt'] as const) {
      const cell = page(lang).match(/<dd[^>]*data-source-count="[^"]*"[^>]*>([^<]*)</);
      expect(cell, `no data-source-count cell on the ${lang} page`).not.toBeNull();
      expect(cell![1]!.trim()).toBe(coverage(meta.sourceCount, meta.discoveredCount, t('stats.coverageOf', lang), String));
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lib/format.test.ts tests/lib/i18n-home.test.ts tests/build/home.test.ts tests/build/methodology.test.ts`
Expected: FAIL — `coverage` is not exported; `stats.coverageOf` is missing.

- [ ] **Step 3: Implement**

`src/lib/format.ts`, after `compactNumber`:

```ts
/** "N of M" while a crawl is still reaching every discovered repo; the bare N once it has. */
export function coverage(read: number, discovered: number, of: string, render: (n: number) => string): string {
  return read < discovered ? `${render(read)} ${of} ${render(discovered)}` : render(read);
}
```

`src/lib/i18n/home.ts`: in the `en` table after `'stats.sources': 'Sources',` add `'stats.coverageOf': 'of',`; in the `pt` table after `'stats.sources': 'Fontes',` add `'stats.coverageOf': 'de',`. In the same file, replace the comment above `'home.staleNote'` (both copies if the `pt` table repeats it) with:

```ts
  // No day count and no cadence in the prose: STALE_DAYS (src/lib/format.ts, B1) is the only
  // place the threshold is written, and the schedule (the daily crawl.yml, §6.1) lives in
  // .github/workflows/, not in a string.
```

`src/pages/[lang]/index.astro`: add `coverage` to the existing `format.ts` import, and replace line 40 with:

```ts
  {
    key: 'sources',
    label: t('stats.sources', lang),
    value: coverage(meta.sourceCount, meta.discoveredCount, t('stats.coverageOf', lang), (n) => compactNumber(n, lang)),
  },
```

`src/pages/[lang]/methodology.astro`: add `import { coverage } from '../../lib/format.ts';` to the frontmatter imports; replace line 35 with the following (no `meta` binding exists in this file today; if one appears, rename this one `siteMeta`):

```ts
const meta = loadMeta();
const report = evaluateStaleness(parseMeta(meta), new Date());
const sources = coverage(meta.sourceCount, meta.discoveredCount, t('stats.coverageOf', lang), String);
```

and line 136 with:

```astro
        <dd data-source-count={String(report.sourceCount)}>{sources}</dd>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lib/format.test.ts tests/lib/i18n-home.test.ts tests/lib/i18n.test.ts tests/build/home.test.ts tests/build/methodology.test.ts`
Expected: PASS. With today's `data/meta.json` (no `discoveredCount`), both pages render the bare number, as before.

- [ ] **Step 5: Look at the partial state in a browser, not only in markup**

The committed data is complete, so render the partial state on purpose, then restore it:

```bash
BACKUP=$(mktemp) && cp data/meta.json "$BACKUP"
node -e "const f='data/meta.json',m=require('./'+f);m.discoveredCount=m.sourceCount+4397;require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
npx astro build && npx astro preview --port 4321 &
```

Open `http://localhost:4321/ai-tools-hub/en/` and `/ai-tools-hub/pt/` (and `/methodology/`). Expected: the Sources cell reads `3 of 4.4K` / `3 de 4,4K`, fits its cell at phone width (375 px) with no overflow, and has no hazard colour. Then:

```bash
kill %1; cp "$BACKUP" data/meta.json && git status --short data/
```

Expected: `git status` prints nothing for `data/`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/lib/format.ts src/lib/i18n/home.ts 'src/pages/[lang]/index.astro' 'src/pages/[lang]/methodology.astro' tests/lib/format.test.ts tests/lib/i18n-home.test.ts tests/build/home.test.ts tests/build/methodology.test.ts
git commit -m "feat(site): say how much of the corpus the catalog holds while it is partial

The budgeted crawl publishes progress run by run. The Sources figure now
reads '1,830 of 4,400' until every discovered repo has been read, and the
bare number after that. Partial is not stale, so it takes no hazard colour.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 11: Documentation

**Files:**
- Modify: `README.md:129-151` ("Outstanding manual setup")
- Modify: `docs/specs/2026-08-29-ai-tools-hub-design.md` §6.1 (line ~335), §6.2 (line ~384)
- Test: `tests/docs/` (run whatever exists; some tests read the spec or README)

- [ ] **Step 1: Rewrite the README scheduling section**

Replace from `## Outstanding manual setup` up to (not including) `## Known gaps` with:

````markdown
## Scheduling

**`.github/workflows/crawl.yml` is the primary schedule: daily at 06:37 UTC.** It needs one
secret, a fine-grained PAT with *Public repositories* access and no extra permissions
(`GITHUB_TOKEN` cannot do global code search):

```bash
gh secret set CATALOG_PAT
```

A full crawl does not fit one run. Each run stops on its own budget — 35 minutes, or when the
core or GraphQL quota drops below 200 — commits what it read, and the next run resumes where it
stopped: never-read repos first, then the repos whose stored data is oldest. Until every
discovered repo has been read once, the site's Sources figure reads "N of M". A run that stops
without reading anything, fails, or times out comments on the open `P1: crawl failed` issue (or
opens one).

**The local timer is optional.** `ops/install-schedule.sh` installs a systemd user timer every
4 hours (plus a Windows logon task that starts WSL). It shares the PAT's quota with the Action;
the budget stops whichever runs second.

```bash
mkdir -p ~/.config/ai-tools-hub
printf 'CATALOG_PAT=github_pat_...\n' > ~/.config/ai-tools-hub/harvest.env
chmod 600 ~/.config/ai-tools-hub/harvest.env
bash ops/install-schedule.sh
systemctl --user is-enabled ai-tools-hub-harvest.timer   # expected: enabled
```

````

Then `grep -n "weekly\|fallback\|Outstanding manual setup" README.md` and fix any remaining reference that describes the Action as weekly or as a fallback (including a table of contents, if one links the old heading).

- [ ] **Step 2: Amend the 2026-08-29 spec**

Directly under the `### 6.1 Pipeline — two workflows, never one` heading, insert:

```markdown
> **Amended 2026-09-27** by [the budgeted-crawl spec](2026-09-27-budgeted-crawl-design.md): the
> first full-discovery run never finished (7,005 repos against a 5,000/h core budget and a 50-min
> job timeout). `crawl.yml` is now the **daily primary** and the local timer optional; discovery
> drops `mcp-server` and keeps `claude-code` above 100 stars; each run stops on a quota/time budget
> and resumes from the stored `pushedAt`. The paragraphs below describe the original design.
```

Directly under `### 6.2 Measured rate limits 📄`, insert:

```markdown
> **Amended 2026-09-27:** the per-`SKILL.md` commit lookup was the dominant `core` cost (one REST
> call per path). It now runs as aliased GraphQL `history(first: 1, path:)`, 50 paths per query
> for 1 point — measured identical sha and date to REST.
```

- [ ] **Step 3: Run the docs tests**

Run: `npx vitest run tests/docs tests/project`
Expected: PASS. If a test pins README headings or the spec text, update the test to the new heading and state the reason in the commit body.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/specs/2026-08-29-ai-tools-hub-design.md
git commit -m "docs: make the daily Action the primary schedule, and amend §6.1/§6.2

The README still told the reader the Action was a weekly fallback that
needed a secret; the spec still sized the crawl at one topic and one
request per repo. Both now point at the budgeted-crawl design.

Claude-Session: https://claude.ai/code/session_01Rt6yLm1MNj6UNMyH4FFWh5"
```

---

### Task 12: Verify, review, open the PR, and watch the first real run

No new code. Each step reports its real output.

- [ ] **Step 1: Full suite, typecheck, build**

```bash
npm test
npm run typecheck
npm run build
```

Expected: all three exit 0. Report the test count.

- [ ] **Step 2: Quality passes required by the maintainer**

Run `/simplify`, then `/code-review` on the branch. Apply what they confirm, re-run Step 1, commit any fixes separately.

- [ ] **Step 3: Push and open the PR** (only after the maintainer says so)

```bash
git push -u origin feat/budgeted-crawl
gh pr create --title "Budgeted, resumable crawl" --body-file - <<'EOF'
The first full-discovery harvest was killed at the 50-minute job timeout with no output, and no full crawl had ever completed: discovery admits 7,005 repos, tree reads alone exceed an hour of core quota, and nothing was written before the end.

- Discovery drops `mcp-server`, keeps `claude-code` at ≥100★.
- One core request per repo: pinned oid from enrichment, one tree read, per-path commits in GraphQL batches of 50.
- A budget (core/GraphQL reserve 200, 35-min clock) stops the run between repos; each clean stop commits; the stored `pushedAt` is the resume cursor.
- A run that reads nothing from a non-empty queue fails loudly.
- `crawl.yml` runs daily, reports timeouts (`cancelled()`), and comments on one open P1 issue.
- The site reads "N of M" sources while partial.

Spec: `docs/specs/2026-09-27-budgeted-crawl-design.md` · Plan: `docs/plans/2026-09-27-budgeted-crawl.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: After merge — dispatch and watch the first run to the end**

```bash
gh workflow run crawl.yml
gh run watch "$(gh run list --workflow crawl.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```

Expected: the job ends `success` well before 50 min; the log shows progress lines and `harvest: read N, … stopped: time budget` (or `queue drained`); a `chore(crawl): refresh catalog data …` commit lands on `master`; `data/meta.json` has `discoveredCount` > `sourceCount` > 3.

- [ ] **Step 5: Close the stale P1 issues**

Only after Step 4 succeeded:

```bash
for n in 4 14 15 16; do gh issue close "$n" --comment "Fixed by the budgeted crawl; first successful run: <run URL from Step 4>"; done
```
