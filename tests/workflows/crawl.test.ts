import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = readFileSync('.github/workflows/crawl.yml', 'utf8');

describe('crawl.yml schedule hygiene (spec §6.5)', () => {
  it('contains no tab characters', () => {
    expect(yml).not.toMatch(/\t/);
  });

  it('runs weekly, off the hour, in an off-peak UTC window', () => {
    // Five fields, and the fifth is a day of the week rather than `*` — that is what makes
    // this weekly. A nightly `37 6 * * *` no longer matches.
    const match = yml.match(/cron:\s*'(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+(\d)'/);
    expect(match).not.toBeNull();
    const minute = Number(match![1]);
    const hour = Number(match![2]);
    const weekday = Number(match![3]);
    expect(minute).toBeGreaterThan(0);
    expect(minute).toBeLessThan(60);
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThanOrEqual(9);
    expect(weekday).toBeGreaterThanOrEqual(0);
    expect(weekday).toBeLessThanOrEqual(6);
  });

  it('says in the file why it is the fallback and not the primary (spec §6.1)', () => {
    expect(yml).toContain('fallback');
    expect(yml).toContain('ops/install-schedule.sh');
    expect(yml).toContain('machine is off');
  });

  it('always offers the manual escape hatch', () => {
    expect(yml).toContain('workflow_dispatch:');
  });
});

describe('crawl.yml authentication (spec §6.2)', () => {
  it('passes the PAT, never GITHUB_TOKEN, as CATALOG_PAT', () => {
    expect(yml).toContain('CATALOG_PAT: ${{ secrets.CATALOG_PAT }}');
    expect(yml).not.toContain('CATALOG_PAT: ${{ secrets.GITHUB_TOKEN }}');
  });

  it('fails loudly when the PAT is missing or expired', () => {
    expect(yml).toContain('::error::');
    expect(yml).toContain('exit 1');
  });
});

describe('crawl.yml keeps its own schedule alive (spec §6.5)', () => {
  it('commits and pushes all three refreshed data files', () => {
    expect(yml).toContain('git add data/skills.json data/collections.json data/meta.json');
    expect(yml).toContain('--allow-empty');
    expect(yml).toContain('git push');
  });

  it('grants the write permission the commit needs', () => {
    expect(yml).toContain('contents: write');
  });

  it('opens an issue when the crawl fails', () => {
    expect(yml).toContain('if: failure()');
    expect(yml).toContain('gh issue create');
    expect(yml).toContain('issues: write');
  });
});

describe('crawl.yml pins its actions and never injects inputs into a shell', () => {
  it('pins checkout and setup-node, on a Node that strips types by default', () => {
    expect(yml).toContain('actions/checkout@v5');
    expect(yml).toContain('actions/setup-node@v5');
    expect(yml).toContain("node-version: '24'");
  });

  it('routes every workflow input through an environment variable', () => {
    for (const line of yml.split('\n')) {
      if (line.includes('${{ inputs.')) {
        expect(line.trim()).toMatch(/^[A-Z_]+:\s*\$\{\{\s*inputs\.[a-z_]+\s*\}\}$/);
      }
    }
  });
});
