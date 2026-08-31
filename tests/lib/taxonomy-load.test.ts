import { describe, expect, it } from 'vitest';
import { flattenTaxonomy, loadTaxonomy } from '../../src/lib/taxonomy.ts';

describe('loadTaxonomy', () => {
  it('reads the committed taxonomy regardless of cwd', () => {
    const tax = loadTaxonomy();
    expect(tax.domains).toHaveLength(13);
    expect(tax.minimumMass).toBe(4);
  });

  it('caches, returning the same object on a second call', () => {
    expect(loadTaxonomy()).toBe(loadTaxonomy());
  });
});

describe('flattenTaxonomy', () => {
  it('returns all 40 nodes, each domain immediately followed by its children', () => {
    const flat = flattenTaxonomy(loadTaxonomy());
    expect(flat).toHaveLength(40);
    expect(flat[0]?.slug).toBe('security');
    expect(flat[1]?.slug).toBe('security/code-application');
    expect(flat[16]?.slug).toBe('coding-software');
  });

  it('includes every security subdomain', () => {
    const slugs = flattenTaxonomy(loadTaxonomy()).map((n) => n.slug);
    expect(slugs).toContain('security/ai-agent-security');
    expect(slugs).toContain('security/general');
  });
});
