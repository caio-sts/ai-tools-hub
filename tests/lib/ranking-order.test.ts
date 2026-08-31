import { describe, expect, it } from 'vitest';
import type { Collection, Safety, Skill } from '../../src/types.ts';
import { compareForRank } from '../../src/lib/rank.ts';
import { sortValues } from '../../src/lib/facets.ts';

const INERT: Safety = {
  executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null,
};

function skill(name: string, score: number, updatedDays: number, sha: string): Skill {
  return {
    id: `tob/skills@${sha}:skills/${name}/SKILL.md`,
    type: 'skill', name, description: 'A description long enough to be a real one.',
    descriptionPt: null, longPt: null,
    repo: 'tob/skills', path: `skills/${name}/SKILL.md`, sha,
    updatedDays, indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT', licenseSource: 'repo', portable: true, runtimes: ['generic'], safety: INERT,
    primary: 'security/general', also: [], tags: [], securityRelevant: false, listed: true,
    score, breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: score },
  };
}

// Twelve real entries tie at 92, and they were ordered by the hexadecimal prefix of their commit
// sha — 1004934a, 311a784a, 32ad9e6b, … A skill id embeds the commit its content was read at, so
// that order reshuffled on every re-crawl, for no reason a reader could see. Rank 5 through 16 of
// the catalog was, literally, hash order.
describe('ranking order among tied entries', () => {
  it('puts the higher score first', () => {
    expect(compareForRank(skill('a', 90, 1, 'ffff'), skill('b', 80, 1, '0000'))).toBeLessThan(0);
  });

  it('breaks a tie by freshness, which is real signal the score has already rounded away', () => {
    const fresher = skill('zzz', 92, 4, 'ffffffff');
    const staler = skill('aaa', 92, 6, '00000000');
    expect(compareForRank(fresher, staler)).toBeLessThan(0);
  });

  it('breaks a remaining tie by name, which survives a re-crawl', () => {
    expect(compareForRank(skill('aaa', 92, 5, 'ffffffff'), skill('bbb', 92, 5, '00000000'))).toBeLessThan(0);
  });

  it('never orders by the commit sha, so a re-crawl cannot reshuffle the catalog', () => {
    const before = skill('same-name', 92, 5, '0000000000000000000000000000000000000000');
    const after = { ...before, sha: 'ffffffffffffffffffffffffffffffffffffffff', id: 'tob/skills@ffff:skills/same-name/SKILL.md' };
    expect(compareForRank(before, after)).toBe(0);
  });

  it('is a total order over a real tie group, with no pair left equal', () => {
    const group = [
      skill('review-pr', 92, 6, 'aaaa'), skill('panel-review', 92, 6, 'bbbb'),
      skill('audit-prep-assistant', 92, 5, 'cccc'), skill('differential-review', 92, 4, 'dddd'),
    ];
    const sorted = [...group].sort(compareForRank);
    expect(sorted.map((s) => s.name)).toEqual(['differential-review', 'audit-prep-assistant', 'panel-review', 'review-pr']);
  });
});

describe('the Pagefind sort value carries the same order', () => {
  const collection: Collection = {
    repo: 'tob/skills', stars: 10, forks: 1, pushedAt: '2026-08-01T00:00:00Z',
    license: 'MIT', topics: [], isOrg: false, curated: false,
  };

  // Pagefind sorts the value as a STRING and has no second key, so the tie-break has to be inside
  // it or the browser falls back to index order for every tie.
  it('sorts a fresher entry above a staler one at the same score', () => {
    const fresher = sortValues(skill('a', 92, 4, 'aaaa'), collection).score;
    const staler = sortValues(skill('b', 92, 6, 'bbbb'), collection).score;
    expect(fresher > staler).toBe(true);
  });

  it('still sorts a higher score above a lower one, whatever the freshness', () => {
    const better = sortValues(skill('a', 93, 400, 'aaaa'), collection).score;
    const worse = sortValues(skill('b', 92, 0, 'bbbb'), collection).score;
    expect(better > worse).toBe(true);
  });
});
