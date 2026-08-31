import { describe, expect, it } from 'vitest';
import { expectTargetSize } from '../helpers/target-size.ts';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('numbered pagination', () => {
  const html = builtCatalog('en');

  it('renders a labelled pagination landmark', () => {
    expect(html).toMatch(/<nav[^>]*data-pagination[^>]*aria-label="Pagination"/);
  });

  it('renders page 1 as a real link to a distinct URL and marks it current', () => {
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/"[^>]*data-page="1"[^>]*aria-current="page"/);
  });

  it('never uses an infinite-scroll sentinel', () => {
    expect(html).not.toContain('data-infinite-scroll');
    expect(html).not.toContain('IntersectionObserver');
  });

  it('gives page links a 24px hit area', () => {
    expectTargetSize(ruleFor(allBuiltCss(), '.page-link'), '.page-link');
  });
});

describe('designed empty state', () => {
  const html = builtCatalog('en');

  it('ships an empty state that starts hidden', () => {
    expect(html).toMatch(/<div[^>]*data-empty[^>]*hidden>/);
  });

  it('says what an empty result actually means', () => {
    expect(html).toContain('No skills match these filters');
    expect(html).toContain('Every filter is a claim about the indexed data');
  });

  it('offers the way out inside the empty state', () => {
    const empty = html.slice(html.indexOf('data-empty'));
    expect(empty.slice(0, 800)).toMatch(/<button[^>]*data-clear-all[^>]*>Clear all filters<\/button>/);
  });

  it('translates the empty state into pt-BR', () => {
    expect(builtCatalog('pt')).toContain('Nenhuma skill corresponde a estes filtros');
  });
});
