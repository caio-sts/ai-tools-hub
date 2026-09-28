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

const OID = '9892f18037231b42bdbdb6cc6ecdb2f5d58eff0e';
const ALIAS_RE = /^ +(p\d+): history\(first: 1, path: "([^"]+)"\)/gm;

interface RouteOptions {
  /** path -> [sha, committedDate]; a path left out has no history. */
  history?: Record<string, [string, string]>;
  raw?: (url: string) => Response;
}

function router(options: RouteOptions = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url === 'https://api.github.com/graphql') {
      const query = (JSON.parse(String(init?.body)) as { query: string }).query;
      const object: Record<string, unknown> = {};
      for (const [, alias, path] of query.matchAll(ALIAS_RE)) {
        const hit = options.history?.[path!];
        object[alias!] = { nodes: hit === undefined ? [] : [{ oid: hit[0], committedDate: hit[1] }] };
      }
      return new Response(JSON.stringify({ data: { rateLimit: { cost: 1, remaining: 4999 }, repository: { object } } }), {
        status: 200,
      });
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return options.raw?.(url) ?? new Response(SKILL_MD, { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

const BASE = { sleepImpl: async () => {}, now: () => NOW } as const;

function snapshot(tree: unknown = TREE) {
  const entries = (tree as { tree: Array<{ path: string; mode: string; sha: string; type: string }> }).tree;
  return { repo: { repo: 'owner/repo', stars: 120 }, oid: OID, tree: entries };
}

describe('enumerateSkills', () => {
  it('returns one RawSkill per real skill, pinned to the per-path commit sha', async () => {
    const { urls, fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
    });

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });

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
    expect(urls).toContain('https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md');
  });

  it('makes no core request: one GraphQL batch, then raw content only', async () => {
    const { urls, fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
    });
    await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });
    expect(urls.filter((u) => u.startsWith('https://api.github.com/') && !u.endsWith('/graphql'))).toEqual([]);
    expect(urls.filter((u) => u.endsWith('/graphql'))).toHaveLength(1);
  });

  it('pins a path with no history to the snapshot oid, never to a blob sha', async () => {
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl });

    expect(skills[0]!.sha).toBe(OID);
    expect(skills[0]!.blobSha).toBe('blob-a');
    expect(skills[0]!.updatedDays).toBe(UNKNOWN_UPDATED_DAYS);
    expect(UNKNOWN_UPDATED_DAYS).toBe(3650);
    expect(urls).toContain(`https://raw.githubusercontent.com/owner/repo/${OID}/skills/alpha/SKILL.md`);
    expect(urls.some((u) => u.includes('/blob-a/'))).toBe(false);
  });

  it('skips a path whose content 404s between tree and raw fetch', async () => {
    const { fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
      raw: () => new Response('404: Not Found', { status: 404 }),
    });
    expect(await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl })).toEqual([]);
  });

  it('returns [] for a repo with no tree at all, without a request', async () => {
    const { urls, fetchImpl } = router();
    const skills = await enumerateSkills({ repo: { repo: 'owner/empty', stars: 50 }, oid: OID, tree: [] }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
    expect(urls).toHaveLength(0);
  });

  it('excludes a repo with no root README before spending any request', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills(
      snapshot({ truncated: false, tree: [{ path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' }] }),
      'tok',
      { ...BASE, fetchImpl, log: (m) => logs.push(m) },
    );

    expect(skills).toEqual([]);
    expect(urls).toHaveLength(0);
    expect(logs.join('\n')).toContain('README');
  });

  it('excludes a skill whose description fails the inclusion filter', async () => {
    const logs: string[] = [];
    const { fetchImpl } = router({
      history: { 'skills/alpha/SKILL.md': ['c0ffee1', '2026-07-15T00:00:00Z'] },
      raw: () => new Response('---\nname: alpha\ndescription: Helper.\n---\nBody.', { status: 200 }),
    });

    const skills = await enumerateSkills(snapshot(), 'tok', { ...BASE, fetchImpl, log: (m) => logs.push(m) });

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
      raw: (url) =>
        new Response(
          url.includes('/omega/')
            ? '---\nname: Omega\ndescription: Renders build provenance attestations.\n---\nBody.'
            : '---\nname: Alpha\ndescription: Scans lockfiles for malicious packages.\n---\nBody.',
          { status: 200 },
        ),
    });

    const skills = await enumerateSkills(snapshot(tree), 'tok', { ...BASE, fetchImpl });

    expect(skills.map((s) => s.path)).toEqual(['packs/alpha/SKILL.md', 'skills/omega/SKILL.md']);
  });
});
