import { describe, expect, it } from 'vitest';
import { codeSearchPage, MARKETPLACE_CODE_QUERY } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('codeSearchPage', () => {
  it('queries the highest-signal structured seed, authenticated', async () => {
    const urls: string[] = [];
    let seenAuth = '';
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      seenAuth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      return new Response(
        JSON.stringify({
          total_count: 1,
          items: [
            {
              path: '.claude-plugin/marketplace.json',
              repository: {
                full_name: 'anthropics/skills',
                stargazers_count: 172473,
                owner: { type: 'Organization' },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await codeSearchPage(1, 'tok', { fetchImpl });

    expect(MARKETPLACE_CODE_QUERY).toBe('path:.claude-plugin filename:marketplace.json');
    expect(urls).toEqual([
      'https://api.github.com/search/code?q=path%3A.claude-plugin%20filename%3Amarketplace.json&per_page=100&page=1',
    ]);
    expect(seenAuth).toBe('Bearer tok');
    expect(result).toEqual({
      totalCount: 1,
      items: [{ repo: 'anthropics/skills', stars: 172473, isOrg: true }],
    });
  });

  it('collapses several marketplace files in one repo to a single seed', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            total_count: 3,
            items: [
              { repository: { full_name: 'mono/plugins', owner: { type: 'User' } } },
              { repository: { full_name: 'mono/plugins', owner: { type: 'User' } } },
              { repository: { full_name: 'other/plugins', owner: { type: 'Organization' } } },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await codeSearchPage(1, 'tok', { fetchImpl });
    expect(result.items).toEqual([
      { repo: 'mono/plugins', stars: 0, isOrg: false },
      { repo: 'other/plugins', stars: 0, isOrg: true },
    ]);
    expect(result.totalCount).toBe(3);
  });

  it('treats the 422 past the 1000-result cap as the end of the seed, not an error', async () => {
    const fetchImpl = stubFetch(() => new Response('too many results', { status: 422 }));
    await expect(codeSearchPage(11, 'tok', { fetchImpl })).resolves.toEqual({
      items: [],
      totalCount: 0,
    });
  });

  it('honours retry-after on a 403 and then succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', { status: 403, headers: { 'retry-after': '6' } });
      }
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 });
    });
    const result = await codeSearchPage(1, 'tok', {
      fetchImpl,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });
    expect(calls).toBe(2);
    expect(slept).toEqual([6000]);
    expect(result.items).toEqual([]);
  });

  it('throws on an unexpected status', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(codeSearchPage(2, 'tok', { fetchImpl })).rejects.toThrow(
      'code search page 2: HTTP 500',
    );
  });
});
