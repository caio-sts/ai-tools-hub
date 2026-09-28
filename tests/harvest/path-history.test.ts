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
