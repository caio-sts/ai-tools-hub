import { defineConfig } from 'vitest/config';
// Deliberately NOT `import { BASE } from './astro.config.mjs'`: astro.config.mjs imports
// astro-pagefind, which ships its entry as raw TypeScript under node_modules, and Node refuses to
// type-strip that (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING). And deliberately not from
// src/lib/facets.ts either: that module imports the i18n barrel, which uses import.meta.glob, and
// Vite bundles this config with esbuild and runs it as plain ESM, where glob does not exist.
// src/lib/base.ts has no imports at all; tests/catalog/pagefind-base.test.ts asserts SITE_BASE and
// astro.config.mjs's `base` agree.
import { SITE_BASE } from './src/lib/base.ts';

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
