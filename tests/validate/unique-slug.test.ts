import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkUniqueSlug } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 3 - unique slug', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkUniqueSlug(loadTaxonomy())).toEqual({ name: '3 unique slug', ok: true, errors: [] });
  });

  it('catches a duplicated subdomain inside one domain', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/supply-chain', name: { en: 'Supply Chain again', pt: 'Supply Chain de novo' } });
    const result = checkUniqueSlug(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['duplicate slug "security/supply-chain"']);
  });

  it('catches a child that collides with a domain slug', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children!.push({ slug: 'security', name: { en: 'Security', pt: 'Segurança' } });
    const result = checkUniqueSlug(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['duplicate slug "security"']);
  });
});
