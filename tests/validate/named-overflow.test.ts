import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkNamedOverflow } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 2 - named overflow', () => {
  it('passes: all 13 domains carry a general leaf', () => {
    expect(checkNamedOverflow(loadTaxonomy())).toEqual({ name: '2 named overflow', ok: true, errors: [] });
  });

  it('fails when a domain loses its general leaf', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children = [];
    const result = checkNamedOverflow(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['domain "productivity" has no named overflow leaf "productivity/general"']);
  });

  it('fails when the general leaf is missing a pt-BR label', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const general = security!.children!.find((c) => c.slug === 'security/general');
    general!.name.pt = '';
    const result = checkNamedOverflow(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('needs a non-empty name in both locales');
  });
});
