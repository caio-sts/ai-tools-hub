import { describe, it, expect } from 'vitest';
import { SKILL_URL_PATTERN, makeSitemapFilter, unlistedSkillSlugs } from '../../src/lib/sitemap.ts';
import { skillSlug } from '../../src/lib/slug.ts';
import type { Skill } from '../../src/types.ts';

/** Local fixture: importing a *.test.ts would re-register that file's suites inside this one. */
function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'acme/tools@abc1234:kit/SKILL.md',
    type: 'skill',
    name: 'Terraform Drift Detector',
    description: 'Detects drift between Terraform state and deployed cloud resources.',
    descriptionPt: null,
    longPt: null,
    repo: 'acme/tools',
    path: 'kit/SKILL.md',
    sha: 'abc1234',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false, scriptCount: 0, languages: [],
      network: false, readsEnv: false, declaredTools: null,
    },
    primary: 'security/iac-config',
    also: [],
    tags: ['terraform'],
    securityRelevant: true,
    score: 71,
    breakdown: { adoption: 12, maintenance: 26, provenance: 13, completeness: 20, total: 71 },
    listed: true,
    ...over,
  };
}

describe('unlistedSkillSlugs', () => {
  it('returns the slug of every evicted entry and nothing else', () => {
    const listed = makeSkill({ repo: 'acme/tools', path: 'kit/SKILL.md' });
    const evicted = makeSkill({ repo: 'acme/tools', path: 'old/SKILL.md', listed: false });
    expect(unlistedSkillSlugs([listed, evicted])).toEqual([skillSlug(evicted)]);
  });

  it('is empty when every entry is listed', () => {
    expect(unlistedSkillSlugs([makeSkill()])).toEqual([]);
  });
});

describe('makeSitemapFilter', () => {
  const filter = makeSitemapFilter(['evicted-drift-tool']);

  it('drops an unlisted skill URL in either locale', () => {
    expect(filter('https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/')).toBe(false);
    expect(filter('https://example.com/ai-tools-hub/pt/skills/evicted-drift-tool/')).toBe(false);
  });

  it('keeps a listed skill URL', () => {
    expect(filter('https://example.com/ai-tools-hub/en/skills/terraform-drift-detector/')).toBe(true);
  });

  it('works under any deployment base, including none', () => {
    expect(filter('https://example.com/en/skills/evicted-drift-tool/')).toBe(false);
    expect(filter('https://example.com/deep/nested/base/en/skills/evicted-drift-tool/')).toBe(false);
  });

  it('never touches a URL that is not a per-skill page', () => {
    for (const url of [
      'https://example.com/ai-tools-hub/en/catalog/',
      'https://example.com/ai-tools-hub/en/methodology/',
      'https://example.com/ai-tools-hub/pt/',
      'https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/extra/',
    ]) {
      expect(filter(url), url).toBe(true);
    }
  });

  it('keeps everything when nothing has been evicted', () => {
    const permissive = makeSitemapFilter([]);
    expect(permissive('https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/')).toBe(true);
  });

  it('exposes the route pattern it matches on', () => {
    // Multi-segment: skillSlug() emits `owner/repo/dir/name`, so a one-segment
    // pattern silently matches nothing real and no evicted entry ever leaves the sitemap.
    expect(SKILL_URL_PATTERN.exec('/ai-tools-hub/en/skills/anthropics/skills/document-skills/pdf/')?.[2])
      .toBe('anthropics/skills/document-skills/pdf');
    expect(SKILL_URL_PATTERN.exec('/ai-tools-hub/en/skills/kube-bench-runner/')?.[2])
      .toBe('kube-bench-runner');
  });
});
