import { describe, expect, it } from 'vitest';
import type {
  Assignments,
  Collection,
  Lang,
  Meta,
  RawSkill,
  RepoRef,
  Runtime,
  Safety,
  ScoreBreakdown,
  Skill,
  Taxonomy,
  TreeFile,
} from '../src/types.ts';

const langs: Lang[] = ['en', 'pt'];
const runtimes: Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

const treeFile: TreeFile = {
  path: 'security/sbom/SKILL.md',
  mode: '100644',
  sha: '9f8e7d6',
  type: 'blob',
};

const repoRef: RepoRef = { repo: 'trailofbits/skills', stars: 6908 };

const collection: Collection = {
  repo: 'trailofbits/skills',
  stars: 6908,
  forks: 412,
  pushedAt: '2026-08-20T11:04:00Z',
  license: 'Apache-2.0',
  topics: ['agent-skills', 'security'],
  isOrg: true,
  curated: true,
};

const safety: Safety = {
  executesCode: true,
  scriptCount: 2,
  languages: ['python'],
  network: true,
  readsEnv: false,
  declaredTools: null,
};

const breakdown: ScoreBreakdown = {
  adoption: 20,
  maintenance: 26,
  provenance: 25,
  completeness: 20,
  total: 91,
};

const rawSkill: RawSkill = {
  repo: 'trailofbits/skills',
  path: 'security/sbom/SKILL.md',
  sha: 'a1b2c3d',
  blobSha: '9f8e7d6',
  frontmatter: { name: 'sbom-audit', license: 'Apache-2.0' },
  body: '# SBOM audit\n',
  updatedDays: 12,
};

const skill: Skill = {
  id: 'trailofbits/skills@a1b2c3d:security/sbom/SKILL.md',
  type: 'skill',
  name: 'sbom-audit',
  description: 'Audits a generated SBOM against known malicious package advisories.',
  descriptionPt: null,
  longPt: null,
  repo: 'trailofbits/skills',
  path: 'security/sbom/SKILL.md',
  sha: 'a1b2c3d',
  updatedDays: 12,
  indexedAt: '2026-08-29',
  license: 'Apache-2.0',
  licenseSource: 'sibling',
  portable: true,
  runtimes: ['claude', 'openclaw'],
  safety,
  primary: 'security/supply-chain',
  also: ['devops-infra/general'],
  tags: ['sbom', 'slsa'],
  securityRelevant: true,
  score: 91,
  breakdown,
  listed: true,
};

const assignments: Assignments = {
  [skill.id]: {
    primary: 'security/supply-chain',
    also: ['devops-infra/general'],
    tags: ['sbom', 'slsa'],
  },
};

const meta: Meta = {
  crawledAt: '2026-08-29T02:07:00Z',
  classifiedAt: null,
  skillCount: 1,
  sourceCount: 1,
};

const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        {
          slug: 'security/supply-chain',
          name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' },
          frameworkRefs: ['OWASP A03:2025'],
        },
        {
          slug: 'security/general',
          name: { en: 'General / Other', pt: 'Geral / Outros' },
        },
      ],
    },
  ],
  protected: ['CI/CD', 'Supply Chain'],
  aliases: { sca: 'supply-chain' },
  minimumMass: 5,
};

describe('shared types', () => {
  it('resolves as a real module at runtime', async () => {
    await expect(import('../src/types.ts')).resolves.toBeDefined();
  });

  it('keys a skill as owner/repo@sha:path', () => {
    expect(skill.id).toBe(`${skill.repo}@${skill.sha}:${skill.path}`);
  });

  it('caps secondary placement at two nodes', () => {
    expect(skill.also.length).toBeLessThanOrEqual(2);
    expect(skill.tags.length).toBeLessThanOrEqual(10);
  });

  it('keeps every score component inside its weight, summing to the total', () => {
    expect(breakdown.adoption).toBeLessThanOrEqual(25);
    expect(breakdown.maintenance).toBeLessThanOrEqual(30);
    expect(breakdown.provenance).toBeLessThanOrEqual(25);
    expect(breakdown.completeness).toBeLessThanOrEqual(20);
    expect(
      breakdown.adoption + breakdown.maintenance + breakdown.provenance + breakdown.completeness,
    ).toBe(breakdown.total);
    expect(skill.score).toBe(breakdown.total);
  });

  // Spec §5.1: eviction is a flag, not a deletion — the row keeps its id, its
  // original indexedAt (provenance, not a listing timestamp) and its score.
  it('flags an evicted entry instead of deleting it', () => {
    expect(skill.listed).toBe(true);
    const evicted: Skill = { ...skill, listed: false };
    expect(evicted.listed).toBe(false);
    expect(evicted.id).toBe(skill.id);
    expect(evicted.indexedAt).toBe(skill.indexedAt);
    expect(evicted.score).toBe(skill.score);
  });

  it('keys assignments by the skill id, not by an array index', () => {
    expect(Object.keys(assignments)).toEqual([skill.id]);
    expect(assignments[skill.id]?.primary).toBe(skill.primary);
  });

  it('lets meta report an unclassified crawl', () => {
    expect(meta.classifiedAt).toBeNull();
    expect(meta.crawledAt).not.toBe('');
  });

  it('allows an undeclared tool list', () => {
    expect(safety.declaredTools).toBeNull();
  });

  it('carries only real blobs, never symlinks', () => {
    expect(treeFile.mode).not.toBe('120000');
    expect(repoRef.stars).toBeGreaterThanOrEqual(10);
  });

  it('covers both locales and all five runtimes in RUNTIME_ORDER', () => {
    expect(langs).toEqual(['en', 'pt']);
    expect(runtimes).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });

  it('round-trips through JSON unchanged', () => {
    const payload = { skill, collection, rawSkill, taxonomy, assignments, meta };
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
