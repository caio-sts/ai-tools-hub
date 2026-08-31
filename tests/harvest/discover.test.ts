import { describe, expect, it } from 'vitest';
import { discoverRepos } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

function queryOf(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get('page') ?? '0');
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const EMPTY = { total_count: 0, items: [] };

describe('discoverRepos', () => {
  it('unions every sweep, dedupes by repo, and applies the repo gate', async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) return json(EMPTY);
      const query = queryOf(url);
      if (query === 'topic:claude-skills stars:>=1000') {
        return json({
          total_count: 2,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
            {
              full_name: 'trailofbits/skills',
              stargazers_count: 6908,
              owner: { type: 'Organization' },
            },
          ],
        });
      }
      if (query === 'topic:agent-skills stars:>=1000') {
        return json({
          total_count: 1,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
          ],
        });
      }
      if (query === 'topic:mcp-server stars:10..99') {
        return json({
          total_count: 3,
          items: [
            { full_name: 'someone/tiny-skills', stargazers_count: 11, owner: { type: 'User' } },
            { full_name: 'someone/too-small', stargazers_count: 5, owner: { type: 'User' } },
            { full_name: 'someorg/tiny', stargazers_count: 3, owner: { type: 'Organization' } },
          ],
        });
      }
      return json(EMPTY);
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(repos).toEqual([
      { repo: 'anthropics/skills', stars: 172473 },
      { repo: 'trailofbits/skills', stars: 6908 },
      { repo: 'someone/tiny-skills', stars: 11 },
      { repo: 'someorg/tiny', stars: 3 },
    ]);
  });

  it('admits marketplace-seeded repos the topic sweeps never reach', async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) {
        return json({
          total_count: 2,
          items: [
            {
              repository: {
                full_name: 'seedorg/plugins',
                stargazers_count: 1,
                owner: { type: 'Organization' },
              },
            },
            {
              repository: {
                full_name: 'seeduser/plugins',
                stargazers_count: 1,
                owner: { type: 'User' },
              },
            },
          ],
        });
      }
      return json(EMPTY);
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    // The org seed clears the gate on its account type; the 1-star personal seed does not.
    expect(repos).toEqual([{ repo: 'seedorg/plugins', stars: 1 }]);
  });

  it('pages through a partition until the cap or the last page', async () => {
    const pagesSeen: number[] = [];
    const first = Array.from({ length: 100 }, (_, i) => ({
      full_name: `owner/a${String(i).padStart(3, '0')}`,
      stargazers_count: 500,
      owner: { type: 'User' },
    }));
    const second = Array.from({ length: 50 }, (_, i) => ({
      full_name: `owner/b${String(i).padStart(3, '0')}`,
      stargazers_count: 500,
      owner: { type: 'User' },
    }));

    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) return json(EMPTY);
      if (queryOf(url) !== 'topic:claude-code stars:100..999') return json(EMPTY);
      const page = pageOf(url);
      pagesSeen.push(page);
      return json({ total_count: 150, items: page === 1 ? first : second });
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(pagesSeen).toEqual([1, 2]);
    expect(repos).toHaveLength(150);
    expect(repos.some((r) => r.repo === 'owner/b049')).toBe(true);
  });

  it('issues 15 topic requests plus one code-search request when everything is empty', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return json(EMPTY);
    });
    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });
    expect(calls).toBe(16);
    expect(repos).toEqual([]);
  });
});
