import { describe, expect, it } from 'vitest';
import { scoreSkill, type SkillInput } from '../../src/lib/score.ts';

function input(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    stars: 0,
    updatedDays: 0,
    curated: false,
    isOrg: false,
    license: null,
    portable: false,
    description: '',
    ...overrides,
  };
}

describe('adoption (0-25, log10 of repo stars normalised to a 200000 ceiling)', () => {
  it('gives 0 to a repo with no stars', () => {
    expect(scoreSkill(input({ stars: 0 })).adoption).toBe(0);
  });

  it('scores the measured corpus points', () => {
    expect(scoreSkill(input({ stars: 9 })).adoption).toBe(5);
    expect(scoreSkill(input({ stars: 999 })).adoption).toBe(14);
    expect(scoreSkill(input({ stars: 6908 })).adoption).toBe(18);
    expect(scoreSkill(input({ stars: 52244 })).adoption).toBe(22);
  });

  it('caps at 25 on and above the ceiling', () => {
    expect(scoreSkill(input({ stars: 200000 })).adoption).toBe(25);
  });
});

describe('maintenance (0-30, 90-day half-life on the PATH last-commit age)', () => {
  it('gives a full 30 to a path committed today', () => {
    expect(scoreSkill(input({ updatedDays: 0 })).maintenance).toBe(30);
  });

  it('halves every 90 days', () => {
    expect(scoreSkill(input({ updatedDays: 90 })).maintenance).toBe(15);
    expect(scoreSkill(input({ updatedDays: 180 })).maintenance).toBe(8);
  });

  it('decays smoothly between half-lives', () => {
    expect(scoreSkill(input({ updatedDays: 12 })).maintenance).toBe(27);
    expect(scoreSkill(input({ updatedDays: 30 })).maintenance).toBe(24);
    expect(scoreSkill(input({ updatedDays: 45 })).maintenance).toBe(21);
    expect(scoreSkill(input({ updatedDays: 200 })).maintenance).toBe(6);
    expect(scoreSkill(input({ updatedDays: 365 })).maintenance).toBe(2);
    expect(scoreSkill(input({ updatedDays: 1000 })).maintenance).toBe(0);
  });
});

describe('provenance (0-25: curated +12, org +8, license +5)', () => {
  it('sums the three flags', () => {
    expect(scoreSkill(input({ curated: true, isOrg: true, license: 'MIT' })).provenance).toBe(25);
    expect(scoreSkill(input({ curated: false, isOrg: true, license: null })).provenance).toBe(8);
    expect(scoreSkill(input({ curated: true, isOrg: false, license: 'MIT' })).provenance).toBe(17);
    expect(scoreSkill(input()).provenance).toBe(0);
  });
});

describe('completeness (0-20: portable +9, license +6, real description +5)', () => {
  it('sums the three flags', () => {
    expect(
      scoreSkill(input({ portable: true, license: 'MIT', description: 'Formats markdown tables for the console.' }))
        .completeness,
    ).toBe(20);
    expect(scoreSkill(input()).completeness).toBe(0);
  });

  it('treats 40 characters as the real-description threshold', () => {
    expect(scoreSkill(input({ description: 'Formats markdown tables for the console.' })).completeness).toBe(5);
    expect(scoreSkill(input({ description: 'Formats markdown tables for the console' })).completeness).toBe(0);
  });
});

describe('total', () => {
  it('is the sum of the four components', () => {
    const b = scoreSkill(
      input({
        stars: 6908,
        updatedDays: 12,
        curated: true,
        isOrg: true,
        license: 'Apache-2.0',
        portable: true,
        description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
      }),
    );
    expect(b).toEqual({ adoption: 18, maintenance: 27, provenance: 25, completeness: 20, total: 90 });
  });
});
