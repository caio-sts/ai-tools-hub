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

const ROOT_README_RE = /^readme(\.[a-z0-9]+)?$/i;

/** Spec 6.4 "has a README" — a repository-root README, the one strangers actually land on. */
export function hasReadme(tree: readonly TreeFile[]): boolean {
  return tree.some(
    (file) => file.type === 'blob' && !file.path.includes('/') && ROOT_README_RE.test(file.path),
  );
}

/**
 * Spec 6.4 "not under .claude/skills/". A repo's own .claude/skills/ tree is internal glue,
 * not a distributable product: 41,984 of 351,232 SKILL.md files on GitHub live there.
 */
export function isRepoInternal(path: string): boolean {
  return path.startsWith('.claude/skills/') || path.includes('/.claude/skills/');
}
