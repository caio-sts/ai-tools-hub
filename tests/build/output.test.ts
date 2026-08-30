import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// dist/ is built once by tests/global-setup.ts. Never rebuild it here.
const distFile = (file: string): string =>
  fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));

describe('sitemap output', () => {
  it('emits a sitemap index', () => {
    expect(existsSync(distFile('sitemap-index.xml'))).toBe(true);
  });

  it('lists URLs under the project-page base path', () => {
    const xml = readFileSync(distFile('sitemap-0.xml'), 'utf8');
    expect(xml).toContain('https://caio-sts.github.io/ai-tools-hub/');
    expect(xml).not.toContain('ai-tools-hub/ai-tools-hub');
  });
});

describe('base-aware links in the built HTML', () => {
  const html = (): string => readFileSync(distFile('base-check/index.html'), 'utf8');

  it('prefixes every generated href with the project-page base', () => {
    expect(html()).toContain('href="/ai-tools-hub/"');
    expect(html()).toContain('href="/ai-tools-hub/en/"');
    expect(html()).toContain('href="/ai-tools-hub/pt/"');
  });

  it('emits no root-relative href that would 404 on Pages', () => {
    expect(html()).not.toContain('href="/en/"');
    expect(html()).not.toContain('href="/pt/"');
  });

  it('never doubles the base path', () => {
    expect(html()).not.toContain('/ai-tools-hub/ai-tools-hub/');
  });
});
