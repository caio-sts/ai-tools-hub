import { mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Collection, Safety, Skill } from '../../src/types.ts';
import { NEVER_CRAWLED } from '../../src/lib/data.ts';
import { loadLanguageDetector } from '../../scripts/harvest/language.ts';
import {
  backfillLanguage,
  buildBlobQuery,
  graphqlBlobBatch,
  parseBackfillArgs,
  type BackfillOptions,
  type FetchBlobBatch,
} from '../../scripts/backfill-language.ts';

beforeAll(loadLanguageDetector);

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
const MISSING = skill('missing', { score: 30 });

function blobsCounting(): { fetch: FetchBlobBatch; rows: () => number } {
  let rows = 0;
  const fetch: FetchBlobBatch = async (batch) => {
    rows += batch.length;
    return new Map(batch.map((s) => [s.id, s.id === MISSING.id ? null : s.id === GERMAN.id ? GERMAN_MD : ENGLISH_MD]));
  };
  return { fetch, rows: () => rows };
}

function collection(repo: string): Collection {
  return { repo, stars: 50, forks: 1, pushedAt: '2026-10-01T00:00:00Z', license: 'MIT', topics: [], isOrg: false, curated: false };
}

async function seed(): Promise<{ dir: string; options: (write: boolean) => BackfillOptions }> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-backfill-'));
  await writeFile(join(dir, 'skills.json'), `${JSON.stringify([GERMAN, ENGLISH, MISSING], null, 2)}\n`, 'utf8');
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
  const cacheFile = join(dir, 'verdicts.json');
  return { dir, options: (write) => ({ write, cacheFile, log: () => {} }) };
}

const read = async <T>(dir: string, file: string): Promise<T> =>
  JSON.parse(await readFile(join(dir, file), 'utf8')) as T;

