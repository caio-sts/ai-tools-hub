import { describe, expect, it } from 'vitest';
import { searchPage } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('searchPage', () => {
  it('requests 100 results per page, sorted by stars, and maps the payload', async () => {
    const urls: string[] = [];
    let seenAuth = '';
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = headers.authorization;
      return new Response(
        JSON.stringify({
          total_count: 2,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
            {
              full_name: 'someone/skills',
              stargazers_count: 6908,
              owner: { type: 'User' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await searchPage('topic:claude-skills stars:>=1000', 1, 'tok', { fetchImpl });

    expect(urls[0]).toBe(
      'https://api.github.com/search/repositories?q=topic%3Aclaude-skills%20stars%3A%3E%3D1000&sort=stars&order=desc&per_page=100&page=1',
    );
    expect(seenAuth).toBe('Bearer tok');
    expect(result.totalCount).toBe(2);
    expect(result.items).toEqual([
      { repo: 'anthropics/skills', stars: 172473, isOrg: true },
      { repo: 'someone/skills', stars: 6908, isOrg: false },
    ]);
  });

  it('honours retry-after on a 403 and then succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', {
          status: 403,
          headers: { 'retry-after': '2' },
        });
      }
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 });
    });

    const result = await searchPage('topic:agent-skills stars:10..99', 3, 'tok', {
      fetchImpl,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    expect(calls).toBe(2);
    expect(slept).toEqual([2000]);
    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('throws on a non-retryable status', async () => {
    const fetchImpl = stubFetch(() => new Response('boom', { status: 422 }));
    await expect(searchPage('topic:x stars:10..99', 11, 'tok', { fetchImpl })).rejects.toThrow(
      'search "topic:x stars:10..99" page 11: HTTP 422',
    );
  });

  it('drops malformed items and defaults a missing owner type to not-an-org', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({ total_count: 2, items: [{ stargazers_count: 5 }, { full_name: 'a/b' }] }),
          { status: 200 },
        ),
    );
    const result = await searchPage('topic:x stars:10..99', 1, 'tok', { fetchImpl });
    expect(result.items).toEqual([{ repo: 'a/b', stars: 0, isOrg: false }]);
  });
});
