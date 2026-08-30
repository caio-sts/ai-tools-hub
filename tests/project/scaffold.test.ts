import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  name: string;
  private: boolean;
  type: string;
  engines: { node: string };
  scripts: Record<string, string>;
}

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8'),
) as PackageJson;
const gitignore = readFileSync(fileURLToPath(new URL('.gitignore', root)), 'utf8');

describe('project scaffold', () => {
  it('is a private ES-module package', () => {
    expect(pkg.name).toBe('ai-tools-hub');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
  });

  it('requires a Node that both Astro 7 and `node file.ts` support', () => {
    expect(pkg.engines.node).toBe('>=22.18.0');
  });

  it('runs the suite through vitest', () => {
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('ignores build output but keeps the lockfile committed', () => {
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.astro/');
    expect(gitignore).not.toContain('package-lock.json');
  });
});
