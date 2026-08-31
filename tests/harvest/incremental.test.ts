import { describe, expect, it } from 'vitest';
import type { Collection, Skill } from '../../src/types.ts';
import { carryForward, partitionRepos, pushedAtIndex, type CatalogSnapshot } from '../../scripts/harvest/run.ts';

function collection(repo: string, pushedAt: string): Collection {
  return { repo, stars: 10, forks: 1, pushedAt, license: 'MIT', topics: [], isOrg: false, curated: false };
}

function skill(repo: string, id: string): Skill {
  return {
    id,
    type: 'skill',
    name: 'n',
    description: 'A carried-forward entry with a description long enough to be real.',
    descriptionPt: null,
    longPt: null,
    repo,
    path: 'SKILL.md',
    sha: 'abc',
    updatedDays: 1,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    listed: true,
    // adoption 10 + maintenance 30 + provenance 5 (license) + completeness 20 (portable+license+description)
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
  };
}

const previous: CatalogSnapshot = {
  skills: [skill('cached/repo', 'cached/repo@abc:SKILL.md'), skill('changed/repo', 'changed/repo@abc:SKILL.md')],
  collections: [collection('cached/repo', '2026-08-01T00:00:00Z'), collection('changed/repo', '2026-08-01T00:00:00Z')],
};

describe('pushedAtIndex', () => {
  it('maps each previously seen repo to its pushedAt', () => {
    const index = pushedAtIndex(previous);
    expect(index.get('cached/repo')).toBe('2026-08-01T00:00:00Z');
    expect(index.size).toBe(2);
  });

  it('is empty for an empty snapshot', () => {
    expect(pushedAtIndex({ skills: [], collections: [] }).size).toBe(0);
  });
});

describe('partitionRepos (spec §6.1: skip repos whose pushedAt is unchanged)', () => {
  it('skips unchanged repos and crawls changed and unseen ones', () => {
    const fresh = [
      collection('cached/repo', '2026-08-01T00:00:00Z'),
      collection('changed/repo', '2026-08-28T09:00:00Z'),
      collection('brand/new', '2026-08-29T09:00:00Z'),
    ];

    const { crawl, skipped } = partitionRepos(fresh, pushedAtIndex(previous));
    expect(skipped.map((c) => c.repo)).toEqual(['cached/repo']);
    expect(crawl.map((c) => c.repo)).toEqual(['changed/repo', 'brand/new']);
  });

  it('crawls everything on a cold start', () => {
    const fresh = [collection('a/b', '2026-08-29T00:00:00Z')];
    const { crawl, skipped } = partitionRepos(fresh, new Map());
    expect(crawl).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});

describe('carryForward', () => {
  it('keeps exactly the previous skills of the skipped repos', () => {
    const kept = carryForward(previous, [collection('cached/repo', '2026-08-01T00:00:00Z')], new Map());
    expect(kept.map((s) => s.id)).toEqual(['cached/repo@abc:SKILL.md']);
  });

  it('keeps nothing when nothing was skipped', () => {
    expect(carryForward(previous, [], new Map())).toEqual([]);
  });
});
