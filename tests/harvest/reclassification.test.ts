import { describe, expect, it } from 'vitest';
import type { Assignments, Collection, RawSkill, Safety, Skill } from '../../src/types.ts';
import {
  assignmentsByIdentity,
  buildSkill,
  carryForward,
  identityKey,
  parseSkillId,
  type CatalogSnapshot,
} from '../../scripts/harvest/run.ts';

const OLD_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const NEW_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH = 'skills/semgrep/SKILL.md';
const ENGLISH = 'Run Semgrep across the repository and triage vulnerabilities by severity.';

const INERT: Safety = {
  executesCode: false,
  scriptCount: 0,
  languages: [],
  network: false,
  readsEnv: false,
  declaredTools: null,
};

function collection(repo: string, pushedAt: string): Collection {
  return { repo, stars: 10, forks: 1, pushedAt, license: 'MIT', topics: [], isOrg: false, curated: false };
}

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: `tob/skills@${OLD_SHA}:${PATH}`,
    type: 'skill',
    name: 'semgrep',
    description: ENGLISH,
    descriptionPt: null,
    longPt: null,
    repo: 'tob/skills',
    path: PATH,
    sha: OLD_SHA,
    updatedDays: 1,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: INERT,
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    listed: true,
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
    ...overrides,
  };
}

describe('parseSkillId', () => {
  it('splits owner/repo@sha:path back into its three parts', () => {
    expect(parseSkillId(`tob/skills@${OLD_SHA}:${PATH}`)).toEqual({
      repo: 'tob/skills',
      sha: OLD_SHA,
      path: PATH,
    });
  });

  it('keeps a colon inside the path, splitting only at the separator after the sha', () => {
    expect(parseSkillId(`a/b@${OLD_SHA}:weird:name/SKILL.md`)?.path).toBe('weird:name/SKILL.md');
  });

  it('returns null for a string that is not a skill id', () => {
    expect(parseSkillId('not-an-id')).toBeNull();
    expect(parseSkillId('a/b@shaonly')).toBeNull();
  });
});

describe('assignmentsByIdentity (spec §6.1: decisions carry forward on repo + path)', () => {
  it('rekeys assignments off the sha so a re-crawl keeps the decision', () => {
    const assignments: Assignments = {
      [`tob/skills@${OLD_SHA}:${PATH}`]: { primary: 'security/code-application', also: [], tags: ['sast'] },
    };

    const index = assignmentsByIdentity(assignments);
    expect(index.get(identityKey('tob/skills', PATH))).toEqual({
      primary: 'security/code-application',
      also: [],
      tags: ['sast'],
    });
  });

  it('ignores entries whose key is not a parseable skill id', () => {
    expect(assignmentsByIdentity({ garbage: { primary: 'security/general', also: [], tags: [] } }).size).toBe(0);
  });
});

describe('carryForward re-applies the current classification', () => {
  const previous: CatalogSnapshot = {
    skills: [skill()],
    collections: [collection('tob/skills', '2026-08-01T00:00:00Z')],
  };
  const skipped = [collection('tob/skills', '2026-08-01T00:00:00Z')];

  it('applies an assignment written after the entry was last crawled', () => {
    const index = assignmentsByIdentity({
      [`tob/skills@${OLD_SHA}:${PATH}`]: { primary: 'security/code-application', also: ['devops-infra/general'], tags: ['sast'] },
    });

    const [carried] = carryForward(previous, skipped, index);
    expect(carried?.primary).toBe('security/code-application');
    expect(carried?.also).toEqual(['devops-infra/general']);
    expect(carried?.tags).toEqual(['sast']);
  });

  it('matches on repo and path, so an assignment keyed to an older sha still lands', () => {
    const index = assignmentsByIdentity({
      [`tob/skills@${NEW_SHA}:${PATH}`]: { primary: 'security/offensive-testing', also: [], tags: [] },
    });

    expect(carryForward(previous, skipped, index)[0]?.primary).toBe('security/offensive-testing');
  });

  it('returns an entry to the unclassified leaf when its assignment was removed', () => {
    const classified: CatalogSnapshot = {
      ...previous,
      skills: [skill({ primary: 'security/code-application', also: ['security/general'], tags: ['sast'] })],
    };

    const [carried] = carryForward(classified, skipped, new Map());
    expect(carried?.primary).toBe('vertical-domain/general');
    expect(carried?.also).toEqual([]);
    expect(carried?.tags).toEqual([]);
  });

  it('caps also at 2 and tags at 10, exactly as buildSkill does', () => {
    const index = assignmentsByIdentity({
      [`tob/skills@${OLD_SHA}:${PATH}`]: {
        primary: 'security/general',
        also: ['security/general', 'devops-infra/general', 'productivity/general'],
        tags: Array.from({ length: 12 }, (_, i) => `t${i}`),
      },
    });

    const [carried] = carryForward(previous, skipped, index);
    expect(carried?.also).toHaveLength(2);
    expect(carried?.tags).toHaveLength(10);
  });
});

describe('buildSkill carries a pt-BR translation across a re-crawl', () => {
  const raw: RawSkill = {
    repo: 'tob/skills',
    path: PATH,
    sha: NEW_SHA,
    blobSha: '1111111111111111111111111111111111111111',
    frontmatter: { name: 'semgrep', description: ENGLISH },
    body: '',
    updatedDays: 3,
  };
  const base = {
    raw,
    collection: collection('tob/skills', '2026-08-29T00:00:00Z'),
    safety: INERT,
    treePaths: [PATH],
    siblingLicenseText: null,
    assignment: undefined,
    indexedAt: '2026-08-29T00:00:00.000Z',
  };

  it('keeps descriptionPt and longPt when the English text is unchanged', () => {
    const built = buildSkill({
      ...base,
      previousTranslation: { description: ENGLISH, descriptionPt: 'Roda o Semgrep.', longPt: 'Texto longo.' },
    });

    expect(built.descriptionPt).toBe('Roda o Semgrep.');
    expect(built.longPt).toBe('Texto longo.');
  });

  it('drops a translation of text that no longer exists, rather than mislabelling it', () => {
    const built = buildSkill({
      ...base,
      previousTranslation: { description: 'An older English description.', descriptionPt: 'Tradução velha.', longPt: 'Antigo.' },
    });

    expect(built.descriptionPt).toBeNull();
    expect(built.longPt).toBeNull();
  });

  it('leaves both null when nothing was translated before', () => {
    const built = buildSkill({ ...base, previousTranslation: undefined });
    expect(built.descriptionPt).toBeNull();
    expect(built.longPt).toBeNull();
  });
});
