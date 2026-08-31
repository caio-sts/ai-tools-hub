import type { Skill } from '../types.ts';
import { skillSlug } from './slug.ts';

/**
 * A built per-skill route, recognised by its tail rather than by a full path so the same regex
 * works under /ai-tools-hub/, under a custom domain with no base, and in tests with neither.
 * No `g` flag: exec() must stay stateless across calls.
 */
export const SKILL_URL_PATTERN = /\/(en|pt)\/skills\/(.+?)\/?$/;

/** Slugs of entries evicted by the per-subdomain cap (§5.1). Their pages still build. */
export function unlistedSkillSlugs(skills: Skill[]): string[] {
  return skills.filter((skill) => !skill.listed).map((skill) => skillSlug(skill));
}

/**
 * @astrojs/sitemap filter: return false to drop a URL. An evicted entry keeps its page and the
 * noindex meta B4 puts on it, but the catalog must not advertise an entry it does not list.
 */
export function makeSitemapFilter(unlistedSlugs: Iterable<string>): (url: string) => boolean {
  const unlisted = new Set(unlistedSlugs);
  return (url: string): boolean => {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = url;
    }
    const match = SKILL_URL_PATTERN.exec(pathname);
    if (!match) return true;
    return !unlisted.has(match[2]);
  };
}
