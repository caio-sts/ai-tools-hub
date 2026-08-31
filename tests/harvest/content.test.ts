import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { siblingLicensePath } from '../../src/lib/license.ts';
import { MAX_SCRIPT_FILES, fetchScriptContents } from '../../scripts/harvest/run.ts';

const COMMIT = '4c9e1f7a2b3d5e6f7081920a3b4c5d6e7f809102';
const BLOB = '1111111111111111111111111111111111111111';

function recordingFetch(handler: (url: string) => Response): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { impl, urls };
}

describe('fetchScriptContents', () => {
  const files: TreeFile[] = [
    { path: 'skills/x/scripts/a.py', mode: '100644', sha: '1', type: 'blob' },
    { path: 'skills/x/scripts/b.py', mode: '100644', sha: '2', type: 'blob' },
    { path: 'skills/x/scripts/gone.py', mode: '100644', sha: '3', type: 'blob' },
  ];

  it('pins every request to the commit sha it was given, never to a blob sha', async () => {
    const rec = recordingFetch(() => new Response('print(1)', { status: 200 }));
    await fetchScriptContents('a/b', COMMIT, files.slice(0, 1), { fetchImpl: rec.impl });

    expect(rec.urls).toEqual([`https://raw.githubusercontent.com/a/b/${COMMIT}/skills/x/scripts/a.py`]);
    expect(rec.urls[0]).not.toContain(BLOB);
  });

  it('maps every readable file by path and drops the unreadable ones', async () => {
    const rec = recordingFetch((url) =>
      url.endsWith('gone.py') ? new Response('404', { status: 404 }) : new Response(`# ${url.split('/').pop()}`, { status: 200 }),
    );

    const contents = await fetchScriptContents('a/b', COMMIT, files, { fetchImpl: rec.impl });
    expect(contents.size).toBe(2);
    expect(contents.get('skills/x/scripts/a.py')).toBe('# a.py');
    expect(contents.has('skills/x/scripts/gone.py')).toBe(false);
  });

  it('survives a server error on one file instead of aborting the crawl', async () => {
    const rec = recordingFetch((url) =>
      url.endsWith('b.py') ? new Response('boom', { status: 500 }) : new Response('ok', { status: 200 }),
    );

    const contents = await fetchScriptContents('a/b', COMMIT, files.slice(0, 2), { fetchImpl: rec.impl });
    expect(contents.size).toBe(1);
    expect(contents.has('skills/x/scripts/a.py')).toBe(true);
  });

  it('never fetches more than MAX_SCRIPT_FILES per skill', async () => {
    const many: TreeFile[] = Array.from({ length: 40 }, (_unused, i) => ({
      path: `skills/x/scripts/f${i}.py`,
      mode: '100644',
      sha: String(i),
      type: 'blob',
    }));
    const rec = recordingFetch(() => new Response('print(1)', { status: 200 }));

    const contents = await fetchScriptContents('a/b', COMMIT, many, { fetchImpl: rec.impl });
    expect(MAX_SCRIPT_FILES).toBe(25);
    expect(rec.urls).toHaveLength(25);
    expect(contents.size).toBe(25);
  });
});

describe('siblingLicensePath (spec §4.3, exported from src/lib/license.ts)', () => {
  const treePaths = [
    'skills/sast/SKILL.md',
    'skills/sast/LICENSE.txt',
    'skills/sast/sub/LICENSE',
    'skills/other/LICENSE',
  ];

  it('finds a LICENSE file next to SKILL.md', () => {
    expect(siblingLicensePath('skills/sast/SKILL.md', treePaths)).toBe('skills/sast/LICENSE.txt');
  });

  it('ignores a nested LICENSE and another skill directory', () => {
    expect(siblingLicensePath('skills/none/SKILL.md', treePaths)).toBeNull();
  });

  it('matches LICENCE case-insensitively at the repo root', () => {
    expect(siblingLicensePath('SKILL.md', ['SKILL.md', 'licence'])).toBe('licence');
  });
});
