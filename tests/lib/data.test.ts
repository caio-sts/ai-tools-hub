import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_DIR,
  EMPTY_META,
  NEVER_CRAWLED,
  loadAssignments,
  loadCollections,
  loadMeta,
  loadSkills,
} from '../../src/lib/data.ts';

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ai-tools-hub-data-'));
}

describe('loading tolerates a missing, broken or wrongly-shaped file', () => {
  it('returns empty values when nothing is on disk', async () => {
    const dir = await scratch();
    expect(loadSkills(dir)).toEqual([]);
    expect(loadCollections(dir)).toEqual([]);
    expect(loadMeta(dir)).toEqual(EMPTY_META);
    expect(loadAssignments(dir)).toEqual({});
  });

  it('returns empty values for unparseable JSON', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '{ broken', 'utf8');
    await writeFile(join(dir, 'meta.json'), 'nope', 'utf8');
    expect(loadSkills(dir)).toEqual([]);
    expect(loadMeta(dir)).toEqual(EMPTY_META);
  });

  it('rejects the wrapped {"skills": []} shape — skills.json is a bare array', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '{"skills":[{"id":"a/b@c:SKILL.md"}]}', 'utf8');
    expect(loadSkills(dir)).toEqual([]);
  });

  it('rejects an assignments file that is an array — it is keyed by skill id', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'assignments.json'), '[{"primary":"security/general"}]', 'utf8');
    expect(loadAssignments(dir)).toEqual({});
  });
});

describe('loading returns the canonical shapes', () => {
  it('reads bare arrays from skills.json and collections.json', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '[{"id":"a/b@c:SKILL.md","name":"x"}]', 'utf8');
    await writeFile(join(dir, 'collections.json'), '[{"repo":"a/b","stars":10,"forks":1}]', 'utf8');
    expect(loadSkills(dir)).toHaveLength(1);
    expect(loadSkills(dir)[0]!.id).toBe('a/b@c:SKILL.md');
    expect(loadCollections(dir)[0]!.repo).toBe('a/b');
  });

  it('normalises a partial meta.json instead of returning undefined fields', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'meta.json'), '{"skillCount":7}', 'utf8');
    expect(loadMeta(dir)).toEqual({ crawledAt: NEVER_CRAWLED, classifiedAt: null, skillCount: 7, sourceCount: 0 });
  });

  it('keeps well-formed assignment rows and drops malformed ones', async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        'a/b@c:SKILL.md': { primary: 'security/general', also: ['devops-infra/general'], tags: ['sast'] },
        'a/b@c:bare/SKILL.md': { primary: 'security/general' },
        'a/b@c:junk/SKILL.md': { also: [], tags: [] },
      }),
      'utf8',
    );

    const assignments = loadAssignments(dir);
    expect(Object.keys(assignments).sort()).toEqual(['a/b@c:SKILL.md', 'a/b@c:bare/SKILL.md']);
    expect(assignments['a/b@c:SKILL.md']).toEqual({
      primary: 'security/general',
      also: ['devops-infra/general'],
      tags: ['sast'],
    });
    expect(assignments['a/b@c:bare/SKILL.md']).toEqual({ primary: 'security/general', also: [], tags: [] });
  });
});

describe('the committed data directory', () => {
  it('points DEFAULT_DATA_DIR at the repository data/ folder and parses every file there', () => {
    expect(existsSync(join(DEFAULT_DATA_DIR, 'skills.json'))).toBe(true);
    expect(existsSync(join(DEFAULT_DATA_DIR, 'collections.json'))).toBe(true);
    expect(Array.isArray(loadSkills())).toBe(true);
    expect(Array.isArray(loadCollections())).toBe(true);
    expect(typeof loadMeta().crawledAt).toBe('string');
    expect(typeof loadAssignments()).toBe('object');
  });
});
