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
  };
}

function stubFetch(remaining: number) {
  const mock = vi.fn(async (_url: unknown, init: unknown) => {
    const query = (JSON.parse((init as FetchInit).body) as { query: string }).query;
    const data: Record<string, unknown> = { rateLimit: { cost: 13, remaining } };
    for (const [, alias, owner, name] of query.matchAll(ALIAS_RE)) {
      data[alias] = node(`${owner}/${name}`);
    }
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enrichCollections', () => {
  it('splits 51 repos into two queries and returns one Collection each', async () => {
    const repos = Array.from({ length: 51 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    const mock = stubFetch(4900);

    const collections = await enrichCollections(repos, 'ghp_test');

    expect(mock).toHaveBeenCalledTimes(2);
    expect([...queryOf(mock.mock.calls[0]).matchAll(ALIAS_RE)]).toHaveLength(ENRICH_BATCH_SIZE);
    expect([...queryOf(mock.mock.calls[1]).matchAll(ALIAS_RE)]).toHaveLength(1);
    expect(collections).toHaveLength(51);
    expect(collections[0].repo).toBe('owner/repo-0');
    expect(collections[50].repo).toBe('owner/repo-50');
    expect(collections[0].stars).toBe(100);
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

  it('throws on a non-OK HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Bad credentials' })),
    );
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], 'bad')).rejects.toThrow(
      'enrich: GraphQL HTTP 401 — Bad credentials',
    );
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
