import { describe, expect, it } from 'vitest';
import { expectTargetSize } from '../helpers/target-size.ts';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('active filter chips', () => {
  const html = builtCatalog('en');

  it('ships a labelled chip region that starts hidden', () => {
    expect(html).toMatch(/<div[^>]*data-chips[^>]*hidden[^>]*aria-label="Active filters"/);
  });

  it('ships a chip template with a label slot and an individual remove button', () => {
    expect(html).toContain('<template id="chip-template">');
    const template = html.slice(html.indexOf('<template id="chip-template">'));
    expect(template.slice(0, 600)).toContain('data-chip-label');
    expect(template.slice(0, 600)).toMatch(/<button[^>]*data-chip-remove/);
  });

  it('offers a clear-all control beside the chips', () => {
    const region = html.slice(html.indexOf('data-chips'));
    expect(region.slice(0, 900)).toMatch(/<button[^>]*data-clear-all[^>]*>Clear all filters<\/button>/);
  });

  it('gives the remove button an accessible name in both locales', () => {
    expect(html).toMatch(/data-chip-remove[^>]*aria-label="Remove filter"/);
    expect(builtCatalog('pt')).toMatch(/data-chip-remove[^>]*aria-label="Remover filtro"/);
  });

  it('gives chips and their remove buttons 24x24 hit areas', () => {
    const css = allBuiltCss();
    expectTargetSize(ruleFor(css, '.filter-chip'), '.filter-chip');
    expectTargetSize(ruleFor(css, '.chip-remove'), '.chip-remove');
  });
});
