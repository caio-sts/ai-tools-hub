import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection, Safety, Skill } from '../../src/types.ts';
import {
  EPOCH,
  backfillLanguage,
  buildBlobQuery,
  graphqlBlobBatch,
  parseBackfillArgs,
  type FetchBlobBatch,
} from '../../scripts/backfill-language.ts';

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

const blobs: FetchBlobBatch = async (batch) =>
  new Map(batch.map((s) => [s.id, s.id === UNREADABLE.id ? null : s.id === GERMAN.id ? GERMAN_MD : ENGLISH_MD]));

function collection(repo: string): Collection {
  return { repo, stars: 50, forks: 1, pushedAt: '2026-10-01T00:00:00Z', license: 'MIT', topics: [], isOrg: false, curated: false };
}

async function seed(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-backfill-'));
  await writeFile(join(dir, 'skills.json'), `${JSON.stringify([GERMAN, ENGLISH, UNREADABLE], null, 2)}\n`, 'utf8');
  await writeFile(
    join(dir, 'collections.json'),
    `${JSON.stringify([collection('owner/repo'), collection('other/repo')], null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(dir, 'meta.json'),
    `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: null, skillCount: 3, sourceCount: 2 }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

const read = async <T>(dir: string, file: string): Promise<T> =>
  JSON.parse(await readFile(join(dir, file), 'utf8')) as T;

describe('backfillLanguage (spec 2026-10-24 D4)', () => {
  it('drops rows the language rule excludes, naming the rule, and keeps an unreadable one', async () => {
    const dir = await seed();
    const result = await backfillLanguage(dir, blobs, true);

    expect(result).toEqual({
      kept: 2,
      dropped: [{ id: GERMAN.id, repo: 'owner/repo', verdict: 'description-language' }],
      unreadable: 1,
    });
    expect((await read<Skill[]>(dir, 'skills.json')).map((s) => s.name).sort()).toEqual(['english', 'unreadable']);
  });

  it('recomputes the listing, so a dropped listed row frees its slot', async () => {
    const dir = await seed();
    await backfillLanguage(dir, blobs, true);

    expect((await read<Skill[]>(dir, 'skills.json')).find((s) => s.name === 'english')?.listed).toBe(true);
  });

  it('keeps meta.skillCount equal to the rows stored', async () => {
    const dir = await seed();
    await backfillLanguage(dir, blobs, true);

    expect((await read<{ skillCount: number }>(dir, 'meta.json')).skillCount).toBe(2);
  });

  it('queues every repo that lost a row for a re-read, so a displaced English sibling can return', async () => {
    const dir = await seed();
    await backfillLanguage(dir, blobs, true);

    const byRepo = new Map((await read<Collection[]>(dir, 'collections.json')).map((c) => [c.repo, c.pushedAt]));
    expect(byRepo.get('owner/repo')).toBe(EPOCH);
    expect(byRepo.get('other/repo')).toBe('2026-10-01T00:00:00Z');
  });

  it('writes nothing on a dry run', async () => {
    const dir = await seed();
    const before = await readFile(join(dir, 'skills.json'), 'utf8');
    const result = await backfillLanguage(dir, blobs, false);

    expect(result.dropped.map((d) => d.id)).toEqual([GERMAN.id]);
    expect(await readFile(join(dir, 'skills.json'), 'utf8')).toBe(before);
  });

  it('aborts without writing when a batch cannot be read', async () => {
    const dir = await seed();
    const before = await readFile(join(dir, 'skills.json'), 'utf8');
    const failing: FetchBlobBatch = async () => {
      throw new Error('backfill: GraphQL HTTP 401');
    };

    await expect(backfillLanguage(dir, failing, true)).rejects.toThrow('HTTP 401');
    expect(await readFile(join(dir, 'skills.json'), 'utf8')).toBe(before);
  });
});

describe('parseBackfillArgs', () => {
  it('is a dry run unless --write is given, and refuses anything else', () => {
    expect(parseBackfillArgs([])).toEqual({ write: false });
    expect(parseBackfillArgs(['--write'])).toEqual({ write: true });
    expect(() => parseBackfillArgs(['--dryrun'])).toThrow('--dryrun');
  });
});

describe('graphqlBlobBatch', () => {
  const noWait = async (): Promise<void> => {};
  const ok = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });

  it('retries a 5xx, then reads each alias, a missing object as null', async () => {
    const responses = [new Response('bad gateway', { status: 502 }), ok({ b0: { object: { text: 'hi' } }, b1: { object: null } })];
    const fetchImpl = async (): Promise<Response> => responses.shift()!;
    const texts = await graphqlBlobBatch('tok', fetchImpl, noWait)([ENGLISH, GERMAN]);
    expect(texts).toEqual(new Map([[ENGLISH.id, 'hi'], [GERMAN.id, null]]));
  });

  it('throws on a 4xx without retrying, and after three 5xx', async () => {
    let calls = 0;
    const unauthorized = async (): Promise<Response> => {
      calls += 1;
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    };
    await expect(graphqlBlobBatch('tok', unauthorized, noWait)([ENGLISH])).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);

    const down = async (): Promise<Response> => new Response('', { status: 502 });
    await expect(graphqlBlobBatch('tok', down, noWait)([ENGLISH])).rejects.toThrow('HTTP 502');
  });

  it('throws when the response carries no data, e.g. a GraphQL timeout', async () => {
    const timeout = async (): Promise<Response> =>
      new Response(JSON.stringify({ data: null, errors: [{ message: 'timeout' }] }), { status: 200 });
    await expect(graphqlBlobBatch('tok', timeout, noWait)([ENGLISH])).rejects.toThrow('timeout');
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
