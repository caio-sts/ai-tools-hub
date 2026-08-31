import { describe, expect, it } from 'vitest';
import type { Skill } from '../../src/types.ts';
import { withBase } from '../../src/lib/link.ts';
import { officialFileUrl, rawFileUrl, skillHref, skillSlug } from '../../src/lib/slug.ts';

const SHA = 'a71b0c3d5e2f48916d84ab0c5f7e3d2190b46c8a';

/** A contract-valid Skill: score === breakdown.total, every component inside its cap, listed. */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const repo = overrides.repo ?? 'anthropics/skills';
  const path = overrides.path ?? 'document-skills/pdf/SKILL.md';
  const sha = overrides.sha ?? SHA;
  return {
    id: `${repo}@${sha}:${path}`,
    type: 'skill',
    name: 'PDF Toolkit',
    description: 'Fills, merges and extracts text from PDF documents using local tooling.',
    descriptionPt: null,
    longPt: null,
    repo,
    path,
    sha,
    updatedDays: 12,
    indexedAt: '2026-08-28',
    license: 'Apache-2.0',
    licenseSource: 'sibling',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    },
    primary: 'security/supply-chain',
    also: [],
    tags: ['pdf'],
    securityRelevant: false,
    score: 86,
    breakdown: { adoption: 25, maintenance: 27, provenance: 20, completeness: 14, total: 86 },
    listed: true,
    ...overrides,
  };
}

describe('skillSlug', () => {
  it('drops the SKILL.md filename and keeps owner, repo and directory', () => {
    expect(skillSlug(makeSkill())).toBe('anthropics/skills/document-skills/pdf');
  });

  it('returns owner/repo for a SKILL.md sitting at the repository root', () => {
    expect(skillSlug(makeSkill({ repo: 'acme-labs/agent-kit', path: 'SKILL.md' })))
      .toBe('acme-labs/agent-kit');
  });

  it('lowercases and replaces characters that are not URL safe', () => {
    expect(skillSlug(makeSkill({ repo: 'Acme Labs/Agent Kit', path: 'Skills/K8s Audit/SKILL.md' })))
      .toBe('acme-labs/agent-kit/skills/k8s-audit');
  });

  it('matches the SKILL.md filename case-insensitively', () => {
    expect(skillSlug(makeSkill({ repo: 'a/b', path: 'x/skill.md' }))).toBe('a/b/x');
  });

  it('never puts the sha in the slug, so a new commit cannot break a bookmark', () => {
    const before = makeSkill();
    const after = makeSkill({ sha: '0f1e2d3c4b5a69788796a5b4c3d2e1f009182736' });
    expect(skillSlug(after)).toBe(skillSlug(before));
    expect(skillSlug(after)).not.toContain(after.sha);
  });
});

describe('skillHref', () => {
  it('builds a base-aware, language-scoped, trailing-slash URL', () => {
    expect(skillHref(makeSkill(), 'en'))
      .toBe(withBase('/en/skills/anthropics/skills/document-skills/pdf/'));
  });

  it('scopes the same skill under each locale', () => {
    const skill = makeSkill();
    expect(skillHref(skill, 'pt')).toBe(withBase('/pt/skills/anthropics/skills/document-skills/pdf/'));
    expect(skillHref(skill, 'pt')).not.toBe(skillHref(skill, 'en'));
  });
});

describe('officialFileUrl and rawFileUrl', () => {
  it('links the GitHub blob for the exact indexed commit', () => {
    expect(officialFileUrl(makeSkill())).toBe(
      `https://github.com/anthropics/skills/blob/${SHA}/document-skills/pdf/SKILL.md`,
    );
  });

  it('points the raw fetch at raw.githubusercontent.com', () => {
    expect(rawFileUrl(makeSkill())).toBe(
      `https://raw.githubusercontent.com/anthropics/skills/${SHA}/document-skills/pdf/SKILL.md`,
    );
  });

  it('builds both source URLs from the commit sha carried by the id, never a blob sha', () => {
    const skill = makeSkill();
    const commit = skill.id.split('@')[1].split(':')[0];
    expect(commit).toBe(skill.sha);
    expect(officialFileUrl(skill)).toContain(`/blob/${commit}/`);
    expect(rawFileUrl(skill)).toContain(`/${commit}/`);
  });
});
