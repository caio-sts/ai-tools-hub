import { describe, expect, it } from 'vitest';
import { BASE } from '../../astro.config.mjs';
import { joinBase, withBase } from '../../src/lib/link.ts';

describe('joinBase', () => {
  it('prefixes a configured project-page base', () => {
    expect(joinBase('/ai-tools-hub/', '/en/')).toBe('/ai-tools-hub/en/');
  });

  it('accepts a base written without a trailing slash', () => {
    expect(joinBase('/ai-tools-hub', '/en/security/')).toBe('/ai-tools-hub/en/security/');
  });

  it('accepts a path written without a leading slash', () => {
    expect(joinBase('/ai-tools-hub/', 'en/')).toBe('/ai-tools-hub/en/');
  });

  it('keeps the base root reachable', () => {
    expect(joinBase('/ai-tools-hub/', '/')).toBe('/ai-tools-hub/');
    expect(joinBase('/ai-tools-hub/', '')).toBe('/ai-tools-hub/');
  });

  it('is a no-op for an empty base', () => {
    expect(joinBase('', '/en/')).toBe('/en/');
  });

  it('is a no-op for a root base', () => {
    expect(joinBase('/', '/en/')).toBe('/en/');
    expect(joinBase('/', '/')).toBe('/');
  });

  it('never doubles a slash', () => {
    expect(joinBase('/ai-tools-hub/', '/en/')).not.toContain('//');
    expect(joinBase('/ai-tools-hub', 'en/')).not.toContain('//');
  });
});

describe('withBase', () => {
  it('reads the same BASE the astro config declares', () => {
    expect(import.meta.env.BASE_URL).toBe(BASE);
  });

  it('produces the paths the deployed project page serves', () => {
    expect(withBase('/')).toBe('/ai-tools-hub/');
    expect(withBase('/en/')).toBe('/ai-tools-hub/en/');
    expect(withBase('/pt/security/supply-chain/')).toBe('/ai-tools-hub/pt/security/supply-chain/');
  });

  it('returns an absolute in-site path', () => {
    expect(withBase('/en/security/')).toMatch(/^\/[^/]/);
  });
});
