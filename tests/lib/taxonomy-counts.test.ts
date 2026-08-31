import { describe, expect, it } from 'vitest';
import { countBySlug, countDomain, nodeState } from '../../src/lib/taxonomy.ts';
import type { Skill } from '../../src/types.ts';

/**
 * A fixture Skill the score contract accepts: score === breakdown.total and every
 * component inside its cap (adoption 25, maintenance 30, provenance 25, completeness 20).
 * Every slug used below exists in data/taxonomy.json. `listed` defaults to true; pass false
 * for an entry the per-subdomain cap evicted (§5.1).
 */
function makeSkill(
  name: string,
  primary: string,
  also: string[] = [],
  listed = true,
): Skill {
  return {
    id: `owner/repo@abc1234:${name}/SKILL.md`,
    type: 'skill',
    name,
    description: 'fixture entry used only by the taxonomy counting tests',
    descriptionPt: null,
    longPt: null,
    repo: 'owner/repo',
    path: `${name}/SKILL.md`,
    sha: 'abc1234',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'Apache-2.0',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    },
    primary,
    also,
    tags: [],
    securityRelevant: true,
    score: 78,
    breakdown: { adoption: 18, maintenance: 27, provenance: 13, completeness: 20, total: 78 },
    listed,
  };
}

describe('countBySlug', () => {
  it('counts primary placements', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/supply-chain'),
      makeSkill('c', 'security/threat-modeling'),
    ]);
    expect(counts.get('security/supply-chain')).toBe(2);
    expect(counts.get('security/threat-modeling')).toBe(1);
  });

  it('counts "also" placements, because the entry really appears in that list', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain', ['security/cicd-pipeline']),
    ]);
    expect(counts.get('security/cicd-pipeline')).toBe(1);
  });

  it('counts a skill once per slug even if primary is repeated in also', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain', ['security/supply-chain']),
    ]);
    expect(counts.get('security/supply-chain')).toBe(1);
  });

  it('returns no key at all for a slug nothing is filed under', () => {
    const counts = countBySlug([makeSkill('a', 'security/supply-chain')]);
    expect(counts.get('security/detection-forensics')).toBeUndefined();
  });

  it('returns an empty map for an empty catalog', () => {
    expect(countBySlug([]).size).toBe(0);
  });

  it('ignores an entry the cap evicted, on its primary and on every also', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/supply-chain', ['security/cicd-pipeline'], false),
    ]);
    expect(counts.get('security/supply-chain')).toBe(1);
    expect(counts.get('security/cicd-pipeline')).toBeUndefined();
  });
});

describe('countDomain', () => {
  it('aggregates every child of the domain', () => {
    const skills = [
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/threat-modeling'),
      makeSkill('c', 'devops-infra/general'),
    ];
    expect(countDomain(skills, 'security')).toBe(2);
    expect(countDomain(skills, 'devops-infra')).toBe(1);
    expect(countDomain(skills, 'writing-docs')).toBe(0);
  });

  it('counts a skill once even when two of its slugs sit in the same domain', () => {
    const skills = [makeSkill('a', 'security/supply-chain', ['security/cicd-pipeline'])];
    expect(countDomain(skills, 'security')).toBe(1);
  });

  it('counts a skill filed on the bare domain slug as well as on a child', () => {
    expect(countDomain([makeSkill('a', 'productivity')], 'productivity')).toBe(1);
  });

  it('does not treat a shared prefix as the same domain', () => {
    expect(countDomain([makeSkill('a', 'security-theatre/general')], 'security')).toBe(0);
  });

  it('ignores an evicted entry, so a domain count is a count of what is listed', () => {
    const skills = [
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/threat-modeling', [], false),
    ];
    expect(countDomain(skills, 'security')).toBe(1);
  });
});

describe('nodeState', () => {
  it('is empty at zero', () => {
    expect(nodeState(0, 5)).toBe('empty');
  });

  it('is thin between one and one below minimum mass', () => {
    expect(nodeState(1, 5)).toBe('thin');
    expect(nodeState(4, 5)).toBe('thin');
  });

  it('is active at exactly minimum mass and above', () => {
    expect(nodeState(5, 5)).toBe('active');
    expect(nodeState(120, 5)).toBe('active');
  });

  it('treats a negative count as empty rather than throwing', () => {
    expect(nodeState(-1, 5)).toBe('empty');
  });
});

describe('eviction and minimum mass', () => {
  it('never lets an evicted entry prop a node above minimum mass', () => {
    const slug = 'security/threat-modeling';
    const count =
      countBySlug([
        makeSkill('a', slug),
        makeSkill('b', slug),
        makeSkill('c', slug),
        makeSkill('d', slug, [], false),
        makeSkill('e', slug, [], false),
      ]).get(slug) ?? 0;
    expect(count).toBe(3);
    expect(nodeState(count, 5)).toBe('thin');
  });
});
