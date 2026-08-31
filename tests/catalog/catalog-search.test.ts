import { describe, expect, it } from 'vitest';
import { expectTargetSize } from '../helpers/target-size.ts';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('the catalog carries its own text filter', () => {
  const html = builtCatalog('en');

  it('renders a real search form on the catalog page itself', () => {
    expect(html).toMatch(/<form[^>]*data-catalog-search[^>]*method="get"/);
    expect(html).toMatch(/<input[^>]*data-search-input[^>]*type="search"[^>]*name="q"/);
  });

  it('renders exactly one search input, so nothing can steal the controller hook', () => {
    expect((html.match(/<input[^>]*data-search-input/g) ?? []).length).toBe(1);
    expect((builtCatalog('pt').match(/<input[^>]*data-search-input/g) ?? []).length).toBe(1);
  });

  it('ships the full combobox attribute set on that one input', () => {
    const input = html.match(/<input[^>]*data-search-input[^>]*>/)?.[0] ?? '';
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-controls="catalog-suggestions"');
    expect(input).toContain('aria-autocomplete="list"');
  });

  it('ships the empty listbox the combobox points at', () => {
    expect(html).toMatch(/<ul[^>]*id="catalog-suggestions"[^>]*role="listbox"[^>]*><\/ul>/);
  });

  it('labels the input visibly and ties the label to it', () => {
    expect(html).toMatch(/<label[^>]*for="catalog-q"[^>]*>Filter these results by text<\/label>/);
    expect(html).toMatch(/<input[^>]*id="catalog-q"/);
  });

  it('offers a clear control with an accessible name', () => {
    expect(html).toMatch(/<button[^>]*data-search-clear[^>]*aria-label="Clear the text filter"/);
  });

  it('translates the search chrome into pt-BR', () => {
    const pt = builtCatalog('pt');
    expect(pt).toContain('Filtrar estes resultados por texto');
    expect(pt).toMatch(/<input[^>]*placeholder="nome, caminho, tag ou repositório"/);
  });

  it('hides the control when JavaScript is off, because nothing could apply it', () => {
    expect(html).toMatch(/<noscript><style>[^<]*\[data-catalog-search\]\{display:none\}/);
  });

  it('gives the input and its clear button 24px hit areas', () => {
    const css = allBuiltCss();
    expect(ruleFor(css, '.catalog-search__input')).toContain('min-height:40px');
    expectTargetSize(ruleFor(css, '.catalog-search__clear'), '.catalog-search__clear');
  });
});
