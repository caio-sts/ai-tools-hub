import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtCatalog } from './facet-rail.test.ts';
import { bundleFor } from './catalog-controller.test.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const railSource = readFileSync(resolve(root, 'src/components/FacetRail.astro'), 'utf8');
const html = builtCatalog('en');

/** The text of one @media block, whitespace-stripped, so a declaration can be located inside it. */
function mediaBlock(source: string, query: string): string {
  const at = source.indexOf(query);
  expect(at, `no @media block matching ${query}`).toBeGreaterThan(-1);
  const open = source.indexOf('{', at);
  let depth = 1;
  let k = open + 1;
  while (k < source.length && depth > 0) {
    if (source[k] === '{') depth += 1;
    else if (source[k] === '}') depth -= 1;
    k += 1;
  }
  return source.slice(open + 1, k - 1).replace(/\s+/g, '');
}

// At 390px the rail was a position:sticky nested scroller — 697px tall over 2007px of content —
// stacked ABOVE the results, so the first card sat 1247px down. The catalog opened on a phone as a
// full screen of checkboxes that scrolled inside themselves.
describe('the facet rail collapses on a narrow viewport', () => {
  it('wraps the rail in a disclosure that is open by default', () => {
    // Open in the markup so a narrow viewport without JavaScript still reaches the filters, and so
    // the desktop sidebar needs no script at all to be correct.
    expect(html).toMatch(/<details[^>]*data-facet-disclosure[^>]*\sopen/);
  });

  it('gives the disclosure a summary carrying the rail title', () => {
    expect(html).toContain('data-facet-summary');
    expect(html).toMatch(/data-facet-summary[\s\S]{0,400}Filters/);
  });

  it('carries a slot for the active-filter count', () => {
    expect(html).toContain('data-facet-active-count');
  });

  it('hides the summary once the sidebar has room, so desktop is unchanged', () => {
    expect(mediaBlock(railSource, '@media (min-width: 900px)')).toContain('.facet-summary{display:none');
  });

  it('stops the rail being a sticky nested scroller below that width', () => {
    const narrow = mediaBlock(railSource, '@media (max-width: 899px)');
    expect(narrow).toContain('position:static');
    expect(narrow).toContain('max-height:none');
    expect(narrow).toContain('overflow-y:visible');
  });

  it('closes the disclosure on a narrow viewport, and only there', () => {
    const js = bundleFor('catalog-config') ?? '';
    expect(js).toContain('max-width: 899px');
    expect(js).toContain('data-facet-disclosure');
  });

  it('paints the active count from the same state the chips come from', () => {
    expect(bundleFor('catalog-config') ?? '').toContain('data-facet-active-count');
  });
});

// WCAG 2.5.3, Label in Name: the accessible name must contain the visible label, or voice control
// cannot address the control. Shortening the visible label to "EN" while the accessible name stayed
// "Inglês" broke exactly that — "EN" appears nowhere in "Inglês".
describe('the shortened language labels stay addressable by voice', () => {
  const home = readFileSync(resolve(root, 'dist/pt/index.html'), 'utf8');

  it('keeps the visible code inside the accessible name', () => {
    for (const [code, short, full] of [['en', 'EN', 'Inglês'], ['pt', 'PT-BR', 'Português (Brasil)']]) {
      const tag = home.match(new RegExp(`<a[^>]*data-lang="${code}"[^>]*>`))?.[0] ?? '';
      const label = tag.match(/aria-label="([^"]*)"/)?.[1] ?? '';
      expect(label, `data-lang="${code}" has no aria-label`).not.toBe('');
      expect(label).toContain(short);
      expect(label).toContain(full);
    }
  });

  it('still renders both the short and the full label, so each width has one', () => {
    expect(home).toContain('lang-short');
    expect(home).toContain('lang-full');
  });
});
