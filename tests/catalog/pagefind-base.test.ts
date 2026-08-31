import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGEFIND_BASE_URL, PAGEFIND_BUNDLE_PATH, SITE_BASE } from '../../src/lib/facets.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const config = readFileSync(resolve(root, 'astro.config.mjs'), 'utf8');

describe('Astro base and Pagefind path config agree', () => {
  it('astro.config.mjs base matches SITE_BASE', () => {
    // A1.2 writes the path once, as `export const BASE = '…'`, and sets `base: BASE` — its own
    // test fails if the literal appears twice in this file. So resolve the indirection rather
    // than assuming an inline literal.
    const inline = config.match(/base:\s*['"]([^'"]+)['"]/)?.[1];
    const named = config.match(/base:\s*([A-Za-z_$][\w$]*)\s*,/)?.[1];
    const viaConst =
      named === undefined
        ? undefined
        : config.match(new RegExp(`const\\s+${named}\\s*(?::[^=]+)?=\\s*['"]([^'"]+)['"]`))?.[1];
    expect(inline ?? viaConst).toBe(SITE_BASE);
  });

  it('astro.config.mjs registers the astro-pagefind integration', () => {
    expect(config).toContain("from 'astro-pagefind'");
    expect(config).toMatch(/integrations:\s*\[[^\]]*pagefind\(\)/s);
  });

  it('pins both search packages exactly, because a floating minor changes the bundle path', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    expect(deps['astro-pagefind']).toBe('2.0.1');
    expect(deps.pagefind).toBe('1.5.2');
  });

  it('PAGEFIND_BASE_URL equals the site base', () => {
    expect(PAGEFIND_BASE_URL).toBe(SITE_BASE);
  });

  it('PAGEFIND_BUNDLE_PATH is the site base plus the bundle location', () => {
    expect(PAGEFIND_BUNDLE_PATH).toBe(`${SITE_BASE}pagefind/pagefind.js`);
  });

  it('the build actually emits the file that path points at', () => {
    const rel = PAGEFIND_BUNDLE_PATH.slice(SITE_BASE.length);
    expect(
      existsSync(resolve(root, 'dist', rel)),
      `dist/${rel} was not emitted; the Pagefind bundle path and Astro base disagree`,
    ).toBe(true);
  });
});
