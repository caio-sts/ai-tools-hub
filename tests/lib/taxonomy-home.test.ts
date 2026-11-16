import { describe, expect, it } from 'vitest';
import { homeDomains } from '../../src/lib/taxonomy.ts';
import type { Taxonomy, TaxonomyNode } from '../../src/types.ts';

function node(slug: string, children?: TaxonomyNode[]): TaxonomyNode {
  return { slug, name: { en: slug, pt: slug }, ...(children ? { children } : {}) };
}

function leaves(domain: string, ...names: string[]): TaxonomyNode[] {
  return names.map((name) => node(`${domain}/${name}`));
}

/** Synthetic: security deliberately not first, so the ordering rule is exercised. */
const taxonomy: Taxonomy = {
  domains: [
    node('coding-software', leaves('coding-software', 'code-review', 'testing', 'general')),
    node('productivity', leaves('productivity', 'general')),
    node('security', leaves('security', 'supply-chain', 'general')),
    node('vertical-domain'),
  ],
  protected: [],
  aliases: {},
  minimumMass: 4,
};

const slugs = (domains: TaxonomyNode[]) => domains.map((domain) => domain.slug);

describe('homeDomains', () => {
  it('expands every domain with a leaf besides its general overflow, security first', () => {
    expect(slugs(homeDomains(taxonomy).expanded)).toEqual(['security', 'coding-software']);
  });

  it('keeps a domain holding only its general leaf, or no children, as a tile, in taxonomy order', () => {
    expect(slugs(homeDomains(taxonomy).tiles)).toEqual(['productivity', 'vertical-domain']);
  });

  it('places every domain exactly once', () => {
    const { expanded, tiles } = homeDomains(taxonomy);
    expect([...slugs(expanded), ...slugs(tiles)].sort()).toEqual(slugs(taxonomy.domains).sort());
  });

  it('does not reorder the taxonomy it is given', () => {
    homeDomains(taxonomy);
    expect(slugs(taxonomy.domains)[0]).toBe('coding-software');
  });
});
