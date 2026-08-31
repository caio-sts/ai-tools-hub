import { describe, expect, it } from 'vitest';
import { discoverMarketplaceRepos } from '../../scripts/harvest/discover.ts';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get('page') ?? '0');
}

describe('discoverMarketplaceRepos', () => {
  it('pages until the total is consumed and unions the seeds', async () => {
    const pagesSeen: number[] = [];
    const first = Array.from({ length: 100 }, (_, i) => ({
      repository: {
        full_name: `owner/a${String(i).padStart(3, '0')}`,
        stargazers_count: 40,
        owner: { type: 'User' },
      },
    }));
    const second = [
      {
        repository: {
          full_name: 'lateorg/plugins',
          stargazers_count: 2,
          owner: { type: 'Organization' },
        },
      },
    ];

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const page = pageOf(String(input));
      pagesSeen.push(page);
      return json({ total_count: 150, items: page === 1 ? first : second });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(pagesSeen).toEqual([1, 2]);
    expect(seeds).toHaveLength(101);
    expect(seeds).toContainEqual({ repo: 'lateorg/plugins', stars: 2, isOrg: true });
  });

  it('stops after one request when the seed is empty', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ total_count: 0, items: [] });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(calls).toBe(1);
    expect(seeds).toEqual([]);
  });

  it('keeps the highest star count seen for a repo across pages', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const page = pageOf(String(input));
      const stars = page === 1 ? 5 : 900;
      return json({
        total_count: 200,
        items: Array.from({ length: 100 }, () => ({
          repository: {
            full_name: 'dup/plugins',
            stargazers_count: stars,
            owner: { type: 'User' },
          },
        })),
      });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(seeds).toEqual([{ repo: 'dup/plugins', stars: 900, isOrg: false }]);
  });
});
