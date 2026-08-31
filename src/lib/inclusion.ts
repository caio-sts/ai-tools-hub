import type { TreeFile } from '../types.ts';

/**
 * Spec 6.4. The quality floor: a stars>=10 sweep cuts topic:claude-skills from 7,626 repos
 * to ~1,131. Defined here, once, and imported by the query builder so the swept band and the
 * admitted band can never drift apart.
 */
export const MIN_STARS = 10;

export interface RepoGateInput {
  stars: number;
  isOrg: boolean;
}

/** Spec 6.4: ">=N stars OR an org account". Organisations publish for strangers by default. */
export function passesRepoGate(input: RepoGateInput): boolean {
  return input.isOrg || input.stars >= MIN_STARS;
}

// `TreeFile` is used by hasReadme, added in the next task.
void (0 as unknown as TreeFile | undefined);
