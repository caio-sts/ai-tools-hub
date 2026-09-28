import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  if?: string;
  run?: string;
  env?: Record<string, string>;
}

const yml = readFileSync('.github/workflows/crawl.yml', 'utf8');
const steps: Step[] = parse(yml).jobs.harvest.steps;

function stepIndex(predicate: (step: Step) => boolean, what: string): number {
  const index = steps.findIndex(predicate);
  if (index === -1) throw new Error(`crawl.yml has no step that ${what}`);
  return index;
}

describe('crawl.yml schedule hygiene (spec §6.5)', () => {
  it('contains no tab characters', () => {
    expect(yml).not.toMatch(/\t/);
  });

  it('runs daily, off the hour, in an off-peak UTC window', () => {
    const match = yml.match(/cron:\s*'(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*'/);
    expect(match).not.toBeNull();
    const minute = Number(match![1]);
    const hour = Number(match![2]);
    expect(minute).toBeGreaterThan(0);
    expect(minute).toBeLessThan(60);
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThanOrEqual(9);
  });

  it('says in the file that it is the primary schedule, and the local timer optional', () => {
    expect(yml).toContain('primary schedule');
    expect(yml).toContain('ops/install-schedule.sh');
    expect(yml).toContain('optional');
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

  it('reports a failure or a timeout on one open issue instead of opening one a day', () => {
    // A timeout concludes `cancelled`, which `failure()` alone never sees.
    expect(yml).toContain('if: failure() || cancelled()');
    expect(yml).toContain('gh issue list --state open');
    expect(yml).toContain('gh issue comment');
    expect(yml).toContain('gh issue create');
    expect(yml).toContain('P1: crawl failed');
    expect(yml).toContain('issues: write');
    // Under `set -e`, a bare assignment propagates the command's exit status: the lookup
    // failing (not just finding zero issues) must not abort the step before gh issue create.
    expect(yml).toMatch(/OPEN=\$\(gh issue list[^\n]*\|\| true\)/);
  });

  it('stops the harvest on its own clock well before the job is killed', () => {
    const budget = Number(yml.match(/HARVEST_TIME_BUDGET_MIN:\s*'(\d+)'/)?.[1]);
    const timeout = Number(yml.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    expect(budget).toBe(35);
    expect(timeout).toBe(50);
    expect(timeout - budget).toBeGreaterThanOrEqual(10);
  });
});

describe('crawl.yml publishes what it commits', () => {
  // A push made with GITHUB_TOKEN starts no workflow run, and deploy.yml is the only publisher.
  it('dispatches deploy and CI with the permission that needs', () => {
    expect(yml).toContain('actions: write');
    expect(yml).toContain('gh workflow run deploy.yml --ref "$GITHUB_REF_NAME"');
    expect(yml).toContain('gh workflow run ci.yml --ref "$GITHUB_REF_NAME"');
  });

  it('dispatches only after the push', () => {
    const push = stepIndex((step) => step.run?.includes('git push') ?? false, 'pushes');
    const publish = stepIndex((step) => step.run?.includes('gh workflow run deploy.yml') ?? false, 'dispatches deploy');
    expect(publish).toBeGreaterThan(push);
    expect(steps[publish]!.env?.['GH_TOKEN']).toBe('${{ secrets.GITHUB_TOKEN }}');
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