describe('backfillLanguage (spec 2026-10-24 D4)', () => {
  it('drops rows the language rule excludes, naming the rule, and keeps a blob GitHub no longer has', async () => {
    const { dir, options } = await seed();
    const result = await backfillLanguage(dir, blobsCounting().fetch, options(true));

    expect(result).toEqual({
      kept: 2,
      dropped: [{ id: GERMAN.id, repo: 'owner/repo', verdict: 'body-language' }],
      missing: 1,
    });
    expect((await read<Skill[]>(dir, 'skills.json')).map((s) => s.name).sort()).toEqual(['english', 'missing']);
  });

  it('recomputes the listing and keeps meta.skillCount equal to the rows stored', async () => {
    const { dir, options } = await seed();
    await backfillLanguage(dir, blobsCounting().fetch, options(true));

    expect((await read<Skill[]>(dir, 'skills.json')).find((s) => s.name === 'english')?.listed).toBe(true);
    expect((await read<{ skillCount: number }>(dir, 'meta.json')).skillCount).toBe(2);
  });

  it('queues every repo that lost a row for a re-read, so a displaced English sibling can return', async () => {
    const { dir, options } = await seed();
    await backfillLanguage(dir, blobsCounting().fetch, options(true));

    const byRepo = new Map((await read<Collection[]>(dir, 'collections.json')).map((c) => [c.repo, c.pushedAt]));
    expect(byRepo.get('owner/repo')).toBe(NEVER_CRAWLED);
    expect(byRepo.get('other/repo')).toBe('2026-10-01T00:00:00Z');
  });

  it('writes nothing on a dry run, and the write run reuses its verdicts instead of fetching again', async () => {
    const { dir, options } = await seed();
    const before = await readFile(join(dir, 'skills.json'), 'utf8');
    const dry = blobsCounting();
    expect((await backfillLanguage(dir, dry.fetch, options(false))).dropped.map((d) => d.id)).toEqual([GERMAN.id]);
    expect(await readFile(join(dir, 'skills.json'), 'utf8')).toBe(before);
    expect(dry.rows()).toBe(3);

    const wet = blobsCounting();
    await backfillLanguage(dir, wet.fetch, options(true));
    expect(wet.rows()).toBe(0);
    expect((await read<Skill[]>(dir, 'skills.json')).map((s) => s.name)).not.toContain('german');
  });

  it('aborts without writing when a batch cannot be read, and resumes from its checkpoint', async () => {
    const { dir, options } = await seed();
    const before = await readFile(join(dir, 'skills.json'), 'utf8');
    const good = blobsCounting();
    let calls = 0;
    const failsOnSecond: FetchBlobBatch = async (batch) => {
      calls += 1;
      if (calls === 2) throw new Error('backfill: GraphQL HTTP 502');
      return good.fetch(batch);
    };

    await expect(backfillLanguage(dir, failsOnSecond, { ...options(true), batchSize: 1 })).rejects.toThrow('HTTP 502');
    expect(await readFile(join(dir, 'skills.json'), 'utf8')).toBe(before);

    const resumed = blobsCounting();
    await backfillLanguage(dir, resumed.fetch, { ...options(true), batchSize: 1 });
    expect(resumed.rows()).toBe(2);
  });

  it('refuses to write if data/ changed while it was reading', async () => {
    const { dir, options } = await seed();
    const touching: FetchBlobBatch = async (batch) => {
      const later = new Date(Date.now() + 60_000);
      await utimes(join(dir, 'collections.json'), later, later);
      return blobsCounting().fetch(batch);
    };

    await expect(backfillLanguage(dir, touching, options(true))).rejects.toThrow('changed while');
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
  const waits: number[] = [];
  const wait = async (ms: number): Promise<void> => {
    waits.push(ms);
  };
  const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

  it('retries a 5xx, then reads each alias; a NOT_FOUND object is null', async () => {
    const responses = [
      new Response('bad gateway', { status: 502 }),
      ok({
        data: { b0: { object: { text: 'hi' } }, b1: { object: null } },
        errors: [{ type: 'NOT_FOUND', path: ['b1'], message: 'gone' }],
      }),
    ];
    const texts = await graphqlBlobBatch('tok', async () => responses.shift()!, wait)([ENGLISH, GERMAN]);
    expect(texts).toEqual(new Map([[ENGLISH.id, 'hi'], [GERMAN.id, null]]));
  });

  it('treats any other per-alias error as a failed batch, never as a missing blob', async () => {
    const partial = async (): Promise<Response> =>
      ok({ data: { b0: null }, errors: [{ type: 'RATE_LIMITED', path: ['b0'], message: 'slow down' }] });
    await expect(graphqlBlobBatch('tok', partial, wait)([ENGLISH])).rejects.toThrow('RATE_LIMITED');
  });

  it('waits out a secondary rate limit using retry-after', async () => {
    waits.length = 0;
    const responses = [
      new Response('{"message":"secondary rate limit"}', { status: 403, headers: { 'retry-after': '7' } }),
      ok({ data: { b0: { object: { text: 'hi' } } } }),
    ];
    const texts = await graphqlBlobBatch('tok', async () => responses.shift()!, wait)([ENGLISH]);
    expect(texts.get(ENGLISH.id)).toBe('hi');
    expect(waits).toEqual([7000]);
  });

  it('throws on 401 without retrying, and after repeated 5xx', async () => {
    let calls = 0;
    const unauthorized = async (): Promise<Response> => {
      calls += 1;
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    };
    await expect(graphqlBlobBatch('tok', unauthorized, wait)([ENGLISH])).rejects.toThrow('HTTP 401');
    expect(calls).toBe(1);

    const down = async (): Promise<Response> => new Response('', { status: 502 });
    await expect(graphqlBlobBatch('tok', down, wait)([ENGLISH])).rejects.toThrow('HTTP 502');
  });

  it('throws when the response carries no data, e.g. a GraphQL timeout', async () => {
    const timeout = async (): Promise<Response> => ok({ data: null, errors: [{ message: 'timeout' }] });
    await expect(graphqlBlobBatch('tok', timeout, wait)([ENGLISH])).rejects.toThrow('timeout');
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
