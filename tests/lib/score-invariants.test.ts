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

describe('component bounds hold for hostile numeric input', () => {
  it('clamps negative stars to 0 adoption instead of producing NaN', () => {
    expect(scoreSkill(input({ stars: -5 })).adoption).toBe(0);
  });

  it('clamps a negative path age to a full-but-not-inflated 30 maintenance', () => {
    expect(scoreSkill(input({ updatedDays: -30 })).maintenance).toBe(30);
  });

  it('treats non-finite numbers as zero', () => {
    const b = scoreSkill(input({ stars: Number.NaN, updatedDays: Number.POSITIVE_INFINITY }));
    expect(b.adoption).toBe(0);
    expect(b.maintenance).toBe(30);
  });

  it('never exceeds 25 / 30 / 25 / 20 / 100', () => {
    const extremes: SkillInput[] = [
      input({ stars: 5_000_000, updatedDays: -1000, curated: true, isOrg: true, license: 'MIT', portable: true, description: 'x'.repeat(400) }),
      input({ stars: -1, updatedDays: 1e9 }),
      input({ stars: Number.NaN, updatedDays: Number.NaN }),
    ];
    for (const s of extremes) {
      const b = scoreSkill(s);
      expect(b.adoption).toBeGreaterThanOrEqual(0);
      expect(b.adoption).toBeLessThanOrEqual(25);
      expect(b.maintenance).toBeGreaterThanOrEqual(0);
      expect(b.maintenance).toBeLessThanOrEqual(30);
      expect(b.provenance).toBeGreaterThanOrEqual(0);
      expect(b.provenance).toBeLessThanOrEqual(25);
      expect(b.completeness).toBeGreaterThanOrEqual(0);
      expect(b.completeness).toBeLessThanOrEqual(20);
      expect(b.total).toBeLessThanOrEqual(100);
      expect(b.total).toBe(b.adoption + b.maintenance + b.provenance + b.completeness);
    }
  });
});

describe('two skills from the SAME repo separate on per-path signals', () => {
  // Same repo: same stars, same org flag, same curated flag, same license.
  // Different: per-path updatedDays and per-skill portability.
  const repoLevel = { stars: 6908, curated: true, isOrg: true, license: 'Apache-2.0' as string | null };

  const fresh = scoreSkill({
    ...repoLevel,
    updatedDays: 12,
    portable: true,
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  });

  const stale = scoreSkill({
    ...repoLevel,
    updatedDays: 200,
    portable: false,
    description: 'Old helper.',
  });

  it('agrees on the repo-level components', () => {
    expect(fresh.adoption).toBe(stale.adoption);
    expect(fresh.adoption).toBe(18);
    expect(fresh.provenance).toBe(stale.provenance);
    expect(fresh.provenance).toBe(25);
  });

  it('produces different totals, not a tie', () => {
    expect(fresh.total).toBe(90);
    expect(stale.total).toBe(55);
    expect(fresh.total).not.toBe(stale.total);
    expect(fresh.total).toBeGreaterThan(stale.total);
  });
});

describe('safety is never an input to the score (spec §5)', () => {
  const base: SkillInput = {
    stars: 6908,
    updatedDays: 12,
    curated: true,
    isOrg: true,
    license: 'Apache-2.0',
    portable: true,
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  };

  it('has no safety key on SkillInput', () => {
    expect(Object.keys(base)).not.toContain('safety');
    expect(Object.keys(base).sort()).toEqual([
      'curated',
      'description',
      'isOrg',
      'license',
      'portable',
      'stars',
      'updatedDays',
    ]);
  });

  // No `@ts-expect-error` on the `safety:` lines below. A spread into an untyped
  // `const` has no contextual type, so excess-property checking never runs, the
  // directive would be unused, and `tsc --noEmit` would fail with TS2578 — turning
  // Task A1.5's committed typecheck test red for the rest of this plan. The
  // `as SkillInput` casts carry the intent instead.
  it('scores identically whether a skill executes everything or nothing', () => {
    const dangerous = {
      ...base,
      // safety is deliberately not part of SkillInput (spec §5)
      safety: { executesCode: true, scriptCount: 12, languages: ['python', 'bash'], network: true, readsEnv: true, declaredTools: null },
    };
    const inert = {
      ...base,
      // safety is deliberately not part of SkillInput (spec §5)
      safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: [] },
    };

    expect(scoreSkill(dangerous as SkillInput)).toEqual(scoreSkill(base));
    expect(scoreSkill(inert as SkillInput)).toEqual(scoreSkill(base));
    expect(scoreSkill(dangerous as SkillInput)).toEqual(scoreSkill(inert as SkillInput));
  });
});
