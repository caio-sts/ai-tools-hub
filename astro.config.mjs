// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import pagefind from 'astro-pagefind';

// The one base-path literal in this repository. Everything that needs the base
// path imports BASE from here — including vitest.config.ts and, later, Pagefind.
// Spec §13: two independent base-path configs is the failure this prevents.
export const BASE = '/ai-tools-hub/';

// Project page: `site` is the origin only, `base` carries the repo path.
export default defineConfig({
  site: 'https://caio-sts.github.io',
  base: BASE,
  output: 'static',
  trailingSlash: 'always',
  vite: { plugins: [tailwindcss()] },
  integrations: [sitemap(), pagefind()],
});
