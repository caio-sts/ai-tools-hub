import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { flattenTaxonomy, loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { KNOWN_SLUGS, SLUG_REDIRECTS, checkSlugStability } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

function without(slug: string): Taxonomy {
  const tax = mutable();
  for (const domain of tax.domains) {
    domain.children = (domain.children ?? []).filter((c) => c.slug !== slug);
  }
  return tax;
}

describe('check 5 - versioned slugs and redirects', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkSlugStability(loadTaxonomy())).toEqual({ name: '5 slug stability', ok: true, errors: [] });
  });

  it('freezes all 40 slugs in KNOWN_SLUGS', () => {
    expect([...KNOWN_SLUGS].sort()).toEqual(flattenTaxonomy(loadTaxonomy()).map((n) => n.slug).sort());
  });

  it('every shipped redirect points from a frozen slug to a live one', () => {
    const live = new Set(flattenTaxonomy(loadTaxonomy()).map((n) => n.slug));
    for (const [from, to] of Object.entries(SLUG_REDIRECTS)) {
      expect(KNOWN_SLUGS, from).toContain(from);
      expect(live.has(from), `${from} is still live`).toBe(false);
      expect(live.has(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('ignores a display-name rewrite entirely', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cloud-permissions');
    node!.name.en = 'Cloud Posture Management';
    node!.name.pt = 'Gestão de Postura em Nuvem';
    expect(checkSlugStability(tax).ok).toBe(true);
  });

  it('fails when a display-name change drags the slug with it', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cloud-permissions');
    node!.slug = 'security/cloud-posture';
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('slug "security/cloud-posture" is not in KNOWN_SLUGS - add it deliberately, and add a SLUG_REDIRECTS entry if it renames an old slug');
    expect(result.errors).toContain('KNOWN_SLUGS lists "security/cloud-permissions" but the taxonomy no longer has it - add SLUG_REDIRECTS["security/cloud-permissions"] pointing at its replacement');
  });

  it('accepts a retired slug once a redirect takes its place', () => {
    const result = checkSlugStability(without('security/threat-modeling'), {
      'security/threat-modeling': 'security/general',
    });
    expect(result).toEqual({ name: '5 slug stability', ok: true, errors: [] });
  });

  it('rejects a redirect that points at a slug which is not live', () => {
    const result = checkSlugStability(without('security/threat-modeling'), {
      'security/threat-modeling': 'security/nowhere',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/threat-modeling" points at "security/nowhere", which is not a live slug');
  });

  it('rejects a redirect whose source is still live', () => {
    const result = checkSlugStability(loadTaxonomy(), { 'security/supply-chain': 'security/general' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/supply-chain" is still a live slug - remove the redirect or remove the node');
  });

  it('rejects a redirect from a slug that was never published', () => {
    const result = checkSlugStability(loadTaxonomy(), { 'security/never-existed': 'security/general' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/never-existed" is not in KNOWN_SLUGS - only a retired slug can redirect');
  });

  it('rejects a slug that is not lowercase kebab-case', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/Threat_Intel', name: { en: 'Threat Intel', pt: 'Inteligência de Ameaças' } });
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('child slug "security/Threat_Intel" must be "security/<kebab-case>"');
  });

  it('rejects a child whose slug is not prefixed by its parent domain', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children!.push({ slug: 'security/threat-modeling', name: { en: 'Threat Modeling', pt: 'Modelagem de Ameaças' } });
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('child slug "security/threat-modeling" must be "productivity/<kebab-case>"');
  });
});
