import type { Lang, Skill } from '../types.ts';
import { withBase } from './link.ts';

const SKILL_FILE = /(^|\/)SKILL\.md$/i;

function slugSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable per-skill path segment: owner/repo/<dir of SKILL.md>. Never includes the sha. */
export function skillSlug(skill: Skill): string {
  const dir = skill.path.replace(SKILL_FILE, '');
  return [...skill.repo.split('/'), ...dir.split('/')]
    .map(slugSegment)
    .filter(Boolean)
    .join('/');
}

export function skillHref(skill: Skill, lang: Lang): string {
  return withBase(`/${lang}/skills/${skillSlug(skill)}/`);
}

/** The source file on GitHub, pinned to the commit we indexed. */
export function officialFileUrl(skill: Skill): string {
  return `https://github.com/${skill.repo}/blob/${skill.sha}/${skill.path}`;
}

/** The same file as plain text: unauthenticated, CORS `*`, fetchable from the browser (§6.1). */
export function rawFileUrl(skill: Skill): string {
  return `https://raw.githubusercontent.com/${skill.repo}/${skill.sha}/${skill.path}`;
}
