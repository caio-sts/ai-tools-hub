// Astro `base` and Pagefind's own path config are separate settings that never consult each other.
// Both live here so CI can assert they agree; a silent disagreement 404s the search bundle.
//
// This module is imported by the catalog's client script, so it must stay free of Node built-ins:
// no `node:fs`, and no import of src/lib/taxonomy.ts or src/lib/data.ts.

export const SITE_BASE = '/ai-tools-hub/';
export const PAGEFIND_BASE_URL = SITE_BASE;
export const PAGEFIND_BUNDLE_PATH = `${SITE_BASE}pagefind/pagefind.js`;
