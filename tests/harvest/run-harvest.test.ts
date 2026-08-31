import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { runHarvest, type HarvestDeps } from '../../scripts/harvest/run.ts';

const HEAD_COMMIT = '4c9e1f7a2b3d5e6f7081920a3b4c5d6e7f809102';
const PATH_SHA = 'newsha0000000000000000000000000000000000';
const BLOB_SHA = 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1';

const INERT: Safety = {
  executesCode: false,
  scriptCount: 0,
  languages: [],
  network: false,
  readsEnv: false,
  declaredTools: null,
};

function collection(repo: string, pushedAt: string, stars: number): Collection {
  return { repo, stars, forks: 3, pushedAt, license: 'MIT', topics: ['claude-skills'], isOrg: true, curated: true };
}

function cachedSkill(): Skill {
  return {
    id: 'cached/repo@old:SKILL.md',
    type: 'skill',
    name: 'cached',
    description: 'A skill carried forward untouched from the previous crawl run.',
    descriptionPt: null,
    longPt: null,
    repo: 'cached/repo',
    path: 'SKILL.md',
    sha: 'old',
    updatedDays: 5,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: INERT,
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    // Deliberately false on disk: it was evicted on the previous run. It is rank 1 in its
    // subdomain now, so applyListing has to bring it back (spec §5.1).
    listed: false,
    score: 100,
    breakdown: { adoption: 25, maintenance: 30, provenance: 25, completeness: 20, total: 100 },
  };
}

async function seededDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-run-'));
  await writeFile(join(dir, 'skills.json'), `${JSON.stringify([cachedSkill()], null, 2)}\n`, 'utf8');
  await writeFile(
    join(dir, 'collections.json'),
    `${JSON.stringify([collection('cached/repo', '2026-08-01T00:00:00Z', 500)], null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(dir, 'meta.json'),
    `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: '2026-08-10T00:00:00.000Z', skillCount: 1, sourceCount: 1 }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

interface Spy {
  enumerated: string[];
  contentRefs: string[];
  licenseRefs: string[];
  safetyFrontmatter: Array<Record<string, unknown>>;
}

function spy(): Spy {
  return { enumerated: [], contentRefs: [], licenseRefs: [], safetyFrontmatter: [] };
}

const tree: TreeFile[] = [
  { path: 'skills/fresh/SKILL.md', mode: '100644', sha: BLOB_SHA, type: 'blob' },
  { path: 'skills/fresh/LICENSE', mode: '100644', sha: 'lic', type: 'blob' },
  { path: 'skills/fresh/scripts/run.py', mode: '100755', sha: 'b2', type: 'blob' },
];

const raw: RawSkill = {
  repo: 'fresh/repo',
  path: 'skills/fresh/SKILL.md',
  sha: PATH_SHA,
  blobSha: BLOB_SHA,
  frontmatter: {
    name: 'fresh',
    description: 'Scan container images and report vulnerabilities by severity.',
    'allowed-tools': ['Bash'],
  },
  body: '',
  updatedDays: 0,
};

function deps(s: Spy, headSha: string | null = HEAD_COMMIT): Partial<HarvestDeps> {
  return {
    discoverRepos: async () => {
      throw new Error('discovery must not run when an allowlist is supplied');
    },
    enrichCollections: async () => [
      collection('cached/repo', '2026-08-01T00:00:00Z', 500),
      collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
    ],
    enumerateSkills: async (repo) => {
      s.enumerated.push(repo.repo);
      return repo.repo === 'fresh/repo' ? [raw] : [];
    },
    fetchTree: async () => tree,
    fetchHeadCommit: async () => headSha,
    fetchRawFile: async (_repo, ref) => {
      s.licenseRefs.push(ref);
      return 'MIT License\n';
    },
    fetchScriptContents: async (_repo, ref) => {
      s.contentRefs.push(ref);
      return new Map([['skills/fresh/scripts/run.py', 'import os\n']]);
    },
    deriveSafety: (_files, _contents, frontmatter) => {
      s.safetyFrontmatter.push(frontmatter);
      return { ...INERT, executesCode: true, scriptCount: 1, languages: ['python'], declaredTools: ['Bash'] };
    },
    now: () => new Date('2026-08-29T06:37:00.000Z'),
  };
}

