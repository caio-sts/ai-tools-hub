import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_REPOS,
  ENRICH_BATCH_SIZE,
  curatedSet,
  dedupeRepos,
  enrichCollections,
} from '../../scripts/harvest/enrich.ts';

const ALIAS_RE = /^ {2}(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/gm;

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Pull the GraphQL query text back out of one recorded fetch call. */
function queryOf(call: unknown[]): string {
  const init = call[1] as FetchInit;
  return (JSON.parse(init.body) as { query: string }).query;
}

function node(nameWithOwner: string) {
  return {
    nameWithOwner,
    stargazerCount: 100,
    forkCount: 10,
    pushedAt: '2026-08-20T00:00:00Z',
    licenseInfo: { spdxId: 'MIT' },
    repositoryTopics: { nodes: [{ topic: { name: 'agent-skills' } }] },
    owner: { __typename: 'User' },
    defaultBranchRef: { target: { oid: `oid-${nameWithOwner}` } },
  };
}

function answer(init: unknown, remaining = 4900) {
  const query = (JSON.parse((init as FetchInit).body) as { query: string }).query;
  const data: Record<string, unknown> = { rateLimit: { cost: 1, remaining } };
  for (const [, alias, owner, name] of query.matchAll(ALIAS_RE)) {
    data[alias] = node(`${owner}/${name}`);
  }
  return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
}

function stubFetch(remaining: number) {
  const mock = vi.fn(async (_url: unknown, init: unknown) => answer(init, remaining));
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** Fails with each response (or rejects with each Error) in turn, then answers normally. */
function flakyFetch(...failures: object[]) {
  const mock = vi.fn(async (_url: unknown, init: unknown) => {
    const next = failures.shift();
    if (next instanceof Error) throw next;
    return next ?? answer(init);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const httpError = (status: number, body = '<!DOCTYPE html>') => ({
  ok: false,
  status,
  json: async () => ({}),
  text: async () => body,
});

// GitHub sometimes closes an overrun query with a 200 and no body.
const emptyBody = {
  ok: true,
  status: 200,
  json: async () => {
    throw new SyntaxError('Unexpected end of JSON input');
  },
  text: async () => '',
};

// ...or with a 200 that carries errors and `data: null`.
const noData = {
  ok: true,
  status: 200,
  json: async () => ({ data: null, errors: [{ message: 'This may be the result of a timeout' }] }),
  text: async () => '',
};

const NO_WAIT = { sleepImpl: async () => {} };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enrichCollections', () => {
  it('splits one batch plus one repo into two queries and returns one Collection each', async () => {
    const repos = Array.from({ length: ENRICH_BATCH_SIZE + 1 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    const mock = stubFetch(4900);

    const { collections, headOids } = await enrichCollections(repos, 'ghp_test');

    expect(mock).toHaveBeenCalledTimes(2);
    expect([...queryOf(mock.mock.calls[0]).matchAll(ALIAS_RE)]).toHaveLength(ENRICH_BATCH_SIZE);
    expect([...queryOf(mock.mock.calls[1]).matchAll(ALIAS_RE)]).toHaveLength(1);
    expect(collections).toHaveLength(ENRICH_BATCH_SIZE + 1);
    expect(collections[0].repo).toBe('owner/repo-0');
    expect(collections[ENRICH_BATCH_SIZE].repo).toBe(`owner/repo-${ENRICH_BATCH_SIZE}`);
    expect(collections[0].stars).toBe(100);
    expect(headOids.get(`owner/repo-${ENRICH_BATCH_SIZE}`)).toBe(`oid-owner/repo-${ENRICH_BATCH_SIZE}`);
  });

  it('reports the GraphQL points left after every batch', async () => {
    stubFetch(4900);
    const reported: number[] = [];
    const repos = Array.from({ length: ENRICH_BATCH_SIZE + 1 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    await enrichCollections(repos, 'ghp_test', { onGraphqlRemaining: (r) => reported.push(r) });
    expect(reported).toEqual([4900, 4900]);
  });

  it('sends the token as a bearer credential to the GraphQL endpoint', async () => {
    const mock = stubFetch(4900);
    await enrichCollections([{ repo: 'anthropics/skills', stars: 1 }], 'ghp_secret');
    expect(mock.mock.calls[0][0]).toBe('https://api.github.com/graphql');
    const init = mock.mock.calls[0][1] as FetchInit;
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('bearer ghp_secret');
  });

  it('throws instead of returning a partial corpus when the budget drains', async () => {
    stubFetch(50);
    const repos = Array.from({ length: 51 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    await expect(enrichCollections(repos, 'ghp_test')).rejects.toThrow(
      'enrich: GraphQL budget down to 50 points',
    );
  });

  it('throws on a client error without retrying it', async () => {
    const mock = flakyFetch(httpError(401, 'Bad credentials'));
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], 'bad', NO_WAIT)).rejects.toThrow(
      'enrich: GraphQL HTTP 401 — Bad credentials',
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('retries a gateway timeout and keeps the batch', async () => {
    const mock = flakyFetch(httpError(502), httpError(504));
    const waits: number[] = [];
    const { collections } = await enrichCollections([{ repo: 'a/b', stars: 1 }], 'ghp_test', {
      sleepImpl: async (ms) => {
        waits.push(ms);
      },
    });
    expect(mock).toHaveBeenCalledTimes(3);
    expect(waits).toEqual([2000, 4000]);
    expect(collections.map((c) => c.repo)).toEqual(['a/b']);
  });

  it.each([
    ['a 200 with an empty body', emptyBody],
    ['a 200 with errors but no data', noData],
    ['a network-level failure', new TypeError('fetch failed')],
  ])('retries %s', async (_case, failure) => {
    const mock = flakyFetch(failure);
    const { collections } = await enrichCollections([{ repo: 'a/b', stars: 1 }], 'ghp_test', NO_WAIT);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(collections).toHaveLength(1);
  });

  it('gives up after three attempts at the same batch', async () => {
    const mock = flakyFetch(httpError(504), httpError(504), httpError(504));
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], 'ghp_test', NO_WAIT)).rejects.toThrow(
      'enrich: GraphQL HTTP 504',
    );
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('requires a token', async () => {
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], '')).rejects.toThrow(
      'a CATALOG_PAT token is required',
    );
  });

  it('dedupes case-insensitively and marks curated marketplaces', () => {
    expect(
      dedupeRepos([
        { repo: 'anthropics/skills', stars: 5 },
        { repo: 'Anthropics/Skills', stars: 5 },
        { repo: 'other/repo', stars: 1 },
      ]),
    ).toEqual([
      { repo: 'anthropics/skills', stars: 5 },
      { repo: 'other/repo', stars: 1 },
    ]);
    expect(CURATED_REPOS).toContain('anthropics/skills');
    expect(curatedSet().has('anthropics/skills')).toBe(true);
    expect(curatedSet(['My/Marketplace']).has('my/marketplace')).toBe(true);
    expect(curatedSet().has('random/repo')).toBe(false);
  });
});
