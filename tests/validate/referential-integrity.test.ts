import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkReferentialIntegrity, parseAssignments } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

const ID = 'trailofbits/skills@a1b2c3d:security/sbom/SKILL.md';

describe('check 6 - referential integrity', () => {
  it('passes on the committed taxonomy with no assignments yet', () => {
    expect(checkReferentialIntegrity(loadTaxonomy(), {})).toEqual({ name: '6 referential integrity', ok: true, errors: [] });
  });

  it('accepts an assignment with a resolvable primary and two also entries', () => {
    const assignments = {
      [ID]: { primary: 'security/supply-chain', also: ['security/cicd-pipeline', 'devops-infra/general'], tags: ['sbom', 'slsa'] },
    };
    expect(checkReferentialIntegrity(loadTaxonomy(), assignments).ok).toBe(true);
  });

  it('rejects a third also entry', () => {
    const assignments = {
      [ID]: { primary: 'security/supply-chain', also: ['security/cicd-pipeline', 'devops-infra/general', 'security/general'], tags: [] },
    };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": also has 3 entries, max is 2`);
  });

  it('rejects a primary that is a domain rather than a leaf', () => {
    const assignments = { [ID]: { primary: 'security', also: [], tags: [] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": primary "security" does not resolve to a leaf`);
  });

  it('rejects an also entry that repeats the primary', () => {
    const assignments = { [ID]: { primary: 'security/general', also: ['security/general'], tags: [] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": also repeats primary "security/general"`);
  });

  it('rejects an eleventh tag', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    const assignments = { [ID]: { primary: 'security/general', also: [], tags } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": tags has 11 entries, max is 10`);
  });

  it('rejects a tag that is a taxonomy slug, because tags never drive navigation', () => {
    const assignments = { [ID]: { primary: 'security/general', also: [], tags: ['security/supply-chain'] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": tag "security/supply-chain" is a taxonomy slug - tags never drive navigation`);
  });

  it('rejects a node named with a reserved Pagefind filter key', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/all', name: { en: 'All', pt: 'Todos' } });
    const result = checkReferentialIntegrity(tax, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/all" uses reserved Pagefind filter key "all"');
  });

  it('rejects a display name that is a reserved Pagefind filter key', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/general');
    node!.name.en = 'None';
    const result = checkReferentialIntegrity(tax, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/general" has reserved display name "None" (en)');
  });
});

describe('parseAssignments', () => {
  it('reads the canonical record keyed by skill id', () => {
    const raw = { [ID]: { primary: 'security/general', also: [], tags: ['sbom'] } };
    expect(parseAssignments(raw)).toEqual(raw);
  });

  it('defaults a missing also and tags to empty arrays', () => {
    expect(parseAssignments({ [ID]: { primary: 'security/general' } })).toEqual({
      [ID]: { primary: 'security/general', also: [], tags: [] },
    });
  });

  it('rejects the array shape outright', () => {
    expect(() => parseAssignments([{ id: ID, primary: 'security/general' }])).toThrow(
      'data/assignments.json must be a JSON object keyed by the skill id "owner/repo@sha:path", not an array',
    );
  });

  it('throws when a record has no primary', () => {
    expect(() => parseAssignments({ [ID]: {} })).toThrow(`assignment "${ID}" has no string "primary"`);
  });

  it('throws when also is not an array of strings', () => {
    expect(() => parseAssignments({ [ID]: { primary: 'security/general', also: 'security/general' } })).toThrow(
      `assignment "${ID}" has a non-string-array "also"`,
    );
  });
});
