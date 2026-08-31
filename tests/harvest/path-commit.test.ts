import { describe, expect, it } from 'vitest';
import { fetchHeadCommit, fetchPathCommit } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

const NOW = Date.parse('2026-08-29T00:00:00Z');

describe('fetchPathCommit', () => {
  it('asks for the newest commit touching that exact path', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(
        JSON.stringify([{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }]),
        { status: 200 },
      );
    });

    const result = await fetchPathCommit('owner/repo', 'skills/alpha/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });

    expect(urls).toEqual([
      'https://api.github.com/repos/owner/repo/commits?path=skills%2Falpha%2FSKILL.md&per_page=1',
    ]);
    expect(result).toEqual({ sha: 'c0ffee1', updatedDays: 45 });
  });

  it('falls back to the author date when there is no committer date', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify([{ sha: 'abc', commit: { author: { date: '2026-08-28T00:00:00Z' } } }]),
          { status: 200 },
        ),
    );
    const result = await fetchPathCommit('owner/repo', 'a/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });
    expect(result).toEqual({ sha: 'abc', updatedDays: 1 });
  });

  it('never reports a negative age', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify([{ sha: 'abc', commit: { committer: { date: '2026-09-30T00:00:00Z' } } }]),
          { status: 200 },
        ),
    );
    const result = await fetchPathCommit('owner/repo', 'a/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });
    expect(result).toEqual({ sha: 'abc', updatedDays: 0 });
  });

  it('returns null when no commit, an empty repo or a missing repo comes back', async () => {
    const none = stubFetch(() => new Response('[]', { status: 200 }));
    const conflict = stubFetch(() => new Response('', { status: 409 }));
    const missing = stubFetch(() => new Response('', { status: 404 }));
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: none, now: () => NOW }),
    ).toBeNull();
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: conflict, now: () => NOW }),
    ).toBeNull();
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: missing, now: () => NOW }),
    ).toBeNull();
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(
      fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl, now: () => NOW }),
    ).rejects.toThrow('commits o/r:a/SKILL.md: HTTP 500');
  });
});

describe('fetchHeadCommit', () => {
  it('asks for the newest commit on the default branch, with no path filter', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify([{ sha: 'headc0m' }]), { status: 200 });
    });

    expect(await fetchHeadCommit('owner/repo', 'tok', { fetchImpl })).toBe('headc0m');
    expect(urls).toEqual(['https://api.github.com/repos/owner/repo/commits?per_page=1']);
  });

  it('returns null for an empty, missing or shaless response', async () => {
    const empty = stubFetch(() => new Response('[]', { status: 200 }));
    const conflict = stubFetch(() => new Response('', { status: 409 }));
    const missing = stubFetch(() => new Response('', { status: 404 }));
    const shaless = stubFetch(() => new Response(JSON.stringify([{ commit: {} }]), { status: 200 }));
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: empty })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: conflict })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: missing })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: shaless })).toBeNull();
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 502 }));
    await expect(fetchHeadCommit('o/r', 't', { fetchImpl })).rejects.toThrow('commits o/r: HTTP 502');
  });
});
