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

  it('asks for read-only repository permissions', () => {
    expect(WORKFLOW).toContain('permissions:');
    expect(WORKFLOW).toContain('contents: read');
  });
});

describe('ci.yml fails loudly on master (spec §13)', () => {
  const { jobs } = parse(WORKFLOW);

  it('gives up on a hung run long before the 6 h default', () => {
    expect(jobs.test['timeout-minutes']).toBe(30);
  });

  it('reports failures and cancellations on master; the step drops cancellations that were superseded', () => {
    expect(jobs.report.needs).toBe('test');
    expect(jobs.report.if).toBe(
      "${{ always() && github.ref_name == github.event.repository.default_branch && (needs.test.result == 'failure' || needs.test.result == 'cancelled') }}",
    );
    expect(jobs.report.permissions).toEqual({ issues: 'write', actions: 'read' });
    expect(jobs.report.steps[0].env.TEST_RESULT).toBe('${{ needs.test.result }}');
  });
});
