import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function page(file: string): string {
  if (!existsSync(file)) throw new Error(`Missing ${file} — the route did not build`);
  return readFileSync(file, 'utf8');
}

/**
 * Every stylesheet or script the site ships — emitted into dist/_astro AND inlined into the
 * pages. Astro inlines a small enough asset instead of emitting it, so a helper that only read
 * dist/_astro would report "not shipped" for chrome that is demonstrably on the page.
 */
const PAGES = ['dist/en/catalog/index.html', 'dist/en/methodology/index.html'];

function assets(extension: '.css' | '.js'): string {
  const dir = 'dist/_astro';
  if (!existsSync(dir)) throw new Error(`Missing ${dir} — the build produced no assets`);
  const emitted = readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => readFileSync(join(dir, file), 'utf8'));

  const tag = extension === '.css' ? 'style' : 'script';
  const pattern = new RegExp(`<${tag}(?![^>]*\\b(?:src|href)=)[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const inlined = PAGES.flatMap((file) =>
    [...page(file).matchAll(pattern)].map((match) => match[1]),
  );

  return [...emitted, ...inlined].join('\n');
}

describe('persistent site chrome', () => {
  it('reaches methodology from the footer of every page', () => {
    for (const file of PAGES) {
      const links = page(file).match(/<a[^>]*data-footer-link[^>]*>/g) ?? [];
      expect(
        links.some((link) => link.includes('href="/ai-tools-hub/en/methodology/"')),
        `no footer link to /en/methodology/ in ${file}`,
      ).toBe(true);
    }
  });

  it('keeps the footer after the main region', () => {
    const html = page(PAGES[0]);
    expect(html.indexOf('</main>')).toBeLessThan(html.lastIndexOf('data-footer-link'));
  });

  it('renders exactly one footer', () => {
    expect((page(PAGES[0]).match(/<footer/g) ?? []).length).toBe(1);
  });

  it('renders the staleness banner inside the sticky header', () => {
    const header = page(PAGES[0]).split('<header')[1]?.split('</header>')[0] ?? '';
    expect(header).toContain('data-staleness-banner');
  });

  it('reports the crawl and the classification in two separate elements', () => {
    const html = page(PAGES[0]);
    expect(html.match(/<p[^>]*data-crawl-state="(fresh|warn|stale|unknown)"[^>]*>/),
      'no [data-crawl-state] row found').not.toBeNull();
    expect(html.match(/<p[^>]*data-classification-state="(fresh|warn|stale|unknown)"[^>]*>/),
      'no [data-classification-state] row found').not.toBeNull();
    expect(html.indexOf('data-crawl-state')).not.toBe(html.indexOf('data-classification-state'));
  });

  it('never collapses the two rows into a single updated_at figure', () => {
    expect(page(PAGES[0])).toContain('data-classification-lag');
  });

  it('ships the a11y behaviour on every page the layout wraps', () => {
    const js = assets('.js');
    expect(js).toContain('data-clear-all');
    expect(js).toContain('--header-h');
  });

  it('ships the search behaviour over B3 combobox', () => {
    const js = assets('.js');
    expect(js).toContain('data-search-input');
    expect(js).toContain('aria-activedescendant');
    expect(js).toContain('rescue-index/');
  });

  it('keeps exactly one search input on the catalog', () => {
    expect((page(PAGES[0]).match(/data-search-input/g) ?? []).length).toBe(1);
  });

  it('ships the WCAG 2.4.11 scroll offset with a pre-JS fallback', () => {
    const css = assets('.css');
    expect(css).toContain('--header-h');
    expect(css).toMatch(/scroll-margin-top:\s*calc\(\s*var\(--header-h\)/);
    expect(css).toMatch(/body\s*>\s*header[^{]*\{[^}]*position:\s*sticky/);
  });

  it('translates the chrome on the pt-BR routes', () => {
    const pt = page('dist/pt/methodology/index.html');
    expect(pt).toContain('Atraso da classificação');
    const links = pt.match(/<a[^>]*data-footer-link[^>]*>/g) ?? [];
    expect(links.some((link) => link.includes('href="/ai-tools-hub/pt/methodology/"'))).toBe(true);
  });
});
