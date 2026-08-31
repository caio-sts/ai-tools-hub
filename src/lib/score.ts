import type { ScoreBreakdown } from '../types.ts';

/**
 * Everything the score model is allowed to see. Safety is deliberately absent:
 * executing code is a fact, not a fault, so it stays descriptive (spec §5).
 */
export interface SkillInput {
  stars: number;
  updatedDays: number;
  curated: boolean;
  isOrg: boolean;
  license: string | null;
  portable: boolean;
  description: string;
}

const STAR_CEILING = 200_000;
const HALF_LIFE_DAYS = 90;
const MIN_REAL_DESCRIPTION = 40;

export function scoreSkill(s: SkillInput): ScoreBreakdown {
  const adoption = Math.round(Math.min(1, Math.log10(s.stars + 1) / Math.log10(STAR_CEILING)) * 25);
  const maintenance = Math.round(30 * Math.pow(0.5, s.updatedDays / HALF_LIFE_DAYS));
  const provenance = (s.curated ? 12 : 0) + (s.isOrg ? 8 : 0) + (s.license ? 5 : 0);
  const completeness =
    (s.portable ? 9 : 0) +
    (s.license ? 6 : 0) +
    (s.description.length >= MIN_REAL_DESCRIPTION ? 5 : 0);

  return {
    adoption,
    maintenance,
    provenance,
    completeness,
    total: adoption + maintenance + provenance + completeness,
  };
}
