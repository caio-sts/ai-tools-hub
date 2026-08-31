import { describe, expect, it } from 'vitest';
import type { SortableCard } from '../../src/lib/facets.ts';
import { facetCount, pageNumbers, pageView, sortCards } from '../../src/lib/facets.ts';

const filters = { risk: { network: 3, 'reads-env': 1 }, runtime: { claude: 2 } };
const totalFilters = { risk: { network: 9, 'reads-env': 4 }, runtime: { claude: 7 } };

describe('facetCount', () => {
  it('uses the narrowed count for a key with nothing checked', () => {
    expect(facetCount('runtime', 'claude', { risk: ['network'] }, filters, totalFilters)).toBe(2);
  });

  it('uses the unfiltered count for a key that already has a selection, so OR siblings do not self-zero', () => {
    expect(facetCount('risk', 'reads-env', { risk: ['network'] }, filters, totalFilters)).toBe(4);
  });

  it('reports zero for a value that would return nothing', () => {
    expect(facetCount('runtime', 'cursor', {}, filters, totalFilters)).toBe(0);
  });

  it('reports zero for an entirely unknown key', () => {
    expect(facetCount('licence', 'MIT', {}, filters, totalFilters)).toBe(0);
  });
});

describe('pageView', () => {
  it('describes the first page of an exact fit', () => {
    expect(pageView(48, 1, 24)).toEqual({ page: 1, totalPages: 2, from: 0, to: 24, total: 48 });
  });

  it('clips the final partial page', () => {
    expect(pageView(30, 2, 24)).toEqual({ page: 2, totalPages: 2, from: 24, to: 30, total: 30 });
  });

  it('clamps a page past the end back to the last page', () => {
    expect(pageView(30, 9, 24).page).toBe(2);
  });

  it('always reports one page for an empty result set', () => {
    expect(pageView(0, 1, 24)).toEqual({ page: 1, totalPages: 1, from: 0, to: 0, total: 0 });
  });
});

describe('pageNumbers', () => {
  it('lists every page while they fit', () => {
    expect(pageNumbers(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('gaps to the end from the start', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, 'gap', 10]);
  });

  it('windows around the middle', () => {
    expect(pageNumbers(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
  });

  it('gaps from the start at the end', () => {
    expect(pageNumbers(10, 10)).toEqual([1, 'gap', 9, 10]);
  });

  it('never replaces page 2 with a gap', () => {
    expect(pageNumbers(2, 10)).toEqual([1, 2, 3, 'gap', 10]);
  });

  it('returns an empty list when there are no pages', () => {
    expect(pageNumbers(1, 0)).toEqual([]);
  });
});

describe('sortCards', () => {
  const cards: SortableCard[] = [
    { id: 'b', score: 90, stars: 500, forks: 3, newest: 200, updated: 5 },
    { id: 'a', score: 90, stars: 900, forks: 1, newest: 100, updated: 40 },
    { id: 'c', score: 77, stars: 10, forks: 9, newest: 300, updated: 1 },
  ];

  it('sorts by score descending, breaking ties on id for determinism', () => {
    expect(sortCards(cards, 'score').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by stars descending', () => {
    expect(sortCards(cards, 'stars').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by forks descending', () => {
    expect(sortCards(cards, 'forks').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts newest by indexing time descending', () => {
    expect(sortCards(cards, 'newest').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts updated by fewest days since the path changed', () => {
    expect(sortCards(cards, 'updated').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate the input array', () => {
    const copy = [...cards];
    sortCards(cards, 'stars');
    expect(cards).toEqual(copy);
  });
});
