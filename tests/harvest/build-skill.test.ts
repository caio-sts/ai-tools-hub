import { describe, expect, it } from 'vitest';
import type { Assignment, Collection, RawSkill, Safety } from '../../src/types.ts';
import { buildSkill } from '../../scripts/harvest/run.ts';

const SHA = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3';

const collection: Collection = {
  repo: 'trailofbits/skills',
  stars: 6908,
  forks: 412,
  pushedAt: '2026-08-20T10:00:00Z',
  license: 'Apache-2.0',
  topics: ['claude-skills', 'security'],
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

const raw: RawSkill = {
  repo: 'trailofbits/skills',
  path: 'skills/semgrep-triage/SKILL.md',
  sha: SHA,
  blobSha: '1111111111111111111111111111111111111111',
  frontmatter: {
    name: 'semgrep-triage',
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  },
  body: '# Semgrep triage\n',
  updatedDays: 12,
};

/** No LICENSE next to the SKILL.md, so tier 2 cannot fire and the repo SPDX wins. */
const bareTree = ['skills/semgrep-triage/SKILL.md', 'skills/semgrep-triage/scripts/scan.py'];

describe('buildSkill', () => {
  it('composes an unclassified entry with a repo-level license fallback', () => {
    const skill = buildSkill({
      raw,
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill).toEqual({
      id: `trailofbits/skills@${SHA}:skills/semgrep-triage/SKILL.md`,
      type: 'skill',
      name: 'semgrep-triage',
      description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
      descriptionPt: null,
      longPt: null,
      repo: 'trailofbits/skills',
      path: 'skills/semgrep-triage/SKILL.md',
      sha: SHA,
      updatedDays: 12,
      indexedAt: '2026-08-29T00:00:00.000Z',
      license: 'Apache-2.0',
      licenseSource: 'repo',
      portable: true,
      runtimes: ['claude'],
      safety,
      primary: 'vertical-domain/general',
      also: [],
      tags: [],
      securityRelevant: true,
      listed: true,
      score: 90,
      breakdown: { adoption: 18, maintenance: 27, provenance: 25, completeness: 20, total: 90 },
    });
  });

  it('applies an assignment and caps also at 2 and tags at 10', () => {
    const assignment: Assignment = {
      primary: 'security/code-application',
      also: ['coding-software/general', 'devops-infra/general', 'productivity/general'],
      tags: ['sast', 'semgrep', 'triage', 'python', 'static-analysis', 'cli', 'ci', 'review', 'scanning', 'findings', 'eleventh'],
    };

    const skill = buildSkill({
      raw,
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.primary).toBe('security/code-application');
    expect(skill.also).toEqual(['coding-software/general', 'devops-infra/general']);
    expect(skill.tags).toHaveLength(10);
    expect(skill.tags[9]).toBe('findings');
    expect(skill.descriptionPt).toBeNull();
    expect(skill.longPt).toBeNull();
  });

  it('falls back to the directory name, marks a non-conformant skill unportable, and scores it lower', () => {
    const skill = buildSkill({
      raw: {
        repo: 'trailofbits/skills',
        path: 'skills/release-notes/SKILL.md',
        sha: SHA,
        blobSha: '2222222222222222222222222222222222222222',
        frontmatter: {
          description: 'Generate release notes from the git history since the last tag.',
          category: 'writing',
        },
        body: '',
        updatedDays: 200,
      },
      collection,
      safety,
      treePaths: ['skills/release-notes/SKILL.md'],
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.name).toBe('release-notes');
    expect(skill.portable).toBe(false);
    expect(skill.securityRelevant).toBe(false);
    expect(skill.breakdown).toEqual({ adoption: 18, maintenance: 6, provenance: 25, completeness: 11, total: 60 });
    expect(skill.score).toBe(60);
  });

  it('prefers a sibling LICENSE over a null repo license (anthropics/skills case)', () => {
    const skill = buildSkill({
      raw,
      collection: { ...collection, license: null },
      treePaths: [...bareTree, 'skills/semgrep-triage/LICENSE'],
      safety,
      siblingLicenseText: '                    Apache License\n              Version 2.0, January 2004\n',
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.license).toBe('Apache-2.0');
    expect(skill.licenseSource).toBe('sibling');
  });

  it('honours the frontmatter compatibility field in RUNTIME_ORDER, never alphabetically', () => {
    const skill = buildSkill({
      raw: { ...raw, frontmatter: { ...raw.frontmatter, compatibility: ['cursor', 'openclaw'] } },
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    // RUNTIME_ORDER (exported from src/lib/safety.ts, A5) is claude, openclaw, codex, cursor,
    // generic. Alphabetical would be claude, cursor, openclaw — a real ordering bug.
    expect(skill.runtimes).toEqual(['claude', 'openclaw', 'cursor']);
  });
});
