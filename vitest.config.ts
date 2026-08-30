import { defineConfig } from 'vitest/config';
import { BASE } from './astro.config.mjs';

export default defineConfig({
  // Vite fills import.meta.env.BASE_URL from this, so withBase() behaves in
  // tests exactly as it does in the built site.
  base: BASE,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    globalSetup: ['tests/global-setup.ts'],
    testTimeout: 20_000,
  },
});
