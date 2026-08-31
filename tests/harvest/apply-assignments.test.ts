import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Assignment, Safety, Skill } from '../../src/types.ts';
import { applyClassification, assignmentsByIdentity, identityKey } from '../../scripts/harvest/run.ts';
import { applyAssignmentsToCatalog } from '../../scripts/apply-assignments.ts';

const SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PATH = 'skills/semgrep/SKILL.md';

const INERT: Safety = {
  executesCode: false,
  scriptCount: 0,
  languages: [],
  network: false,
  readsEnv: false,
  declaredTools: null,
};

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: `tob/skills@${SHA}:${PATH}`,
    type: 'skill',
    name: 'semgrep',
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
    descriptionPt: null,
    longPt: null,
    repo: 'tob/skills',
    path: PATH,
    sha: SHA,
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

const ASSIGNMENT: Assignment = { primary: 'security/code-application', also: [], tags: ['sast'] };

describe('applyClassification', () => {
  it('writes primary, also and tags onto a matching entry', () => {
    const index = new Map([[identityKey('tob/skills', PATH), ASSIGNMENT]]);
    expect(applyClassification([skill()], index)[0]?.primary).toBe('security/code-application');
  });

  it('leaves every other field of the entry untouched', () => {
    const index = new Map([[identityKey('tob/skills', PATH), ASSIGNMENT]]);
    const before = skill();
    const after = applyClassification([before], index)[0];
    expect({ ...after, primary: before.primary, also: before.also, tags: before.tags }).toEqual(before);
  });
});

describe('applyAssignmentsToCatalog (the offline half of the classification session)', () => {
  async function seed(assignments: Record<string, Assignment>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-apply-'));
    await writeFile(join(dir, 'skills.json'), `${JSON.stringify([skill()], null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
    await writeFile(join(dir, 'assignments.json'), `${JSON.stringify(assignments, null, 2)}\n`, 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 1, sourceCount: 1 }, null, 2)}\n`,
      'utf8',
    );
    return dir;
  }

  it('rewrites skills.json from assignments.json', async () => {
    const dir = await seed({ [`tob/skills@${SHA}:${PATH}`]: ASSIGNMENT });
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const skills = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];
    expect(skills[0]?.primary).toBe('security/code-application');
    expect(skills[0]?.tags).toEqual(['sast']);
  });

  it('stamps classifiedAt so the staleness banner cannot report a lie', async () => {
    const dir = await seed({ [`tob/skills@${SHA}:${PATH}`]: ASSIGNMENT });
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { classifiedAt: string };
    expect(meta.classifiedAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it('counts every stored row in skillCount, not just the listed ones', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-apply-'));
    const evicted = skill({ id: `tob/skills@${SHA}:skills/other/SKILL.md`, path: 'skills/other/SKILL.md', listed: false });
    await writeFile(join(dir, 'skills.json'), `${JSON.stringify([skill(), evicted], null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
    await writeFile(join(dir, 'assignments.json'), '{}\n', 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 2, sourceCount: 1 }, null, 2)}\n`,
      'utf8',
    );
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { skillCount: number };
    expect(meta.skillCount).toBe(2);
  });

  it('reports how many entries are still queued unclassified', async () => {
    const dir = await seed({});
    const result = await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');
    expect(result).toEqual({ classified: 0, unclassified: 1 });
  });

  it('matches an assignment written against an older sha', async () => {
    const dir = await seed({ [`tob/skills@bbbbbbbb:${PATH}`]: ASSIGNMENT });
    const result = await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const skills = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];
    expect(skills[0]?.primary).toBe('security/code-application');
    expect(result.classified).toBe(1);
  });
});

describe('assignmentsByIdentity feeds applyClassification', () => {
  it('round-trips a committed-shape assignments record', () => {
    const index = assignmentsByIdentity({ [`tob/skills@${SHA}:${PATH}`]: ASSIGNMENT });
    expect(applyClassification([skill()], index)[0]?.tags).toEqual(['sast']);
  });
});
