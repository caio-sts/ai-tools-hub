import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection } from '../../src/types.ts';
import { EMPTY_META, loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { writeCatalog, writeMeta } from '../../scripts/harvest/run.ts';

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ai-tools-hub-write-'));
}

const collection: Collection = {
  repo: 'a/b',
  stars: 1,
  forks: 0,
  pushedAt: '2026-08-01T00:00:00Z',
  license: 'MIT',
  topics: ['claude-skills'],
  isOrg: false,
  curated: false,
};

describe('writing produces stable, diff-friendly, canonically shaped files', () => {
  it('writes two bare arrays, not one wrapper object', async () => {
    const dir = await scratch();
    await writeCatalog(dir, { skills: [], collections: [collection] });

    const skillsRaw = await readFile(join(dir, 'skills.json'), 'utf8');
    const collectionsRaw = await readFile(join(dir, 'collections.json'), 'utf8');

    expect(skillsRaw).toBe('[]\n');
    expect(collectionsRaw.startsWith('[')).toBe(true);
    expect(collectionsRaw.endsWith('\n')).toBe(true);
    expect(collectionsRaw).not.toContain('"collections"');
  });

  it('round-trips through the loaders', async () => {
    const dir = await scratch();
    await writeCatalog(dir, { skills: [], collections: [collection] });
    expect(loadSkills(dir)).toEqual([]);
    expect(loadCollections(dir)).toEqual([collection]);
  });

  it('round-trips meta', async () => {
    const dir = await scratch();
    const meta = {
      crawledAt: '2026-08-29T06:37:00.000Z',
      classifiedAt: '2026-08-28T00:00:00.000Z',
      skillCount: 24,
      sourceCount: 3,
    };
    await writeMeta(dir, meta);
    expect(loadMeta(dir)).toEqual(meta);
  });

  it('creates the data directory when it is absent', async () => {
    const dir = join(await scratch(), 'nested', 'data');
    await writeMeta(dir, EMPTY_META);
    await writeCatalog(dir, { skills: [], collections: [] });
    expect(loadMeta(dir)).toEqual(EMPTY_META);
    expect(loadCollections(dir)).toEqual([]);
  });
});
