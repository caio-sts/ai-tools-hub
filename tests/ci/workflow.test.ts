import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const WORKFLOW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/ci.yml'),
  'utf8',
);

describe('.github/workflows/ci.yml', () => {
  it('runs on push to main and on every pull request', () => {
    expect(WORKFLOW).toContain('branches: [main, master]');
    expect(WORKFLOW).toContain('pull_request:');
    expect(WORKFLOW).toContain('workflow_dispatch:');
  });

  it('pins the action versions the project standardised on', () => {
    expect(WORKFLOW).toContain('actions/checkout@v5');
    expect(WORKFLOW).toContain('actions/setup-node@v5');
    expect(WORKFLOW).toContain("node-version: '24'");
  });

  it('runs both the unit tests and the taxonomy governance checks', () => {
    expect(WORKFLOW).toContain('run: npm test');
    expect(WORKFLOW).toContain('run: npm run validate');
  });

  it('is read-only by default; only the report job may write, and only issues', () => {
    const workflow = parse(WORKFLOW);
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.report.permissions).toEqual({ issues: 'write' });
  });
});

describe('ci.yml fails loudly on master (spec §13)', () => {
  const { concurrency, jobs } = parse(WORKFLOW);
  const step = jobs.report.steps[0];

  it('gives up on a hung run, and on a hung report, long before the 6 h default', () => {
    expect(jobs.test['timeout-minutes']).toBe(30);
    expect(jobs.report['timeout-minutes']).toBe(5);
  });

  it('queues master runs instead of cancelling them, so a cancelled master run is a hang or a manual cancel', () => {
    expect(concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
    expect(jobs.report.if).toBe(
      "${{ always() && github.ref_name == github.event.repository.default_branch && (needs.test.result == 'failure' || needs.test.result == 'cancelled') }}",
    );
  });

  it('files through gh without a checkout, mentions the owner and never assigns', () => {
    expect(step.env).toEqual({ GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}', GH_REPO: '${{ github.repository }}' });
    expect(step.run).toMatch(/OPEN=\$\(gh issue list --state open[^\n]*\|\| true\)/);
    expect(step.run).toMatch(/gh issue comment "\$OPEN" --body "@\$GITHUB_REPOSITORY_OWNER /);
    expect(step.run).not.toContain('assignee');
    expect(step.run).not.toContain('run list');
  });
});
