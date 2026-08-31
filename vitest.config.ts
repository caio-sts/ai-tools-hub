import { defineConfig } from 'vitest/config';
// Deliberately NOT `import { BASE } from './astro.config.mjs'`: Node loads this file with its own
// ESM loader, astro.config.mjs imports astro-pagefind, and that package ships its entry as raw
// TypeScript under node_modules — which Node refuses to type-strip
// (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). src/lib/facets.ts has no imports at all, and
// tests/catalog/pagefind-base.test.ts asserts SITE_BASE and astro.config.mjs's `base` agree.
import { SITE_BASE } from './src/lib/facets.ts';

export default defineConfig({
  // Vite fills import.meta.env.BASE_URL from this, so withBase() behaves in
  // tests exactly as it does in the built site.
  base: SITE_BASE,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 20_000,
  },
});