describe('runHarvest', () => {
  it('skips unchanged repos, carries their skills forward, and writes both catalog files', async () => {
    const dir = await seededDataDir();
    const s = spy();

    const { skills, collections, meta } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo', 'fresh/repo'],
      deps: deps(s),
    });

    expect(s.enumerated).toEqual(['fresh/repo']);
    expect(skills.map((k) => k.id).sort()).toEqual([
      'cached/repo@old:SKILL.md',
      `fresh/repo@${PATH_SHA}:skills/fresh/SKILL.md`,
    ]);
    expect(collections.map((c) => c.repo)).toEqual(['cached/repo', 'fresh/repo']);
    expect(loadSkills(dir)).toHaveLength(2);
    expect(meta).toEqual({
      crawledAt: '2026-08-29T06:37:00.000Z',
      classifiedAt: '2026-08-10T00:00:00.000Z',
      skillCount: 2,
      sourceCount: 2,
    });
  });

  it('pins every raw fetch to the head COMMIT sha, never to the skill or blob sha', async () => {
    const dir = await seededDataDir();
    const s = spy();
    await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.contentRefs).toEqual([HEAD_COMMIT]);
    expect(s.licenseRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).not.toContain(PATH_SHA);
    expect(s.contentRefs).not.toContain(BLOB_SHA);
  });

  it('makes no raw request at all when the head commit sha cannot be resolved', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s, null) });

    expect(s.contentRefs).toEqual([]);
    expect(s.licenseRefs).toEqual([]);
    // The entry still lands, with a tree-only safety surface.
    expect(skills.find((k) => k.repo === 'fresh/repo')).toBeDefined();
  });

  it('passes the frontmatter through to deriveSafety so declaredTools is populated (spec §4.3)', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.safetyFrontmatter).toHaveLength(1);
    expect(s.safetyFrontmatter[0]!['allowed-tools']).toEqual(['Bash']);

    const fresh = skills.find((k) => k.repo === 'fresh/repo');
    expect(fresh?.safety.declaredTools).toEqual(['Bash']);
    expect(fresh?.securityRelevant).toBe(true);
    expect(fresh?.indexedAt).toBe('2026-08-29T06:37:00.000Z');
  });

  it('re-lists a previously evicted entry, keeping its original indexedAt (spec §5.1)', async () => {
    const dir = await seededDataDir();
    const { skills } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo', 'fresh/repo'],
      deps: deps(spy()),
    });

    const cached = skills.find((k) => k.id === 'cached/repo@old:SKILL.md');
    // It was written to disk with listed: false. Only applyListing can turn it back on,
    // and indexedAt is provenance, not a listing timestamp, so it must not move.
    expect(cached?.listed).toBe(true);
    expect(cached?.indexedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(skills.every((k) => k.listed)).toBe(true);
    expect(loadSkills(dir).every((k) => k.listed)).toBe(true);
  });

  it('sorts by score descending, then by id', async () => {
    const dir = await seededDataDir();
    const { skills } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo', 'fresh/repo'],
      deps: deps(spy()),
    });

    for (let i = 1; i < skills.length; i += 1) {
      expect(skills[i - 1]!.score).toBeGreaterThanOrEqual(skills[i]!.score);
    }
    expect(skills[0]!.id).toBe('cached/repo@old:SKILL.md');
  });

  it('applies data/assignments.json when it is present', async () => {
    const dir = await seededDataDir();
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        [`fresh/repo@${PATH_SHA}:skills/fresh/SKILL.md`]: {
          primary: 'security/containers-kubernetes',
          also: [],
          tags: ['trivy'],
        },
      }),
      'utf8',
    );

    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(spy()) });
    const fresh = skills.find((k) => k.repo === 'fresh/repo');
    expect(fresh?.primary).toBe('security/containers-kubernetes');
    expect(fresh?.tags).toEqual(['trivy']);
  });
});
