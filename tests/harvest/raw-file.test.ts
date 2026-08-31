import { describe, expect, it } from 'vitest';
import { fetchRawFile } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchRawFile', () => {
  it('reads a commit-pinned path without an Authorization header', async () => {
    const urls: string[] = [];
    let headers: Record<string, string> = {};
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response('---\nname: alpha\n---\nBody.', { status: 200 });
    });

    const text = await fetchRawFile('owner/repo', 'c0ffee1', 'skills/alpha/SKILL.md', {
      fetchImpl,
    });

    expect(urls).toEqual([
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md',
    ]);
    expect(headers.authorization).toBeUndefined();
    expect(text).toBe('---\nname: alpha\n---\nBody.');
  });

  it('percent-encodes each path segment but keeps the separators', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response('x', { status: 200 });
    });
    await fetchRawFile('owner/repo', 'c0ffee1', 'skills/my skill/SKILL.md', { fetchImpl });
    expect(urls[0]).toBe(
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/my%20skill/SKILL.md',
    );
  });

  it('returns null on 404', async () => {
    const fetchImpl = stubFetch(() => new Response('404: Not Found', { status: 404 }));
    expect(await fetchRawFile('owner/repo', 'c0ffee1', 'a/SKILL.md', { fetchImpl })).toBeNull();
  });

  it('throws on other failures', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 503 }));
    await expect(
      fetchRawFile('owner/repo', 'c0ffee1', 'a/SKILL.md', { fetchImpl }),
    ).rejects.toThrow('raw owner/repo:a/SKILL.md: HTTP 503');
  });
});
