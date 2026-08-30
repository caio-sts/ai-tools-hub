import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE } from '../../astro.config.mjs';
import vitestConfig from '../../vitest.config.ts';

const TESTS_DIR = fileURLToPath(new URL('../', import.meta.url));
const SELF = 'project/harness.test.ts';
const SETUP = 'global-setup.ts';

function testSources(): string[] {
  return readdirSync(TESTS_DIR, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('\\').join('/'))
    .filter((entry) => entry.endsWith('.ts'));
}

describe('test harness', () => {
  it('builds the site once, in globalSetup', () => {
    expect(vitestConfig.test?.globalSetup).toEqual(['tests/global-setup.ts']);
  });

  it('gives tests the BASE_URL the built site gets', () => {
    expect(vitestConfig.base).toBe(BASE);
    expect(import.meta.env.BASE_URL).toBe(BASE);
  });

  it('lets no other test spawn its own astro build', () => {
    const offenders = testSources().filter((relative) => {
      if (relative === SELF || relative === SETUP) {
        return false;
      }
      const source = readFileSync(`${TESTS_DIR}${relative}`, 'utf8');
      return source.includes('child_process') && /\bastro\b/.test(source);
    });
    expect(
      offenders,
      'these test files spawn their own astro build; read the globalSetup build in dist/ instead',
    ).toEqual([]);
  });
});
