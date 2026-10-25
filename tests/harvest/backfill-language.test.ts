import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Safety, Skill } from '../../src/types.ts';
import { backfillLanguage, buildBlobQuery, type FetchBlobs } from '../../scripts/backfill-language.ts';

const INERT: Safety = {
  executesCode: false,
  scriptCount: 0,
  languages: [],
  network: false,
  readsEnv: false,
  declaredTools: null,
};

function skill(name: string, overrides: Partial<Skill> = {}): Skill {
  const path = `skills/${name}/SKILL.md`;
  return {
    id: `owner/repo@abc1234:${path}`,
    type: 'skill',
    name,
    description: 'Scans lockfiles for malicious packages before every release.',
    descriptionPt: null,
    longPt: null,
    repo: 'owner/repo',
    path,
    sha: 'abc1234',
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
    listed: false,
    score: 50,
    breakdown: { adoption: 10, maintenance: 20, provenance: 10, completeness: 10, total: 50 },
    ...overrides,
  };
}

const ENGLISH_MD =
  '---\nname: english\ndescription: Scans lockfiles for malicious packages.\n---\n' +
  'Run it on every pull request. It reads each lockfile, checks every package against known malicious ' +
  'releases and explains how to pin a safe version.';
const GERMAN_MD =
  '---\nname: german\ndescription: Prüft Lockfiles auf bösartige Pakete.\n---\n' +
  'Vor jeder Veröffentlichung ausführen. Der Skill liest jede Lockdatei, prüft alle Pakete gegen bekannte ' +
  'bösartige Versionen und erklärt, wie man eine sichere Version festlegt.';

const ENGLISH = skill('english', { score: 40 });
const GERMAN = skill('german', { score: 90, listed: true });
const UNREADABLE = skill('unreadable', { score: 30 });

const blobs: FetchBlobs = async (skills) =>
  new Map(skills.map((s) => [s.id, s.id === UNREADABLE.id ? null : s.id === GERMAN.id ? GERMAN_MD : ENGLISH_MD]));

async function seed(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-backfill-'));
  await writeFile(join(dir, 'skills.json'), `${JSON.stringify([GERMAN, ENGLISH, UNREADABLE], null, 2)}\n`, 'utf8');
  await writeFile(join(dir, 'collections.json'), '[]\n', 'utf8');
  await writeFile(
    join(dir, 'meta.json'),
    `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 3, sourceCount: 1 }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

const stored = async (dir: string): Promise<Skill[]> =>
  JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8')) as Skill[];

describe('backfillLanguage (spec 2026-10-24 D4)', () => {
  it('drops rows the language rule excludes and keeps an unreadable one', async () => {
    const dir = await seed();
    const result = await backfillLanguage(dir, blobs, true);

    expect(result).toEqual({ kept: 2, dropped: [GERMAN.id], unreadable: 1 });
    expect((await stored(dir)).map((s) => s.name).sort()).toEqual(['english', 'unreadable']);
  });

  it('recomputes the listing, so a dropped listed row frees its slot', async () => {
    const dir = await seed();
    await backfillLanguage(dir, blobs, true);

    expect((await stored(dir)).find((s) => s.name === 'english')?.listed).toBe(true);
  });

  it('keeps meta.skillCount equal to the rows stored', async () => {
    const dir = await seed();
    await backfillLanguage(dir, blobs, true);

    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8')) as { skillCount: number };
    expect(meta.skillCount).toBe(2);
  });

  it('writes nothing on a dry run', async () => {
    const dir = await seed();
    const before = await readFile(join(dir, 'skills.json'), 'utf8');
    const result = await backfillLanguage(dir, blobs, false);

    expect(result.dropped).toEqual([GERMAN.id]);
    expect(await readFile(join(dir, 'skills.json'), 'utf8')).toBe(before);
  });
});

describe('buildBlobQuery', () => {
  it('asks for each SKILL.md at the commit its row was indexed at, quoting paths safely', () => {
    const query = buildBlobQuery([skill('a "quoted" dir')]);
    expect(query).toContain('b0: repository(owner: "owner", name: "repo")');
    expect(query).toContain('object(expression: "abc1234:skills/a \\"quoted\\" dir/SKILL.md")');
    expect(query).toContain('... on Blob { text }');
  });
});
