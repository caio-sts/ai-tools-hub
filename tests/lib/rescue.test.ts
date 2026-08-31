import { describe, it, expect } from 'vitest';
import { buildRescueDocs, type RescueDoc } from '../../src/lib/rescue.ts';
import { skillSlug } from '../../src/lib/slug.ts';
import type { Skill, Taxonomy } from '../../src/types.ts';

/** Every fixture satisfies score === breakdown.total, each part inside 25/30/25/20. */
export function makeSkill(over: Partial<Skill> = {}): Skill {
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

export const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        { slug: 'security/containers-kubernetes', name: { en: 'Containers & Kubernetes', pt: 'Contêineres e Kubernetes' } },
        { slug: 'security/compliance-grc', name: { en: 'Compliance, Risk & Audit', pt: 'Conformidade, Risco e Auditoria' } },
      ],
    },
  ],
  protected: ['Kubernetes'],
  aliases: { k8s: 'containers-kubernetes', grc: 'compliance-grc' },
  minimumMass: 5,
};

describe('fixture integrity', () => {
  it('keeps score equal to breakdown.total, every part inside its cap', () => {
    const s = makeSkill();
    expect(s.score).toBe(s.breakdown.total);
    expect(s.breakdown.adoption).toBeLessThanOrEqual(25);
    expect(s.breakdown.maintenance).toBeLessThanOrEqual(30);
    expect(s.breakdown.provenance).toBeLessThanOrEqual(25);
    expect(s.breakdown.completeness).toBeLessThanOrEqual(20);
  });
});

describe('buildRescueDocs', () => {
  const skills = [makeSkill()];

  it('emits one doc per skill and one per taxonomy node', () => {
    const docs = buildRescueDocs(skills, taxonomy, 'en');
    expect(docs.filter((d) => d.kind === 'skill')).toHaveLength(1);
    expect(docs.filter((d) => d.kind === 'node')).toHaveLength(3);
  });

  it('never carries description or body text', () => {
    const blob = JSON.stringify(buildRescueDocs(skills, taxonomy, 'en'));
    expect(blob).not.toContain('Detects drift between Terraform state');
  });

  it('attaches alias terms to the node they resolve to', () => {
    const docs = buildRescueDocs(skills, taxonomy, 'en');
    const node = docs.find((d: RescueDoc) => d.id === 'node:security/containers-kubernetes');
    expect(node?.aliases.split(' ')).toContain('k8s');
    const grc = docs.find((d: RescueDoc) => d.id === 'node:security/compliance-grc');
    expect(grc?.aliases.split(' ')).toContain('grc');
  });

  it('uses the requested locale for node names', () => {
    const pt = buildRescueDocs(skills, taxonomy, 'pt');
    expect(pt.find((d) => d.id === 'node:security/containers-kubernetes')?.name)
      .toBe('Contêineres e Kubernetes');
  });

  it('routes skills through the one slug function, and stores a base-relative path', () => {
    const skill = makeSkill({ repo: 'anthropics/skills', path: 'document-skills/pdf/SKILL.md' });
    const doc = buildRescueDocs([skill], taxonomy, 'en').find((d) => d.kind === 'skill');
    expect(doc?.path).toBe(`/en/skills/${skillSlug(skill)}/`);
  });

  it('sends nodes to the catalog, the only list surface this plan builds', () => {
    const pt = buildRescueDocs(skills, taxonomy, 'pt');
    expect(pt.find((d) => d.id === 'node:security')?.path).toBe('/pt/catalog/?subdomain=security');
    const en = buildRescueDocs(skills, taxonomy, 'en');
    expect(en.find((d) => d.id === 'node:security/containers-kubernetes')?.path)
      .toBe('/en/catalog/?subdomain=security/containers-kubernetes');
    for (const doc of en) {
      expect(doc.path, `${doc.id} points at a route nobody builds`).not.toMatch(/^\/en\/security/);
    }
  });

  it('indexes only listed entries — an evicted skill keeps its page, not its search presence', () => {
    const evicted = makeSkill({ id: 'gone/here@ddd4444:z/SKILL.md', name: 'Evicted Drift Tool', listed: false });
    const docs = buildRescueDocs([makeSkill(), evicted], taxonomy, 'en');
    expect(docs.filter((d) => d.kind === 'skill')).toHaveLength(1);
    expect(docs.map((d) => d.name)).not.toContain('Evicted Drift Tool');
    expect(docs.filter((d) => d.kind === 'node')).toHaveLength(3);
  });

  it('keys skill docs by the skill id so the index dedupes on re-crawl', () => {
    expect(buildRescueDocs(skills, taxonomy, 'en').find((d) => d.kind === 'skill')?.id)
      .toBe('acme/tools@abc1234:kit/SKILL.md');
  });
});

import { createRescueIndex, suggestRescue } from '../../src/lib/rescue.ts';

describe('suggestRescue — Pagefind has zero typo tolerance, this is the rescue', () => {
  const corpus = [
    makeSkill({ id: 'a/one@aaa1111:x/SKILL.md', repo: 'a/one', name: 'Terraform Drift Detector' }),
    makeSkill({ id: 'b/two@bbb2222:y/SKILL.md', repo: 'b/two', name: 'Claude Code Reviewer' }),
    makeSkill({ id: 'c/three@ccc3333:z/SKILL.md', repo: 'c/three', name: 'Secret Rotation Playbook' }),
  ];
  const richTaxonomy: Taxonomy = {
    ...taxonomy,
    domains: [
      {
        slug: 'security',
        name: { en: 'Security', pt: 'Segurança' },
        children: [
          { slug: 'security/containers-kubernetes', name: { en: 'Containers & Kubernetes', pt: 'Contêineres e Kubernetes' } },
          { slug: 'security/code-application', name: { en: 'Code & Application', pt: 'Código e Aplicação' } },
          { slug: 'security/supply-chain', name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' } },
        ],
      },
    ],
  };
  const index = createRescueIndex(buildRescueDocs(corpus, richTaxonomy, 'en'));

  it('rescues "kubernets"', () => {
    expect(suggestRescue(index, 'kubernets').map((s) => s.name)[0]).toBe('Containers & Kubernetes');
  });

  it('rescues "terrafrom"', () => {
    expect(suggestRescue(index, 'terrafrom').map((s) => s.name)[0]).toBe('Terraform Drift Detector');
  });

  it('rescues "clude code"', () => {
    expect(suggestRescue(index, 'clude code').map((s) => s.name).slice(0, 3))
      .toContain('Claude Code Reviewer');
  });

  it('finds a node through an alias nobody puts in a label', () => {
    expect(suggestRescue(index, 'k8s').map((s) => s.name)).toContain('Containers & Kubernetes');
  });

  it('returns nothing for a query shorter than two characters', () => {
    expect(suggestRescue(index, 'k')).toEqual([]);
    expect(suggestRescue(index, '  ')).toEqual([]);
  });

  it('honours the limit and returns base-relative paths for navigation', () => {
    const hits = suggestRescue(index, 'se', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const hit of hits) expect(hit.path.startsWith('/en/')).toBe(true);
  });
});
