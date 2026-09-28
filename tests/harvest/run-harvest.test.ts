import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { RateLimitedError, type Budget } from '../../scripts/harvest/budget.ts';
import type { RepoSnapshot } from '../../scripts/harvest/enumerate.ts';
import { StuckCrawlError, main, runHarvest, type HarvestDeps } from '../../scripts/harvest/run.ts';

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
  treeRefs: string[];
  contentRefs: string[];
  licenseRefs: string[];
  safetyFrontmatter: Array<Record<string, unknown>>;
}

function spy(): Spy {
  return { enumerated: [], treeRefs: [], contentRefs: [], licenseRefs: [], safetyFrontmatter: [] };
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

interface DepsOptions {
  fresh?: Collection[];
  headOids?: Map<string, string>;
  rawsFor?: (repo: string) => RawSkill[];
  fetchTree?: HarvestDeps['fetchTree'];
}

function deps(s: Spy, options: DepsOptions = {}): Partial<HarvestDeps> {
  const fresh = options.fresh ?? [
    collection('cached/repo', '2026-08-01T00:00:00Z', 500),
    collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
  ];
  const headOids = options.headOids ?? new Map(fresh.map((c) => [c.repo, HEAD_COMMIT]));
  return {
    discoverRepos: async () => {
      throw new Error('discovery must not run when an allowlist is supplied');
    },
    enrichCollections: async () => ({ collections: fresh, headOids }),
    fetchTree:
      options.fetchTree ??
      (async (_repo, ref) => {
        s.treeRefs.push(ref);
        return tree;
      }),
    enumerateSkills: async (snapshot: RepoSnapshot) => {
      s.enumerated.push(snapshot.repo.repo);
      if (options.rawsFor) return options.rawsFor(snapshot.repo.repo);
      return snapshot.repo.repo === 'fresh/repo' ? [raw] : [];
    },
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
    log: () => {},
  };
}

/** Lets `repos` repos start, then reports the time budget spent. */
function budgetAllowing(repos: number): Budget {
  let checks = 0;
  return {
    observeCore() {},
    observeGraphql() {},
    exhausted: () => (checks++ < repos ? null : 'time budget'),
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
      discoveredCount: 2,
    });
    expect(s.treeRefs).toEqual([HEAD_COMMIT]);
  });

  it('reads the tree and pins every raw fetch to the enrichment oid, never the skill or blob sha', async () => {
    const dir = await seededDataDir();
    const s = spy();
    await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.treeRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).toEqual([HEAD_COMMIT]);
    expect(s.licenseRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).not.toContain(PATH_SHA);
    expect(s.contentRefs).not.toContain(BLOB_SHA);
  });

  it('treats a repo with no default branch as empty: no request, no skills, but a row', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills, collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['fresh/repo'],
      deps: deps(s, { headOids: new Map() }),
    });

    expect(s.treeRefs).toEqual([]);
    expect(s.enumerated).toEqual([]);
    expect(skills.find((k) => k.repo === 'fresh/repo')).toBeUndefined();
    expect(collections.map((c) => c.repo)).toContain('fresh/repo');
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

  it('stops cleanly on the budget, keeps what it read, and leaves never-read repos out', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('a/small', '2026-09-01T00:00:00Z', 5),
      collection('b/medium', '2026-09-01T00:00:00Z', 50),
      collection('c/large', '2026-09-01T00:00:00Z', 500),
    ];

    const { collections, meta, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(s, { fresh }),
      budget: budgetAllowing(2),
    });

    expect(s.enumerated).toEqual(['c/large', 'b/medium']);
    expect(collections.map((c) => c.repo)).toEqual(['b/medium', 'c/large']);
    expect(meta.sourceCount).toBe(2);
    expect(meta.discoveredCount).toBe(3);
    expect(summary).toEqual({ read: 2, unchanged: 0, deferred: 1, failed: 0, stopped: 'time budget' });
  });

  it('keeps the previous row and skills of a changed repo it did not reach, so it stays queued', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('cached/repo', '2026-09-20T00:00:00Z', 500),
      collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
    ];

    const { skills, collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(s, { fresh }),
      budget: budgetAllowing(1),
    });

    expect(s.enumerated).toEqual(['fresh/repo']);
    const cached = collections.find((c) => c.repo === 'cached/repo');
    expect(cached?.pushedAt).toBe('2026-08-01T00:00:00Z');
    expect(skills.map((k) => k.id)).toContain('cached/repo@old:SKILL.md');
  });

  it('discards a repo refused mid-read, commits the ones before it, and exits normally', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const logs: string[] = [];
    const fresh = [
      collection('first/repo', '2026-09-01T00:00:00Z', 900),
      collection('second/repo', '2026-09-01T00:00:00Z', 100),
    ];

    const { collections, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: {
        ...deps(s, {
          fresh,
          fetchTree: async (repo) => {
            if (repo === 'second/repo') throw new RateLimitedError(`tree ${repo}`);
            return tree;
          },
        }),
        log: (message: string) => logs.push(message),
      },
    });

    expect(collections.map((c) => c.repo)).toEqual(['first/repo']);
    expect(summary.stopped).toBe('rate limited');
    expect(summary.deferred).toBe(1);
    expect(logs).toContain('harvest: second/repo discarded: tree second/repo: rate limited');
  });

  it('discards a changed repo refused mid-read, keeps its previous row and skills, and resolves', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const fresh = [
      collection('first/repo', '2026-09-01T00:00:00Z', 900),
      collection('cached/repo', '2026-09-20T00:00:00Z', 500),
    ];

    const { skills, collections, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: {
        ...deps(s, { fresh, rawsFor: (repo) => [{ ...raw, repo }] }),
        fetchScriptContents: async (repo: string, ref: string) => {
          if (repo === 'cached/repo') throw new RateLimitedError(`content ${repo}`);
          s.contentRefs.push(ref);
          return new Map([['skills/fresh/scripts/run.py', 'import os\n']]);
        },
      },
    });

    expect(s.enumerated).toEqual(['first/repo', 'cached/repo']);
    expect(skills.find((k) => k.repo === 'first/repo')).toBeDefined();
    expect(skills.map((k) => k.id)).toContain('cached/repo@old:SKILL.md');
    const cached = collections.find((c) => c.repo === 'cached/repo');
    expect(cached?.pushedAt).toBe('2026-08-01T00:00:00Z');
    expect(summary.stopped).toBe('rate limited');
  });

  it('gives a repo it read a row even when it yields zero skills, so it is not re-read', async () => {
    const dir = await seededDataDir();
    const fresh = [collection('empty/skills', '2026-09-01T00:00:00Z', 50)];

    const { collections } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['empty/skills'],
      deps: deps(spy(), { fresh, rawsFor: () => [] }),
    });

    expect(collections.map((c) => c.repo)).toEqual(['empty/skills']);
  });

  it('fails loudly, and writes nothing, when it cannot read a single repo of a non-empty queue', async () => {
    const dir = await seededDataDir();
    const before = await readFile(join(dir, 'meta.json'), 'utf8');
    const fresh = [collection('never/read', '2026-09-01T00:00:00Z', 50)];

    await expect(
      runHarvest({
        token: 'tok',
        dataDir: dir,
        allowlist: ['never/read'],
        deps: deps(spy(), { fresh }),
        budget: budgetAllowing(0),
      }),
    ).rejects.toBeInstanceOf(StuckCrawlError);
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toBe(before);
  });

  it('succeeds with nothing to do when every repo is unchanged', async () => {
    const dir = await seededDataDir();
    const fresh = [collection('cached/repo', '2026-08-01T00:00:00Z', 500)];

    const { summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo'],
      deps: deps(spy(), { fresh }),
      budget: budgetAllowing(0),
    });

    expect(summary).toEqual({ read: 0, unchanged: 1, deferred: 0, failed: 0, stopped: null });
  });

  it('logs a failing never-read repo, leaves it out, and reads the rest', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const logs: string[] = [];
    const fresh = [
      collection('a/first', '2026-09-01T00:00:00Z', 900),
      collection('b/second', '2026-09-01T00:00:00Z', 500),
      collection('c/third', '2026-09-01T00:00:00Z', 100),
    ];

    const { collections, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: {
        ...deps(s, {
          fresh,
          rawsFor: (repo) => [{ ...raw, repo }],
          fetchTree: async (repo) => {
            if (repo === 'b/second') throw new Error('fetch failed');
            return tree;
          },
        }),
        log: (message: string) => logs.push(message),
      },
    });

    expect(s.enumerated).toEqual(['a/first', 'c/third']);
    expect(collections.map((c) => c.repo)).toEqual(['a/first', 'c/third']);
    expect(loadSkills(dir).map((k) => k.repo).sort()).toEqual(['a/first', 'c/third']);
    expect(summary).toEqual({ read: 2, unchanged: 0, deferred: 1, failed: 1, stopped: null });
    expect(logs).toContain('harvest: b/second failed: fetch failed');
    expect(logs).toContain('harvest: read 2, unchanged 0, deferred 1, failed 1, stopped: queue drained');
  });

  it('keeps the previous row and skills of a changed repo that fails mid-read', async () => {
    const dir = await seededDataDir();
    await writeFile(
      join(dir, 'collections.json'),
      `${JSON.stringify(
        [collection('cached/repo', '2026-08-01T00:00:00Z', 500), collection('older/repo', '2026-08-15T00:00:00Z', 50)],
        null,
        2,
      )}\n`,
      'utf8',
    );
    const s = spy();
    const fresh = [
      collection('a/first', '2026-09-01T00:00:00Z', 900),
      collection('cached/repo', '2026-09-20T00:00:00Z', 500),
      collection('older/repo', '2026-09-20T00:00:00Z', 50),
    ];

    const { skills, collections, summary } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: {
        ...deps(s, { fresh, rawsFor: (repo) => [{ ...raw, repo }] }),
        fetchScriptContents: async (repo: string) => {
          if (repo === 'cached/repo') throw new Error('raw cached/repo: 502');
          return new Map([['skills/fresh/scripts/run.py', 'import os\n']]);
        },
      },
    });

    expect(s.enumerated).toEqual(['a/first', 'cached/repo', 'older/repo']);
    expect(collections.find((c) => c.repo === 'cached/repo')?.pushedAt).toBe('2026-08-01T00:00:00Z');
    expect(collections.find((c) => c.repo === 'older/repo')?.pushedAt).toBe('2026-09-20T00:00:00Z');
    expect(skills.filter((k) => k.repo === 'cached/repo').map((k) => k.id)).toEqual(['cached/repo@old:SKILL.md']);
    expect(skills.find((k) => k.repo === 'older/repo')).toBeDefined();
    expect(summary).toEqual({ read: 2, unchanged: 0, deferred: 1, failed: 1, stopped: null });
  });

  it('logs how long a repo took to read once it takes a minute or more', async () => {
    const dir = await seededDataDir();
    const logs: string[] = [];
    let clock = Date.parse('2026-09-28T06:37:00.000Z');
    const fresh = [
      collection('slow/repo', '2026-09-01T00:00:00Z', 900),
      collection('quick/repo', '2026-09-01T00:00:00Z', 100),
    ];

    await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: {
        ...deps(spy(), {
          fresh,
          fetchTree: async (repo) => {
            clock += repo === 'slow/repo' ? 61_000 : 59_999;
            return tree;
          },
        }),
        now: () => new Date(clock),
        log: (message: string) => logs.push(message),
      },
    });

    expect(logs).toContain('harvest: slow/repo read in 61s');
    expect(logs.filter((line) => line.includes(' read in '))).toHaveLength(1);
  });

  it('fails loudly, and writes nothing, when every repo of the queue fails', async () => {
    const dir = await seededDataDir();
    const before = await Promise.all(
      ['skills.json', 'collections.json', 'meta.json'].map((file) => readFile(join(dir, file), 'utf8')),
    );
    const fresh = [
      collection('a/first', '2026-09-01T00:00:00Z', 900),
      collection('b/second', '2026-09-01T00:00:00Z', 500),
    ];

    const error = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: fresh.map((c) => c.repo),
      deps: deps(spy(), {
        fresh,
        fetchTree: async (repo) => {
          throw new Error(`tree ${repo}: 500`);
        },
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StuckCrawlError);
    expect((error as StuckCrawlError).reason).toBe('repo failures');
    const after = await Promise.all(
      ['skills.json', 'collections.json', 'meta.json'].map((file) => readFile(join(dir, file), 'utf8')),
    );
    expect(after).toEqual(before);
  });

  it('fails loudly when the very first repo is rate limited', async () => {
    const dir = await seededDataDir();
    const before = await readFile(join(dir, 'meta.json'), 'utf8');
    const fresh = [collection('a/first', '2026-09-01T00:00:00Z', 900)];

    const error = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['a/first'],
      deps: deps(spy(), {
        fresh,
        fetchTree: async (repo) => {
          throw new RateLimitedError(`tree ${repo}`);
        },
      }),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StuckCrawlError);
    expect((error as StuckCrawlError).reason).toBe('rate limited');
    expect(await readFile(join(dir, 'meta.json'), 'utf8')).toBe(before);
  });
});

describe('main', () => {
  const env = { CATALOG_PAT: 'tok' };
  const fresh = [
    collection('a/first', '2026-09-01T00:00:00Z', 900),
    collection('b/second', '2026-09-01T00:00:00Z', 500),
  ];
  const argv = (dir: string) => [`--allowlist=${fresh.map((c) => c.repo).join(',')}`, `--data-dir=${dir}`];

  it('exits 1 after writing when a repo failed', async () => {
    const dir = await seededDataDir();
    const failing = deps(spy(), {
      fresh,
      fetchTree: async (repo) => {
        if (repo === 'b/second') throw new Error('fetch failed');
        return tree;
      },
    });

    expect(await main(argv(dir), env, failing)).toBe(1);
    expect(JSON.parse(await readFile(join(dir, 'collections.json'), 'utf8'))).toHaveLength(1);
  });

  it('exits 0 when every queued repo was read', async () => {
    const dir = await seededDataDir();
    expect(await main(argv(dir), env, deps(spy(), { fresh }))).toBe(0);
  });
});
