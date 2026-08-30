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
