import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
