import { describe, expect, it } from 'vitest';
import { fetchTree } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchTree', () => {
  it('makes exactly one recursive tree request and maps the entries', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          sha: 'tree1',
          truncated: false,
          tree: [
            { path: 'skills', mode: '040000', sha: 'dir1', type: 'tree' },
            { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob1', type: 'blob' },
          ],
        }),
        { status: 200 },
      );
    });

    const files = await fetchTree('owner/repo', 'tok', { fetchImpl });

    expect(urls).toEqual(['https://api.github.com/repos/owner/repo/git/trees/HEAD?recursive=1']);
    expect(files).toEqual([
      { path: 'skills', mode: '040000', sha: 'dir1', type: 'tree' },
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob1', type: 'blob' },
    ]);
  });

  it('returns an empty tree for missing (404) and empty (409) repos', async () => {
    const notFound = stubFetch(() => new Response('', { status: 404 }));
    const empty = stubFetch(() => new Response('', { status: 409 }));
    expect(await fetchTree('owner/gone', 'tok', { fetchImpl: notFound })).toEqual([]);
    expect(await fetchTree('owner/empty', 'tok', { fetchImpl: empty })).toEqual([]);
  });

  it('logs loudly when GitHub truncates the tree but still returns what arrived', async () => {
    const logs: string[] = [];
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            truncated: true,
            tree: [{ path: 'a/SKILL.md', mode: '100644', sha: 'b1', type: 'blob' }],
          }),
          { status: 200 },
        ),
    );
    const files = await fetchTree('owner/huge', 'tok', { fetchImpl, log: (m) => logs.push(m) });
    expect(files).toHaveLength(1);
    expect(logs.join('\n')).toContain('TRUNCATED');
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(fetchTree('owner/repo', 'tok', { fetchImpl })).rejects.toThrow(
      'tree owner/repo: HTTP 500',
    );
  });
});
