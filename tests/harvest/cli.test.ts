import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/harvest/run.ts';

function runCli(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['scripts/harvest/run.ts'],
      { cwd: process.cwd(), env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('parseArgs', () => {
  it('defaults to a full crawl into data/', () => {
    expect(parseArgs([])).toEqual({ allowlist: null, dataDir: 'data' });
  });

  it('splits a comma-separated allowlist and trims each entry', () => {
    expect(parseArgs(['--allowlist=anthropics/skills, trailofbits/skills'])).toEqual({
      allowlist: ['anthropics/skills', 'trailofbits/skills'],
      dataDir: 'data',
    });
  });

  it('drops empty allowlist entries', () => {
    expect(parseArgs(['--allowlist=a/b,,'])).toEqual({ allowlist: ['a/b'], dataDir: 'data' });
  });

  it('accepts a custom data directory', () => {
    expect(parseArgs(['--data-dir=/tmp/out'])).toEqual({ allowlist: null, dataDir: '/tmp/out' });
  });
});

describe('the CLI fails loudly without a PAT (spec §6.2)', () => {
  it('runs on a Node that strips types without a flag', () => {
    // `node scripts/harvest/run.ts` needs TypeScript type stripping on by default, which Node has
    // since 22.18.0 — exactly the floor package.json declares in engines.node (A1.1). crawl.yml
    // pins Node 24. If this assertion fires, upgrade before reading the next failure.
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    expect(major > 22 || (major === 22 && minor >= 18)).toBe(true);
  });

  it('exits 1 and names CATALOG_PAT', async () => {
    const result = await runCli({ CATALOG_PAT: '' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CATALOG_PAT');
    expect(result.stderr).toContain('GITHUB_TOKEN');
  }, 30_000);
});
