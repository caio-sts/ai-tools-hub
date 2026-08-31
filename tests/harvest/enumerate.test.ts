import { describe, expect, it } from 'vitest';
import { enumerateSkills, UNKNOWN_UPDATED_DAYS } from '../../scripts/harvest/enumerate.ts';

const NOW = Date.parse('2026-08-29T00:00:00Z');

const TREE = {
  truncated: false,
  tree: [
    { path: 'README.md', mode: '100644', sha: 'blob-readme', type: 'blob' },
    { path: 'skills', mode: '040000', sha: 'tree-1', type: 'tree' },
    { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
    { path: 'skills/beta/SKILL.md', mode: '120000', sha: 'blob-b', type: 'blob' },
    { path: 'mirror/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
    { path: '.claude/skills/internal/SKILL.md', mode: '100644', sha: 'blob-c', type: 'blob' },
  ],
};

const SKILL_MD = [
  '---',
  'name: alpha',
  'description: Scans lockfiles for malicious packages.',
  '---',
  '',
  'Run it on every PR.',
  '',
].join('\n');

interface RouteOptions {
  tree?: unknown;
  pathCommits?: unknown;
  headCommits?: unknown;
  raw?: (url: string) => Response;
}

function router(options: RouteOptions = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/git/trees/')) {
      return new Response(JSON.stringify(options.tree ?? TREE), { status: 200 });
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return options.raw?.(url) ?? new Response(SKILL_MD, { status: 200 });
    }
    if (url.includes('/commits?path=')) {
      return new Response(JSON.stringify(options.pathCommits ?? []), { status: 200 });
    }
    if (url.includes('/commits?per_page=')) {
      return new Response(JSON.stringify(options.headCommits ?? []), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

const BASE = { sleepImpl: async () => {}, now: () => NOW } as const;

describe('enumerateSkills', () => {
  it('returns one RawSkill per real skill, pinned to the per-path commit sha', async () => {
    const { urls, fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills).toEqual([
      {
        repo: 'owner/repo',
        path: 'skills/alpha/SKILL.md',
        sha: 'c0ffee1',
        blobSha: 'blob-a',
        frontmatter: {
          name: 'alpha',
          description: 'Scans lockfiles for malicious packages.',
        },
        body: 'Run it on every PR.',
        updatedDays: 45,
      },
    ]);
    expect(urls).toContain(
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md',
    );
  });

  it('falls back to the repo HEAD commit sha, never to a blob sha', async () => {
    const { urls, fetchImpl } = router({ headCommits: [{ sha: 'headc0m' }] });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills[0].sha).toBe('headc0m');
    expect(skills[0].blobSha).toBe('blob-a');
    expect(skills[0].updatedDays).toBe(UNKNOWN_UPDATED_DAYS);
    expect(UNKNOWN_UPDATED_DAYS).toBe(3650);
    expect(urls).toContain(
      'https://raw.githubusercontent.com/owner/repo/headc0m/skills/alpha/SKILL.md',
    );
    expect(urls.some((u) => u.includes('/blob-a/'))).toBe(false);
  });

  it('skips a path when neither a path commit nor a head commit exists', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(urls.some((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(false);
    expect(logs.join('\n')).toContain('no commit sha');
  });

  it('skips a path whose content 404s between tree and raw fetch', async () => {
    const { fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: () => new Response('404: Not Found', { status: 404 }),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
  });

  it('returns [] for a repo with no tree at all', async () => {
    const fetchImpl = (async () => new Response('', { status: 409 })) as typeof fetch;
    const skills = await enumerateSkills({ repo: 'owner/empty', stars: 50 }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
  });

  it('excludes a repo with no root README after exactly one request', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router({
      tree: {
        truncated: false,
        tree: [{ path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' }],
      },
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(urls).toHaveLength(1);
    expect(logs.join('\n')).toContain('README');
  });

  it('excludes a skill whose description fails the inclusion filter', async () => {
    const logs: string[] = [];
    const { fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: () => new Response('---\nname: alpha\ndescription: Helper.\n---\nBody.', { status: 200 }),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(logs.join('\n')).toContain('weak-description');
  });

  it('caps one entry per publisher per concept', async () => {
    const tree = {
      truncated: false,
      tree: [
        { path: 'README.md', mode: '100644', sha: 'blob-readme', type: 'blob' },
        { path: 'packs/alpha/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
        { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
        { path: 'skills/omega/SKILL.md', mode: '100644', sha: 'blob-3', type: 'blob' },
      ],
    };
    const { fetchImpl } = router({
      tree,
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: (url) =>
        new Response(
          url.includes('/omega/')
            ? '---\nname: Omega\ndescription: Renders build provenance attestations.\n---\nBody.'
            : '---\nname: Alpha\ndescription: Scans lockfiles for malicious packages.\n---\nBody.',
          { status: 200 },
        ),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills.map((s) => s.path)).toEqual([
      'packs/alpha/SKILL.md',
      'skills/omega/SKILL.md',
    ]);
  });
});
