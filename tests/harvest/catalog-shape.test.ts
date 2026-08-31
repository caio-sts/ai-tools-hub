import { describe, expect, it } from 'vitest';
import type { Collection, Meta, ScoreBreakdown, Skill } from '../../src/types.ts';
import { loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { validateCatalog } from '../../scripts/harvest/run.ts';

const collection: Collection = {
  repo: 'a/b',
  stars: 10,
  forks: 0,
  pushedAt: '2026-08-01T00:00:00Z',
  license: 'MIT',
  topics: [],
  isOrg: false,
  curated: false,
};

/** Any total in 0..100 split into components that respect the 25/30/25/20 caps. */
function breakdownFor(total: number): ScoreBreakdown {
  const adoption = Math.min(25, total);
  const maintenance = Math.min(30, total - adoption);
  const provenance = Math.min(25, total - adoption - maintenance);
  const completeness = total - adoption - maintenance - provenance;
  return { adoption, maintenance, provenance, completeness, total };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  const base: Skill = {
    id: 'a/b@abc1234:SKILL.md',
    type: 'skill',
    name: 'x',
    description: 'A description long enough to clear the forty-character threshold.',
    descriptionPt: null,
    longPt: null,
    repo: 'a/b',
    path: 'SKILL.md',
    sha: 'abc1234',
    updatedDays: 1,
    indexedAt: '2026-08-29T00:00:00.000Z',
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
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
  };
  return { ...base, ...overrides };
}

function meta(overrides: Partial<Meta> = {}): Meta {
  return { crawledAt: '2026-08-29T00:00:00.000Z', classifiedAt: null, skillCount: 1, sourceCount: 1, ...overrides };
}

describe('validateCatalog accepts a consistent catalog', () => {
  it('reports no problems for one good entry', () => {
    expect(validateCatalog([skill()], [collection], meta())).toEqual([]);
  });

  it('reports no problems for an empty catalog', () => {
    expect(validateCatalog([], [], meta({ skillCount: 0, sourceCount: 0 }))).toEqual([]);
  });
});

describe('validateCatalog catches every way the pipeline can lie', () => {
  function problems(skills: Skill[], collections: Collection[], m: Meta): string[] {
    return validateCatalog(skills, collections, m).map((p) => p.problem);
  }

  it('catches a duplicate id', () => {
    const m = meta({ skillCount: 2 });
    expect(problems([skill(), skill()], [collection], m)).toContain('duplicate id');
  });

  it('catches an id that does not re-derive from repo, sha and path', () => {
    expect(problems([skill({ id: 'a/b@wrong:SKILL.md' })], [collection], meta())).toContain(
      'id is not repo@sha:path',
    );
  });

  it('catches a breakdown that does not sum, and a score that disagrees with it', () => {
    const bad = skill({ breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 99 } });
    expect(problems([bad], [collection], meta())).toContain('breakdown does not sum to total');
    expect(problems([skill({ score: 1 })], [collection], meta())).toContain('score does not equal breakdown.total');
  });

  it('catches a component over its cap', () => {
    const bad = skill({
      score: 96,
      breakdown: { adoption: 41, maintenance: 30, provenance: 5, completeness: 20, total: 96 },
    });
    expect(problems([bad], [collection], meta())).toContain('adoption outside 0..25');
  });

  it('catches a license without a source, and a source without a license', () => {
    expect(problems([skill({ licenseSource: null })], [collection], meta())).toContain(
      'license set but licenseSource is null',
    );
    expect(problems([skill({ license: null })], [collection], meta())).toContain(
      'licenseSource set but license is null',
    );
  });

  it('catches an over-full also list, an over-full tag list and an empty runtime list', () => {
    const bad = skill({ also: ['a/x', 'a/y', 'a/z'], tags: Array.from({ length: 11 }, (_u, i) => `t${i}`), runtimes: [] });
    const found = problems([bad], [collection], meta());
    expect(found).toContain('more than 2 also entries');
    expect(found).toContain('more than 10 tags');
    expect(found).toContain('no runtimes');
  });

  it('catches an entry whose repo has no collection row', () => {
    expect(problems([skill()], [], meta({ sourceCount: 0 }))).toContain('repo has no collection row');
  });

  it('catches an out-of-order catalog', () => {
    const low = skill({ id: 'a/b@abc1234:low/SKILL.md', path: 'low/SKILL.md', score: 5, breakdown: { adoption: 5, maintenance: 0, provenance: 0, completeness: 0, total: 5 } });
    expect(problems([low, skill()], [collection], meta({ skillCount: 2 }))).toContain('not sorted by score descending');
  });

  it('catches a non-boolean listed flag surviving from a hand-edited file', () => {
    // The loaders cast rather than validate, so this shape really can reach the site.
    const bad = { ...skill(), listed: 'yes' } as unknown as Skill;
    expect(problems([bad], [collection], meta())).toContain('listed is not a boolean');
  });

  it('catches a subdomain listing more entries than the cap could ever allow', () => {
    // 80 entries, all listed: what the file looks like if applyListing is ever dropped from
    // runHarvest and buildSkill's provisional `listed: true` survives to disk (spec §5.1).
    const many = Array.from({ length: 80 }, (_u, i) =>
      skill({
        id: `a/b@abc1234:s${i}/SKILL.md`,
        path: `s${i}/SKILL.md`,
        score: 100 - i,
        breakdown: breakdownFor(100 - i),
      }),
    );
    expect(problems(many, [collection], meta({ skillCount: 80 }))).toContain(
      'more listed entries than the subdomain cap allows',
    );
  });

  it('catches meta counts and a non-ISO crawl date', () => {
    const found = problems([skill()], [collection], meta({ skillCount: 9, sourceCount: 9, crawledAt: 'last tuesday' }));
    expect(found).toContain('meta.skillCount does not match the catalog');
    expect(found).toContain('meta.sourceCount does not match the catalog');
    expect(found).toContain('meta.crawledAt is not an ISO timestamp');
  });
});

describe('the committed data files are internally consistent', () => {
  it('produces no problems, whatever the last crawl found', () => {
    expect(validateCatalog(loadSkills(), loadCollections(), loadMeta())).toEqual([]);
  });
});
