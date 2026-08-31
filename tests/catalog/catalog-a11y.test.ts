import { describe, expect, it } from 'vitest';
import { builtCatalog } from './facet-rail.test.ts';
import { bundleFor } from './catalog-controller.test.ts';
import { indexedSkillPages } from './pagefind-filters.test.ts';

describe('live facet counts', () => {
  const js = bundleFor('catalog-config') ?? '';

  it('reads both Pagefind count objects, not just the narrowed one', () => {
    expect(js).toContain('totalFilters');
    expect(js).toContain('filters');
  });

  it('writes counts back into every rail row', () => {
    expect(js).toContain('data-facet-count');
    expect(js).toContain('data-facet-value');
  });

  it('renders chips from the chip template with key and value attached', () => {
    expect(js).toContain('chip-template');
    expect(js).toContain('chipKey');
    expect(js).toContain('chipValue');
  });

  it('labels a chip from the serialized map rather than importing an i18n table', () => {
    expect(js).toContain('labels');
    expect(js).not.toContain('nodeName');
  });
});

describe('polite result announcement', () => {
  const js = bundleFor('catalog-config') ?? '';

  it('debounces the announcement rather than firing on every interaction', () => {
    expect(js).toMatch(/setTimeout\([^,]+,\s*300\)/);
    expect(js).toContain('clearTimeout');
  });

  it('moves focus to the results heading after clearing filters', () => {
    expect(js).toContain('results-heading');
    expect(js).toContain('focus()');
  });
});

describe('page-level accessibility contract', () => {
  it('declares the route language on the document so Pagefind picks the right index', () => {
    expect(builtCatalog('en')).toMatch(/<html[^>]*lang="en"/);
    expect(builtCatalog('pt')).toMatch(/<html[^>]*lang="pt-BR"/);
  });

  it('keeps the results heading focusable and distinct from the layout skip target', () => {
    expect(builtCatalog('en')).toMatch(/id="results-heading"[^>]*tabindex="-1"/);
  });

  it('keeps every one of the five flat filter keys live in the built index markup', () => {
    // Only the listed pages carry an index block (§5.1) — an evicted page has none to inspect.
    const pages = indexedSkillPages();
    for (const key of ['domain', 'subdomain', 'runtime', 'risk', 'license']) {
      expect(pages[0]).toContain(`data-pagefind-filter="${key}[`);
    }
  });
});
