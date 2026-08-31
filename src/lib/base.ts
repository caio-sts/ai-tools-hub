// The three path constants, in a module with no imports of its own.
//
// vitest.config.ts reads SITE_BASE from here and nowhere else: Vite bundles that config with
// esbuild and runs it as plain ESM, so anything it imports must be free of Vite-only features.
// src/lib/facets.ts re-exports these and does import the i18n barrel, which uses
// import.meta.glob — importing facets.ts from the config would fail at load time.
//
// Astro `base` and Pagefind's own path config are separate settings that never consult each
// other; tests/catalog/pagefind-base.test.ts asserts they agree, because a silent disagreement
// 404s the search bundle with no console error.

export const SITE_BASE = '/ai-tools-hub/';
export const PAGEFIND_BASE_URL = SITE_BASE;
export const PAGEFIND_BUNDLE_PATH = `${SITE_BASE}pagefind/pagefind.js`;
