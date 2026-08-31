import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const FILE = 'src/components/SearchBehavior.astro';

function source(): string {
  if (!existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  return readFileSync(FILE, 'utf8');
}

describe('SearchBehavior owns behaviour, never markup', () => {
  it('renders no input and no listbox of its own', () => {
    const text = source();
    expect(text, 'B3 owns the only search input on the site').not.toMatch(/<input/);
    expect(text).not.toMatch(/<ul/);
    expect(text).not.toContain("createElement('input')");
    expect(text).not.toContain("createElement('ul')");
    expect(text).not.toContain("'listbox'");
  });

  it('reaches B3 markup through the attributes B3 publishes', () => {
    const text = source();
    expect(text).toContain("querySelector<HTMLInputElement>('[data-search-input]')");
    expect(text).toContain("getAttribute('aria-controls')");
    expect(text, 'the listbox id belongs to B3, not to this file').not.toContain('catalog-suggestions');
  });

  it('creates the polite live region the announcer writes into', () => {
    const text = source();
    expect(text).toContain("setAttribute('aria-live', 'polite')");
    expect(text).toContain("setAttribute('aria-atomic', 'true')");
    expect(text).toContain('data-search-status');
    expect(text).toContain('data-search-rescue');
  });

  it('drives the combobox ARIA state from the pure reducer', () => {
    const text = source();
    expect(text).toContain("from '../lib/combobox.ts'");
    expect(text).toContain('aria-activedescendant');
    expect(text).toContain('aria-expanded');
  });

  it('imports the one Pagefind path derivation instead of building a second', () => {
    const text = source();
    expect(text).toContain("import { PAGEFIND_BUNDLE_PATH } from '../lib/facets.ts';");
    expect(text).not.toContain("'/pagefind/pagefind.js'");
  });

  it('loads the rescue index and the debounced announcer', () => {
    const text = source();
    expect(text).toContain("from '../lib/rescue.ts'");
    expect(text).toContain("from '../lib/announce.ts'");
    expect(text).toContain('rescue-index/');
  });

  it('is inert on a page that has no search input', () => {
    expect(source()).toMatch(/if \(input && listbox\)/);
  });
});
