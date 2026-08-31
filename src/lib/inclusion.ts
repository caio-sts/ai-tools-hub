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

/** Spec 6.4 "non-trivial": published thresholds, so the rule is inspectable, not taste. */
export const MIN_DESCRIPTION_CHARS = 20;
export const MIN_DESCRIPTION_WORDS = 4;

/** Spec 6.4 "non-repo-specific": prose that only makes sense inside the host repository. */
export const REPO_SPECIFIC_PHRASES = [
  'this repo',
  'this repository',
  'our repo',
  'our team',
  'internal use',
  'this project only',
  'do not use outside',
] as const;

/** Names too generic to prove a description is about its own repo rather than the skill. */
const GENERIC_REPO_WORDS = new Set([
  'skill',
  'skills',
  'agent',
  'agents',
  'tool',
  'tools',
  'plugin',
  'plugins',
  'claude',
  'claude-code',
  'codex',
  'cursor',
  'openclaw',
  'mcp',
  'prompt',
  'prompts',
  'awesome',
  'docs',
  'examples',
]);

function distinctiveSegments(repo: string): string[] {
  return repo
    .toLowerCase()
    .split('/')
    .filter((segment) => segment.length >= 5 && !GENERIC_REPO_WORDS.has(segment));
}

export function isMeaningfulDescription(description: unknown, repo: string): boolean {
  if (typeof description !== 'string') return false;
  const text = description.trim();
  if (text.length < MIN_DESCRIPTION_CHARS) return false;
  if (text.split(/\s+/).length < MIN_DESCRIPTION_WORDS) return false;
  const lower = text.toLowerCase();
  if (REPO_SPECIFIC_PHRASES.some((phrase) => lower.includes(phrase))) return false;
  return !distinctiveSegments(repo).some((segment) => lower.includes(segment));
}

export interface ConceptKey {
  publisher: string;
  concept: string;
}

export function publisherOf(repo: string): string {
  const slash = repo.indexOf('/');
  return (slash === -1 ? repo : repo.slice(0, slash)).toLowerCase();
}

export function normalizeConcept(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Spec 6.3 trap 4: "cap one entry per publisher per concept, so a single 846-path monorepo
 * cannot swamp a category page". Deliberately generic over the concept key: harvest calls it
 * with the normalised skill name, a category page calls it with `skill.primary`.
 * First-seen order is preserved, so the caller's own ordering decides which entry survives.
 */
export function capPerPublisherPerConcept<T>(
  items: readonly T[],
  keyOf: (item: T) => ConceptKey,
  limit = 1,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const { publisher, concept } = keyOf(item);
    const key = `${publisher} ${concept}`;
    const seen = counts.get(key) ?? 0;
    if (seen >= limit) continue;
    counts.set(key, seen + 1);
    out.push(item);
  }
  return out;
}

export type InclusionReason = 'included' | 'repo-internal' | 'no-readme' | 'weak-description';

/**
 * Spec 6.4: "these rules are published at /methodology". This array is the machine-readable
 * source of truth for that page's ordering; B5 supplies the hand-written prose for each id in
 * both locales. Add a rule here and the page's list is wrong until B5 writes its copy — which
 * is the intended pressure.
 */
export const INCLUSION_RULE_ORDER: readonly InclusionReason[] = [
  'repo-internal',
  'no-readme',
  'weak-description',
];

export interface SkillCandidate {
  repo: string;
  path: string;
  hasReadme: boolean;
  description: unknown;
}

/**
 * Per-skill half of spec 6.4. The repo half (`passesRepoGate`) runs earlier, at discovery,
 * because it decides whether the repo is fetched at all. Returns the first failing rule so the
 * harvest log says *why* something was dropped.
 */
export function includeSkill(candidate: SkillCandidate): InclusionReason {
  if (isRepoInternal(candidate.path)) return 'repo-internal';
  if (!candidate.hasReadme) return 'no-readme';
  if (!isMeaningfulDescription(candidate.description, candidate.repo)) return 'weak-description';
  return 'included';
}
