import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Skill } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { skillSlug } from '../../src/lib/slug.ts';

function sitemapXml(): string {
  const files = existsSync('dist')
    ? readdirSync('dist').filter((file) => file.startsWith('sitemap') && file.endsWith('.xml'))
    : [];
  if (files.length === 0) {
    throw new Error('No dist/sitemap*.xml — @astrojs/sitemap did not run, or the site was not built');
  }
  return files.map((file) => readFileSync(join('dist', file), 'utf8')).join('\n');
}

describe('the sitemap advertises only listed entries', () => {
  const skills = loadSkills();
  // @astrojs/sitemap writes `new URL(...).href`, which percent-encodes non-ASCII slugs.
  const urlOf = (skill: Skill): string => `/en/skills/${encodeURI(skillSlug(skill))}/`;

  it('lists every listed skill page', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => entry.listed)) {
      expect(xml, `${skill.id} is listed but missing from the sitemap`).toContain(urlOf(skill));
    }
  });

  it('advertises no entry evicted by the per-subdomain cap', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => !entry.listed)) {
      expect(xml, `${skill.id} is unlisted but still in the sitemap`).not.toContain(urlOf(skill));
    }
  });
});
