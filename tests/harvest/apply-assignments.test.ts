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

// Listing is DERIVED from primary: applyListing groups by it and caps each subdomain. The first
// classification pass split one over-cap group of 101 into twenty leaves, none of them near the
// cap — but the listed flags still described the old single group, so 41 entries stayed evicted
// from the catalog, the facets and the search index for a grouping that no longer existed.
describe('applyAssignmentsToCatalog recomputes listing, because listing depends on primary', () => {
  async function seedCapped(): Promise<{ dir: string; ids: string[] }> {
    const dir = await mkdtemp(join(tmpdir(), 'ao-listing-'));
    const rows: Skill[] = [];
    const assignments: Record<string, Assignment> = {};
    // 70 rows in one leaf: past the 60 cap, so the tail is evicted exactly as the harvest left it.
    for (let i = 0; i < 70; i += 1) {
      const path = `skills/s${String(i).padStart(2, '0')}/SKILL.md`;
      const id = `tob/skills@${SHA}:${path}`;
      rows.push(skill({ id, path, name: `s${i}`, listed: i < 60, score: 100 - i }));
      // Split them across two leaves, so neither is anywhere near the cap.
      assignments[id] = { primary: i % 2 === 0 ? 'security/general' : 'coding-software/general', also: [], tags: [] };
    }
    await writeFile(join(dir, 'skills.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
    await writeFile(join(dir, 'assignments.json'), `${JSON.stringify(assignments, null, 2)}\n`, 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 70, sourceCount: 1 }, null, 2)}\n`,
      'utf8',
    );
    return { dir, ids: rows.map((r) => r.id) };
  }

  it('relists entries the old grouping had evicted', async () => {
    const { dir } = await seedCapped();
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const skills = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];
    expect(skills.filter((s) => s.listed)).toHaveLength(70);
  });

  it('still evicts past the cap when one leaf really is over it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ao-listing-cap-'));
    const rows: Skill[] = [];
    const assignments: Record<string, Assignment> = {};
    for (let i = 0; i < 70; i += 1) {
      const path = `skills/s${String(i).padStart(2, '0')}/SKILL.md`;
      const id = `tob/skills@${SHA}:${path}`;
      rows.push(skill({ id, path, name: `s${i}`, listed: false, score: 100 - i }));
      assignments[id] = { primary: 'security/general', also: [], tags: [] };
    }
    await writeFile(join(dir, 'skills.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
    await writeFile(join(dir, 'assignments.json'), `${JSON.stringify(assignments, null, 2)}\n`, 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 70, sourceCount: 1 }, null, 2)}\n`,
      'utf8',
    );
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const skills = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];
    expect(skills.filter((s) => s.listed)).toHaveLength(60);
  });
});

// Pagefind sorts one key as a string and has no second one, so entries sharing a score AND a
// freshness fall back to index order — which is the order of skills.json. The harvest sorts it by
// compareForRank; this path has to as well, or the two disagree and the catalog shows a residue of
// whatever order the previous crawl happened to leave behind.
describe('applyAssignmentsToCatalog writes the catalog in ranking order', () => {
  it('sorts by score, then freshness, then name', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ao-order-'));
    const rows = [
      skill({ id: `a/b@${SHA}:z/SKILL.md`, path: 'z/SKILL.md', name: 'zebra', score: 90, updatedDays: 5 }),
      skill({ id: `a/b@${SHA}:a/SKILL.md`, path: 'a/SKILL.md', name: 'alpha', score: 90, updatedDays: 5 }),
      skill({ id: `a/b@${SHA}:f/SKILL.md`, path: 'f/SKILL.md', name: 'fresh', score: 90, updatedDays: 1 }),
      skill({ id: `a/b@${SHA}:t/SKILL.md`, path: 't/SKILL.md', name: 'top', score: 99, updatedDays: 9 }),
    ];
    await writeFile(join(dir, 'skills.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
    await writeFile(join(dir, 'assignments.json'), '{}\n', 'utf8');
    await writeFile(
      join(dir, 'meta.json'),
      `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 4, sourceCount: 1 }, null, 2)}\n`,
      'utf8',
    );
    await applyAssignmentsToCatalog(dir, '2026-08-31T12:00:00.000Z');

    const written = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];
    expect(written.map((s) => s.name)).toEqual(['top', 'fresh', 'alpha', 'zebra']);
  });
});

describe('assignmentsByIdentity feeds applyClassification', () => {
  it('round-trips a committed-shape assignments record', () => {
    const index = assignmentsByIdentity({ [`tob/skills@${SHA}:${PATH}`]: ASSIGNMENT });
    expect(applyClassification([skill()], index)[0]?.tags).toEqual(['sast']);
  });
});
