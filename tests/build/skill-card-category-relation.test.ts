import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { nodeName } from '../../src/lib/taxonomy.ts';
import { builtCatalog } from '../catalog/facet-rail.test.ts';
import { bundleFor } from '../catalog/catalog-controller.test.ts';

const LISTED = loadSkills().filter((skill) => skill.listed);

/** The chip element for one skill, out of the catalog page — the detail page suppresses it (B4.7). */
function chipFor(html: string, primary: string): string {
  const at = html.indexOf(`data-category="${primary}"`);
  expect(at, `no category chip for ${primary}`).toBeGreaterThan(-1);
  const open = html.lastIndexOf('<', at);
  return html.slice(open, html.indexOf('</p>', at) + 4);
}

function text(fragment: string): string {
  return fragment.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

// The chip was a bare leaf name with no label, so its meaning was ambiguous — and in a filtered
// list it read as wrong: filter by security/offensive-testing and `genotoxic` showed
// "General / Other", because its primary is coding-software/general and it matched through `also`.
describe('the category chip says what the relation is', () => {
  it('labels the chip, so a bare leaf name is never left to interpretation', () => {
    for (const lang of ['en', 'pt'] as const) {
      const html = builtCatalog(lang);
      const skill = LISTED[0]!;
      const chip = chipFor(html, skill.primary);
      expect(text(chip)).toContain(strings[lang]['skill.filedUnder']);
      expect(text(chip)).toContain(nodeName(skill.primary, lang));
    }
  });

  it('ships both labels on the element, so the client needs no i18n table to swap them', () => {
    const chip = chipFor(builtCatalog('pt'), LISTED[0]!.primary);
    expect(chip).toContain(`data-label-filed="${strings.pt['skill.filedUnder']}"`);
    expect(chip).toContain(`data-label-also="${strings.pt['skill.alsoIn']}"`);
  });

  it('carries the also slugs, which is what decides the relation', () => {
    const withAlso = LISTED.find((skill) => skill.also.length > 0);
    expect(withAlso, 'no listed entry has an also slug to test with').toBeDefined();
    const chip = chipFor(builtCatalog('en'), withAlso!.primary);
    expect(chip).toMatch(/data-also="[^"]/);
  });

  it('relabels client-side, because the catalog filters after the page is built', () => {
    // Assert the built form: the attributes are read through dataset, which the minifier renders
    // as the camelCase property, not as the attribute name written in the source.
    const js = bundleFor('catalog-config') ?? '';
    expect(js).toContain('labelAlso');
    expect(js).toContain('labelFiled');
    expect(js).toContain('data-field="category"');
    expect(js).toContain('data-category-key');
  });
});
