import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkAliasMap } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 4 - alias map', () => {
  it('passes: all 9 aliases resolve to exactly one node', () => {
    expect(checkAliasMap(loadTaxonomy())).toEqual({ name: '4 alias map', ok: true, errors: [] });
  });

  it('fails when an alias points at a node that no longer exists', () => {
    const tax = mutable();
    tax.aliases.dast = 'offensive-security';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['alias "dast" points at "offensive-security", which is not a node']);
  });

  it('fails when an alias target is ambiguous across domains', () => {
    const tax = mutable();
    tax.aliases.overflow = 'general';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('which is ambiguous');
  });

  it('fails when an alias key shadows a real node slug', () => {
    const tax = mutable();
    tax.aliases['supply-chain'] = 'code-application';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('alias key "supply-chain" shadows a real node slug');
  });
});
