import { describe, expect, it } from 'vitest';
import type { ScoreBreakdown, Skill } from '../../src/types.ts';
import { EVICT_RANK, SUBDOMAIN_CAP, applyListing } from '../../src/lib/rank.ts';

/** Any total in 0..100 split into components that respect the 25/30/25/20 caps. */
function breakdownFor(total: number): ScoreBreakdown {
  const adoption = Math.min(25, total);
  const maintenance = Math.min(30, total - adoption);
  const provenance = Math.min(25, total - adoption - maintenance);
  const completeness = total - adoption - maintenance - provenance;
  return { adoption, maintenance, provenance, completeness, total };
}

function id(primary: string, rank: number): string {
  return `owner/repo@abc1234:${primary}/${rank}/SKILL.md`;
}

/**
 * Every fixture starts `listed: true`, so an entry that comes back false proves the flag was
 * recomputed from rank rather than passed through from the input.
 */
function entry(primary: string, rank: number, score: number): Skill {
  return {
    id: id(primary, rank),
    type: 'skill',
    name: `entry-${rank}`,
    description: 'A catalog entry with a description long enough to be real.',
    descriptionPt: null,
    longPt: null,
    repo: 'owner/repo',
    path: `${primary}/${rank}/SKILL.md`,
    sha: 'abc1234',
    updatedDays: 1,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    primary,
    also: [],
    tags: [],
    securityRelevant: false,
    listed: true,
    score,
    breakdown: breakdownFor(score),
  };
}

/** `count` entries in one subdomain scored 100, 99, 98 …, so rank N is `id(primary, N)`. */
function ladder(primary: string, count: number): Skill[] {
  return Array.from({ length: count }, (_unused, i) => entry(primary, i + 1, 100 - i));
}

function isListed(result: Skill[], primary: string, rank: number): boolean {
  const found = result.find((skill) => skill.id === id(primary, rank));
  if (found === undefined) throw new Error(`no entry at rank ${rank} of ${primary}`);
  return found.listed;
}

function listedCount(result: Skill[], primary: string): number {
  return result.filter((skill) => skill.primary === primary && skill.listed).length;
}

describe('the cap lists the top SUBDOMAIN_CAP of each subdomain (spec §5.1)', () => {
  it('pins the two thresholds', () => {
    expect(SUBDOMAIN_CAP).toBe(60);
    expect(EVICT_RANK).toBe(72);
  });

  it('lists rank 60 and drops rank 61 when nothing was listed before', () => {
    const result = applyListing(ladder('security/supply-chain', 80), new Set(), 5);
    expect(isListed(result, 'security/supply-chain', 1)).toBe(true);
    expect(isListed(result, 'security/supply-chain', 60)).toBe(true);
    expect(isListed(result, 'security/supply-chain', 61)).toBe(false);
    expect(isListed(result, 'security/supply-chain', 80)).toBe(false);
    expect(listedCount(result, 'security/supply-chain')).toBe(60);
  });

  it('caps per subdomain, so a populous node cannot crowd out a thin one', () => {
    const result = applyListing(
      [...ladder('security/supply-chain', 80), ...ladder('security/threat-modeling', 7)],
      new Set(),
      5,
    );
    expect(listedCount(result, 'security/supply-chain')).toBe(60);
    expect(listedCount(result, 'security/threat-modeling')).toBe(7);
  });

  it('ranks by score, not by input order', () => {
    const result = applyListing([...ladder('security/supply-chain', 80)].reverse(), new Set(), 5);
    expect(isListed(result, 'security/supply-chain', 1)).toBe(true);
    expect(isListed(result, 'security/supply-chain', 61)).toBe(false);
  });

  it('returns the entries in the input order, so a sorted catalog stays sorted', () => {
    const input = ladder('security/supply-chain', 80);
    const result = applyListing(input, new Set(), 5);
    expect(result.map((skill) => skill.id)).toEqual(input.map((skill) => skill.id));
  });
});

describe('hysteresis: entering is harder than staying (spec §5.1)', () => {
  // Only the supply-chain entries were listed on the previous run. threat-modeling is a
  // brand-new subdomain, so the same rank has to behave differently in the two groups.
  const previous = new Set([
    id('security/supply-chain', 60),
    id('security/supply-chain', 65),
    id('security/supply-chain', 72),
    id('security/supply-chain', 73),
  ]);
  const result = applyListing(
    [...ladder('security/supply-chain', 80), ...ladder('security/threat-modeling', 80)],
    previous,
    5,
  );

  it('keeps a previously listed entry that has slipped to rank 65', () => {
    expect(isListed(result, 'security/supply-chain', 65)).toBe(true);
  });

  it('drops the same rank 65 when it was not listed before', () => {
    expect(isListed(result, 'security/threat-modeling', 65)).toBe(false);
  });

  it('holds a previously listed entry at rank 72 and drops it at rank 73', () => {
    expect(isListed(result, 'security/supply-chain', 72)).toBe(true);
    expect(isListed(result, 'security/supply-chain', 73)).toBe(false);
  });
});

describe('the cap is a ceiling, never a floor (spec §5.1, §10.1)', () => {
  it('keeps a three-entry subdomain fully listed however badly it scores', () => {
    const thin = [
      entry('security/threat-modeling', 1, 2),
      entry('security/threat-modeling', 2, 1),
      entry('security/threat-modeling', 3, 0),
    ];
    const result = applyListing(thin, new Set(), 5);
    expect(listedCount(result, 'security/threat-modeling')).toBe(3);
    expect(result.every((skill) => skill.listed)).toBe(true);
  });

  it('fills back up to minimumMass when the cap would leave a subdomain short', () => {
    // The only shape in which the floor is observable. Production runs a minimumMass of 5,
    // far below a cap of 60, so the guard can never bite there — and without this case the
    // guard could be deleted with every other test in this file still green.
    const result = applyListing(ladder('security/supply-chain', 100), new Set(), 70);
    expect(listedCount(result, 'security/supply-chain')).toBe(70);
    expect(isListed(result, 'security/supply-chain', 70)).toBe(true);
    expect(isListed(result, 'security/supply-chain', 71)).toBe(false);
  });
});
