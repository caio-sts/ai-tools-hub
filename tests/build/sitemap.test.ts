import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
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

  it('wires the filter through astro.config.mjs, reading data only through the A6 loader', () => {
    const config = readFileSync('astro.config.mjs', 'utf8');
    expect(
      config.includes("from './src/lib/sitemap.ts'"),
      'astro.config.mjs does not import src/lib/sitemap.ts: the sitemap still advertises unlisted entries',
    ).toBe(true);
    expect(config).toContain("import { loadSkills } from './src/lib/data.ts';");
    expect(config).toContain('filter: makeSitemapFilter(unlistedSkillSlugs(loadSkills()))');
  });

  it('lists every listed skill page', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => entry.listed)) {
      expect(xml, `${skill.id} is listed but missing from the sitemap`)
        .toContain(`/en/skills/${skillSlug(skill)}/`);
    }
  });

  it('advertises no entry evicted by the per-subdomain cap', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => !entry.listed)) {
      expect(xml, `${skill.id} is unlisted but still in the sitemap`)
        .not.toContain(`/en/skills/${skillSlug(skill)}/`);
    }
  });

  it('still builds the page for an evicted entry', () => {
    for (const skill of skills.filter((entry) => !entry.listed)) {
      expect(
        existsSync(`dist/en/skills/${skillSlug(skill)}/index.html`),
        `${skill.id} lost its page: §5.1 drops the listing, never the page`,
      ).toBe(true);
    }
  });
});
