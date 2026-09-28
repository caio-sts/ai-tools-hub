import { describe, expect, it } from 'vitest';
import { fetchHeadCommit } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

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
