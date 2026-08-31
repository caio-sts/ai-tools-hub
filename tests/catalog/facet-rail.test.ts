import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export function builtCatalog(lang: string): string {
  const candidates = [
    resolve(root, `dist/${lang}/catalog/index.html`),
    resolve(root, `dist/${lang}/catalog.html`),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`built catalog page for "${lang}" not found under dist/${lang}/`);
  return hit ? readFileSync(hit, 'utf8') : '';
}

export function allBuiltCss(): string {
  const dir = resolve(root, 'dist/_astro');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(resolve(dir, f), 'utf8'))
    : [];
  return [builtCatalog('en'), ...files].join('\n').replace(/\s+/g, '');
}

export function ruleFor(css: string, selector: string): string {
  const index = css.indexOf(`${selector}{`);
  expect(index, `rule ${selector} not found in built CSS`).toBeGreaterThan(-1);
  const open = css.indexOf('{', index);
  return css.slice(open, css.indexOf('}', open));
}

describe('FacetRail', () => {
  const html = builtCatalog('en');

  it('renders the four rail groups in decision-frequency order, risk first', () => {
    const order = [...html.matchAll(/data-facet-group="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('renders multi-select checkboxes named for their filter key', () => {
    expect(html).toMatch(/<input[^>]*data-facet-check[^>]*type="checkbox"[^>]*name="risk"[^>]*value="no-code-execution"/);
  });

  it('carries a count element on every facet row', () => {
    const rows = (html.match(/data-facet-value="/g) ?? []).length;
    const counts = (html.match(/data-facet-count/g) ?? []).length;
    expect(rows).toBeGreaterThan(0);
    expect(counts).toBe(rows);
  });

  it('counts only listed entries, so an evicted row cannot inflate the rail', () => {
    const rows = JSON.parse(readFileSync(resolve(root, 'data/skills.json'), 'utf8')) as { listed: boolean }[];
    const listed = rows.filter((row) => row.listed).length;
    const countOf = (value: string): number =>
      Number(html.match(new RegExp(`data-facet-value="${value}"[\\s\\S]*?data-facet-count>(\\d+)<`))?.[1] ?? -1);
    // Every skill emits exactly one of these two mutually exclusive risk values (§4.3), so their
    // sum is the size of the listing and nothing else.
    expect(countOf('no-code-execution') + countOf('executes-code')).toBe(listed);
  });

  it('tags each row with the key and value the controller needs', () => {
    expect(html).toMatch(/data-facet-key="risk"[^>]*data-facet-value="executes-code"/);
  });

  it('gives the rail an accessible name', () => {
    expect(html).toMatch(/<aside[^>]*data-facet-rail[^>]*aria-label="Filters"/);
  });

  it('translates the rail into pt-BR', () => {
    expect(builtCatalog('pt')).toContain('Risco e capacidade');
  });
});

describe('WCAG 2.5.8 target size and 2.4.11 focus clearance', () => {
  const css = allBuiltCss();

  // Asserts the requirement rather than a magic number: 2.5.8 sets a floor, so a row that grows
  // more comfortable must not read as a regression.
  function minPx(rule: string, property: 'min-height' | 'min-width'): number {
    const match = new RegExp(`${property}:(\\d+)px`).exec(rule);
    expect(match, `${property} missing from ${rule}`).toBeTruthy();
    return Number(match![1]);
  }

  it('gives .facet-row at least a 24x24 CSS px hit area', () => {
    expect(minPx(ruleFor(css, '.facet-row'), 'min-height')).toBeGreaterThanOrEqual(24);
    expect(minPx(ruleFor(css, '.facet-row'), 'min-width')).toBeGreaterThanOrEqual(24);
  });

  it('gives the checkbox itself a 24x24 box', () => {
    expect(ruleFor(css, '.facet-check')).toContain('min-height:24px');
    expect(ruleFor(css, '.facet-check')).toContain('min-width:24px');
  });

  it('keeps a focused row clear of the sticky header', () => {
    expect(ruleFor(css, '.facet-row')).toContain('scroll-margin-top:var(--header-h,3.5rem)');
  });
});

describe('the two Pagefind path values reach the browser', () => {
  it('ships baseUrl, bundlePath and the route path on every locale', () => {
    for (const lang of ['en', 'pt']) {
      const match = builtCatalog(lang).match(
        /<script type="application\/json" id="catalog-config">([\s\S]*?)<\/script>/,
      );
      expect(match, `catalog-config missing on /${lang}/catalog/`).toBeTruthy();
      const config = JSON.parse(match![1]);
      expect(config.baseUrl).toBe('/ai-tools-hub/');
      expect(config.bundlePath).toBe('/ai-tools-hub/pagefind/pagefind.js');
      expect(config.catalogPath).toBe(`/ai-tools-hub/${lang}/catalog/`);
    }
  });

  it('ships a chip label for every checkable value, so the client needs no i18n table', () => {
    const config = JSON.parse(
      builtCatalog('en').match(/<script type="application\/json" id="catalog-config">([\s\S]*?)<\/script>/)![1],
    );
    expect(config.labels.risk['no-code-execution']).toBe('Does not execute code');
    expect(Object.keys(config.labels).sort()).toEqual(['domain', 'license', 'risk', 'runtime', 'subdomain']);
  });
});
