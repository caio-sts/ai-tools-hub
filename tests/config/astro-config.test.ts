import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { BASE } from '../../astro.config.mjs';

const source = readFileSync(
  fileURLToPath(new URL('../../astro.config.mjs', import.meta.url)),
  'utf8',
);

describe('astro.config.mjs', () => {
  it('serves from the project-page base path', () => {
    expect(BASE).toBe('/ai-tools-hub/');
    expect(config.base).toBe(BASE);
  });

  it('points site at the origin only, without the base path', () => {
    expect(config.site).toBe('https://caio-sts.github.io');
    expect(config.site).not.toContain('ai-tools-hub');
  });

  it('builds a fully static site (Pages has no rewrite rules)', () => {
    expect(config.output).toBe('static');
  });

  it('uses directory URLs with a trailing slash', () => {
    expect(config.trailingSlash).toBe('always');
  });

  // Spec §13: Pagefind's baseUrl must agree with Astro's base. It can only
  // disagree if someone writes the path twice, so the path is written once.
  it('declares the base path exactly once, as BASE', () => {
    const literals = source.match(/'\/ai-tools-hub\/'/g) ?? [];
    expect(
      literals,
      'the base path is written more than once; import BASE instead of retyping it',
    ).toHaveLength(1);
  });
});
