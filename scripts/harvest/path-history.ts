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
    rateLimit?: { remaining: number; cost?: number } | null;
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
