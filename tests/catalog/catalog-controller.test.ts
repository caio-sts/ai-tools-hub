import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtCatalog } from './facet-rail.test.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Returns the built client bundle containing `needle`, or null when no bundle references it. */
export function bundleFor(needle: string): string | null {
  const dir = resolve(root, 'dist/_astro');
  if (!existsSync(dir)) return null;
  const referenced = [...builtCatalog('en').matchAll(/src="[^"]*\/_astro\/([^"]+\.js)"/g)].map((m) => m[1]);
  const all = [...new Set([...referenced, ...readdirSync(dir).filter((f) => f.endsWith('.js'))])];
  for (const file of all) {
    const full = resolve(dir, file);
    if (!existsSync(full)) continue;
    const body = readFileSync(full, 'utf8');
    if (body.includes(needle)) return body;
  }
  return null;
}

describe('catalog controller bundle', () => {
  const js = bundleFor('catalog-config');

  it('ships a client bundle that reads the catalog config', () => {
    expect(js, 'no built bundle under dist/_astro references catalog-config').not.toBeNull();
  });

  it('loads the Pagefind bundle from the configured path, not a hard-coded one', () => {
    expect(js ?? '').toMatch(/import\([A-Za-z_$][\w$]*\.bundlePath\)/);
    expect(js ?? '').not.toContain('/pagefind/pagefind.js"');
  });

  it('sets Pagefind baseUrl from the same config before init', () => {
    expect(js ?? '').toMatch(/options\(\{\s*baseUrl:/);
    expect(js ?? '').toContain('.init()');
  });

  it('passes the text term when there is one and browses with null when there is not', () => {
    expect(js ?? '').toMatch(/\.search\([^,]*\|\|\s*null\s*,/);
  });

  it('asks Pagefind to sort rather than sorting in the DOM', () => {
    // The minifier rewrites 'desc' as a template literal, so accept a backtick quote too.
    expect(js ?? '').toMatch(/score:\s*["'`]desc["'`]/);
    expect(js ?? '').toMatch(/updated:\s*["'`]asc["'`]/);
  });

  it('resolves each result back onto its server-rendered card by skill id', () => {
    // The map is keyed by the item's own dataset.skillId, not by the selector that found it.
    expect(js ?? '').toContain('dataset.skillId');
    expect(js ?? '').toContain('meta');
  });

  it('renumbers rank on every render, because a static rank is ornament', () => {
    expect(js ?? '').toContain('data-rank');
  });

  it('keeps the URL authoritative with pushState and popstate', () => {
    expect(js ?? '').toContain('pushState');
    expect(js ?? '').toContain('popstate');
  });
});

// The catalog froze on the server-rendered first page: filters, search, sort and pagination all
// recomputed correctly — the rendered event carried the right result count — and nothing moved on
// screen. `data-skill-id` is on the <li> AND on the <details> inside it (the skill page needs it
// there), so a bare `[data-skill-id]` selector collected 120 elements and the inner <details>
// overwrote its own <li> in the card map. render() then hid and unhid the panel instead of the
// card, and `style.order` did nothing at all, because order only applies to a grid item.
describe('the card map is keyed to the grid item, not to a descendant of it', () => {
  const js = bundleFor('catalog-config');
  const html = builtCatalog('en');

  it('emits data-skill-id twice per card, so a bare selector is ambiguous', () => {
    const ids = [...html.matchAll(/data-skill-id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBe(new Set(ids).size * 2);
  });

  it('marks every grid item with data-catalog-item, which no descendant carries', () => {
    const items = [...html.matchAll(/\sdata-catalog-item[\s>]/g)];
    const ids = new Set([...html.matchAll(/data-skill-id="([^"]+)"/g)].map((m) => m[1]));
    expect(items.length).toBe(ids.size);
  });

  it('collects cards by that attribute', () => {
    expect(js ?? '').toContain('[data-catalog-item]');
  });

  it('never collects them with a bare [data-skill-id] selector', () => {
    expect((js ?? '').replace(/[`'"]/g, '"')).not.toContain('querySelectorAll("[data-skill-id]")');
  });
});
