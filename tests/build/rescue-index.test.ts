import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadRescueIndex } from '../../src/lib/rescue.ts';
import { RESCUE_LANGS, rescueIndexJson } from '../../scripts/build-rescue-index.ts';

const MAX_BYTES = 512 * 1024;

function read(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`Missing ${file} — run "node scripts/build-rescue-index.ts" and commit the result`);
  }
  return readFileSync(file, 'utf8');
}

describe('the committed rescue index', () => {
  for (const lang of RESCUE_LANGS) {
    it(`ships public/rescue-index/${lang}.json`, () => {
      const raw = read(`public/rescue-index/${lang}.json`);
      expect(() => JSON.parse(raw)).not.toThrow();
      const bytes = Buffer.byteLength(raw, 'utf8');
      expect(bytes, `public/rescue-index/${lang}.json is ${bytes} bytes — it must stay small`)
        .toBeLessThan(MAX_BYTES);
      expect(loadRescueIndex(raw).documentCount).toBeGreaterThan(0);
    });

    it(`is in sync with the harvested catalog for ${lang}`, () => {
      expect(
        JSON.parse(read(`public/rescue-index/${lang}.json`)),
        `public/rescue-index/${lang}.json is stale — regenerate with "node scripts/build-rescue-index.ts"`,
      ).toEqual(JSON.parse(rescueIndexJson(lang)));
    });

    it(`is copied into dist/rescue-index/${lang}.json by the build`, () => {
      expect(existsSync(`dist/rescue-index/${lang}.json`)).toBe(true);
    });
  }

  it('carries no description text into the shipped payload', () => {
    for (const lang of RESCUE_LANGS) {
      expect(read(`public/rescue-index/${lang}.json`)).not.toContain('"description"');
    }
  });
});

describe('the weekly fallback crawl regenerates it', () => {
  const yml = readFileSync('.github/workflows/crawl.yml', 'utf8');

  it('rebuilds the rescue index before committing', () => {
    expect(yml).toContain('scripts/build-rescue-index.ts');
  });

  it('commits the regenerated artifact alongside the catalog data', () => {
    // A6.13 owns this line and stages three data files, not two; assert the pairing rather than
    // a literal string, so A6 stays free to add a fourth without breaking this.
    const gitAdd = yml.match(/^\s*git add .*$/m)?.[0] ?? '';
    expect(gitAdd).toContain('data/skills.json');
    expect(gitAdd).toContain('public/rescue-index');
  });
});

describe('the primary local schedule regenerates it too', () => {
  const localChain = ['scripts/harvest/run.ts', 'ops/ai-tools-hub-harvest.service', 'ops/install-schedule.sh']
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('rebuilds the artifact on the local run, not only in the weekly Action', () => {
    expect(
      localChain,
      'the local systemd run is the primary schedule (§6.1): if it commits data/skills.json without rebuilding public/rescue-index, the sync test above fails every 4 hours. Reconcile with A6, which owns scripts/harvest/run.ts and ops/ — do not weaken this test',
    ).toContain('build-rescue-index');
  });
});
