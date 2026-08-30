# Foundation & Data Pipeline — Implementation Plan

> **Execution:** Implement task-by-task, in order. Every task ends with a passing test and a commit, so the plan can be stopped and resumed at any task boundary. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take an empty repository to a deployed GitHub Pages site whose design system is visible at `/styleguide`, whose taxonomy is validated in CI, and whose nightly GitHub Action harvests real agent skills from GitHub into a scored, committed `data/skills.json`.

**Architecture:** A static Astro 7 site published to a project page at `/ai-tools-hub/`. All indexing happens at build time — there is no server. The harvest runs as a separate scheduled Action (never inside the Pages build, which has a hard 10-minute deploy timeout) and commits its output, so the data file is a reviewable artifact and the committing cron keeps its own schedule alive. Scoring is a pure function over harvested facts, so it is unit-testable without any network.

**Tech Stack:** Astro 7.2.9 (static output) · Tailwind CSS 4.3.3 via `@tailwindcss/vite` (CSS-first `@theme`) · TypeScript 5 · Vitest 3 · Node 24 · GitHub Actions.

**Spec:** `docs/specs/2026-08-29-ai-tools-hub-design.md`

## Global Constraints

- **Base path is `/ai-tools-hub/`.** Every internal href goes through `withBase()` from `src/lib/link.ts`. Hand-written absolute hrefs work locally and 404 in production — spec §11.2 names this the single most common GitHub Pages failure.
- **`upload-pages-artifact` requires `include-hidden-files: true`.** Its default is `false`, which silently drops every dotfile, and Astro emits `_astro/`.
- **`GITHUB_TOKEN` cannot perform global code search** — it is repo-scoped. The crawl workflow requires a fine-grained PAT in `secrets.CATALOG_PAT` (spec §6.2).
- **Measured GitHub rate limits** (spec §6.2): `code_search` 10/min · `search` 30/min · `core` 5,000/hr · GraphQL 5,000 points/hr with 4 repos per point. Search results are hard-capped at 1,000 per query.
- **Skip git symlinks (`mode === '120000'`) and dedupe by blob SHA.** A sampled repo had 458 of 846 `SKILL.md` paths as symlinks; not skipping them inflates counts ~2× (spec §6.3).
- **Safety is derived, never declared.** `allowed-tools` is present on only 9% of real skills (spec §4.3). Never build UI requiring a field below 60% presence.
- **Safety is never an input to the score.** Executing code is a fact, not a fault (spec §5).
- **License needs the 3-tier fallback:** frontmatter → sibling `LICENSE*` → repo SPDX → `null`. `anthropics/skills` has 172,473 stars and repo `license: null` while shipping per-skill Apache-2.0 files (spec §4.3).
- **Node names are hand-written in both locales.** Terms in `PROTECTED` must appear in both or neither; CI check 7 enforces it (spec §3.5).
- **Never name a taxonomy node `all`, `any`, `none` or `not`** — reserved Pagefind filter keys that silently break filtering (spec §3.4).
- **Cron schedules must not fire at `:00`** — the schedule event is delayed or dropped under load. Always pair with `workflow_dispatch`.

---


### Task A1.1: npm project and Vitest harness

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `vitest.config.ts`
- Test: `tests/project/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing (first task in the repo; the working tree currently holds only `docs/`)
- Produces: `npm test` → `vitest run` over `tests/**/*.test.ts`; `package.json` with `"type": "module"` and `engines.node >= 22.18.0`; a `.gitignore` that ignores `node_modules/`, `dist/`, `.astro/` and **keeps `package-lock.json` committed** (the deploy workflow runs `npm ci`)

`"type": "module"` is load-bearing beyond taste: without it Vite bundles `vitest.config.ts` to CJS, and Task A1.3's `import { BASE } from './astro.config.mjs'` dies with `TypeError: (0 , import_sitemap.default) is not a function`.

`engines.node` is `>=22.18.0`, not Astro's own `>=22.12.0`: Tasks A3 and A6 run `node scripts/*.ts` unflagged, which needs Node's default TypeScript type stripping. CI pins Node 24.

- [ ] **Step 1: Write the failing test**

Create `tests/project/scaffold.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PackageJson {
  name: string;
  private: boolean;
  type: string;
  engines: { node: string };
  scripts: Record<string, string>;
}

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8'),
) as PackageJson;
const gitignore = readFileSync(fileURLToPath(new URL('.gitignore', root)), 'utf8');

describe('project scaffold', () => {
  it('is a private ES-module package', () => {
    expect(pkg.name).toBe('ai-tools-hub');
    expect(pkg.private).toBe(true);
    expect(pkg.type).toBe('module');
  });

  it('requires a Node that both Astro 7 and `node file.ts` support', () => {
    expect(pkg.engines.node).toBe('>=22.18.0');
  });

  it('runs the suite through vitest', () => {
    expect(pkg.scripts.test).toBe('vitest run');
  });

  it('ignores build output but keeps the lockfile committed', () => {
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('dist/');
    expect(gitignore).toContain('.astro/');
    expect(gitignore).not.toContain('package-lock.json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`

Expected: FAIL — there is no `package.json`, so npm cannot even find a test script:

```
npm error code ENOENT
npm error syscall open
npm error path /home/kyo/projects/ai-tools-hub/package.json
npm error errno -2
npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, open '/home/kyo/projects/ai-tools-hub/package.json'
```

- [ ] **Step 3: Create package.json**

Create `package.json`:

```json
{
  "name": "ai-tools-hub",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "Bilingual, security-first catalog of AI agent skills.",
  "engines": {
    "node": ">=22.18.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:

```gitignore
node_modules/
dist/
.astro/
.vercel/
.DS_Store
*.local
.env
.env.*
!.env.example
```

- [ ] **Step 5: Install Vitest**

Run: `npm install --save-dev vitest@3.2.7`

- [ ] **Step 6: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 20_000,
  },
});
```

Task A1.3 adds `base` and the single `globalSetup` build to this file, once Astro exists to run one.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test`

Expected: PASS — 4 passing tests in `tests/project/scaffold.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json .gitignore vitest.config.ts tests/project/scaffold.test.ts
git commit -m "chore: scaffold npm project and vitest harness"
```

---

### Task A1.2: Astro static install, the single base literal, and the base-check page

**Files:**
- Create: `astro.config.mjs`
- Create: `src/pages/base-check.astro`
- Modify: `package.json` (the `scripts` block)
- Test: `tests/config/astro-config.test.ts`

**Interfaces:**
- Consumes: `package.json` scripts block and `vitest.config.ts` from Task A1.1
- Produces: `astro.config.mjs` with `export const BASE = '/ai-tools-hub/'` — **the only base-path literal in the repository** — plus a default export carrying `site: 'https://caio-sts.github.io'`, `base: BASE`, `output: 'static'`, `trailingSlash: 'always'`; the route `/base-check/`; npm scripts `dev`, `build`, `preview`
- Does **not** create `src/pages/index.astro`. That file is B1's (the root redirect to the default locale); B1 consumes `withBase` from Task A1.7.

Spec §11.2: the site ships as a GitHub Pages **project page**. `site` carries the origin only and `base` carries the repo path — `@astrojs/sitemap` and Astro both compute absolute URLs as `new URL(base, site)`, so putting `/ai-tools-hub/` in `site` as well would emit `/ai-tools-hub/ai-tools-hub/`.

Spec §13 names "two independent base-path configs" as a live risk: Pagefind has its own `baseUrl`/`bundle-path` that must agree with Astro's `base`. The mitigation is written on day one — there is exactly one literal, exported as `BASE`, and the test below fails if a second one appears in the config. When B5 wires Pagefind it must pass `BASE`, not a hand-typed string.

`src/pages/base-check.astro` is a permanent build canary, not scaffolding: Astro needs at least one route to emit a sitemap, and from Task A1.8 this page is the end-to-end proof that `withBase()` picks up the configured base in a real build.

- [ ] **Step 1: Write the failing test**

Create `tests/config/astro-config.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config, { BASE } from '../../astro.config.mjs';

const source = readFileSync(
  fileURLToPath(new URL('../../astro.config.mjs', import.meta.url)),
  'utf8',
);

describe('astro.config.mjs', () => {
  it('serves from the project-page base path', () => {
    expect(BASE).toBe('/ai-tools-hub/');
    expect(config.base).toBe(BASE);
  });

  it('points site at the origin only, without the base path', () => {
    expect(config.site).toBe('https://caio-sts.github.io');
    expect(config.site).not.toContain('ai-tools-hub');
  });

  it('builds a fully static site (Pages has no rewrite rules)', () => {
    expect(config.output).toBe('static');
  });

  it('uses directory URLs with a trailing slash', () => {
    expect(config.trailingSlash).toBe('always');
  });

  // Spec §13: Pagefind's baseUrl must agree with Astro's base. It can only
  // disagree if someone writes the path twice, so the path is written once.
  it('declares the base path exactly once, as BASE', () => {
    const literals = source.match(/'\/ai-tools-hub\/'/g) ?? [];
    expect(
      literals,
      'the base path is written more than once; import BASE instead of retyping it',
    ).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/astro-config.test.ts`

Expected: FAIL, at collection rather than in an assertion:

```
Error: Cannot find module '../../astro.config.mjs' imported from '/home/kyo/projects/ai-tools-hub/tests/config/astro-config.test.ts'
```

- [ ] **Step 3: Install Astro**

Run: `npm install astro@7.2.9`

- [ ] **Step 4: Write the Astro config**

Create `astro.config.mjs`:

```js
// @ts-check
import { defineConfig } from 'astro/config';

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
});
```

- [ ] **Step 5: Add the build canary page**

Create `src/pages/base-check.astro`:

```astro
---
const title = 'base check';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{title}</title>
  </head>
  <body>
    <h1>{title}</h1>
  </body>
</html>
```

Task A1.8 rewrites the body to emit links built by `withBase()`.

- [ ] **Step 6: Add the Astro npm scripts**

In `package.json`, replace exactly this block:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
```

with:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/config/astro-config.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 8: Verify the build emits dist/**

Run: `npm run build && ls dist dist/base-check`

Expected: the build reports `1 page(s) built`, and `dist/base-check/index.html` is listed (`trailingSlash: 'always'` gives directory URLs, so there is no `dist/base-check.html`).

- [ ] **Step 9: Commit**

```bash
git add astro.config.mjs src/pages/base-check.astro package.json package-lock.json tests/config/astro-config.test.ts
git commit -m "feat: add astro static build with a single project-page base literal"
```

---

### Task A1.3: One `astro build` for the whole suite

**Files:**
- Create: `tests/global-setup.ts`
- Modify: `vitest.config.ts` (the whole file)
- Test: `tests/project/harness.test.ts`

**Interfaces:**
- Consumes: `astro.config.mjs` (`BASE`) and `src/pages/base-check.astro` from Task A1.2; `vitest.config.ts` from Task A1.1
- Produces: `tests/global-setup.ts`, which runs `astro build` **once** before the suite; `vitest.config.ts` declaring `base: BASE` and `globalSetup: ['tests/global-setup.ts']`; the repo-wide rule that **no test file spawns its own build** — build-output tests only read `dist/`

Vitest runs test *files* in parallel. If more than one file rebuilds `dist/` in `beforeAll`, every other file reading `dist/` is reading a directory being rewritten underneath it. One build, before anything runs, removes the race for every section: A2's style tests, B2's page tests, B3's catalog tests and B5's rescue-index test all read the same tree.

Setting Vite's `base` here is the second half of Task A1.2's single-literal rule: `import.meta.env.BASE_URL` is `/ai-tools-hub/` under Vitest exactly as it is in the built site, so `withBase()` can be unit-tested against its production value instead of a `/` stand-in.

- [ ] **Step 1: Write the failing test**

Create `tests/project/harness.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BASE } from '../../astro.config.mjs';
import vitestConfig from '../../vitest.config.ts';

const TESTS_DIR = fileURLToPath(new URL('../', import.meta.url));
const SELF = 'project/harness.test.ts';
const SETUP = 'global-setup.ts';

function testSources(): string[] {
  return readdirSync(TESTS_DIR, { recursive: true, encoding: 'utf8' })
    .map((entry) => entry.split('\\').join('/'))
    .filter((entry) => entry.endsWith('.ts'));
}

describe('test harness', () => {
  it('builds the site once, in globalSetup', () => {
    expect(vitestConfig.test?.globalSetup).toEqual(['tests/global-setup.ts']);
  });

  it('gives tests the BASE_URL the built site gets', () => {
    expect(vitestConfig.base).toBe(BASE);
    expect(import.meta.env.BASE_URL).toBe(BASE);
  });

  it('lets no other test spawn its own astro build', () => {
    const offenders = testSources().filter((relative) => {
      if (relative === SELF || relative === SETUP) {
        return false;
      }
      const source = readFileSync(`${TESTS_DIR}${relative}`, 'utf8');
      return source.includes('child_process') && /\bastro\b/.test(source);
    });
    expect(
      offenders,
      'these test files spawn their own astro build; read the globalSetup build in dist/ instead',
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/project/harness.test.ts`

Expected: FAIL — two of the three assertions, because `vitest.config.ts` still declares neither:

```
AssertionError: expected undefined to deeply equal [ 'tests/global-setup.ts' ]
AssertionError: expected undefined to be '/ai-tools-hub/'
```

- [ ] **Step 3: Write the global setup**

Create `tests/global-setup.ts`:

```ts
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// The suite's only `astro build`. Every test that inspects the built site reads
// dist/ as a fixture; none of them may rebuild it while another file is reading.
export default function setup(): void {
  execFileSync('npx', ['astro', 'build'], { cwd: ROOT, stdio: 'inherit' });
}
```

A failed build throws here, so the whole run stops with the Astro error rather than a wall of confusing missing-file assertions.

- [ ] **Step 4: Wire the config**

Replace the whole of `vitest.config.ts` with:

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/project/harness.test.ts`

Expected: PASS — 3 passing tests, and the Astro build log appears once, before the run.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS — `scaffold`, `astro-config` and `harness` all pass, with exactly one `[build] Complete!` line in the output.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts tests/global-setup.ts tests/project/harness.test.ts
git commit -m "test: build the site once in globalSetup instead of per test file"
```

---

### Task A1.4: Sitemap output asserted against the built site

**Files:**
- Modify: `astro.config.mjs` (add the integration)
- Test: `tests/build/output.test.ts`

**Interfaces:**
- Consumes: `astro.config.mjs` and `src/pages/base-check.astro` from Task A1.2; the single build from Task A1.3
- Produces: `dist/sitemap-index.xml` and `dist/sitemap-0.xml` on every build; `tests/build/output.test.ts`, which **only reads** `dist/`

Spec §11.3 cuts SEO to exactly this one integration.

- [ ] **Step 1: Install the sitemap integration**

Run: `npm install @astrojs/sitemap@3.7.3`

- [ ] **Step 2: Write the failing test**

Create `tests/build/output.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// dist/ is built once by tests/global-setup.ts. Never rebuild it here.
const distFile = (file: string): string =>
  fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));

describe('sitemap output', () => {
  it('emits a sitemap index', () => {
    expect(existsSync(distFile('sitemap-index.xml'))).toBe(true);
  });

  it('lists URLs under the project-page base path', () => {
    const xml = readFileSync(distFile('sitemap-0.xml'), 'utf8');
    expect(xml).toContain('https://caio-sts.github.io/ai-tools-hub/');
    expect(xml).not.toContain('ai-tools-hub/ai-tools-hub');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/build/output.test.ts`

Expected: FAIL — the globalSetup build succeeds, but the integration is not wired, so no sitemap is written:

```
AssertionError: expected false to be true
```

and the second test errors with `ENOENT: no such file or directory, open '/home/kyo/projects/ai-tools-hub/dist/sitemap-0.xml'`.

- [ ] **Step 4: Wire the integration**

Replace the whole of `astro.config.mjs` with:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

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
  integrations: [sitemap()],
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/build/output.test.ts`

Expected: PASS — 2 passing tests, with `[@astrojs/sitemap] \`sitemap-index.xml\` created at \`dist\`` in the setup build log.

- [ ] **Step 6: Commit**

```bash
git add astro.config.mjs package.json package-lock.json tests/build/output.test.ts
git commit -m "feat: emit a sitemap from the astro build"
```

---

### Task A1.5: Strict TypeScript config and a typecheck gate

**Files:**
- Create: `tsconfig.json`
- Modify: `package.json` (the `scripts` block)
- Test: `tests/project/typecheck.test.ts`

**Interfaces:**
- Consumes: `package.json` scripts block from Task A1.2; the `astro` package (which supplies `astro/tsconfigs/strict` and the `astro/client` ambient types) from Task A1.2
- Produces: npm script `typecheck` → `tsc --noEmit`; `allowImportingTsExtensions` is on, so **every relative TypeScript import in this repo is written with an explicit `.ts` extension** — that is what lets `node scripts/*.ts` run the same files Vitest and Astro load

- [ ] **Step 1: Install TypeScript**

Run: `npm install --save-dev typescript@5.9.3`

- [ ] **Step 2: Write the failing test**

Create `tests/project/typecheck.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

describe('typescript project', () => {
  it('typechecks with no errors', () => {
    const result = spawnSync('npm', ['run', '--silent', 'typecheck'], {
      cwd: root,
      encoding: 'utf8',
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    // tsc prints diagnostics on stdout; `npm run --silent` prints nothing at all
    // for a missing script, so the exit status is the assertion that catches that.
    expect(output).toBe('');
    expect(result.status).toBe(0);
  }, 180_000);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/project/typecheck.test.ts`

Expected: FAIL — `package.json` has no `typecheck` script, so npm exits 1 while `--silent` suppresses all output:

```
AssertionError: expected 1 to be +0
```

- [ ] **Step 4: Write the TypeScript config**

Create `tsconfig.json`:

```json
{
  "extends": "astro/tsconfigs/strict",
  "compilerOptions": {
    "noEmit": true,
    "allowJs": true,
    "allowImportingTsExtensions": true,
    "types": ["astro/client"]
  },
  "include": [
    "src/**/*.ts",
    "scripts/**/*.ts",
    "tests/**/*.ts",
    "astro.config.mjs",
    "vitest.config.ts"
  ],
  "exclude": ["node_modules", "dist", ".astro"]
}
```

- [ ] **Step 5: Add the typecheck script**

In `package.json`, replace exactly this block:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
```

with:

```json
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "typecheck": "tsc --noEmit"
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/project/typecheck.test.ts`

Expected: PASS — 1 passing test. `tsc` covers `astro.config.mjs` and `vitest.config.ts` too, so the `BASE` import between them is typechecked.

- [ ] **Step 7: Verify the whole suite is still green**

Run: `npm test`

Expected: PASS — `scaffold`, `astro-config`, `harness`, `output` and `typecheck` all pass.

- [ ] **Step 8: Commit**

```bash
git add tsconfig.json package.json package-lock.json tests/project/typecheck.test.ts
git commit -m "chore: add strict typescript config and typecheck script"
```

---

### Task A1.6: Shared catalog types

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

**Interfaces:**
- Consumes: `tsconfig.json` and the `typecheck` npm script from Task A1.5
- Produces: `src/types.ts` exporting `Lang`, `Runtime`, `TreeFile`, `RepoRef`, `Collection`, `Safety`, `ScoreBreakdown`, `RawSkill`, `Skill`, `TaxonomyNode`, `Taxonomy`, `Meta`, `Assignment`, `Assignments` — the only place any of these is declared. A6's `src/lib/data.ts` imports `Skill`, `Collection`, `Meta` and `Assignments` from here for `loadSkills(): Skill[]`, `loadCollections(): Collection[]`, `loadMeta(): Meta`, `loadAssignments(): Assignments`. A6's `scripts/harvest/run.ts` imports `Assignment` from here too — nothing outside this file re-declares any of them.

The types are erased at runtime, so `tsc --noEmit` is one red/green signal — but the test also does a runtime `import()` of the module, so `npx vitest run` is red before the file exists and green after, and the fixtures lock in the field semantics (`id` shape, `also` cap, breakdown caps and sum, assignment keying).

`Runtime` is written in `RUNTIME_ORDER` — claude, openclaw, codex, cursor, generic — and deliberately does **not** export a `RUNTIME_ORDER` constant; that lives in `src/lib/safety.ts` (A5). Nothing sorts runtimes alphabetically.

- [ ] **Step 1: Write the failing test**

Create `tests/types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  Assignments,
  Collection,
  Lang,
  Meta,
  RawSkill,
  RepoRef,
  Runtime,
  Safety,
  ScoreBreakdown,
  Skill,
  Taxonomy,
  TreeFile,
} from '../src/types.ts';

const langs: Lang[] = ['en', 'pt'];
const runtimes: Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

const treeFile: TreeFile = {
  path: 'security/sbom/SKILL.md',
  mode: '100644',
  sha: '9f8e7d6',
  type: 'blob',
};

const repoRef: RepoRef = { repo: 'trailofbits/skills', stars: 6908 };

const collection: Collection = {
  repo: 'trailofbits/skills',
  stars: 6908,
  forks: 412,
  pushedAt: '2026-08-20T11:04:00Z',
  license: 'Apache-2.0',
  topics: ['agent-skills', 'security'],
  isOrg: true,
  curated: true,
};

const safety: Safety = {
  executesCode: true,
  scriptCount: 2,
  languages: ['python'],
  network: true,
  readsEnv: false,
  declaredTools: null,
};

const breakdown: ScoreBreakdown = {
  adoption: 20,
  maintenance: 26,
  provenance: 25,
  completeness: 20,
  total: 91,
};

const rawSkill: RawSkill = {
  repo: 'trailofbits/skills',
  path: 'security/sbom/SKILL.md',
  sha: 'a1b2c3d',
  blobSha: '9f8e7d6',
  frontmatter: { name: 'sbom-audit', license: 'Apache-2.0' },
  body: '# SBOM audit\n',
  updatedDays: 12,
};

const skill: Skill = {
  id: 'trailofbits/skills@a1b2c3d:security/sbom/SKILL.md',
  type: 'skill',
  name: 'sbom-audit',
  description: 'Audits a generated SBOM against known malicious package advisories.',
  descriptionPt: null,
  longPt: null,
  repo: 'trailofbits/skills',
  path: 'security/sbom/SKILL.md',
  sha: 'a1b2c3d',
  updatedDays: 12,
  indexedAt: '2026-08-29',
  license: 'Apache-2.0',
  licenseSource: 'sibling',
  portable: true,
  runtimes: ['claude', 'openclaw'],
  safety,
  primary: 'security/supply-chain',
  also: ['devops-infra/general'],
  tags: ['sbom', 'slsa'],
  securityRelevant: true,
  score: 91,
  breakdown,
};

const assignments: Assignments = {
  [skill.id]: {
    primary: 'security/supply-chain',
    also: ['devops-infra/general'],
    tags: ['sbom', 'slsa'],
  },
};

const meta: Meta = {
  crawledAt: '2026-08-29T02:07:00Z',
  classifiedAt: null,
  skillCount: 1,
  sourceCount: 1,
};

const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        {
          slug: 'security/supply-chain',
          name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' },
          frameworkRefs: ['OWASP A03:2025'],
        },
        {
          slug: 'security/general',
          name: { en: 'General / Other', pt: 'Geral / Outros' },
        },
      ],
    },
  ],
  protected: ['CI/CD', 'Supply Chain'],
  aliases: { sca: 'supply-chain' },
  minimumMass: 5,
};

describe('shared types', () => {
  it('resolves as a real module at runtime', async () => {
    await expect(import('../src/types.ts')).resolves.toBeDefined();
  });

  it('keys a skill as owner/repo@sha:path', () => {
    expect(skill.id).toBe(`${skill.repo}@${skill.sha}:${skill.path}`);
  });

  it('caps secondary placement at two nodes', () => {
    expect(skill.also.length).toBeLessThanOrEqual(2);
    expect(skill.tags.length).toBeLessThanOrEqual(10);
  });

  it('keeps every score component inside its weight, summing to the total', () => {
    expect(breakdown.adoption).toBeLessThanOrEqual(25);
    expect(breakdown.maintenance).toBeLessThanOrEqual(30);
    expect(breakdown.provenance).toBeLessThanOrEqual(25);
    expect(breakdown.completeness).toBeLessThanOrEqual(20);
    expect(
      breakdown.adoption + breakdown.maintenance + breakdown.provenance + breakdown.completeness,
    ).toBe(breakdown.total);
    expect(skill.score).toBe(breakdown.total);
  });

  it('keys assignments by the skill id, not by an array index', () => {
    expect(Object.keys(assignments)).toEqual([skill.id]);
    expect(assignments[skill.id]?.primary).toBe(skill.primary);
  });

  it('lets meta report an unclassified crawl', () => {
    expect(meta.classifiedAt).toBeNull();
    expect(meta.crawledAt).not.toBe('');
  });

  it('allows an undeclared tool list', () => {
    expect(safety.declaredTools).toBeNull();
  });

  it('carries only real blobs, never symlinks', () => {
    expect(treeFile.mode).not.toBe('120000');
    expect(repoRef.stars).toBeGreaterThanOrEqual(10);
  });

  it('covers both locales and all five runtimes in RUNTIME_ORDER', () => {
    expect(langs).toEqual(['en', 'pt']);
    expect(runtimes).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });

  it('round-trips through JSON unchanged', () => {
    const payload = { skill, collection, rawSkill, taxonomy, assignments, meta };
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`

Expected: FAIL — `resolves as a real module at runtime` fails, with the underlying cause printed as:

```
Caused by: Error: Cannot find module '../src/types.ts' imported from '/home/kyo/projects/ai-tools-hub/tests/types.test.ts'
```

Run: `npm run typecheck`

Expected: FAIL — `tsc` exits 2 and prints `error TS2307: Cannot find module '../src/types.ts' or its corresponding type declarations.`

- [ ] **Step 3: Write the types module**

Create `src/types.ts`:

```ts
export type Lang = 'en' | 'pt';

// Written in RUNTIME_ORDER, never alphabetically. The constant itself lives in
// src/lib/safety.ts; this union only fixes the order everything else displays.
export type Runtime = 'claude' | 'openclaw' | 'codex' | 'cursor' | 'generic';

export interface TreeFile { path: string; mode: string; sha: string; type: string; }
export interface RepoRef { repo: string; stars: number; }

// data/collections.json is a bare Collection[] — the only place stars and forks live.
export interface Collection {
  repo: string; stars: number; forks: number; pushedAt: string;
  license: string | null; topics: string[]; isOrg: boolean; curated: boolean;
}

export interface Safety {
  executesCode: boolean; scriptCount: number; languages: string[];
  network: boolean; readsEnv: boolean; declaredTools: string[] | null;
}

export interface ScoreBreakdown {
  adoption: number;      // 0-25
  maintenance: number;   // 0-30
  provenance: number;    // 0-25
  completeness: number;  // 0-20
  total: number;         // 0-100, and always === Skill.score
}

export interface RawSkill {
  repo: string; path: string; sha: string; blobSha: string;
  frontmatter: Record<string, unknown>; body: string; updatedDays: number;
}

// data/skills.json is a bare Skill[].
export interface Skill {
  id: string;                 // "owner/repo@sha:path"
  type: 'skill';
  name: string;
  description: string;
  descriptionPt: string | null;
  longPt: string | null;
  repo: string; path: string; sha: string;
  updatedDays: number;        // per PATH, not per repo
  indexedAt: string;          // ISO date
  license: string | null;
  licenseSource: 'frontmatter' | 'sibling' | 'repo' | null;
  portable: boolean;
  runtimes: Runtime[];
  safety: Safety;
  primary: string;            // "security/supply-chain"
  also: string[];             // max 2
  tags: string[];             // max 10
  securityRelevant: boolean;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface TaxonomyNode {
  slug: string;               // "security/supply-chain" for children, "security" for domains
  name: { en: string; pt: string };
  children?: TaxonomyNode[];
  frameworkRefs?: string[];
}

export interface Taxonomy {
  domains: TaxonomyNode[];
  protected: string[];
  aliases: Record<string, string>;
  minimumMass: number;        // 5
}

// data/assignments.json is an Assignments object keyed by Skill.id — never an array.
export interface Assignment {
  primary: string;
  also: string[];
  tags: string[];
}
export type Assignments = Record<string, Assignment>;

// data/meta.json is one Meta object. classifiedAt is null until the first
// classification pass runs, so the staleness banner can report the two lags apart.
export interface Meta {
  crawledAt: string;
  classifiedAt: string | null;
  skillCount: number;
  sourceCount: number;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/types.test.ts`

Expected: PASS — typecheck prints nothing and 10 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared catalog types"
```

---

### Task A1.7: Base-aware link helper

**Files:**
- Create: `src/lib/link.ts`
- Test: `tests/lib/link.test.ts`

**Interfaces:**
- Consumes: `tsconfig.json` (`types: ["astro/client"]`, which types `import.meta.env.BASE_URL`) from Task A1.5; `base: BASE` in `vitest.config.ts` from Task A1.3
- Produces: `withBase(path: string): string` and `joinBase(base: string, path: string): string` from `src/lib/link.ts` — **every internal href in this project goes through `withBase`**; a hand-written `href="/skills/…"` works locally and 404s on Pages (spec §11.2, §13)

`joinBase` is the pure core, so an empty base and a root base stay testable; `withBase` binds it to `import.meta.env.BASE_URL`, which Astro fills from `base` at build time and Vitest fills from the same `BASE` constant. That is why the unit test can assert the production value directly instead of a `/` stand-in — and Task A1.8 still proves it end to end in real emitted HTML.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/link.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BASE } from '../../astro.config.mjs';
import { joinBase, withBase } from '../../src/lib/link.ts';

describe('joinBase', () => {
  it('prefixes a configured project-page base', () => {
    expect(joinBase('/ai-tools-hub/', '/en/')).toBe('/ai-tools-hub/en/');
  });

  it('accepts a base written without a trailing slash', () => {
    expect(joinBase('/ai-tools-hub', '/en/security/')).toBe('/ai-tools-hub/en/security/');
  });

  it('accepts a path written without a leading slash', () => {
    expect(joinBase('/ai-tools-hub/', 'en/')).toBe('/ai-tools-hub/en/');
  });

  it('keeps the base root reachable', () => {
    expect(joinBase('/ai-tools-hub/', '/')).toBe('/ai-tools-hub/');
    expect(joinBase('/ai-tools-hub/', '')).toBe('/ai-tools-hub/');
  });

  it('is a no-op for an empty base', () => {
    expect(joinBase('', '/en/')).toBe('/en/');
  });

  it('is a no-op for a root base', () => {
    expect(joinBase('/', '/en/')).toBe('/en/');
    expect(joinBase('/', '/')).toBe('/');
  });

  it('never doubles a slash', () => {
    expect(joinBase('/ai-tools-hub/', '/en/')).not.toContain('//');
    expect(joinBase('/ai-tools-hub', 'en/')).not.toContain('//');
  });
});

describe('withBase', () => {
  it('reads the same BASE the astro config declares', () => {
    expect(import.meta.env.BASE_URL).toBe(BASE);
  });

  it('produces the paths the deployed project page serves', () => {
    expect(withBase('/')).toBe('/ai-tools-hub/');
    expect(withBase('/en/')).toBe('/ai-tools-hub/en/');
    expect(withBase('/pt/security/supply-chain/')).toBe('/ai-tools-hub/pt/security/supply-chain/');
  });

  it('returns an absolute in-site path', () => {
    expect(withBase('/en/security/')).toMatch(/^\/[^/]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/link.test.ts`

Expected: FAIL, at collection:

```
Error: Cannot find module '../../src/lib/link.ts' imported from '/home/kyo/projects/ai-tools-hub/tests/lib/link.test.ts'
```

- [ ] **Step 3: Write the helper**

Create `src/lib/link.ts`:

```ts
const BASE: string = import.meta.env.BASE_URL ?? '/';

// Pure core, so an empty base and a root base stay testable without a build.
export function joinBase(base: string, path: string): string {
  const prefix = base.replace(/\/+$/, '');
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${prefix}${suffix}`;
}

export function withBase(path: string): string {
  return joinBase(BASE, path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/link.test.ts`

Expected: PASS — 10 passing tests.

- [ ] **Step 5: Verify it typechecks**

Run: `npm run typecheck`

Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/link.ts tests/lib/link.test.ts
git commit -m "feat: add base-aware link helper"
```

---

### Task A1.8: `withBase` proven in the emitted HTML

**Files:**
- Modify: `src/pages/base-check.astro` (the whole file)
- Modify: `tests/build/output.test.ts` (append a `describe` block after the closing `});` of the `sitemap output` block)
- Test: `tests/build/output.test.ts`

**Interfaces:**
- Consumes: `withBase(path: string): string` from `src/lib/link.ts` (Task A1.7); `astro.config.mjs` `base: BASE` (Task A1.2); the single build from `tests/global-setup.ts` (Task A1.3)
- Produces: `dist/base-check/index.html` — the deployed, CI-asserted proof that the link helper and Astro's `base` agree (spec §13, "two independent base-path configs")

This is the end-to-end half of the base-path mitigation: the unit test in Task A1.7 proves `withBase` against `import.meta.env.BASE_URL`, and this one proves the value Astro actually injected at build time. B1's `src/pages/index.astro` — the real root redirect to `/en/` — consumes the same helper.

Astro 7 rewrites markup during the build (it emits `data-astro-cid-*` attributes on any component with scoped styles and normalises the doctype), so the assertions below are on `href` and `data-check` attributes only, never on a literal `class` string.

- [ ] **Step 1: Write the failing test**

Append to `tests/build/output.test.ts`, after the closing `});` of the `sitemap output` block:

```ts

describe('base-aware links in the built HTML', () => {
  const html = (): string => readFileSync(distFile('base-check/index.html'), 'utf8');

  it('prefixes every generated href with the project-page base', () => {
    expect(html()).toContain('href="/ai-tools-hub/"');
    expect(html()).toContain('href="/ai-tools-hub/en/"');
    expect(html()).toContain('href="/ai-tools-hub/pt/"');
  });

  it('emits no root-relative href that would 404 on Pages', () => {
    expect(html()).not.toContain('href="/en/"');
    expect(html()).not.toContain('href="/pt/"');
  });

  it('never doubles the base path', () => {
    expect(html()).not.toContain('/ai-tools-hub/ai-tools-hub/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/output.test.ts`

Expected: FAIL — exactly one failing test. The page built in Task A1.2 has no links at all, so the first `toContain` misses:

```
 FAIL  tests/build/output.test.ts > base-aware links in the built HTML > prefixes every generated href with the project-page base
```

The `AssertionError` printed under that line quotes the whole one-line minified document as its received value — the point is that no `href` appears anywhere in it. The other two new tests pass vacuously: a document with no links contains no root-relative link and no doubled base either.

- [ ] **Step 3: Rewrite the canary page**

Replace the whole of `src/pages/base-check.astro` with:

```astro
---
import { withBase } from '../lib/link.ts';

// Every link on this page is written by withBase(). If Astro's `base` and the
// helper ever disagree, tests/build/output.test.ts fails before deploy.
const root = withBase('/');
const locales = ['en', 'pt'].map((lang) => ({ lang, href: withBase(`/${lang}/`) }));
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>base check</title>
  </head>
  <body>
    <h1>base check</h1>
    <p>Every link below was written by <code>withBase()</code>.</p>
    <ul>
      <li><a data-check="root" href={root}>{root}</a></li>
      {locales.map(({ lang, href }) => (
        <li><a data-check={lang} href={href}>{href}</a></li>
      ))}
    </ul>
  </body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/build/output.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 5: Inspect the emitted HTML by hand once**

Run: `grep -o 'href="/ai-tools-hub/[a-z]*/*"' dist/base-check/index.html`

Expected: three lines — `href="/ai-tools-hub/"`, `href="/ai-tools-hub/en/"`, `href="/ai-tools-hub/pt/"`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/base-check.astro tests/build/output.test.ts
git commit -m "feat: prove withBase against the configured base in the built html"
```

---

### Task A1.9: GitHub Pages deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`
- Test: `tests/workflows/deploy.test.ts`

**Interfaces:**
- Consumes: npm script `build` → `astro build` (Task A1.2); `package-lock.json`, kept out of `.gitignore` by Task A1.1, which `npm ci` requires
- Produces: `.github/workflows/deploy.yml` — a two-job Pages deployment with `permissions: {contents: read, pages: write, id-token: write}`, `concurrency: {group: pages, cancel-in-progress: false}`, `upload-pages-artifact@v5.0.0` with `include-hidden-files: true`, and a `workflow_dispatch` trigger

`include-hidden-files` defaults to **false** and silently drops `dist/_astro/`, producing a deployed site with no CSS or JS and no error anywhere (spec §11.1). The test pins it.

- [ ] **Step 1: Install a YAML parser for the test**

Run: `npm install --save-dev yaml@2.9.0`

- [ ] **Step 2: Write the failing test**

Create `tests/workflows/deploy.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface Step {
  name?: string;
  id?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  'runs-on': string;
  needs?: string;
  steps?: Step[];
}

interface Workflow {
  name: string;
  // The `yaml` package is YAML 1.2, which keeps `on` a plain string key
  // (YAML 1.1 parsers fold it into boolean true).
  on: Record<string, unknown>;
  permissions: Record<string, string>;
  concurrency: Record<string, unknown>;
  jobs: Record<string, Job>;
}

const file = fileURLToPath(new URL('../../.github/workflows/deploy.yml', import.meta.url));
const workflow = parse(readFileSync(file, 'utf8')) as Workflow;
const buildSteps = workflow.jobs.build.steps ?? [];

function stepUsing(prefix: string): Step {
  const step = buildSteps.find((candidate) => (candidate.uses ?? '').startsWith(prefix));
  if (step === undefined) {
    throw new Error(`no build step uses ${prefix}`);
  }
  return step;
}

describe('deploy.yml', () => {
  it('runs on pushes to the default branch and on demand', () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(['push', 'workflow_dispatch']),
    );
    expect((workflow.on.push as { branches: string[] }).branches).toEqual(['main', 'master']);
  });

  it('requests exactly the permissions an OIDC Pages deploy needs', () => {
    expect(workflow.permissions).toEqual({
      contents: 'read',
      pages: 'write',
      'id-token': 'write',
    });
  });

  it('queues deployments instead of cancelling them', () => {
    expect(workflow.concurrency).toEqual({ group: 'pages', 'cancel-in-progress': false });
  });

  it('uploads hidden files so _astro/ survives', () => {
    const upload = stepUsing('actions/upload-pages-artifact@');
    expect(upload.uses).toBe('actions/upload-pages-artifact@v5.0.0');
    expect(upload.with).toEqual({ path: './dist', 'include-hidden-files': true });
  });

  it('pins every action to the agreed version', () => {
    expect(stepUsing('actions/checkout@').uses).toBe('actions/checkout@v5');
    expect(stepUsing('actions/setup-node@').uses).toBe('actions/setup-node@v5');
    expect(stepUsing('actions/configure-pages@').uses).toBe('actions/configure-pages@v6.0.0');
  });

  it('builds on a Node the package engines allow', () => {
    expect(stepUsing('actions/setup-node@').with).toEqual({
      'node-version': '24',
      cache: 'npm',
    });
  });

  it('installs from the committed lockfile and runs the astro build', () => {
    expect(buildSteps.some((step) => step.run === 'npm ci')).toBe(true);
    expect(buildSteps.some((step) => step.run === 'npm run build')).toBe(true);
  });

  it('deploys from a second job gated on the build', () => {
    const deploy = workflow.jobs.deploy;
    expect(deploy.needs).toBe('build');
    expect((deploy.steps ?? [])[0]?.uses).toBe('actions/deploy-pages@v5.0.0');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/workflows/deploy.test.ts`

Expected: FAIL, at collection:

```
Error: ENOENT: no such file or directory, open '/home/kyo/projects/ai-tools-hub/.github/workflows/deploy.yml'
```

- [ ] **Step 4: Write the workflow**

Create `.github/workflows/deploy.yml`:

```yaml
# One-time manual setup: repository Settings -> Pages -> Source: GitHub Actions.
name: Deploy to GitHub Pages

on:
  push:
    branches: [main, master]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5
      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version: "24"
          cache: npm
      - name: Install dependencies
        run: npm ci
      - name: Configure Pages
        uses: actions/configure-pages@v6.0.0
      - name: Build the site
        run: npm run build
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v5.0.0
        with:
          path: ./dist
          include-hidden-files: true

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5.0.0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/workflows/deploy.test.ts`

Expected: PASS — 8 passing tests.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`

Expected: PASS — all eight test files pass (`scaffold`, `harness`, `typecheck`, `astro-config`, `output`, `types`, `link`, `deploy`), with exactly one Astro build in the log.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy.yml package.json package-lock.json tests/workflows/deploy.test.ts
git commit -m "ci: add github pages deploy workflow"
```

---

## Section A2 — the design system

**Files this section creates, and no other section may create:** `src/styles/theme.css`,
`src/pages/styleguide.astro`. Everything else it touches it only *modifies*, against an anchor
string that appears verbatim in the owning section's task.

**Consumed from A1, never re-created here:** `package.json` (dependencies are added by
`npm install` only — never a hand edit, so A1's line-ranged `scripts` block stays put),
`astro.config.mjs` (two anchored `Modify` steps in Task A2.2), `tsconfig.json`
(`allowImportingTsExtensions` is on, so every relative import below carries an explicit `.ts`),
and `vitest.config.ts`.

**No test in this section builds anything.** `vitest.config.ts` (A1) declares
`globalSetup: 'tests/global-setup.ts'`, which runs `astro build` exactly once before the suite;
all ten test files here only *read* `dist/`. No `beforeAll` in this section calls `astro build`,
and no step runs `astro build` by hand — `npx vitest run …` is sufficient and is what the steps say.

**The hazard token is `--color-hazard` and nothing else.** It is declared once, in a bare `:root`
block rather than inside `@theme`, so Tailwind cannot emit a `bg-hazard` utility and the
reservation is enforced by construction instead of by discipline. Its only permitted consumers are
the safety strip, stale dates (>60 days) and the undeclared-license value.

---

### Task A2.1: CSS Assertion Toolkit

The design system is asserted against **built** CSS, not source CSS, because the only guarantee
that matters is what a browser receives after Tailwind, Vite and esbuild have all run. This task
builds the parser those assertions need. It has no dependency on Astro or Tailwind and is pure
Node — it is testable on its own with a synthetic `dist/` fixture in a temp directory.

**Files:**
- Create: `tests/styles/built-css.ts`
- Test: `tests/styles/built-css.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `stripCssComments(css: string): string`
  - `collectFiles(dir: string, ext: string): string[]`
  - `readBuiltCss(root: string): string`
  - `splitMediaRegions(css: string): { outside: string; inside: string }`
  - `collectCustomProps(css: string): Set<string>`
  - `SEMANTIC_TOKENS: readonly string[]`

- [ ] **Step 1: Write the failing test**

Create `tests/styles/built-css.test.ts`:

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stripCssComments,
  collectFiles,
  readBuiltCss,
  splitMediaRegions,
  collectCustomProps,
  SEMANTIC_TOKENS,
} from './built-css.ts';

let root: string;

// A synthetic dist/ in a temp dir — this file never reads the real dist/.
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'built-css-'));
  mkdirSync(join(root, '_astro'), { recursive: true });
  mkdirSync(join(root, 'styleguide'), { recursive: true });
  writeFileSync(
    join(root, '_astro', 'site.css'),
    ':root{--a:1;--b:2}/* a comment */@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--b:3;--c:4}}',
    'utf8',
  );
  writeFileSync(
    join(root, 'styleguide', 'index.html'),
    '<html><head><style>:root{--d:5}</style></head><body>hi</body></html>',
    'utf8',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('stripCssComments', () => {
  it('removes block comments', () => {
    expect(stripCssComments('a{}/* x */b{}')).toBe('a{}b{}');
  });
});

describe('collectFiles', () => {
  it('walks nested directories and filters by extension', () => {
    expect(collectFiles(root, '.css')).toEqual([join(root, '_astro', 'site.css')]);
    expect(collectFiles(root, '.html')).toEqual([join(root, 'styleguide', 'index.html')]);
  });
});

describe('readBuiltCss', () => {
  it('concatenates linked stylesheets and inline <style> blocks, comments stripped', () => {
    const css = readBuiltCss(root);
    expect(css).toContain('--a:1');
    expect(css).toContain('--d:5');
    expect(css).not.toContain('a comment');
  });
});

describe('splitMediaRegions', () => {
  it('separates declarations inside @media from declarations outside it', () => {
    const { outside, inside } = splitMediaRegions(readBuiltCss(root));
    expect(collectCustomProps(outside)).toEqual(new Set(['--a', '--b', '--d']));
    expect(collectCustomProps(inside)).toEqual(new Set(['--b', '--c']));
  });

  it('handles nested braces inside a media block', () => {
    const { inside } = splitMediaRegions('@media (x){@supports (y){:root{--z:1}}}:root{--q:2}');
    expect(collectCustomProps(inside)).toEqual(new Set(['--z']));
  });
});

describe('collectCustomProps', () => {
  it('collects declared names only, never var() references', () => {
    expect(collectCustomProps(':root{--x:var(--y)}')).toEqual(new Set(['--x']));
  });
});

describe('SEMANTIC_TOKENS', () => {
  it('lists the 19 shadcn colour aliases', () => {
    expect(SEMANTIC_TOKENS).toHaveLength(19);
    expect(SEMANTIC_TOKENS).toContain('--background');
    expect(SEMANTIC_TOKENS).toContain('--ring');
    expect(SEMANTIC_TOKENS).not.toContain('--radius');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/styles/built-css.test.ts`

Expected: FAIL — the file does not resolve, so no test runs:

```
Error: Failed to resolve import "./built-css.ts" from "tests/styles/built-css.test.ts". Does the file exist?
```

- [ ] **Step 3: Write minimal implementation**

Create `tests/styles/built-css.ts`:

```ts
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Removes /* … *\/ blocks so comment text never satisfies a token assertion. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Recursively lists files under `dir` whose name ends with `ext`, sorted. */
export function collectFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectFiles(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

/**
 * Every byte of CSS a browser would receive from a build output directory:
 * linked stylesheets plus inline <style> blocks Astro chose to inline.
 * Read-only — building dist/ is the suite's globalSetup's job, never a test's.
 */
export function readBuiltCss(root: string): string {
  const linked = collectFiles(root, '.css').map((file) => readFileSync(file, 'utf8'));
  const inline: string[] = [];
  for (const file of collectFiles(root, '.html')) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) inline.push(match[1]);
  }
  return stripCssComments([...linked, ...inline].join('\n'));
}

/** Splits CSS into the text inside @media blocks and the text outside them. */
export function splitMediaRegions(css: string): { outside: string; inside: string } {
  let outside = '';
  let inside = '';
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf('@media', i);
    if (at === -1) {
      outside += css.slice(i);
      break;
    }
    outside += css.slice(i, at);
    const open = css.indexOf('{', at);
    if (open === -1) {
      outside += css.slice(at);
      break;
    }
    let depth = 1;
    let k = open + 1;
    while (k < css.length && depth > 0) {
      const ch = css[k];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      k += 1;
    }
    inside += css.slice(open + 1, depth === 0 ? k - 1 : k);
    i = k;
  }
  return { outside, inside };
}

/** Names of custom properties DECLARED in the given CSS (var() uses are ignored). */
export function collectCustomProps(css: string): Set<string> {
  const found = new Set<string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) found.add(match[1]);
  return found;
}

/** shadcn's exact colour alias names (§9.1). --radius is excluded: it is not a colour. */
export const SEMANTIC_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/styles/built-css.test.ts`

Expected: PASS — 7 passing tests.

- [ ] **Step 5: Commit**

```bash
git add tests/styles/built-css.ts tests/styles/built-css.test.ts
git commit -m "test: add built-CSS assertion toolkit for design tokens"
```

---

### Task A2.2: Tailwind v4 Wiring and the Palette Wipe

`@tailwindcss/vite` goes into A1's `astro.config.mjs` through two anchored edits,
`src/styles/theme.css` is created with nothing but the Tailwind import and `--color-*: initial`,
and a minimal `/styleguide` route exists so there is something to build. The permanent deliverable
is the **palette guard**: a hidden element in the styleguide carrying `bg-red-500 bg-indigo-500`.
Tailwind scans it, finds no such theme colours, and emits no rule — so if anyone ever deletes the
wipe, the guard produces utilities and the test fails.

**Files:**
- Create: `src/styles/theme.css`
- Create: `src/pages/styleguide.astro`
- Modify: `astro.config.mjs` (A1 owns it; two insertions, each anchored on an exact line from A1's
  task — `import { defineConfig } from 'astro/config';` and `  trailingSlash: 'always',`)
- Modify: `package.json` / `package-lock.json` (A1 owns them; changed only by `npm install`, never
  by hand, so A1's line-ranged `scripts` block is untouched)
- Test: `tests/styles/theme-wiring.test.ts`

**Interfaces:**
- Consumes: `astro.config.mjs` from A1 Task A1.3; `tests/global-setup.ts` via A1's
  `vitest.config.ts` `globalSetup`, which is what puts a fresh `dist/` on disk
- Produces: `src/styles/theme.css`; the route `/styleguide` building to `dist/styleguide/index.html`

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-wiring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readBuiltCss } from './built-css.ts';

describe('tailwind v4 wiring', () => {
  it('builds the /styleguide route', () => {
    expect(existsSync('dist/styleguide/index.html')).toBe(true);
  });

  it('ships Tailwind preflight', () => {
    expect(readBuiltCss('dist')).toMatch(/box-sizing:\s*border-box/);
  });

  it('wipes the default palette so bg-red-500 and bg-indigo-500 cannot exist', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.bg-red-500');
    expect(css).not.toContain('.bg-indigo-500');
    expect(css).not.toMatch(/--color-(red|indigo|slate|zinc|sky)-\d00\s*:/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/styles/theme-wiring.test.ts`

Expected: FAIL — 2 failed, 1 passed. `globalSetup` builds successfully (nothing references the
files this task has not written yet), so `dist/` exists — but A1 creates no `src/pages/index.astro`
(that route is B1's), so the only things in it are A1's `base-check/index.html` and the sitemap
files `sitemap-index.xml` and `sitemap-0.xml`:

- `builds the /styleguide route` — `AssertionError: expected false to be true`
- `ships Tailwind preflight` — `AssertionError: expected '' to match /box-sizing:\s*border-box/`
  (there is no stylesheet and no inline `<style>` anywhere in `dist/`, so `readBuiltCss('dist')`
  returns the empty string)
- `wipes the default palette …` passes vacuously, for the same reason

- [ ] **Step 3: Install the pinned Tailwind packages**

```bash
npm install --save-exact tailwindcss@4.3.3 @tailwindcss/vite@4.3.3
```

- [ ] **Step 4: Create the theme file**

```bash
mkdir -p src/styles
cat > src/styles/theme.css <<'CSS'
@import "tailwindcss";

/* ---------------------------------------------------------------------------
   Design system — single source of truth (spec §9.1, §9.2).
   Tailwind v4 CSS-first @theme: this file emits the custom properties AND
   generates the utilities. There is no JS config and no second source.

   `static` is required on every ramp block: Tailwind only emits the theme
   variables it sees used in class names, and this system is consumed through
   var() in component CSS as well as through utilities.
   --------------------------------------------------------------------------- */

/* Wipe Tailwind's default palette so nobody can reach for bg-indigo-500. */
@theme static {
  --color-*: initial;
}
CSS
```

- [ ] **Step 5: Wire @tailwindcss/vite into A1's astro.config.mjs**

Both edits are anchored on a full line that appears verbatim in A1's Task A1.3 Step 4 and is
unique inside the file. Nothing else in `astro.config.mjs` is touched.

```bash
sed -i "s|^import { defineConfig } from 'astro/config';$|&\nimport tailwindcss from '@tailwindcss/vite';|" astro.config.mjs
sed -i "s|^  trailingSlash: 'always',$|&\n  vite: { plugins: [tailwindcss()] },|" astro.config.mjs
cat astro.config.mjs
```

Expected `cat` output:

```js
// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

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
  integrations: [sitemap()],
});
```

`export const BASE` and `base: BASE` are A1's, untouched — the two `sed` lines above only insert
the `tailwindcss` import and the `vite` key, so the base path stays a single literal (A1's own test
fails if `'/ai-tools-hub/'` appears twice in this file).

- [ ] **Step 6: Create the styleguide route**

```bash
mkdir -p src/pages
cat > src/pages/styleguide.astro <<'ASTRO'
---
import '../styles/theme.css';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Styleguide — ai-tools-hub</title>
  </head>
  <body>
    <span class="bg-red-500 bg-indigo-500" hidden data-guard="palette-wipe">palette guard</span>
    <h1>Styleguide</h1>
  </body>
</html>
ASTRO
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-wiring.test.ts`

Expected: PASS — 3 passing tests. (`globalSetup` rebuilds `dist/` before they run; no test in this
suite builds anything itself.)

- [ ] **Step 8: Commit**

```bash
git add astro.config.mjs package.json package-lock.json src/styles/theme.css src/pages/styleguide.astro tests/styles/theme-wiring.test.ts
git commit -m "feat(design): wire Tailwind v4 and wipe the default palette"
```

---

### Task A2.3: Neutral OKLCH Ramp

Twelve neutral steps in OKLCH, following Radix step **roles** so hover, border and focus values are
decidable rather than guessed. Slightly cool (hue 250, chroma ≈ 0.002–0.018) rather than shadcn's
zero-chroma greys — §9.1 adopts shadcn's alias *names*, not its greys.

**Files:**
- Modify: `src/styles/theme.css` (append one `@theme static` block)
- Test: `tests/styles/theme-neutral.test.ts`

**Interfaces:**
- Consumes: `src/styles/theme.css` containing `@theme static { --color-*: initial; }`
- Produces: `--color-n-1` … `--color-n-12` on `:root`

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-neutral.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const STEPS = Array.from({ length: 12 }, (_, i) => `--color-n-${i + 1}`);

describe('neutral ramp', () => {
  it('emits all 12 steps outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const step of STEPS) expect(props.has(step)).toBe(true);
  });

  it('declares every step in oklch()', () => {
    const css = readBuiltCss('dist');
    for (const step of STEPS) {
      expect(css).toMatch(new RegExp(`${step}\\s*:\\s*oklch\\(`));
    }
  });

  it('keeps the default palette wiped', () => {
    expect(readBuiltCss('dist')).not.toContain('.bg-red-500');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-neutral.test.ts`

Expected: FAIL — 2 failed, 1 passed.

- `emits all 12 steps outside any media query` — `AssertionError: expected false to be true`, on
  the very first step (`--color-n-1` is declared nowhere in the built CSS)
- `declares every step in oklch()` fails on the same missing declaration; its message quotes the
  whole built stylesheet followed by `to match /--color-n-1\s*:\s*oklch\(/`
- `keeps the default palette wiped` passes

- [ ] **Step 3: Append the neutral ramp**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Neutral ramp — Radix step roles (§9.1):
     1-2  app background        6  subtle border        9-10  solid / hover
     3    component bg          7  interactive border   11    low-contrast text
     4    hover                 8  focus ring           12    high-contrast text
     5    pressed / selected
   Light values live on bare :root; the dark counterparts are in the theming
   block further down this file.
   --------------------------------------------------------------------------- */
@theme static {
  --color-n-1: oklch(0.991 0.002 250);
  --color-n-2: oklch(0.979 0.003 250);
  --color-n-3: oklch(0.951 0.005 250);
  --color-n-4: oklch(0.925 0.006 250);
  --color-n-5: oklch(0.901 0.007 250);
  --color-n-6: oklch(0.871 0.008 250);
  --color-n-7: oklch(0.830 0.010 250);
  --color-n-8: oklch(0.762 0.013 250);
  --color-n-9: oklch(0.606 0.016 250);
  --color-n-10: oklch(0.571 0.016 250);
  --color-n-11: oklch(0.494 0.015 250);
  --color-n-12: oklch(0.234 0.012 250);
}
CSS
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-neutral.test.ts`

Expected: PASS — 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css tests/styles/theme-neutral.test.ts
git commit -m "feat(design): add the 12-step neutral OKLCH ramp"
```

---

### Task A2.4: Accent OKLCH Ramp and the Reserved Hazard Token

The accent is a signal cyan (hue 195) — deliberately far from orange, because **hazard orange is
reserved exclusively for the safety module** (§9.2) and must never collide with chrome.

There is exactly **one** hazard token, `--color-hazard`, and it is declared in a bare `:root` block
rather than inside `@theme`. That is the whole reservation mechanism: a token outside `@theme`
generates no utilities, so `bg-hazard` / `text-hazard` / `border-hazard` cannot be written by
anyone, ever. The palette guard is extended with those two class names to prove it stays that way.
Permitted consumers are `var(--color-hazard)` in the safety strip, in a stale date, and in the
undeclared-license value — nothing else.

**Files:**
- Modify: `src/styles/theme.css` (append one `@theme static` block and one `:root` block)
- Modify: `src/pages/styleguide.astro` (extend the palette guard element — A2 owns this file)
- Test: `tests/styles/theme-accent.test.ts`

**Interfaces:**
- Consumes: `src/styles/theme.css` containing `@theme static { --color-*: initial; }`
- Produces: `--color-a-1` … `--color-a-12` as theme colours; `--color-hazard` as a plain
  custom property with no utility surface

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-accent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuiltCss, splitMediaRegions, collectCustomProps, SEMANTIC_TOKENS } from './built-css.ts';

const STEPS = Array.from({ length: 12 }, (_, i) => `--color-a-${i + 1}`);

describe('accent ramp', () => {
  it('emits all 12 steps outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const step of STEPS) expect(props.has(step)).toBe(true);
  });

  it('declares every step in oklch()', () => {
    const css = readBuiltCss('dist');
    for (const step of STEPS) {
      expect(css).toMatch(new RegExp(`${step}\\s*:\\s*oklch\\(`));
    }
  });
});

describe('hazard token', () => {
  it('emits exactly one hazard token, named --color-hazard', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/--color-hazard\s*:\s*oklch\(/);
    const named = [...collectCustomProps(css)].filter((prop) => prop.includes('hazard')).sort();
    expect(named).toEqual(['--color-hazard']);
  });

  it('generates no hazard utility, so nobody can write bg-hazard', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.bg-hazard');
    expect(css).not.toContain('.text-hazard');
    expect(css).not.toContain('.border-hazard');
  });

  it('is never reachable through a shadcn semantic alias (§9.2 reservation)', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    for (const token of SEMANTIC_TOKENS) {
      const declarations = source.match(new RegExp(`${token}\\s*:[^;]*;`, 'g')) ?? [];
      for (const declaration of declarations) {
        expect(declaration).not.toContain('hazard');
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-accent.test.ts`

Expected: FAIL — 2 failed, 3 passed.

- `emits all 12 steps outside any media query` — `AssertionError: expected false to be true`
  (`--color-a-1` is declared nowhere)
- `emits exactly one hazard token, named --color-hazard` fails on its first assertion; the message
  quotes the whole built stylesheet followed by `to match /--color-hazard\s*:\s*oklch\(/`
- the `oklch()` loop, the no-utility test and the alias test pass vacuously

- [ ] **Step 3: Append the accent ramp and the hazard token**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Accent ramp — same Radix step roles as the neutral ramp. Signal cyan, chosen
   so it can never be confused with hazard orange.
   --------------------------------------------------------------------------- */
@theme static {
  --color-a-1: oklch(0.990 0.005 195);
  --color-a-2: oklch(0.976 0.012 195);
  --color-a-3: oklch(0.948 0.028 195);
  --color-a-4: oklch(0.917 0.043 195);
  --color-a-5: oklch(0.880 0.055 195);
  --color-a-6: oklch(0.833 0.066 195);
  --color-a-7: oklch(0.771 0.078 195);
  --color-a-8: oklch(0.688 0.094 195);
  --color-a-9: oklch(0.610 0.106 195);
  --color-a-10: oklch(0.572 0.101 195);
  --color-a-11: oklch(0.505 0.091 195);
  --color-a-12: oklch(0.290 0.050 195);
}

/* ---------------------------------------------------------------------------
   RESERVED — the safety module, and nothing else (§9.2). One token, one name:
   --color-hazard. Permitted consumers, all via var(): the safety strip, a
   stale date (>60 days), and the undeclared-license value. Never links, never
   chrome, never accents, never focus.

   Declared HERE, in a bare :root block, and deliberately NOT inside @theme:
   a token outside @theme generates no utilities, so `bg-hazard` and
   `text-hazard` cannot be written at all. The reservation is structural
   instead of a convention someone has to remember. A wrong badge is a
   liability (§4.3), so this colour has to mean exactly one thing site-wide.
   Its dark counterpart is in the theming block further down this file.
   --------------------------------------------------------------------------- */
:root {
  --color-hazard: oklch(0.588 0.196 42);
}
CSS
```

- [ ] **Step 4: Extend the palette guard to cover the hazard utilities**

The guard is anchored on `data-guard="palette-wipe"`, which occurs once in the file.

```bash
sed -i 's|<span class="[^"]*" hidden data-guard="palette-wipe">|<span class="bg-red-500 bg-indigo-500 bg-hazard text-hazard" hidden data-guard="palette-wipe">|' src/pages/styleguide.astro
grep -n 'data-guard' src/pages/styleguide.astro
```

Expected `grep` output (this reads the Astro **source**, not `dist/`):

```
13:    <span class="bg-red-500 bg-indigo-500 bg-hazard text-hazard" hidden data-guard="palette-wipe">palette guard</span>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-accent.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/pages/styleguide.astro tests/styles/theme-accent.test.ts
git commit -m "feat(design): add the accent ramp and reserve the single hazard token"
```

---

### Task A2.5: Typography, Spacing and the 9-Step Text Scale

JetBrains Mono for every identifier, path, count, command and metric; Archivo for prose (§9.2).
`--text-*: initial` first, so the scale is exactly nine steps and no stray `text-6xl` survives.

**Files:**
- Modify: `src/styles/theme.css` (prepend the webfont import; append one `@theme static` block)
- Test: `tests/styles/theme-typography.test.ts`

**Interfaces:**
- Consumes: `src/styles/theme.css`
- Produces: `--font-sans`, `--font-mono`, `--spacing`, and `--text-xs` … `--text-5xl` with paired
  `--text-*--line-height` values

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-typography.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const SCALE = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];

describe('typography tokens', () => {
  it('names Archivo for prose and JetBrains Mono for identifiers', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/--font-sans\s*:[^;]*Archivo/);
    expect(css).toMatch(/--font-mono\s*:[^;]*JetBrains Mono/);
  });

  it('loads both webfont families', () => {
    const css = readBuiltCss('dist');
    expect(css).toContain('fonts.googleapis.com');
    expect(css).toContain('Archivo');
    expect(css).toContain('JetBrains+Mono');
  });

  it('defines a spacing base unit', () => {
    expect(readBuiltCss('dist')).toMatch(/--spacing\s*:\s*0\.25rem/);
  });

  it('defines exactly nine text steps, each with a line height', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const step of SCALE) {
      expect(props.has(`--text-${step}`)).toBe(true);
      expect(props.has(`--text-${step}--line-height`)).toBe(true);
    }
    const sizes = [...props].filter((p) => /^--text-[^-]+$/.test(p));
    expect(sizes.sort()).toEqual(SCALE.map((s) => `--text-${s}`).sort());
  });

  it('drops the serif family', () => {
    expect(readBuiltCss('dist')).not.toMatch(/--font-serif\s*:\s*ui-serif/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-typography.test.ts`

Expected: FAIL — 4 failed, 1 passed.

- `names Archivo for prose …` — the built CSS declares no `--font-sans` whose value contains
  `Archivo` (Tailwind's own default sans stack carries no webfont), so `toMatch` reports no match
  for `/--font-sans\s*:[^;]*Archivo/`; the message quotes the whole built stylesheet
- `loads both webfont families` — `AssertionError: expected [the built stylesheet] to contain
  'fonts.googleapis.com'`
- `defines a spacing base unit` — no match for `/--spacing\s*:\s*0\.25rem/`
- `defines exactly nine text steps …` — `AssertionError: expected false to be true` on
  `props.has('--text-xs')`
- `drops the serif family` passes

- [ ] **Step 3: Prepend the webfont import**

The `@import url(…)` must be the first line of the file — CSS requires every `@import` to precede
other rules, and Vite keeps it above Tailwind's emitted `@layer` statement in the bundle.

```bash
sed -i "1i @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');" src/styles/theme.css
head -2 src/styles/theme.css
```

Expected `head` output:

```
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');
@import "tailwindcss";
```

- [ ] **Step 4: Append the typography and spacing block**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Typography and spacing (§9.2). JetBrains Mono carries every identifier, path,
   count, command and metric; Archivo carries prose. The scale is wiped first so
   it is exactly nine steps — an unused tenth step is drift waiting to happen.
   --------------------------------------------------------------------------- */
@theme static {
  --text-*: initial;

  --spacing: 0.25rem;

  --font-serif: initial;
  --font-sans: 'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;

  --text-xs: 0.6875rem;
  --text-xs--line-height: 1rem;
  --text-sm: 0.8125rem;
  --text-sm--line-height: 1.25rem;
  --text-base: 0.9375rem;
  --text-base--line-height: 1.5rem;
  --text-lg: 1.0625rem;
  --text-lg--line-height: 1.625rem;
  --text-xl: 1.25rem;
  --text-xl--line-height: 1.75rem;
  --text-2xl: 1.5rem;
  --text-2xl--line-height: 2rem;
  --text-3xl: 1.875rem;
  --text-3xl--line-height: 2.25rem;
  --text-4xl: 2.25rem;
  --text-4xl--line-height: 2.5rem;
  --text-5xl: 3rem;
  --text-5xl--line-height: 1.1;
}
CSS
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-typography.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css tests/styles/theme-typography.test.ts
git commit -m "feat(design): add typography, spacing and the 9-step text scale"
```

---

### Task A2.6: shadcn Semantic Aliases

Every alias is a `var()` reference into a ramp. That is the whole trick: the dark theme only has to
re-point the **ramps**, and all nineteen aliases follow. Only `--destructive` carries a literal, so
it is the only alias needing a dark counterpart. `@theme inline` republishes the aliases under the
`--color-*` namespace so `bg-background` / `text-foreground` / `border-border` exist as utilities and
still track the theme at runtime.

**Files:**
- Modify: `src/styles/theme.css` (append a `:root` block and a `@theme inline` block)
- Modify: `src/pages/styleguide.astro` (add `bg-background text-foreground` to `<body>` — A2 owns
  this file)
- Test: `tests/styles/theme-semantics.test.ts`

**Interfaces:**
- Consumes: `--color-n-1` … `--color-n-12`, `--color-a-1` … `--color-a-12`
- Produces: `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
  `--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`,
  `--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`, `--accent-foreground`,
  `--destructive`, `--destructive-foreground`, `--border`, `--input`, `--ring`, `--radius`

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-semantics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps, SEMANTIC_TOKENS } from './built-css.ts';

describe('shadcn semantic aliases', () => {
  it('defines all 19 colour aliases outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const token of SEMANTIC_TOKENS) expect(props.has(token)).toBe(true);
  });

  it('defines --radius as zero (Industrial Console has no radius)', () => {
    expect(readBuiltCss('dist')).toMatch(/--radius\s*:\s*0(px)?\s*[;}]/);
  });

  it('generates shadcn-compatible utilities that follow the theme at runtime', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/\.bg-background\s*\{\s*background-color:\s*var\(--background\)/);
    expect(css).toMatch(/\.text-foreground\s*\{\s*color:\s*var\(--foreground\)/);
  });

  it('never routes a semantic alias to the hazard token', () => {
    const css = readBuiltCss('dist');
    for (const token of SEMANTIC_TOKENS) {
      const declaration = new RegExp(`${token}\\s*:\\s*var\\(--color-hazard\\)`);
      expect(css).not.toMatch(declaration);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-semantics.test.ts`

Expected: FAIL — 3 failed, 1 passed.

- `defines all 19 colour aliases outside any media query` — `AssertionError: expected false to be
  true` on `props.has('--background')`
- `defines --radius as zero …` — no match for `/--radius\s*:\s*0(px)?\s*[;}]/` in the built
  stylesheet
- `generates shadcn-compatible utilities …` — no match for
  `/\.bg-background\s*\{\s*background-color:\s*var\(--background\)/`
- `never routes a semantic alias to the hazard token` passes

- [ ] **Step 3: Append the aliases and the inline theme mapping**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   shadcn's exact semantic names mapped onto the ramps (§9.1) — so any shadcn
   block pasted in later is already themed, without adopting shadcn's greys.

   Every alias is a var() into a ramp on purpose: the dark theme re-points the
   ramps and all of these follow. --destructive is the single literal, and so
   the single alias that needs a dark counterpart. None of them may ever point
   at --color-hazard: that token belongs to the safety module alone.
   --------------------------------------------------------------------------- */
:root {
  --background: var(--color-n-1);
  --foreground: var(--color-n-12);
  --card: var(--color-n-2);
  --card-foreground: var(--color-n-12);
  --popover: var(--color-n-2);
  --popover-foreground: var(--color-n-12);
  --primary: var(--color-a-9);
  --primary-foreground: var(--color-n-1);
  --secondary: var(--color-n-3);
  --secondary-foreground: var(--color-n-12);
  --muted: var(--color-n-3);
  --muted-foreground: var(--color-n-11);
  --accent: var(--color-a-4);
  --accent-foreground: var(--color-a-12);
  --destructive: oklch(0.554 0.204 27);
  --destructive-foreground: var(--color-n-1);
  --border: var(--color-n-6);
  --input: var(--color-n-7);
  --ring: var(--color-a-8);
  --radius: 0px;
}

/* `inline` copies the value into each utility instead of adding another
   indirection, so bg-background resolves to var(--background) and re-reads it
   on every theme switch. */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
}
CSS
```

- [ ] **Step 4: Use the aliases on the styleguide so the utilities are generated**

```bash
sed -i 's|^  <body>$|  <body class="bg-background text-foreground">|' src/pages/styleguide.astro
grep -n '<body' src/pages/styleguide.astro
```

Expected `grep` output (Astro **source**, not `dist/`):

```
12:  <body class="bg-background text-foreground">
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-semantics.test.ts`

Expected: PASS — 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/pages/styleguide.astro tests/styles/theme-semantics.test.ts
git commit -m "feat(design): map shadcn semantic aliases onto the OKLCH ramps"
```

---

### Task A2.7: Three-State Theming

Full light palette on bare `:root` (already there); dark overrides in
`@media (prefers-color-scheme: dark)` guarded as `:root:not([data-theme="light"])`; the same
declarations repeated under `:root[data-theme="dark"]`. **No CSS `light-dark()`** — it is Baseline
only since May 2024, *narrower* than Tailwind v4's Safari 16.4 floor, so combining them silently
drops colour on browsers that support the rest of the stack (§9.1).

The duplication between the two dark blocks is required by the pattern and is exactly where drift
starts, so a test compares the two declaration sets directly. The second test is the section's
headline invariant: **no colour may be defined only inside a media query.**

**Files:**
- Modify: `src/styles/theme.css` (append the two dark blocks)
- Test: `tests/styles/theme-theming.test.ts`

**Interfaces:**
- Consumes: `--color-n-1` … `--color-n-12`, `--color-a-1` … `--color-a-12`, `--color-hazard`,
  `--destructive`
- Produces: dark values for all of the above under both dark selectors

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-theming.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuiltCss, splitMediaRegions, collectCustomProps, SEMANTIC_TOKENS } from './built-css.ts';

function declarationsOf(body: string): string[] {
  return body
    .split(';')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort();
}

describe('three-state theming', () => {
  it('never uses CSS light-dark()', () => {
    expect(readFileSync('src/styles/theme.css', 'utf8')).not.toContain('light-dark(');
  });

  it('guards the media override so an explicit light choice wins', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source).toContain('@media (prefers-color-scheme: dark)');
    expect(source).toContain(':root:not([data-theme="light"])');
    expect(source).toContain(':root[data-theme="dark"]');
  });

  it('keeps the two dark blocks declaring identical values', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    const media = /:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(source);
    const attribute = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(source);
    expect(media).not.toBeNull();
    expect(attribute).not.toBeNull();
    expect(declarationsOf(media![1])).toEqual(declarationsOf(attribute![1]));
  });

  it('defines no colour ONLY inside a media query', () => {
    const { outside, inside } = splitMediaRegions(readBuiltCss('dist'));
    const declaredOutside = collectCustomProps(outside);
    const colourish = [...collectCustomProps(inside)].filter(
      (prop) => prop.startsWith('--color-') || (SEMANTIC_TOKENS as readonly string[]).includes(prop),
    );
    expect(colourish.length).toBeGreaterThan(0);
    const orphans = colourish.filter((prop) => !declaredOutside.has(prop)).sort();
    expect(orphans).toEqual([]);
  });

  it('re-points the ramps rather than the aliases, so aliases stay single-sourced', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    const attribute = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(source)![1];
    expect(attribute).toContain('--color-n-1');
    expect(attribute).toContain('--color-a-9');
    expect(attribute).toContain('--color-hazard');
    expect(attribute).toContain('--destructive');
    expect(attribute).not.toContain('--background');
    expect(attribute).not.toContain('--muted-foreground');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-theming.test.ts`

Expected: FAIL — 4 failed, 1 passed.

- `guards the media override …` — `src/styles/theme.css` contains no
  `@media (prefers-color-scheme: dark)`, so `toContain` fails and the message prints the current
  theme file
- `keeps the two dark blocks declaring identical values` — `AssertionError: expected null not to be
  null` (neither dark selector matches)
- `defines no colour ONLY inside a media query` — the built CSS has no dark block yet, so no
  colour token is declared inside any `@media`, and `expect(colourish.length).toBeGreaterThan(0)`
  fails with `expected 0 to be greater than 0`
- `re-points the ramps rather than the aliases …` — the regex `.exec(source)` returns `null` and
  the `!` index throws `TypeError: Cannot read properties of null (reading '1')`
- `never uses CSS light-dark()` passes

- [ ] **Step 3: Append the two dark blocks**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Theming — three states (§9.1). Deliberately NOT CSS light-dark(): that
   function is Baseline only since May 2024, narrower than Tailwind v4's own
   Safari 16.4 floor, so combining the two silently drops colour on browsers
   that support everything else here.

     1. bare :root                                  -> the full light palette
     2. @media dark + :root:not([data-theme=light]) -> system preference
     3. :root[data-theme="dark"]                    -> explicit user choice

   Only ramps, the one reserved hazard token and the one literal alias are
   re-pointed. Every other alias is a var() into a ramp and follows
   automatically. The two blocks below MUST stay declaration-for-declaration
   identical.
   --------------------------------------------------------------------------- */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-n-1: oklch(0.178 0.006 250);
    --color-n-2: oklch(0.213 0.008 250);
    --color-n-3: oklch(0.254 0.010 250);
    --color-n-4: oklch(0.283 0.012 250);
    --color-n-5: oklch(0.314 0.013 250);
    --color-n-6: oklch(0.355 0.014 250);
    --color-n-7: oklch(0.413 0.016 250);
    --color-n-8: oklch(0.498 0.018 250);
    --color-n-9: oklch(0.539 0.018 250);
    --color-n-10: oklch(0.584 0.017 250);
    --color-n-11: oklch(0.770 0.014 250);
    --color-n-12: oklch(0.949 0.006 250);
    --color-a-1: oklch(0.190 0.020 195);
    --color-a-2: oklch(0.222 0.028 195);
    --color-a-3: oklch(0.271 0.045 195);
    --color-a-4: oklch(0.309 0.058 195);
    --color-a-5: oklch(0.351 0.066 195);
    --color-a-6: oklch(0.404 0.072 195);
    --color-a-7: oklch(0.477 0.080 195);
    --color-a-8: oklch(0.567 0.092 195);
    --color-a-9: oklch(0.735 0.116 195);
    --color-a-10: oklch(0.790 0.110 195);
    --color-a-11: oklch(0.845 0.095 195);
    --color-a-12: oklch(0.945 0.035 195);
    --color-hazard: oklch(0.762 0.168 58);
    --destructive: oklch(0.681 0.188 25);
  }
}

:root[data-theme="dark"] {
  --color-n-1: oklch(0.178 0.006 250);
  --color-n-2: oklch(0.213 0.008 250);
  --color-n-3: oklch(0.254 0.010 250);
  --color-n-4: oklch(0.283 0.012 250);
  --color-n-5: oklch(0.314 0.013 250);
  --color-n-6: oklch(0.355 0.014 250);
  --color-n-7: oklch(0.413 0.016 250);
  --color-n-8: oklch(0.498 0.018 250);
  --color-n-9: oklch(0.539 0.018 250);
  --color-n-10: oklch(0.584 0.017 250);
  --color-n-11: oklch(0.770 0.014 250);
  --color-n-12: oklch(0.949 0.006 250);
  --color-a-1: oklch(0.190 0.020 195);
  --color-a-2: oklch(0.222 0.028 195);
  --color-a-3: oklch(0.271 0.045 195);
  --color-a-4: oklch(0.309 0.058 195);
  --color-a-5: oklch(0.351 0.066 195);
  --color-a-6: oklch(0.404 0.072 195);
  --color-a-7: oklch(0.477 0.080 195);
  --color-a-8: oklch(0.567 0.092 195);
  --color-a-9: oklch(0.735 0.116 195);
  --color-a-10: oklch(0.790 0.110 195);
  --color-a-11: oklch(0.845 0.095 195);
  --color-a-12: oklch(0.945 0.035 195);
  --color-hazard: oklch(0.762 0.168 58);
  --destructive: oklch(0.681 0.188 25);
}
CSS
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-theming.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 5: Run the whole styles suite to confirm nothing regressed**

Run: `npx vitest run tests/styles`

Expected: PASS — all seven files so far.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css tests/styles/theme-theming.test.ts
git commit -m "feat(design): add three-state theming with dark ramp overrides"
```

---

### Task A2.8: Motion Tokens and the Reduced-Motion Kill Switch

Three durations, one easing curve, and a `prefers-reduced-motion: reduce` guard that collapses them
and neutralises any animation the rest of the site introduces later (§9.1).

**Files:**
- Modify: `src/styles/theme.css` (append the motion `:root` block and the guard)
- Test: `tests/styles/theme-motion.test.ts`

**Interfaces:**
- Consumes: `src/styles/theme.css`
- Produces: `--motion-state` (90ms), `--motion-enter` (150ms), `--motion-overlay` (220ms),
  `--motion-ease`

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const TOKENS = ['--motion-state', '--motion-enter', '--motion-overlay', '--motion-ease'];

describe('motion tokens', () => {
  it('defines every motion token outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const token of TOKENS) expect(props.has(token)).toBe(true);
  });

  it('uses 90ms state, 150ms enter, 220ms overlay', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/--motion-state\s*:\s*90ms/);
    expect(css).toMatch(/--motion-enter\s*:\s*150ms/);
    expect(css).toMatch(/--motion-overlay\s*:\s*220ms/);
  });

  it('declares exactly one easing curve in the whole system', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source.match(/cubic-bezier\(/g)).toHaveLength(1);
  });

  it('ships a prefers-reduced-motion kill switch', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    const css = readBuiltCss('dist');
    expect(css).toMatch(/animation-duration:\s*1ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*1ms\s*!important/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-motion.test.ts`

Expected: FAIL — all 4 tests fail.

- `defines every motion token outside any media query` — `AssertionError: expected false to be true`
  on `props.has('--motion-state')`
- `uses 90ms state, 150ms enter, 220ms overlay` — no match for `/--motion-state\s*:\s*90ms/` in the
  built stylesheet
- `declares exactly one easing curve in the whole system` —
  `AssertionError: expected null to have a length of 1 but got null` (`String.match` returns `null`
  when there is no `cubic-bezier(` in the theme file at all)
- `ships a prefers-reduced-motion kill switch` —
  `AssertionError: expected [the theme file] to contain '@media (prefers-reduced-motion: reduce)'`

- [ ] **Step 3: Append the motion tokens and the guard**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Motion (§9.1). Three durations, one curve. State changes are 90ms so they
   read as instant; entering elements get 150ms; overlays get 220ms because
   they move further. Anything that wants a fourth duration is a design bug.
   --------------------------------------------------------------------------- */
:root {
  --motion-state: 90ms;
  --motion-enter: 150ms;
  --motion-overlay: 220ms;
  --motion-ease: cubic-bezier(0.2, 0, 0, 1);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-state: 0ms;
    --motion-enter: 0ms;
    --motion-overlay: 0ms;
  }

  *,
  *::before,
  *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
}
CSS
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-motion.test.ts`

Expected: PASS — 4 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/styles/theme.css tests/styles/theme-motion.test.ts
git commit -m "feat(design): add motion tokens with a reduced-motion kill switch"
```

---

### Task A2.9: Industrial Console Base Layer

Art direction enforced by the theme rather than by discipline (§9.2): no radius, no shadows, 1px
borders, dark-first control surface. The radius and shadow namespaces are wiped so `rounded-lg` and
`shadow-lg` do not exist — the palette guard from Task A2.2 is extended to prove it.

**Files:**
- Modify: `src/styles/theme.css` (append the constraints `@theme static` block and `@layer base`)
- Modify: `src/pages/styleguide.astro` (extend the palette guard element — A2 owns this file)
- Test: `tests/styles/theme-industrial.test.ts`

**Interfaces:**
- Consumes: `--background`, `--foreground`, `--border`, `--ring`, `--font-sans`, `--font-mono`,
  `--text-base`, `--color-a-5`
- Produces: the `base` layer rules; the removal of the `--radius-*`, `--shadow-*`,
  `--inset-shadow-*` and `--drop-shadow-*` namespaces

- [ ] **Step 1: Write the failing test**

Create `tests/styles/theme-industrial.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readBuiltCss } from './built-css.ts';

describe('Industrial Console constraints', () => {
  it('makes rounded-*, shadow-* and hazard utilities impossible', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.rounded-lg');
    expect(css).not.toContain('.shadow-lg');
    expect(css).not.toContain('.bg-red-500');
    expect(css).not.toContain('.bg-indigo-500');
    expect(css).not.toContain('.bg-hazard');
  });

  it('defaults borders to 1px-capable, --border coloured, solid', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/border-color:\s*var\(--border\)/);
    expect(css).toMatch(/border-style:\s*solid/);
  });

  it('paints the page from the semantic aliases', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/background-color:\s*var\(--background\)/);
    expect(css).toMatch(/color:\s*var\(--foreground\)/);
    expect(css).toMatch(/font-family:\s*var\(--font-sans\)/);
  });

  it('gives identifiers the mono face and focus a visible ring', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--ring\)/);
  });

  it('declares color-scheme for all three theme states', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/color-scheme:\s*light\s+dark/);
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light[;}]/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/theme-industrial.test.ts`

Expected: FAIL — 4 failed, 1 passed.

- `defaults borders to 1px-capable …` — Tailwind's preflight ships `border: 0 solid`, never a
  `border-color: var(--border)` declaration, so `toMatch` reports no match for
  `/border-color:\s*var\(--border\)/`; the message quotes the whole built stylesheet
- `paints the page from the semantic aliases` — no `background-color: var(--background)` outside
  the `.bg-background` utility's own rule body … which is exactly why the assertion is written
  against the base layer this step has not added yet; no match
- `gives identifiers the mono face and focus a visible ring` — no match for
  `/font-family:\s*var\(--font-mono\)/`
- `declares color-scheme for all three theme states` — no match for `/color-scheme:\s*light\s+dark/`
- `makes rounded-*, shadow-* and hazard utilities impossible` passes: the guard element does not
  carry `rounded-lg` / `shadow-lg` until Step 4, so nothing emits those rules yet

- [ ] **Step 3: Append the constraints and the base layer**

```bash
cat >> src/styles/theme.css <<'CSS'

/* ---------------------------------------------------------------------------
   Industrial Console (§9.2): dark-first control surface, panelled cards,
   1px borders, no radius, no shadows. Removing the namespaces outright is
   stronger than a convention — rounded-lg and shadow-lg simply do not compile.
   --------------------------------------------------------------------------- */
@theme static {
  --radius-*: initial;
  --shadow-*: initial;
  --inset-shadow-*: initial;
  --drop-shadow-*: initial;
}

@layer base {
  html {
    color-scheme: light dark;
  }

  html[data-theme="light"] {
    color-scheme: light;
  }

  html[data-theme="dark"] {
    color-scheme: dark;
  }

  body {
    background-color: var(--background);
    color: var(--foreground);
    font-family: var(--font-sans);
    font-size: var(--text-base);
    line-height: var(--text-base--line-height);
    -webkit-font-smoothing: antialiased;
  }

  /* Borders are opt-in by width but never by colour or style: a panel only ever
     has to say `border-width: 1px`. */
  *,
  *::before,
  *::after {
    border-color: var(--border);
    border-style: solid;
    border-width: 0;
  }

  code,
  kbd,
  samp,
  pre {
    font-family: var(--font-mono);
  }

  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 0;
  }

  ::selection {
    background-color: var(--color-a-5);
    color: var(--foreground);
  }

  a {
    color: inherit;
    text-decoration: none;
  }
}
CSS
```

- [ ] **Step 4: Extend the palette guard to cover radius and shadow**

```bash
sed -i 's|<span class="[^"]*" hidden data-guard="palette-wipe">|<span class="bg-red-500 bg-indigo-500 bg-hazard text-hazard rounded-lg shadow-lg" hidden data-guard="palette-wipe">|' src/pages/styleguide.astro
grep -n 'data-guard' src/pages/styleguide.astro
```

Expected `grep` output (Astro **source**, not `dist/`):

```
13:    <span class="bg-red-500 bg-indigo-500 bg-hazard text-hazard rounded-lg shadow-lg" hidden data-guard="palette-wipe">palette guard</span>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/styles/theme-industrial.test.ts`

Expected: PASS — 5 passing tests.

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/pages/styleguide.astro tests/styles/theme-industrial.test.ts
git commit -m "feat(design): enforce the Industrial Console base layer"
```

---

### Task A2.10: Styleguide — Every Token and Every Component State

`/styleguide` is the cheapest drift detector a solo maintainer gets (§9.1), so it renders **every**
token and **every** component state, not a selection. Swatches read the token through `var()` in an
inline style, which is exactly how component CSS consumes them — if a token is missing, the swatch
renders transparent and the page shows it. States are rendered side by side as static specimens, so
a regression is visible without hovering anything.

*(This task replaces the former A2.10 / A2.11 pair. Those rewrote this same file end to end twice,
duplicating ~380 lines of Astro between two heredocs — a second source of truth inside the page
whose entire job is detecting a second source of truth.)*

Included: the three taxonomy node states from §10.1 (none of which may lie), the runtime LEDs in
`RUNTIME_ORDER` — claude, openclaw, codex, cursor, generic, never alphabetical — the safety strip,
the stale date and the undeclared-license value that are the only three consumers of hazard orange,
and a WCAG 2.2 §2.5.8 hit-area specimen at 24 px. A theme switcher drives all three theming states
by hand.

Every assertion below is on a `data-*` attribute or an inline `style` value. None is on a
`class="…"` string in built HTML: Astro 7 rewrites tags in a component with scoped styles by
appending `data-astro-cid-*`, and a class-string assertion would be asserting on Astro's output
format rather than on the design system.

**Files:**
- Modify: `src/pages/styleguide.astro` (full rewrite — A2 owns this file)
- Test: `tests/styles/styleguide.test.ts`

**Interfaces:**
- Consumes: `src/styles/theme.css` and every token it defines; a `dist/` built once by
  `tests/global-setup.ts` (A1) via `globalSetup`
- Produces: `dist/styleguide/index.html` carrying one `[data-token]` element per token and
  `[data-state]`, `[data-node-state]`, `[data-led]`, `[data-safety]`, `[data-license]`,
  `[data-stale]`, `[data-score]`, `[data-hit]` and `[data-set-theme]` specimens

- [ ] **Step 1: Write the failing test**

Create `tests/styles/styleguide.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = (): string => readFileSync('dist/styleguide/index.html', 'utf8');

const NEUTRAL = Array.from({ length: 12 }, (_, i) => `--color-n-${i + 1}`);
const ACCENT = Array.from({ length: 12 }, (_, i) => `--color-a-${i + 1}`);
const SEMANTIC = [
  '--background', '--foreground', '--card', '--card-foreground', '--popover',
  '--popover-foreground', '--primary', '--primary-foreground', '--secondary',
  '--secondary-foreground', '--muted', '--muted-foreground', '--accent',
  '--accent-foreground', '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
];
const TEXT = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
const MOTION = ['--motion-state', '--motion-enter', '--motion-overlay', '--motion-ease'];
const OTHER = ['--color-hazard', '--radius', '--spacing', '--font-sans', '--font-mono'];
const RUNTIME_ORDER = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

/** The full opening tag carrying `attr`, so an inline style can be read off it. */
function tagWith(page: string, attr: string): string {
  return new RegExp(`<[^>]*${attr}[^>]*>`).exec(page)?.[0] ?? '';
}

describe('styleguide — tokens', () => {
  it('renders a swatch for every colour token', () => {
    const page = html();
    for (const token of [...NEUTRAL, ...ACCENT, ...SEMANTIC]) {
      expect(page).toContain(`data-token="${token}"`);
    }
  });

  it('renders the non-colour tokens too', () => {
    const page = html();
    for (const token of OTHER) expect(page).toContain(`data-token="${token}"`);
  });

  it('labels each ramp step with its Radix role', () => {
    const page = html();
    for (const role of [
      'app background', 'component bg', 'hover', 'pressed / selected',
      'subtle border', 'interactive border', 'focus ring', 'solid',
      'solid hover', 'low-contrast text', 'high-contrast text',
    ]) {
      expect(page).toContain(role);
    }
  });

  it('renders every step of the text scale', () => {
    const page = html();
    for (const step of TEXT) expect(page).toContain(`data-token="--text-${step}"`);
  });

  it('renders the motion tokens', () => {
    const page = html();
    for (const token of MOTION) expect(page).toContain(`data-token="${token}"`);
  });

  it('states the hazard reservation in words on the page', () => {
    expect(html()).toContain('safety module only');
  });

  it('keeps the palette guard in place', () => {
    expect(html()).toContain('data-guard="palette-wipe"');
  });
});

describe('styleguide — component states', () => {
  it('renders all five button states', () => {
    const page = html();
    for (const state of ['rest', 'hover', 'focus', 'pressed', 'disabled']) {
      expect(page).toContain(`data-state="${state}"`);
    }
  });

  it('renders the three taxonomy node states from §10.1', () => {
    const page = html();
    for (const state of ['active', 'below-mass', 'empty']) {
      expect(page).toContain(`data-node-state="${state}"`);
    }
    expect(page).toContain('no entries yet');
  });

  it('renders a runtime LED for every runtime, in RUNTIME_ORDER', () => {
    const page = html();
    const positions = RUNTIME_ORDER.map((runtime) => page.indexOf(`data-led="${runtime}"`));
    expect(positions.filter((at) => at === -1)).toEqual([]);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('paints the safety strip rows that are hazardous, and only those', () => {
    const page = html();
    for (const row of ['executes-code', 'network', 'reads-env', 'not-declared']) {
      expect(page).toContain(`data-safety="${row}"`);
    }
    expect(tagWith(page, 'data-safety="executes-code"')).toContain('var(--color-hazard)');
    expect(tagWith(page, 'data-safety="reads-env"')).not.toContain('var(--color-hazard)');
  });

  it('paints a stale date in hazard', () => {
    expect(tagWith(html(), 'data-stale="true"')).toContain('var(--color-hazard)');
  });

  it('paints an undeclared licence in hazard and a resolved one plainly', () => {
    const page = html();
    expect(tagWith(page, 'data-license="not-declared"')).toContain('var(--color-hazard)');
    expect(tagWith(page, 'data-license="resolved"')).not.toContain('var(--color-hazard)');
  });

  it('renders the four score bars', () => {
    const page = html();
    for (const part of ['adoption', 'maintenance', 'provenance', 'completeness']) {
      expect(page).toContain(`data-score="${part}"`);
    }
  });

  it('renders a 24px facet hit area (WCAG 2.2 2.5.8)', () => {
    const page = html();
    expect(page).toContain('data-hit="24"');
    expect(tagWith(page, 'data-hit="24"')).toContain('min-height: calc(var(--spacing) * 6)');
  });

  it('ships a working three-state theme switcher', () => {
    const page = html();
    for (const mode of ['light', 'dark', 'system']) {
      expect(page).toContain(`data-set-theme="${mode}"`);
    }
    expect(page).toContain("removeAttribute('data-theme')");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/styles/styleguide.test.ts`

Expected: FAIL — 15 failed, 1 passed. `dist/styleguide/index.html` is still the four-line page from
Task A2.2, so it carries no `data-token` and no state specimen at all:

- `renders a swatch for every colour token` — `AssertionError: expected [the built styleguide HTML]
  to contain 'data-token="--color-n-1"'`
- every other token and state test fails the same way, on its own first missing attribute
- `keeps the palette guard in place` passes — `data-guard="palette-wipe"` has been on the page
  since Task A2.2

- [ ] **Step 3: Rewrite the styleguide route**

```bash
cat > src/pages/styleguide.astro <<'ASTRO'
---
import '../styles/theme.css';

const RAMP_ROLES: Record<number, string> = {
  1: 'app background',
  2: 'app background',
  3: 'component bg',
  4: 'hover',
  5: 'pressed / selected',
  6: 'subtle border',
  7: 'interactive border',
  8: 'focus ring',
  9: 'solid',
  10: 'solid hover',
  11: 'low-contrast text',
  12: 'high-contrast text',
};

const NEUTRAL = Array.from({ length: 12 }, (_, i) => `--color-n-${i + 1}`);
const ACCENT = Array.from({ length: 12 }, (_, i) => `--color-a-${i + 1}`);
const SEMANTIC = [
  '--background', '--foreground', '--card', '--card-foreground', '--popover',
  '--popover-foreground', '--primary', '--primary-foreground', '--secondary',
  '--secondary-foreground', '--muted', '--muted-foreground', '--accent',
  '--accent-foreground', '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
];
const TEXT = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
const MOTION = ['--motion-state', '--motion-enter', '--motion-overlay', '--motion-ease'];

const BUTTON_STATES = ['rest', 'hover', 'focus', 'pressed', 'disabled'];

// RUNTIME_ORDER (§9.2 status LEDs) — never alphabetical.
const RUNTIMES = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

// hazard: true marks the three consumers the token is reserved for.
const SAFETY_ROWS = [
  { key: 'executes-code', label: 'Executes code', value: '3 scripts · python, bash', hazard: true },
  { key: 'network', label: 'Network', value: 'HTTP calls found', hazard: true },
  { key: 'reads-env', label: 'Reads env', value: 'no', hazard: false },
  { key: 'not-declared', label: 'Declared tools', value: 'not declared', hazard: true },
];
const SCORES = [
  { key: 'adoption', label: 'Adoption', value: 21, max: 25 },
  { key: 'maintenance', label: 'Maintenance', value: 26, max: 30 },
  { key: 'provenance', label: 'Provenance', value: 25, max: 25 },
  { key: 'completeness', label: 'Completeness', value: 20, max: 20 },
];
const NODE_STATES = [
  { state: 'active', label: 'Supply Chain & Dependencies', detail: '31' },
  { state: 'below-mass', label: 'Threat Modeling', detail: '2 · below minimum mass' },
  { state: 'empty', label: 'Vertical Domain', detail: 'no entries yet' },
];
const FACETS = ['Executes code', 'Network access', 'Reads env', 'Portable'];

const HAZARD_STYLE = 'color: var(--color-hazard);';
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Styleguide — ai-tools-hub</title>
  </head>
  <body class="bg-background text-foreground">
    <span class="bg-red-500 bg-indigo-500 bg-hazard text-hazard rounded-lg shadow-lg" hidden data-guard="palette-wipe">palette guard</span>

    <main class="sg-page">
      <header class="sg-head">
        <h1 class="sg-h1">Styleguide</h1>
        <p class="sg-lede">
          Every design token and every component state rendered from
          <code>src/styles/theme.css</code>. If a swatch is blank, the token is gone.
        </p>
        <div class="sg-toolbar">
          <button type="button" class="sg-btn" data-set-theme="light">Light</button>
          <button type="button" class="sg-btn" data-set-theme="dark">Dark</button>
          <button type="button" class="sg-btn" data-set-theme="system">System</button>
        </div>
      </header>

      <section data-section="ramp-neutral">
        <h2 class="sg-h2">Neutral ramp</h2>
        <div class="sg-ramp">
          {NEUTRAL.map((token, i) => (
            <div class="sg-swatch" data-token={token}>
              <div class="sg-chip" style={`background: var(${token});`}></div>
              <code class="sg-name">{token}</code>
              <span class="sg-role">{RAMP_ROLES[i + 1]}</span>
            </div>
          ))}
        </div>
      </section>

      <section data-section="ramp-accent">
        <h2 class="sg-h2">Accent ramp</h2>
        <div class="sg-ramp">
          {ACCENT.map((token, i) => (
            <div class="sg-swatch" data-token={token}>
              <div class="sg-chip" style={`background: var(${token});`}></div>
              <code class="sg-name">{token}</code>
              <span class="sg-role">{RAMP_ROLES[i + 1]}</span>
            </div>
          ))}
        </div>
      </section>

      <section data-section="hazard">
        <h2 class="sg-h2">Hazard</h2>
        <p class="sg-note">
          One token, <code>--color-hazard</code>, for the safety module only. Permitted consumers:
          the safety strip, a stale date over 60 days, and an undeclared licence. It lives outside
          <code>@theme</code> on purpose, so no <code>bg-hazard</code> utility can ever exist.
        </p>
        <div class="sg-ramp">
          <div class="sg-swatch" data-token="--color-hazard">
            <div class="sg-chip" style="background: var(--color-hazard);"></div>
            <code class="sg-name">--color-hazard</code>
          </div>
        </div>
      </section>

      <section data-section="semantic">
        <h2 class="sg-h2">Semantic aliases</h2>
        <div class="sg-ramp">
          {SEMANTIC.map((token) => (
            <div class="sg-swatch" data-token={token}>
              <div class="sg-chip" style={`background: var(${token});`}></div>
              <code class="sg-name">{token}</code>
            </div>
          ))}
        </div>
      </section>

      <section data-section="geometry">
        <h2 class="sg-h2">Geometry</h2>
        <div class="sg-ramp">
          <div class="sg-swatch" data-token="--radius">
            <div class="sg-chip" style="background: var(--color-a-9); border-radius: var(--radius);"></div>
            <code class="sg-name">--radius</code>
            <span class="sg-role">0 — Industrial Console has no radius</span>
          </div>
          <div class="sg-swatch" data-token="--spacing">
            <div class="sg-chip" style="background: var(--color-n-6); height: calc(var(--spacing) * 4);"></div>
            <code class="sg-name">--spacing</code>
            <span class="sg-role">0.25rem base unit</span>
          </div>
        </div>
      </section>

      <section data-section="type">
        <h2 class="sg-h2">Type scale</h2>
        {TEXT.map((step) => (
          <p
            class="sg-type"
            data-token={`--text-${step}`}
            style={`font-size: var(--text-${step}); line-height: var(--text-${step}--line-height);`}
          >
            <span>text-{step}</span> <code class="sg-name">owner/repo@sha:path/SKILL.md</code>
          </p>
        ))}
      </section>

      <section data-section="fonts">
        <h2 class="sg-h2">Families</h2>
        <p class="sg-sans" data-token="--font-sans">
          Archivo carries prose. Depth over breadth. Judgment over recall.
        </p>
        <p class="sg-mono" data-token="--font-mono">
          JetBrains Mono carries every identifier, path, count, command and metric. 0123456789
        </p>
      </section>

      <section data-section="motion">
        <h2 class="sg-h2">Motion</h2>
        <div class="sg-ramp">
          {MOTION.map((token) => (
            <div class="sg-swatch" data-token={token}>
              <code class="sg-name">{token}</code>
            </div>
          ))}
        </div>
      </section>

      <section data-section="buttons">
        <h2 class="sg-h2">Button states</h2>
        <div class="sg-row">
          {BUTTON_STATES.map((state) => (
            <button type="button" class="sg-btn sg-btn-primary" data-state={state} disabled={state === 'disabled'}>
              {state}
            </button>
          ))}
        </div>
        <div class="sg-row">
          {BUTTON_STATES.map((state) => (
            <button type="button" class="sg-btn" data-state={state} disabled={state === 'disabled'}>
              {state}
            </button>
          ))}
        </div>
      </section>

      <section data-section="input">
        <h2 class="sg-h2">Input</h2>
        <div class="sg-row">
          <input class="sg-input" type="text" data-state="rest" value="kubernetes" />
          <input class="sg-input" type="text" data-state="focus" value="kubernetes" />
          <input class="sg-input" type="text" data-state="disabled" value="kubernetes" disabled />
        </div>
      </section>

      <section data-section="leds">
        <h2 class="sg-h2">Runtime LEDs — RUNTIME_ORDER</h2>
        <div class="sg-row">
          {RUNTIMES.map((runtime) => (
            <span class="sg-led-row" data-led={runtime}>
              <span class="sg-led"></span>
              <code class="sg-name">{runtime}</code>
            </span>
          ))}
        </div>
      </section>

      <section data-section="card">
        <h2 class="sg-h2">Panel card</h2>
        <article class="sg-card">
          <div class="sg-card-top">
            <code class="sg-name">#4</code>
            <code class="sg-name">92</code>
            {RUNTIMES.slice(0, 3).map((runtime) => (
              <span class="sg-led" data-led-chip={runtime}></span>
            ))}
          </div>
          <h3 class="sg-card-name">sbom-diff</h3>
          <p class="sg-card-desc">
            Diffs two CycloneDX SBOMs and reports added, removed and version-shifted components
            with their advisory status.
          </p>
          <ul class="sg-safety">
            {SAFETY_ROWS.map((row) => (
              <li data-safety={row.key} style={row.hazard ? HAZARD_STYLE : ''}>
                <span>{row.label}</span>
                <code class="sg-name">{row.value}</code>
              </li>
            ))}
          </ul>
          <div class="sg-card-meta">
            <code class="sg-name">trailofbits/skills</code>
            <code class="sg-name">6908 ★ · 412 ⑂</code>
            <code class="sg-name" data-stale="true" style={HAZARD_STYLE}>updated 214d ago</code>
          </div>
          <div class="sg-card-meta">
            <code class="sg-name" data-license="resolved">Apache-2.0</code>
            <code class="sg-name" data-license="not-declared" style={HAZARD_STYLE}>Not declared</code>
          </div>
        </article>
      </section>

      <section data-section="scores">
        <h2 class="sg-h2">Score breakdown</h2>
        {SCORES.map((score) => (
          <div class="sg-score" data-score={score.key}>
            <code class="sg-name">{score.label}</code>
            <div class="sg-score-track">
              <div class="sg-score-fill" style={`width: ${(score.value / score.max) * 100}%;`}></div>
            </div>
            <code class="sg-name">{score.value}/{score.max}</code>
          </div>
        ))}
      </section>

      <section data-section="nodes">
        <h2 class="sg-h2">Taxonomy node states</h2>
        <p class="sg-note">Three states, none of which lie (§10.1). Minimum mass is 5.</p>
        <div class="sg-row">
          {NODE_STATES.map((node) => (
            <span class="sg-node" data-node-state={node.state}>
              <span class="sg-node-label">{node.label}</span>
              <code class="sg-name">{node.state === 'empty' ? '—' : node.detail}</code>
              {node.state === 'empty' && <span class="sg-role">no entries yet</span>}
              {node.state === 'below-mass' && <span class="sg-role">{node.detail}</span>}
            </span>
          ))}
        </div>
      </section>

      <section data-section="facets">
        <h2 class="sg-h2">Facet rows — 24px hit area</h2>
        <div class="sg-facets">
          {FACETS.map((facet) => (
            <label class="sg-facet" data-hit="24" style="min-height: calc(var(--spacing) * 6);">
              <input type="checkbox" />
              <span>{facet}</span>
              <code class="sg-name">128</code>
            </label>
          ))}
        </div>
      </section>
    </main>

    <script is:inline>
      document.querySelectorAll('[data-set-theme]').forEach(function (el) {
        el.addEventListener('click', function () {
          var mode = el.getAttribute('data-set-theme');
          if (mode === 'system') document.documentElement.removeAttribute('data-theme');
          else document.documentElement.setAttribute('data-theme', mode);
        });
      });
    </script>

    <style>
      .sg-page {
        max-width: 76rem;
        margin: 0 auto;
        padding: calc(var(--spacing) * 8);
      }
      .sg-head {
        border-bottom-width: 1px;
        padding-bottom: calc(var(--spacing) * 4);
        margin-bottom: calc(var(--spacing) * 8);
      }
      .sg-h1 {
        font-family: var(--font-mono);
        font-size: var(--text-3xl);
        letter-spacing: -0.01em;
      }
      .sg-h2 {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--muted-foreground);
        border-bottom-width: 1px;
        padding-bottom: calc(var(--spacing) * 2);
        margin-bottom: calc(var(--spacing) * 4);
      }
      section {
        margin-bottom: calc(var(--spacing) * 10);
      }
      .sg-lede,
      .sg-note {
        color: var(--muted-foreground);
        font-size: var(--text-sm);
        max-width: 56ch;
        margin-bottom: calc(var(--spacing) * 4);
      }
      .sg-toolbar,
      .sg-row {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--spacing) * 2);
        align-items: center;
        margin-bottom: calc(var(--spacing) * 3);
      }
      .sg-ramp {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
        gap: calc(var(--spacing) * 2);
      }
      .sg-swatch {
        border-width: 1px;
        padding: calc(var(--spacing) * 2);
        background: var(--card);
      }
      .sg-chip {
        height: calc(var(--spacing) * 12);
        border-width: 1px;
        margin-bottom: calc(var(--spacing) * 2);
      }
      .sg-name {
        display: block;
        font-family: var(--font-mono);
        font-size: var(--text-xs);
      }
      .sg-role {
        display: block;
        font-size: var(--text-xs);
        color: var(--muted-foreground);
      }
      .sg-type {
        margin-bottom: calc(var(--spacing) * 2);
      }
      .sg-sans {
        font-family: var(--font-sans);
        font-size: var(--text-lg);
      }
      .sg-mono {
        font-family: var(--font-mono);
        font-size: var(--text-lg);
      }

      .sg-btn {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        border-width: 1px;
        padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 3);
        min-height: calc(var(--spacing) * 6);
        background: var(--secondary);
        color: var(--secondary-foreground);
        transition: background-color var(--motion-state) var(--motion-ease);
      }
      .sg-btn[data-state='hover'] {
        background: var(--color-n-4);
      }
      .sg-btn[data-state='pressed'] {
        background: var(--color-n-5);
      }
      .sg-btn[data-state='focus'] {
        outline: 2px solid var(--ring);
      }
      .sg-btn[data-state='disabled'] {
        color: var(--muted-foreground);
        border-color: var(--color-n-5);
      }
      .sg-btn-primary {
        background: var(--primary);
        color: var(--primary-foreground);
        border-color: var(--primary);
      }
      .sg-btn-primary[data-state='hover'] {
        background: var(--color-a-10);
      }
      .sg-btn-primary[data-state='pressed'] {
        background: var(--color-a-11);
      }
      .sg-btn-primary[data-state='disabled'] {
        background: var(--color-n-5);
        border-color: var(--color-n-5);
        color: var(--muted-foreground);
      }

      .sg-input {
        font-family: var(--font-mono);
        font-size: var(--text-sm);
        border-width: 1px;
        border-color: var(--input);
        background: var(--background);
        color: var(--foreground);
        padding: calc(var(--spacing) * 1.5) calc(var(--spacing) * 2);
        min-height: calc(var(--spacing) * 6);
      }
      .sg-input[data-state='focus'] {
        outline: 2px solid var(--ring);
      }
      .sg-input[data-state='disabled'] {
        color: var(--muted-foreground);
      }

      .sg-led {
        display: inline-block;
        width: calc(var(--spacing) * 2);
        height: calc(var(--spacing) * 2);
        background: var(--color-a-9);
        border-width: 1px;
      }
      .sg-led-row {
        display: inline-flex;
        align-items: center;
        gap: calc(var(--spacing) * 1.5);
        border-width: 1px;
        padding: calc(var(--spacing) * 1) calc(var(--spacing) * 2);
      }
      [data-led='generic'] .sg-led,
      .sg-led[data-led-chip='generic'] {
        background: var(--color-n-8);
      }

      .sg-card {
        border-width: 1px;
        background: var(--card);
        color: var(--card-foreground);
        padding: calc(var(--spacing) * 3);
        max-width: 26rem;
      }
      .sg-card-top {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing) * 2);
        margin-bottom: calc(var(--spacing) * 2);
      }
      .sg-card-name {
        font-family: var(--font-mono);
        font-size: var(--text-lg);
      }
      .sg-card-desc {
        font-size: var(--text-sm);
        color: var(--muted-foreground);
        margin: calc(var(--spacing) * 2) 0;
      }
      /* The strip is one of the three places allowed to reach for the hazard
         token; the row colours themselves are set inline, per row. */
      .sg-safety {
        border-width: 1px;
        border-color: var(--color-hazard);
        padding: calc(var(--spacing) * 2);
        margin-bottom: calc(var(--spacing) * 2);
      }
      .sg-safety li {
        display: flex;
        justify-content: space-between;
        gap: calc(var(--spacing) * 2);
        font-size: var(--text-xs);
      }
      .sg-card-meta {
        display: flex;
        flex-wrap: wrap;
        gap: calc(var(--spacing) * 2);
        margin-bottom: calc(var(--spacing) * 1);
      }

      .sg-score {
        display: grid;
        grid-template-columns: 9rem 1fr 5rem;
        align-items: center;
        gap: calc(var(--spacing) * 2);
        margin-bottom: calc(var(--spacing) * 2);
      }
      .sg-score-track {
        height: calc(var(--spacing) * 2);
        background: var(--color-n-3);
        border-width: 1px;
      }
      .sg-score-fill {
        height: 100%;
        background: var(--color-a-9);
      }

      .sg-node {
        display: inline-flex;
        flex-direction: column;
        gap: calc(var(--spacing) * 1);
        border-width: 1px;
        padding: calc(var(--spacing) * 2) calc(var(--spacing) * 3);
        min-height: calc(var(--spacing) * 6);
      }
      .sg-node[data-node-state='active'] {
        border-color: var(--color-a-7);
        color: var(--color-a-11);
      }
      .sg-node[data-node-state='below-mass'] {
        color: var(--muted-foreground);
        border-color: var(--color-n-5);
      }
      .sg-node[data-node-state='empty'] {
        color: var(--muted-foreground);
        border-color: var(--color-n-4);
      }

      .sg-facets {
        display: flex;
        flex-direction: column;
        max-width: 20rem;
      }
      .sg-facet {
        display: flex;
        align-items: center;
        gap: calc(var(--spacing) * 2);
        font-size: var(--text-sm);
        border-bottom-width: 1px;
        padding: calc(var(--spacing) * 1) 0;
      }
      .sg-facet code {
        margin-left: auto;
        color: var(--muted-foreground);
      }
    </style>
  </body>
</html>
ASTRO
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/styles/styleguide.test.ts`

Expected: PASS — 16 passing tests.

- [ ] **Step 5: Run the whole styles suite against a clean build**

Run: `rm -rf dist && npx vitest run tests/styles`

Expected: PASS — all ten files. Removing `dist/` first proves the suite depends on nothing but
`globalSetup`'s single `astro build`; no test in this section builds, and none may.

- [ ] **Step 6: Commit**

```bash
git add src/pages/styleguide.astro tests/styles/styleguide.test.ts
git commit -m "feat(design): render every token and component state on /styleguide"
```

---

**Section A3 owns exactly four files** — `data/taxonomy.json`, `src/lib/taxonomy.ts`,
`scripts/validate-taxonomy.ts` and `.github/workflows/ci.yml` — plus its own tests under
`tests/`. It creates nothing else. The one file it touches but does not own is `package.json`
(A1), edited once through an exact anchor string in Task A3.4.

`scripts/validate-taxonomy.ts` has exactly one meaning in this repo: **the seven governance
checks of spec §12, exiting non-zero on failure.** It takes no `argv` and validates no arbitrary
file path.

No A3 test reads or writes `dist/`, so nothing here races the build (RULE 6).

---

### Task A3.1: Taxonomy data file

The hand-written source of truth: 13 domains, `security` fully expanded into its 15 subdomains
with both locales and `frameworkRefs`, plus `PROTECTED`, `ALIASES` and `minimumMass: 5`.

**Files:**
- Create: `data/taxonomy.json`
- Test: `tests/data/taxonomy-file.test.ts`

**Interfaces:**
- Consumes: `Taxonomy`, `TaxonomyNode` from `src/types.ts` (A1.5)
- Produces: `data/taxonomy.json`, conforming to `Taxonomy`, with exactly 40 nodes (13 domains + 15 security children + 12 `general` leaves)

- [ ] **Step 1: Write the failing test**

```ts
// tests/data/taxonomy-file.test.ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';

const TAXONOMY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/taxonomy.json');
const tax = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as Taxonomy;

const SECURITY_CHILDREN = [
  'security/code-application', 'security/secrets-credentials', 'security/supply-chain',
  'security/iac-config', 'security/cloud-permissions', 'security/containers-kubernetes',
  'security/cicd-pipeline', 'security/identity-access', 'security/data-protection',
  'security/offensive-testing', 'security/detection-forensics', 'security/compliance-grc',
  'security/ai-agent-security', 'security/threat-modeling', 'security/general',
];

const OTHER_DOMAINS = [
  'coding-software', 'devops-infra', 'data-analytics', 'ai-agent-eng', 'docs-formats',
  'writing-docs', 'research-knowledge', 'design-creative', 'business-product',
  'productivity', 'agent-authoring', 'vertical-domain',
];

describe('data/taxonomy.json', () => {
  it('has the 13 top-level domains with security first', () => {
    expect(tax.domains.map((d) => d.slug)).toEqual(['security', ...OTHER_DOMAINS]);
  });

  it('expands security into exactly the 15 subdomains', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    expect(security?.children?.map((c) => c.slug)).toEqual(SECURITY_CHILDREN);
  });

  it('names every node in both locales', () => {
    for (const domain of tax.domains) {
      for (const node of [domain, ...(domain.children ?? [])]) {
        expect(node.name.en.length, `${node.slug} en`).toBeGreaterThan(0);
        expect(node.name.pt.length, `${node.slug} pt`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps CI/CD and Supply Chain verbatim in pt-BR', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    const cicd = security?.children?.find((c) => c.slug === 'security/cicd-pipeline');
    const supply = security?.children?.find((c) => c.slug === 'security/supply-chain');
    expect(cicd?.name.pt).toBe('CI/CD e Pipeline');
    expect(supply?.name.pt).toBe('Supply Chain e Dependências');
  });

  it('carries frameworkRefs on every security subdomain except general', () => {
    const security = tax.domains.find((d) => d.slug === 'security');
    for (const child of security?.children ?? []) {
      if (child.slug === 'security/general') continue;
      expect(child.frameworkRefs?.length, child.slug).toBeGreaterThan(0);
    }
  });

  it('declares the governance lists from the spec', () => {
    expect(tax.protected).toEqual(['CI/CD', 'Kubernetes', 'Supply Chain', 'IaC', 'SBOM', 'SLSA', 'OWASP', 'MCP', 'DAST', 'SAST', 'IAM']);
    expect(tax.aliases).toEqual({
      grc: 'compliance-grc', k8s: 'containers-kubernetes', appsec: 'code-application',
      cspm: 'cloud-permissions', ciem: 'cloud-permissions', posture: 'cloud-permissions',
      ir: 'detection-forensics', siem: 'detection-forensics', sca: 'supply-chain',
    });
    expect(tax.minimumMass).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/taxonomy-file.test.ts`

Expected: FAIL. The file is read at module scope, so the whole file errors before any test runs,
with `Error: ENOENT: no such file or directory, open '/home/kyo/projects/ai-tools-hub/data/taxonomy.json'`.

- [ ] **Step 3: Write the taxonomy data file**

```json
{
  "domains": [
    {
      "slug": "security",
      "name": { "en": "Security", "pt": "Segurança" },
      "children": [
        {
          "slug": "security/code-application",
          "name": { "en": "Code & Application", "pt": "Código e Aplicação" },
          "frameworkRefs": ["OWASP A01:2025", "OWASP A05:2025", "OWASP A06:2025"]
        },
        {
          "slug": "security/secrets-credentials",
          "name": { "en": "Secrets & Credentials", "pt": "Segredos e Credenciais" },
          "frameworkRefs": ["CIS Control 5"]
        },
        {
          "slug": "security/supply-chain",
          "name": { "en": "Supply Chain & Dependencies", "pt": "Supply Chain e Dependências" },
          "frameworkRefs": ["OWASP A03:2025", "SLSA"]
        },
        {
          "slug": "security/iac-config",
          "name": { "en": "Infrastructure as Code", "pt": "Infraestrutura como Código" },
          "frameworkRefs": ["OWASP A02:2025", "CIS Benchmarks"]
        },
        {
          "slug": "security/cloud-permissions",
          "name": { "en": "Cloud Permissions", "pt": "Permissões em Nuvem" },
          "frameworkRefs": ["NIST CSF PR.AA"]
        },
        {
          "slug": "security/containers-kubernetes",
          "name": { "en": "Containers & Kubernetes", "pt": "Contêineres e Kubernetes" },
          "frameworkRefs": ["Gartner CNAPP"]
        },
        {
          "slug": "security/cicd-pipeline",
          "name": { "en": "CI/CD & Pipeline", "pt": "CI/CD e Pipeline" },
          "frameworkRefs": ["OWASP A08:2025", "SLSA"]
        },
        {
          "slug": "security/identity-access",
          "name": { "en": "Identity & Access", "pt": "Identidade e Acesso" },
          "frameworkRefs": ["OWASP A07:2025", "CIS Control 6"]
        },
        {
          "slug": "security/data-protection",
          "name": { "en": "Data Protection & Privacy", "pt": "Proteção de Dados e Privacidade" },
          "frameworkRefs": ["NIST CSF PR.DS", "CIS Control 3"]
        },
        {
          "slug": "security/offensive-testing",
          "name": { "en": "Offensive Security & Testing", "pt": "Segurança Ofensiva e Testes" },
          "frameworkRefs": ["MITRE ATT&CK", "CIS Control 18"]
        },
        {
          "slug": "security/detection-forensics",
          "name": { "en": "Detection & Forensics", "pt": "Detecção e Forense" },
          "frameworkRefs": ["NIST CSF DE.CM", "NIST CSF RS.MA"]
        },
        {
          "slug": "security/compliance-grc",
          "name": { "en": "Compliance, Risk & Audit", "pt": "Conformidade, Risco e Auditoria" },
          "frameworkRefs": ["NIST CSF GOVERN"]
        },
        {
          "slug": "security/ai-agent-security",
          "name": { "en": "AI & Agent Security", "pt": "Segurança de IA e Agentes" },
          "frameworkRefs": ["OWASP Top 10 for LLM Applications 2025"]
        },
        {
          "slug": "security/threat-modeling",
          "name": { "en": "Threat Modeling", "pt": "Modelagem de Ameaças" },
          "frameworkRefs": ["OWASP SAMM"]
        },
        {
          "slug": "security/general",
          "name": { "en": "General / Other", "pt": "Geral / Outros" }
        }
      ]
    },
    {
      "slug": "coding-software",
      "name": { "en": "Coding & Software", "pt": "Programação e Software" },
      "children": [
        { "slug": "coding-software/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "devops-infra",
      "name": { "en": "DevOps & Infrastructure", "pt": "DevOps e Infraestrutura" },
      "children": [
        { "slug": "devops-infra/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "data-analytics",
      "name": { "en": "Data & Analytics", "pt": "Dados e Analytics" },
      "children": [
        { "slug": "data-analytics/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "ai-agent-eng",
      "name": { "en": "AI & Agent Engineering", "pt": "Engenharia de IA e Agentes" },
      "children": [
        { "slug": "ai-agent-eng/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "docs-formats",
      "name": { "en": "Documents & Formats", "pt": "Documentos e Formatos" },
      "children": [
        { "slug": "docs-formats/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "writing-docs",
      "name": { "en": "Writing & Documentation", "pt": "Escrita e Documentação" },
      "children": [
        { "slug": "writing-docs/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "research-knowledge",
      "name": { "en": "Research & Knowledge", "pt": "Pesquisa e Conhecimento" },
      "children": [
        { "slug": "research-knowledge/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "design-creative",
      "name": { "en": "Design & Creative", "pt": "Design e Criação" },
      "children": [
        { "slug": "design-creative/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "business-product",
      "name": { "en": "Business & Product", "pt": "Negócios e Produto" },
      "children": [
        { "slug": "business-product/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "productivity",
      "name": { "en": "Productivity", "pt": "Produtividade" },
      "children": [
        { "slug": "productivity/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "agent-authoring",
      "name": { "en": "Agent Authoring", "pt": "Criação de Agentes" },
      "children": [
        { "slug": "agent-authoring/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    },
    {
      "slug": "vertical-domain",
      "name": { "en": "Vertical Domains", "pt": "Domínios Verticais" },
      "children": [
        { "slug": "vertical-domain/general", "name": { "en": "General / Other", "pt": "Geral / Outros" } }
      ]
    }
  ],
  "protected": ["CI/CD", "Kubernetes", "Supply Chain", "IaC", "SBOM", "SLSA", "OWASP", "MCP", "DAST", "SAST", "IAM"],
  "aliases": {
    "grc": "compliance-grc",
    "k8s": "containers-kubernetes",
    "appsec": "code-application",
    "cspm": "cloud-permissions",
    "ciem": "cloud-permissions",
    "posture": "cloud-permissions",
    "ir": "detection-forensics",
    "siem": "detection-forensics",
    "sca": "supply-chain"
  },
  "minimumMass": 5
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/taxonomy-file.test.ts`

Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add data/taxonomy.json tests/data/taxonomy-file.test.ts
git commit -m "feat(taxonomy): hand-written two-level taxonomy with security fully expanded"
```

---

### Task A3.2: Taxonomy loader

`loadTaxonomy()` reads the committed JSON once and caches it; `flattenTaxonomy()` walks it into a
flat node list that every governance check and every page reuses.

**Files:**
- Create: `src/lib/taxonomy.ts`
- Test: `tests/lib/taxonomy-load.test.ts`

**Interfaces:**
- Consumes: `data/taxonomy.json` (A3.1); `Taxonomy`, `TaxonomyNode` from `src/types.ts` (A1.5)
- Produces: `loadTaxonomy(): Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/taxonomy-load.test.ts
import { describe, expect, it } from 'vitest';
import { flattenTaxonomy, loadTaxonomy } from '../../src/lib/taxonomy.ts';

describe('loadTaxonomy', () => {
  it('reads the committed taxonomy regardless of cwd', () => {
    const tax = loadTaxonomy();
    expect(tax.domains).toHaveLength(13);
    expect(tax.minimumMass).toBe(5);
  });

  it('caches, returning the same object on a second call', () => {
    expect(loadTaxonomy()).toBe(loadTaxonomy());
  });
});

describe('flattenTaxonomy', () => {
  it('returns all 40 nodes, each domain immediately followed by its children', () => {
    const flat = flattenTaxonomy(loadTaxonomy());
    expect(flat).toHaveLength(40);
    expect(flat[0]?.slug).toBe('security');
    expect(flat[1]?.slug).toBe('security/code-application');
    expect(flat[16]?.slug).toBe('coding-software');
  });

  it('includes every security subdomain', () => {
    const slugs = flattenTaxonomy(loadTaxonomy()).map((n) => n.slug);
    expect(slugs).toContain('security/ai-agent-security');
    expect(slugs).toContain('security/general');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/taxonomy-load.test.ts`

Expected: FAIL — `src/lib/taxonomy.ts` does not exist, so Vitest cannot resolve the import and
reports, before any test runs:
`Error: Failed to load url ../../src/lib/taxonomy.ts (resolved id: /home/kyo/projects/ai-tools-hub/src/lib/taxonomy.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**

The path is resolved from `import.meta.url`, not from `process.cwd()`, so the same module works
under vitest, under `astro build`, and under a plain `node scripts/*.ts` invocation.

```ts
// src/lib/taxonomy.ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Taxonomy, TaxonomyNode } from '../types.ts';

const TAXONOMY_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/taxonomy.json');

let cached: Taxonomy | null = null;

export function loadTaxonomy(): Taxonomy {
  if (cached === null) {
    cached = JSON.parse(readFileSync(TAXONOMY_PATH, 'utf8')) as Taxonomy;
  }
  return cached;
}

export function flattenTaxonomy(tax: Taxonomy): TaxonomyNode[] {
  const out: TaxonomyNode[] = [];
  for (const domain of tax.domains) {
    out.push(domain);
    for (const child of domain.children ?? []) out.push(child);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/taxonomy-load.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy.ts tests/lib/taxonomy-load.test.ts
git commit -m "feat(taxonomy): cwd-independent taxonomy loader with flatten helper"
```

---

### Task A3.3: Localised node names

`nodeName(slug, lang)` is the only way any page renders a taxonomy label, so an unknown slug must
fail the build loudly instead of rendering an empty string.

**Files:**
- Modify: `src/lib/taxonomy.ts` (A3 owns it — change the type import, append one exported function)
- Test: `tests/lib/node-name.test.ts`

**Interfaces:**
- Consumes: `loadTaxonomy(): Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`, `Lang` from `src/types.ts`
- Produces: `nodeName(slug: string, lang: Lang): string` — throws `nodeName: unknown taxonomy slug "<slug>"` when the slug is not in the taxonomy

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/node-name.test.ts
import { describe, expect, it } from 'vitest';
import { nodeName } from '../../src/lib/taxonomy.ts';

describe('nodeName', () => {
  it('localises a domain', () => {
    expect(nodeName('security', 'en')).toBe('Security');
    expect(nodeName('security', 'pt')).toBe('Segurança');
  });

  it('localises a child by its full slug', () => {
    expect(nodeName('security/supply-chain', 'en')).toBe('Supply Chain & Dependencies');
    expect(nodeName('security/supply-chain', 'pt')).toBe('Supply Chain e Dependências');
  });

  it('localises the named overflow leaf of a thin domain', () => {
    expect(nodeName('productivity/general', 'en')).toBe('General / Other');
    expect(nodeName('productivity/general', 'pt')).toBe('Geral / Outros');
  });

  it('throws loudly on an unknown slug rather than returning a blank label', () => {
    expect(() => nodeName('security/does-not-exist', 'en')).toThrow('nodeName: unknown taxonomy slug "security/does-not-exist"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/node-name.test.ts`

Expected: FAIL — `src/lib/taxonomy.ts` resolves but exports no `nodeName`, so the imported binding
is `undefined` and every one of the 4 tests errors with a TypeError saying `nodeName` is not a
function.

- [ ] **Step 3: Write minimal implementation**

Change the type import at the top of `src/lib/taxonomy.ts` from

```ts
import type { Taxonomy, TaxonomyNode } from '../types.ts';
```

to

```ts
import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';
```

then append to the end of `src/lib/taxonomy.ts`:

```ts
export function nodeName(slug: string, lang: Lang): string {
  const node = flattenTaxonomy(loadTaxonomy()).find((n) => n.slug === slug);
  if (node === undefined) throw new Error(`nodeName: unknown taxonomy slug "${slug}"`);
  return node.name[lang];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/node-name.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/taxonomy.ts tests/lib/node-name.test.ts
git commit -m "feat(taxonomy): nodeName localises slugs and throws on unknown ones"
```

---

### Task A3.4: Validator harness and check 1 — minimum mass

Spec §12.1. `minimumMass` is what stops a category link landing in an empty dead end. A missing,
zero or fractional threshold silently disables that rule, and an absurd one hides the whole
catalog, so all three are CI failures.

This task creates `scripts/validate-taxonomy.ts`, and A3 is the only section that creates it. The
file is the seven governance checks and nothing else: it reads the committed taxonomy through
`loadTaxonomy()`, takes no `argv`, and exits non-zero when any check fails.

**Files:**
- Create: `scripts/validate-taxonomy.ts`
- Modify: `package.json` (A1 owns it — anchored edit against A1.4's exact line `"typecheck": "tsc --noEmit"`)
- Test: `tests/validate/minimum-mass.test.ts`

**Interfaces:**
- Consumes: `loadTaxonomy(): Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]` (A3.2); `Taxonomy` from `src/types.ts`
- Produces: `CheckResult { name: string; ok: boolean; errors: string[] }`, `checkMinimumMass(tax: Taxonomy): CheckResult`, `runAllChecks(tax: Taxonomy): CheckResult[]`, `formatResults(results: CheckResult[]): string`, `npm run validate` exiting non-zero on failure

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/minimum-mass.test.ts
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkMinimumMass } from '../../scripts/validate-taxonomy.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 1 - minimum mass', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkMinimumMass(loadTaxonomy())).toEqual({ name: '1 minimum mass', ok: true, errors: [] });
  });

  it('rejects a zero threshold, which silently disables the rule', () => {
    const tax = mutable();
    tax.minimumMass = 0;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('minimumMass must be >= 1');
  });

  it('rejects a non-integer threshold', () => {
    const tax = mutable();
    tax.minimumMass = 5.5;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('must be an integer');
  });

  it('rejects an absurd threshold that would hide the whole catalog', () => {
    const tax = mutable();
    tax.minimumMass = 500;
    const result = checkMinimumMass(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('must be <= 50');
  });
});

describe('the validate CLI', () => {
  it('exits 0 on the committed taxonomy', () => {
    const stdout = execFileSync('node', ['scripts/validate-taxonomy.ts'], { cwd: ROOT, encoding: 'utf8' });
    expect(stdout).toContain('PASS  1 minimum mass');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/minimum-mass.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` does not exist, so Vitest cannot resolve the import
and reports, before any test runs:
`Error: Failed to load url ../../scripts/validate-taxonomy.ts (resolved id: /home/kyo/projects/ai-tools-hub/scripts/validate-taxonomy.ts). Does the file exist?`

- [ ] **Step 3: Write the harness plus check 1**

Node strips types from `.ts` files with no flags from 22.18 on (CI pins Node 24, A3.11), which is
why the runtime import of `../src/lib/taxonomy.ts` carries its extension and the `Taxonomy` import
is `import type` (erased before resolution).

```ts
// scripts/validate-taxonomy.ts
// The seven taxonomy governance checks of spec §12. Reads the committed taxonomy; takes no argv.
import { pathToFileURL } from 'node:url';
import type { Taxonomy } from '../src/types.ts';
import { flattenTaxonomy, loadTaxonomy } from '../src/lib/taxonomy.ts';

export interface CheckResult {
  name: string;
  ok: boolean;
  errors: string[];
}

export function checkMinimumMass(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  if (typeof tax.minimumMass !== 'number' || !Number.isInteger(tax.minimumMass)) {
    errors.push(`minimumMass must be an integer, got ${JSON.stringify(tax.minimumMass)}`);
  } else if (tax.minimumMass < 1) {
    errors.push(`minimumMass must be >= 1, got ${tax.minimumMass} (0 silently disables the rule)`);
  } else if (tax.minimumMass > 50) {
    errors.push(`minimumMass must be <= 50, got ${tax.minimumMass} (would hide the whole catalog)`);
  }
  return { name: '1 minimum mass', ok: errors.length === 0, errors };
}

export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
  ];
}

export function formatResults(results: CheckResult[]): string {
  return results
    .map((r) => (r.ok ? `PASS  ${r.name}` : [`FAIL  ${r.name}`, ...r.errors.map((e) => `        ${e}`)].join('\n')))
    .join('\n');
}

function main(): void {
  const tax = loadTaxonomy();
  const results = runAllChecks(tax);
  console.log(formatResults(results));
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    failed === 0
      ? `\n${results.length} check(s) passed over ${flattenTaxonomy(tax).length} taxonomy nodes`
      : `\n${failed} check(s) failed`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Wire the npm script**

`package.json` belongs to A1. Make a single anchored edit: find the line A1.4 wrote, which appears
exactly once in the file,

```json
    "typecheck": "tsc --noEmit"
```

and replace it with

```json
    "typecheck": "tsc --noEmit",
    "validate": "node scripts/validate-taxonomy.ts"
```

Do **not** rewrite `package.json` through a JSON parse/stringify round-trip: that reorders keys and
invalidates the line-range edits A1 makes against the `scripts` block.

- [ ] **Step 5: Run the CLI by hand**

Run: `npm run validate`

Expected: prints `PASS  1 minimum mass` then `1 check(s) passed over 40 taxonomy nodes`, exit code 0.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/validate/minimum-mass.test.ts`

Expected: PASS (5 tests)

- [ ] **Step 7: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/minimum-mass.test.ts package.json
git commit -m "feat(governance): validate-taxonomy harness with check 1 minimum mass"
```

---

### Task A3.5: Check 2 — named overflow

Spec §3.1 and §12.2. 29% of real security entries match no subdomain, so every domain needs a
named `general` leaf; unnamed overflow is worse than named.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (insert one function above `runAllChecks`, replace `runAllChecks`)
- Test: `tests/validate/named-overflow.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`
- Produces: `checkNamedOverflow(tax: Taxonomy): CheckResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/named-overflow.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkNamedOverflow } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 2 - named overflow', () => {
  it('passes: all 13 domains carry a general leaf', () => {
    expect(checkNamedOverflow(loadTaxonomy())).toEqual({ name: '2 named overflow', ok: true, errors: [] });
  });

  it('fails when a domain loses its general leaf', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children = [];
    const result = checkNamedOverflow(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['domain "productivity" has no named overflow leaf "productivity/general"']);
  });

  it('fails when the general leaf is missing a pt-BR label', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const general = security!.children!.find((c) => c.slug === 'security/general');
    general!.name.pt = '';
    const result = checkNamedOverflow(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('needs a non-empty name in both locales');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/named-overflow.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` resolves but exports no `checkNamedOverflow`, so all
3 tests error with a TypeError saying `checkNamedOverflow` is not a function.

- [ ] **Step 3: Add the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function checkNamedOverflow(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  for (const domain of tax.domains) {
    const wanted = `${domain.slug}/general`;
    const leaf = (domain.children ?? []).find((c) => c.slug === wanted);
    if (leaf === undefined) {
      errors.push(`domain "${domain.slug}" has no named overflow leaf "${wanted}"`);
      continue;
    }
    if (leaf.name.en.trim() === '' || leaf.name.pt.trim() === '') {
      errors.push(`overflow leaf "${wanted}" needs a non-empty name in both locales`);
    }
  }
  return { name: '2 named overflow', ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Register it**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/validate/named-overflow.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 6: Verify the CLI still exits 0**

Run: `npm run validate`

Expected: `PASS  1 minimum mass` and `PASS  2 named overflow`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/named-overflow.test.ts
git commit -m "feat(governance): check 2 every domain has a named general leaf"
```

---

### Task A3.6: Check 3 — unique slug

Spec §12.3. `awesome-mcp-servers` shipped a duplicated section; a duplicated slug here would make
one node unreachable and silently split its entries.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (insert one function above `runAllChecks`, replace `runAllChecks`)
- Test: `tests/validate/unique-slug.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`
- Produces: `checkUniqueSlug(tax: Taxonomy): CheckResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/unique-slug.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkUniqueSlug } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 3 - unique slug', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkUniqueSlug(loadTaxonomy())).toEqual({ name: '3 unique slug', ok: true, errors: [] });
  });

  it('catches a duplicated subdomain inside one domain', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/supply-chain', name: { en: 'Supply Chain again', pt: 'Supply Chain de novo' } });
    const result = checkUniqueSlug(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['duplicate slug "security/supply-chain"']);
  });

  it('catches a child that collides with a domain slug', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children!.push({ slug: 'security', name: { en: 'Security', pt: 'Segurança' } });
    const result = checkUniqueSlug(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['duplicate slug "security"']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/unique-slug.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` exports no `checkUniqueSlug`, so all 3 tests error
with a TypeError saying `checkUniqueSlug` is not a function.

- [ ] **Step 3: Add the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function checkUniqueSlug(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const node of flattenTaxonomy(tax)) {
    if (seen.has(node.slug)) errors.push(`duplicate slug "${node.slug}"`);
    seen.add(node.slug);
  }
  return { name: '3 unique slug', ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Register it**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/validate/unique-slug.test.ts`

Expected: PASS (3 tests)

- [ ] **Step 6: Verify the CLI still exits 0**

Run: `npm run validate`

Expected: three `PASS` lines, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/unique-slug.test.ts
git commit -m "feat(governance): check 3 slug uniqueness across the whole taxonomy"
```

---

### Task A3.7: Check 4 — the alias map resolves

Spec §3.5 and §12.4. Aliases are the acronyms deliberately kept out of visible labels (`GRC`,
`IR`, `k8s`) but still searchable. An alias pointing at a renamed node is a dead search path, and
an alias key that shadows a real slug is a routing bug.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (add the `SEGMENT` constant, insert one function above `runAllChecks`, replace `runAllChecks`)
- Test: `tests/validate/alias-map.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`
- Produces: `checkAliasMap(tax: Taxonomy): CheckResult`; module-level `const SEGMENT: RegExp`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/alias-map.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkAliasMap } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 4 - alias map', () => {
  it('passes: all 9 aliases resolve to exactly one node', () => {
    expect(checkAliasMap(loadTaxonomy())).toEqual({ name: '4 alias map', ok: true, errors: [] });
  });

  it('fails when an alias points at a node that no longer exists', () => {
    const tax = mutable();
    tax.aliases.dast = 'offensive-security';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(['alias "dast" points at "offensive-security", which is not a node']);
  });

  it('fails when an alias target is ambiguous across domains', () => {
    const tax = mutable();
    tax.aliases.overflow = 'general';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('which is ambiguous');
  });

  it('fails when an alias key shadows a real node slug', () => {
    const tax = mutable();
    tax.aliases['supply-chain'] = 'code-application';
    const result = checkAliasMap(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('alias key "supply-chain" shadows a real node slug');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/alias-map.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` exports no `checkAliasMap`, so all 4 tests error
with a TypeError saying `checkAliasMap` is not a function.

- [ ] **Step 3: Add the shared slug-segment pattern**

Insert into `scripts/validate-taxonomy.ts` immediately below the `CheckResult` interface:

```ts
const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
```

- [ ] **Step 4: Add the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function checkAliasMap(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  const nodes = flattenTaxonomy(tax);
  const slugs = new Set(nodes.map((n) => n.slug));
  for (const [alias, target] of Object.entries(tax.aliases)) {
    if (!SEGMENT.test(alias)) errors.push(`alias key "${alias}" is not lowercase kebab-case`);
    if (slugs.has(alias) || nodes.some((n) => n.slug.endsWith(`/${alias}`))) {
      errors.push(`alias key "${alias}" shadows a real node slug`);
    }
    const matches = nodes.filter((n) => n.slug === target || n.slug.endsWith(`/${target}`));
    if (matches.length === 0) errors.push(`alias "${alias}" points at "${target}", which is not a node`);
    if (matches.length > 1) {
      errors.push(`alias "${alias}" points at "${target}", which is ambiguous: ${matches.map((m) => m.slug).join(', ')}`);
    }
  }
  return { name: '4 alias map', ok: errors.length === 0, errors };
}
```

- [ ] **Step 5: Register it**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
  ];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/validate/alias-map.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 7: Verify the CLI still exits 0**

Run: `npm run validate`

Expected: four `PASS` lines, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/alias-map.test.ts
git commit -m "feat(governance): check 4 every alias resolves to exactly one node"
```

---

### Task A3.8: Check 5 — versioned slugs and redirects

Spec §3.1, §3.5 and §12.5. Display names may change freely ("Software Supply Chain Failures" only
became OWASP A03 in the 2025 edition); slugs may not, because after launch each rename costs a
redirect. Two frozen ledgers make that a deliberate edit instead of an accident:

- `KNOWN_SLUGS` — every slug the taxonomy has ever published.
- `SLUG_REDIRECTS` — retired slug → the live slug that replaced it.

The check ties them together: a slug may leave the taxonomy **only** when a redirect takes its
place, a redirect may only point at a slug that is currently live, and a redirect may not exist for
a slug that is still live. `SLUG_REDIRECTS` is empty today because nothing has shipped and nothing
has been renamed — the value is that the first rename cannot merge without its redirect.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (add `KNOWN_SLUGS` and `SLUG_REDIRECTS`, insert one function above `runAllChecks`, replace `runAllChecks`)
- Test: `tests/validate/slug-stability.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`, `SEGMENT`
- Produces: `KNOWN_SLUGS: string[]` (all 40 slugs), `SLUG_REDIRECTS: Record<string, string>`, `checkSlugStability(tax: Taxonomy, redirects?: Record<string, string>): CheckResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/slug-stability.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { flattenTaxonomy, loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { KNOWN_SLUGS, SLUG_REDIRECTS, checkSlugStability } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

function without(slug: string): Taxonomy {
  const tax = mutable();
  for (const domain of tax.domains) {
    domain.children = (domain.children ?? []).filter((c) => c.slug !== slug);
  }
  return tax;
}

describe('check 5 - versioned slugs and redirects', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkSlugStability(loadTaxonomy())).toEqual({ name: '5 slug stability', ok: true, errors: [] });
  });

  it('freezes all 40 slugs in KNOWN_SLUGS', () => {
    expect([...KNOWN_SLUGS].sort()).toEqual(flattenTaxonomy(loadTaxonomy()).map((n) => n.slug).sort());
  });

  it('every shipped redirect points from a frozen slug to a live one', () => {
    const live = new Set(flattenTaxonomy(loadTaxonomy()).map((n) => n.slug));
    for (const [from, to] of Object.entries(SLUG_REDIRECTS)) {
      expect(KNOWN_SLUGS, from).toContain(from);
      expect(live.has(from), `${from} is still live`).toBe(false);
      expect(live.has(to), `${from} -> ${to}`).toBe(true);
    }
  });

  it('ignores a display-name rewrite entirely', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cloud-permissions');
    node!.name.en = 'Cloud Posture Management';
    node!.name.pt = 'Gestão de Postura em Nuvem';
    expect(checkSlugStability(tax).ok).toBe(true);
  });

  it('fails when a display-name change drags the slug with it', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cloud-permissions');
    node!.slug = 'security/cloud-posture';
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('slug "security/cloud-posture" is not in KNOWN_SLUGS - add it deliberately, and add a SLUG_REDIRECTS entry if it renames an old slug');
    expect(result.errors).toContain('KNOWN_SLUGS lists "security/cloud-permissions" but the taxonomy no longer has it - add SLUG_REDIRECTS["security/cloud-permissions"] pointing at its replacement');
  });

  it('accepts a retired slug once a redirect takes its place', () => {
    const result = checkSlugStability(without('security/threat-modeling'), {
      'security/threat-modeling': 'security/general',
    });
    expect(result).toEqual({ name: '5 slug stability', ok: true, errors: [] });
  });

  it('rejects a redirect that points at a slug which is not live', () => {
    const result = checkSlugStability(without('security/threat-modeling'), {
      'security/threat-modeling': 'security/nowhere',
    });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/threat-modeling" points at "security/nowhere", which is not a live slug');
  });

  it('rejects a redirect whose source is still live', () => {
    const result = checkSlugStability(loadTaxonomy(), { 'security/supply-chain': 'security/general' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/supply-chain" is still a live slug - remove the redirect or remove the node');
  });

  it('rejects a redirect from a slug that was never published', () => {
    const result = checkSlugStability(loadTaxonomy(), { 'security/never-existed': 'security/general' });
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('redirect "security/never-existed" is not in KNOWN_SLUGS - only a retired slug can redirect');
  });

  it('rejects a slug that is not lowercase kebab-case', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/Threat_Intel', name: { en: 'Threat Intel', pt: 'Inteligência de Ameaças' } });
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('child slug "security/Threat_Intel" must be "security/<kebab-case>"');
  });

  it('rejects a child whose slug is not prefixed by its parent domain', () => {
    const tax = mutable();
    const productivity = tax.domains.find((d) => d.slug === 'productivity');
    productivity!.children!.push({ slug: 'security/threat-modeling', name: { en: 'Threat Modeling', pt: 'Modelagem de Ameaças' } });
    const result = checkSlugStability(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('child slug "security/threat-modeling" must be "productivity/<kebab-case>"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/slug-stability.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` exports neither `KNOWN_SLUGS`, `SLUG_REDIRECTS` nor
`checkSlugStability`, so all 11 tests error before reaching an assertion: the nine that call the
check get a TypeError saying `checkSlugStability` is not a function, while the two that read the
frozen ledgers directly get `TypeError: KNOWN_SLUGS is not iterable` and
`TypeError: Cannot convert undefined or null to object`.

- [ ] **Step 3: Add the frozen slug registry and the redirect ledger**

Insert into `scripts/validate-taxonomy.ts` immediately below the `SEGMENT` constant:

```ts
/** Every slug this taxonomy has ever published. Adding one is deliberate; removing one needs a redirect. */
export const KNOWN_SLUGS: string[] = [
  'security',
  'security/code-application',
  'security/secrets-credentials',
  'security/supply-chain',
  'security/iac-config',
  'security/cloud-permissions',
  'security/containers-kubernetes',
  'security/cicd-pipeline',
  'security/identity-access',
  'security/data-protection',
  'security/offensive-testing',
  'security/detection-forensics',
  'security/compliance-grc',
  'security/ai-agent-security',
  'security/threat-modeling',
  'security/general',
  'coding-software',
  'coding-software/general',
  'devops-infra',
  'devops-infra/general',
  'data-analytics',
  'data-analytics/general',
  'ai-agent-eng',
  'ai-agent-eng/general',
  'docs-formats',
  'docs-formats/general',
  'writing-docs',
  'writing-docs/general',
  'research-knowledge',
  'research-knowledge/general',
  'design-creative',
  'design-creative/general',
  'business-product',
  'business-product/general',
  'productivity',
  'productivity/general',
  'agent-authoring',
  'agent-authoring/general',
  'vertical-domain',
  'vertical-domain/general',
];

/**
 * Retired slug -> the live slug that replaced it. Empty at launch: nothing has been renamed yet.
 * Check 5 makes the first rename a paired edit — drop a slug from the taxonomy and you must add
 * its redirect here in the same commit.
 */
export const SLUG_REDIRECTS: Record<string, string> = {};
```

- [ ] **Step 4: Add the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function checkSlugStability(
  tax: Taxonomy,
  redirects: Record<string, string> = SLUG_REDIRECTS,
): CheckResult {
  const errors: string[] = [];
  for (const domain of tax.domains) {
    if (!SEGMENT.test(domain.slug)) errors.push(`domain slug "${domain.slug}" is not lowercase kebab-case`);
    for (const child of domain.children ?? []) {
      const parts = child.slug.split('/');
      if (parts.length !== 2 || parts[0] !== domain.slug || !SEGMENT.test(parts[1])) {
        errors.push(`child slug "${child.slug}" must be "${domain.slug}/<kebab-case>"`);
      }
    }
  }
  const live = new Set(flattenTaxonomy(tax).map((n) => n.slug));
  for (const slug of live) {
    if (!KNOWN_SLUGS.includes(slug)) {
      errors.push(`slug "${slug}" is not in KNOWN_SLUGS - add it deliberately, and add a SLUG_REDIRECTS entry if it renames an old slug`);
    }
  }
  for (const slug of KNOWN_SLUGS) {
    if (!live.has(slug) && redirects[slug] === undefined) {
      errors.push(`KNOWN_SLUGS lists "${slug}" but the taxonomy no longer has it - add SLUG_REDIRECTS["${slug}"] pointing at its replacement`);
    }
  }
  for (const [from, to] of Object.entries(redirects)) {
    if (!KNOWN_SLUGS.includes(from)) {
      errors.push(`redirect "${from}" is not in KNOWN_SLUGS - only a retired slug can redirect`);
    } else if (live.has(from)) {
      errors.push(`redirect "${from}" is still a live slug - remove the redirect or remove the node`);
    }
    if (!live.has(to)) {
      errors.push(`redirect "${from}" points at "${to}", which is not a live slug`);
    }
  }
  return { name: '5 slug stability', ok: errors.length === 0, errors };
}
```

- [ ] **Step 5: Register it**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
    checkSlugStability(tax),
  ];
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/validate/slug-stability.test.ts`

Expected: PASS (11 tests)

- [ ] **Step 7: Verify the CLI still exits 0**

Run: `npm run validate`

Expected: five `PASS` lines, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/slug-stability.test.ts
git commit -m "feat(governance): check 5 freeze slugs in KNOWN_SLUGS and pair removals with redirects"
```

---

### Task A3.9: Check 6 — referential integrity

Spec §3.1, §3.4 and §12.6. Three failures in one check: a node named `all`, `any`, `none` or `not`
silently breaks Pagefind filtering; an assignment whose `primary`/`also` do not resolve — or that
carries more than two `also` entries — would put an entry in a category page that does not exist;
and a `tag` that equals a taxonomy slug reintroduces navigation through free tags, which the spec
forbids.

`data/assignments.json` is written later by the classification PR (spec §6.1) in exactly one shape:

```
Record<string, { primary: string; also: string[]; tags: string[] }>   keyed by "owner/repo@sha:path"
```

The validator reads that shape and nothing else — no array, no `{ assignments: [...] }` wrapper.
A6's `loadAssignments()` in `src/lib/data.ts` reads the same canonical shape; the two differ only in
what they do when the file is wrong, and deliberately so. The harvest must never crash on a bad
classification commit, so A6's loader falls back to `{}`; CI is exactly where a malformed file must
stop the build, so the validator reports it and exits non-zero. A3 does not import A6 (A3 runs
first) and shares no symbol name with it: the reader here is `readAssignmentsFile`, and the types
are `AssignmentEntry` / `AssignmentMap`.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (extend imports; add `AssignmentEntry`, `AssignmentMap`, `RESERVED_NODE_NAMES`, `ASSIGNMENTS_PATH`; add three functions; replace `runAllChecks` and `main`)
- Test: `tests/validate/referential-integrity.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`
- Produces: `AssignmentEntry { primary: string; also: string[]; tags: string[] }`, `AssignmentMap = Record<string, AssignmentEntry>`, `parseAssignments(raw: unknown): AssignmentMap`, `readAssignmentsFile(path: string): AssignmentMap`, `checkReferentialIntegrity(tax: Taxonomy, assignments: AssignmentMap): CheckResult`, `runAllChecks(tax: Taxonomy, assignments: AssignmentMap): CheckResult[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/referential-integrity.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkReferentialIntegrity, parseAssignments } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

const ID = 'trailofbits/skills@a1b2c3d:security/sbom/SKILL.md';

describe('check 6 - referential integrity', () => {
  it('passes on the committed taxonomy with no assignments yet', () => {
    expect(checkReferentialIntegrity(loadTaxonomy(), {})).toEqual({ name: '6 referential integrity', ok: true, errors: [] });
  });

  it('accepts an assignment with a resolvable primary and two also entries', () => {
    const assignments = {
      [ID]: { primary: 'security/supply-chain', also: ['security/cicd-pipeline', 'devops-infra/general'], tags: ['sbom', 'slsa'] },
    };
    expect(checkReferentialIntegrity(loadTaxonomy(), assignments).ok).toBe(true);
  });

  it('rejects a third also entry', () => {
    const assignments = {
      [ID]: { primary: 'security/supply-chain', also: ['security/cicd-pipeline', 'devops-infra/general', 'security/general'], tags: [] },
    };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": also has 3 entries, max is 2`);
  });

  it('rejects a primary that is a domain rather than a leaf', () => {
    const assignments = { [ID]: { primary: 'security', also: [], tags: [] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": primary "security" does not resolve to a leaf`);
  });

  it('rejects an also entry that repeats the primary', () => {
    const assignments = { [ID]: { primary: 'security/general', also: ['security/general'], tags: [] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": also repeats primary "security/general"`);
  });

  it('rejects an eleventh tag', () => {
    const tags = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'];
    const assignments = { [ID]: { primary: 'security/general', also: [], tags } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": tags has 11 entries, max is 10`);
  });

  it('rejects a tag that is a taxonomy slug, because tags never drive navigation', () => {
    const assignments = { [ID]: { primary: 'security/general', also: [], tags: ['security/supply-chain'] } };
    const result = checkReferentialIntegrity(loadTaxonomy(), assignments);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`assignment "${ID}": tag "security/supply-chain" is a taxonomy slug - tags never drive navigation`);
  });

  it('rejects a node named with a reserved Pagefind filter key', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    security!.children!.push({ slug: 'security/all', name: { en: 'All', pt: 'Todos' } });
    const result = checkReferentialIntegrity(tax, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/all" uses reserved Pagefind filter key "all"');
  });

  it('rejects a display name that is a reserved Pagefind filter key', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/general');
    node!.name.en = 'None';
    const result = checkReferentialIntegrity(tax, {});
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/general" has reserved display name "None" (en)');
  });
});

describe('parseAssignments', () => {
  it('reads the canonical record keyed by skill id', () => {
    const raw = { [ID]: { primary: 'security/general', also: [], tags: ['sbom'] } };
    expect(parseAssignments(raw)).toEqual(raw);
  });

  it('defaults a missing also and tags to empty arrays', () => {
    expect(parseAssignments({ [ID]: { primary: 'security/general' } })).toEqual({
      [ID]: { primary: 'security/general', also: [], tags: [] },
    });
  });

  it('rejects the array shape outright', () => {
    expect(() => parseAssignments([{ id: ID, primary: 'security/general' }])).toThrow(
      'data/assignments.json must be a JSON object keyed by the skill id "owner/repo@sha:path", not an array',
    );
  });

  it('throws when a record has no primary', () => {
    expect(() => parseAssignments({ [ID]: {} })).toThrow(`assignment "${ID}" has no string "primary"`);
  });

  it('throws when also is not an array of strings', () => {
    expect(() => parseAssignments({ [ID]: { primary: 'security/general', also: 'security/general' } })).toThrow(
      `assignment "${ID}" has a non-string-array "also"`,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/referential-integrity.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` exports neither `checkReferentialIntegrity` nor
`parseAssignments`, so all 14 tests error with a TypeError saying `checkReferentialIntegrity` (or
`parseAssignments`) is not a function.

- [ ] **Step 3: Extend the imports**

Replace the import line of `scripts/validate-taxonomy.ts`

```ts
import { pathToFileURL } from 'node:url';
```

with:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
```

- [ ] **Step 4: Add the assignment types, the reserved-name list and the file path**

Insert into `scripts/validate-taxonomy.ts` immediately below the `CheckResult` interface:

```ts
/**
 * One row of data/assignments.json (spec §3.1), keyed by the skill id "owner/repo@sha:path".
 * The validator's read-only view of the canonical shape the classification PR writes.
 */
export interface AssignmentEntry {
  primary: string;
  also: string[];
  tags: string[];
}

export type AssignmentMap = Record<string, AssignmentEntry>;

const RESERVED_NODE_NAMES = ['all', 'any', 'none', 'not'];

const ASSIGNMENTS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../data/assignments.json');
```

- [ ] **Step 5: Add the assignments reader**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
function stringArray(id: string, field: 'also' | 'tags', value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`assignment "${id}" has a non-string-array "${field}"`);
  }
  return value as string[];
}

export function parseAssignments(raw: unknown): AssignmentMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('data/assignments.json must be a JSON object keyed by the skill id "owner/repo@sha:path", not an array');
  }
  const out: AssignmentMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error(`assignment "${id}" is not an object`);
    }
    const record = value as Partial<AssignmentEntry>;
    if (typeof record.primary !== 'string') throw new Error(`assignment "${id}" has no string "primary"`);
    out[id] = {
      primary: record.primary,
      also: stringArray(id, 'also', record.also),
      tags: stringArray(id, 'tags', record.tags),
    };
  }
  return out;
}

export function readAssignmentsFile(path: string): AssignmentMap {
  if (!existsSync(path)) return {};
  return parseAssignments(JSON.parse(readFileSync(path, 'utf8')));
}
```

- [ ] **Step 6: Add the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function checkReferentialIntegrity(tax: Taxonomy, assignments: AssignmentMap): CheckResult {
  const errors: string[] = [];
  const nodes = flattenTaxonomy(tax);
  for (const node of nodes) {
    const segment = node.slug.split('/').pop() ?? '';
    if (RESERVED_NODE_NAMES.includes(segment)) {
      errors.push(`node "${node.slug}" uses reserved Pagefind filter key "${segment}"`);
    }
    for (const lang of ['en', 'pt'] as const) {
      if (RESERVED_NODE_NAMES.includes(node.name[lang].trim().toLowerCase())) {
        errors.push(`node "${node.slug}" has reserved display name "${node.name[lang]}" (${lang})`);
      }
    }
  }
  const allSlugs = new Set(nodes.map((n) => n.slug));
  const leafSlugs = new Set(nodes.filter((n) => n.slug.includes('/')).map((n) => n.slug));
  for (const [id, a] of Object.entries(assignments)) {
    if (!leafSlugs.has(a.primary)) errors.push(`assignment "${id}": primary "${a.primary}" does not resolve to a leaf`);
    if (a.also.length > 2) errors.push(`assignment "${id}": also has ${a.also.length} entries, max is 2`);
    if (new Set(a.also).size !== a.also.length) errors.push(`assignment "${id}": also contains duplicates`);
    for (const slug of a.also) {
      if (!leafSlugs.has(slug)) errors.push(`assignment "${id}": also "${slug}" does not resolve to a leaf`);
      if (slug === a.primary) errors.push(`assignment "${id}": also repeats primary "${slug}"`);
    }
    if (a.tags.length > 10) errors.push(`assignment "${id}": tags has ${a.tags.length} entries, max is 10`);
    for (const tag of a.tags) {
      if (allSlugs.has(tag)) {
        errors.push(`assignment "${id}": tag "${tag}" is a taxonomy slug - tags never drive navigation`);
      }
    }
  }
  return { name: '6 referential integrity', ok: errors.length === 0, errors };
}
```

- [ ] **Step 7: Register it and feed assignments through the runner**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy, assignments: AssignmentMap): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
    checkSlugStability(tax),
    checkReferentialIntegrity(tax, assignments),
  ];
}
```

Replace the whole `main` function in `scripts/validate-taxonomy.ts` with:

```ts
function main(): void {
  const tax = loadTaxonomy();
  let assignments: AssignmentMap = {};
  let readFailure: string | null = null;
  try {
    assignments = readAssignmentsFile(ASSIGNMENTS_PATH);
  } catch (error) {
    readFailure = error instanceof Error ? error.message : String(error);
  }
  const results = runAllChecks(tax, assignments);
  console.log(formatResults(results));
  if (readFailure !== null) console.log(`FAIL  data/assignments.json is unreadable\n        ${readFailure}`);
  const failed = results.filter((r) => !r.ok).length + (readFailure === null ? 0 : 1);
  console.log(
    failed === 0
      ? `\n${results.length} check(s) passed over ${flattenTaxonomy(tax).length} nodes and ${Object.keys(assignments).length} assignments`
      : `\n${failed} check(s) failed`,
  );
  process.exitCode = failed === 0 ? 0 : 1;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run tests/validate/referential-integrity.test.ts`

Expected: PASS (14 tests)

- [ ] **Step 9: Verify the CLI still exits 0**

Run: `npm run validate`

Expected: six `PASS` lines then `6 check(s) passed over 40 nodes and 0 assignments`, exit code 0
(`data/assignments.json` does not exist yet, and a missing file is not an error).

- [ ] **Step 10: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/referential-integrity.test.ts
git commit -m "feat(governance): check 6 reserved node names and assignment referential integrity"
```

---

### Task A3.10: Check 7 — protected-term parity

Spec §3.5, §8 and §12.7. This is the check that stops `CI/CD` becoming *Integração Contínua* and
`Supply Chain` becoming *cadeia de suprimentos* (logistics language, not security language). The
rule is symmetric: a `PROTECTED` term present in one locale must be present in the other. The
pattern matches whole terms only and is case-insensitive, so `IaC` does not match inside
*Infrastructure as Code* and `MCP` does not match inside *MCPServer*, and it escapes the slash in
`CI/CD`.

**Files:**
- Modify: `scripts/validate-taxonomy.ts` (insert two functions above `runAllChecks`, replace `runAllChecks`)
- Test: `tests/validate/protected-parity.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `Taxonomy`, `flattenTaxonomy(tax: Taxonomy): TaxonomyNode[]`, `AssignmentMap`
- Produces: `protectedTermPattern(term: string): RegExp`, `checkProtectedParity(tax: Taxonomy): CheckResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/validate/protected-parity.test.ts
import { describe, expect, it } from 'vitest';
import type { Taxonomy } from '../../src/types.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';
import { checkProtectedParity, protectedTermPattern } from '../../scripts/validate-taxonomy.ts';

function mutable(): Taxonomy { return structuredClone(loadTaxonomy()); }

describe('check 7 - protected-term parity', () => {
  it('passes on the committed taxonomy', () => {
    expect(checkProtectedParity(loadTaxonomy())).toEqual({ name: '7 protected-term parity', ok: true, errors: [] });
  });

  it('catches CI/CD drifting to Integração Contínua in pt-BR', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/cicd-pipeline');
    node!.name.pt = 'Integração Contínua e Pipeline';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('node "security/cicd-pipeline": protected term "CI/CD" is in en ("CI/CD & Pipeline") but not in pt ("Integração Contínua e Pipeline")');
  });

  it('catches Supply Chain drifting to cadeia de suprimentos', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/supply-chain');
    node!.name.pt = 'Cadeia de Suprimentos e Dependências';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Supply Chain" is in en');
  });

  it('catches a term added in pt-BR but not in English', () => {
    const tax = mutable();
    const security = tax.domains.find((d) => d.slug === 'security');
    const node = security!.children!.find((c) => c.slug === 'security/containers-kubernetes');
    node!.name.en = 'Containers & Orchestration';
    const result = checkProtectedParity(tax);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('protected term "Kubernetes" is in pt');
  });
});

describe('protectedTermPattern', () => {
  it('matches whole terms only, ignoring case', () => {
    expect(protectedTermPattern('IaC').test('Infrastructure as Code')).toBe(false);
    expect(protectedTermPattern('IAM').test('Identidade e Acesso')).toBe(false);
    expect(protectedTermPattern('SAST').test('SAST review')).toBe(true);
    expect(protectedTermPattern('MCP').test('MCPServer')).toBe(false);
  });

  it('handles the slash in CI/CD', () => {
    expect(protectedTermPattern('CI/CD').test('CI/CD & Pipeline')).toBe(true);
    expect(protectedTermPattern('CI/CD').test('CI e CD')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/validate/protected-parity.test.ts`

Expected: FAIL — `scripts/validate-taxonomy.ts` exports neither `checkProtectedParity` nor
`protectedTermPattern`, so all 6 tests error with a TypeError saying `checkProtectedParity` (or
`protectedTermPattern`) is not a function.

- [ ] **Step 3: Add the term matcher and the check**

Insert into `scripts/validate-taxonomy.ts` immediately above `export function runAllChecks`:

```ts
export function protectedTermPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i');
}

export function checkProtectedParity(tax: Taxonomy): CheckResult {
  const errors: string[] = [];
  const patterns = tax.protected.map((term) => ({ term, re: protectedTermPattern(term) }));
  for (const node of flattenTaxonomy(tax)) {
    for (const { term, re } of patterns) {
      const inEn = re.test(node.name.en);
      const inPt = re.test(node.name.pt);
      if (inEn === inPt) continue;
      const present = inEn ? 'en' : 'pt';
      const missing = inEn ? 'pt' : 'en';
      errors.push(`node "${node.slug}": protected term "${term}" is in ${present} ("${node.name[present]}") but not in ${missing} ("${node.name[missing]}")`);
    }
  }
  return { name: '7 protected-term parity', ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Register it**

Replace the whole `runAllChecks` function in `scripts/validate-taxonomy.ts` with:

```ts
export function runAllChecks(tax: Taxonomy, assignments: AssignmentMap): CheckResult[] {
  return [
    checkMinimumMass(tax),
    checkNamedOverflow(tax),
    checkUniqueSlug(tax),
    checkAliasMap(tax),
    checkSlugStability(tax),
    checkReferentialIntegrity(tax, assignments),
    checkProtectedParity(tax),
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/validate/protected-parity.test.ts`

Expected: PASS (6 tests)

- [ ] **Step 6: Prove the check fails the build on a real drift**

`data/taxonomy.json` is committed (A3.1), so the mutation is restored with `git checkout` rather
than a backup copy — that also restores the file's exact formatting.

```bash
node -e "const fs=require('fs');const t=JSON.parse(fs.readFileSync('data/taxonomy.json','utf8'));t.domains[0].children[6].name.pt='Integração Contínua e Pipeline';fs.writeFileSync('data/taxonomy.json',JSON.stringify(t,null,2));"
npm run validate; echo "exit=$?"
git checkout -- data/taxonomy.json
npm run validate; echo "restored-exit=$?"
```

Expected: the first run prints `FAIL  7 protected-term parity` with the `CI/CD` message and
`exit=1`; after restoring, seven `PASS` lines and `restored-exit=0`.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`

Expected: PASS — every taxonomy and governance test file green. The suite's single `astro build`
runs once in A1's `tests/global-setup.ts`; no A3 test reads or writes `dist/`, so nothing here can
race it.

- [ ] **Step 8: Commit**

```bash
git add scripts/validate-taxonomy.ts tests/validate/protected-parity.test.ts
git commit -m "feat(governance): check 7 protected-term parity across en and pt-BR labels"
```

---

### Task A3.11: CI workflow

The seven checks are only governance if they run without being asked. `ci.yml` runs the unit tests
and `npm run validate` on every push to `main` and every pull request, including the classification
PRs that will edit `data/assignments.json`.

**Files:**
- Create: `.github/workflows/ci.yml`
- Test: `tests/ci/workflow.test.ts`

**Interfaces:**
- Consumes: `npm test` (A1.1) and `npm run validate` (A3.4) scripts in `package.json`; `package-lock.json` committed at the repo root (A1.1)
- Produces: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ci/workflow.test.ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/ci.yml'),
  'utf8',
);

describe('.github/workflows/ci.yml', () => {
  it('runs on push to main and on every pull request', () => {
    expect(WORKFLOW).toContain('branches: [main]');
    expect(WORKFLOW).toContain('pull_request:');
    expect(WORKFLOW).toContain('workflow_dispatch:');
  });

  it('pins the action versions the project standardised on', () => {
    expect(WORKFLOW).toContain('actions/checkout@v5');
    expect(WORKFLOW).toContain('actions/setup-node@v5');
    expect(WORKFLOW).toContain("node-version: '24'");
  });

  it('runs both the unit tests and the taxonomy governance checks', () => {
    expect(WORKFLOW).toContain('run: npm test');
    expect(WORKFLOW).toContain('run: npm run validate');
  });

  it('asks for read-only repository permissions', () => {
    expect(WORKFLOW).toContain('permissions:');
    expect(WORKFLOW).toContain('contents: read');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ci/workflow.test.ts`

Expected: FAIL. The file is read at module scope, so the whole file errors before any test runs,
with `Error: ENOENT: no such file or directory, open '/home/kyo/projects/ai-tools-hub/.github/workflows/ci.yml'`.

- [ ] **Step 3: Write the workflow**

`node scripts/validate-taxonomy.ts` runs with no flags because type stripping is on by default from
Node 22.18 on, and `>=22.18.0` is this project's only Node floor (A1.1's `engines.node`). CI pins one
current release, Node 24, which sits above that floor: the pin fixes what CI runs, it does not raise
the requirement.

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: unit tests + taxonomy governance
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - name: Unit tests
        run: npm test
      - name: Taxonomy governance checks
        run: npm run validate
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ci/workflow.test.ts`

Expected: PASS (4 tests)

- [ ] **Step 5: Reproduce the CI job locally**

Run: `npm ci && npm test && npm run validate`

Expected: the suite is green (its one `astro build` runs in A1's `tests/global-setup.ts`), then
seven `PASS` lines and `7 check(s) passed over 40 nodes and 0 assignments`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/ci.yml tests/ci/workflow.test.ts
git commit -m "ci: run unit tests and the 7 taxonomy governance checks on push and PR"
```

---

### Task A4.1: Inclusion filter — the repo gate

**Files:**
- Create: `src/lib/inclusion.ts`
- Test: `tests/lib/inclusion-repo-gate.test.ts`

**Interfaces:**
- Consumes: nothing (first file of the inclusion module)
- Produces: `export const MIN_STARS = 10`; `export interface RepoGateInput { stars: number; isOrg: boolean }`; `export function passesRepoGate(input: RepoGateInput): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/inclusion-repo-gate.test.ts
import { describe, expect, it } from 'vitest';
import { MIN_STARS, passesRepoGate } from '../../src/lib/inclusion.ts';

describe('passesRepoGate', () => {
  it('publishes the star floor as a single constant', () => {
    expect(MIN_STARS).toBe(10);
  });

  it('admits a personal account at or above the star floor', () => {
    expect(passesRepoGate({ stars: 10, isOrg: false })).toBe(true);
    expect(passesRepoGate({ stars: 6908, isOrg: false })).toBe(true);
  });

  it('rejects a personal account below the star floor', () => {
    expect(passesRepoGate({ stars: 9, isOrg: false })).toBe(false);
    expect(passesRepoGate({ stars: 0, isOrg: false })).toBe(false);
  });

  it('admits an organisation account regardless of stars', () => {
    expect(passesRepoGate({ stars: 0, isOrg: true })).toBe(true);
    expect(passesRepoGate({ stars: 3, isOrg: true })).toBe(true);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/inclusion-repo-gate.test.ts`
Expected: FAIL — `src/lib/inclusion.ts` does not exist yet, so Vitest cannot resolve the import and reports `Error: Failed to load url ../../src/lib/inclusion.ts`.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/inclusion.ts
import type { TreeFile } from '../types.ts';

/**
 * Spec 6.4. The quality floor: a stars>=10 sweep cuts topic:claude-skills from 7,626 repos
 * to ~1,131. Defined here, once, and imported by the query builder so the swept band and the
 * admitted band can never drift apart.
 */
export const MIN_STARS = 10;

export interface RepoGateInput {
  stars: number;
  isOrg: boolean;
}

/** Spec 6.4: ">=N stars OR an org account". Organisations publish for strangers by default. */
export function passesRepoGate(input: RepoGateInput): boolean {
  return input.isOrg || input.stars >= MIN_STARS;
}

// `TreeFile` is used by hasReadme, added in the next task.
void (0 as unknown as TreeFile | undefined);
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/inclusion-repo-gate.test.ts && npm run typecheck`
Expected: PASS — 4 tests pass and typecheck prints nothing.
- [ ] **Step 5: Commit**
```bash
git add src/lib/inclusion.ts tests/lib/inclusion-repo-gate.test.ts
git commit -m "feat(inclusion): repo gate — stars floor or org account"
```

---

### Task A4.2: Inclusion filter — README and repo-internal rules

**Files:**
- Modify: `src/lib/inclusion.ts` (replace the placeholder `void` line at the end of the file, then append)
- Test: `tests/lib/inclusion-readme.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts` (already imported by `src/lib/inclusion.ts`)
- Produces: `export function hasReadme(tree: readonly TreeFile[]): boolean`; `export function isRepoInternal(path: string): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/inclusion-readme.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { hasReadme, isRepoInternal } from '../../src/lib/inclusion.ts';

function blob(path: string): TreeFile {
  return { path, mode: '100644', sha: `sha-${path}`, type: 'blob' };
}

describe('hasReadme', () => {
  it('accepts a repository-root README in any common extension', () => {
    expect(hasReadme([blob('README.md')])).toBe(true);
    expect(hasReadme([blob('readme.rst')])).toBe(true);
    expect(hasReadme([blob('README')])).toBe(true);
    expect(hasReadme([blob('Readme.txt')])).toBe(true);
  });

  it('does not accept a nested README as the repository README', () => {
    expect(hasReadme([blob('docs/README.md')])).toBe(false);
    expect(hasReadme([blob('skills/alpha/README.md')])).toBe(false);
  });

  it('does not accept a directory named README', () => {
    expect(hasReadme([{ path: 'README', mode: '040000', sha: 't', type: 'tree' }])).toBe(false);
  });

  it('rejects a repo with no README at all', () => {
    expect(hasReadme([blob('skills/alpha/SKILL.md')])).toBe(false);
    expect(hasReadme([])).toBe(false);
  });
});

describe('isRepoInternal', () => {
  it('flags a repo top-level .claude/skills tree', () => {
    expect(isRepoInternal('.claude/skills/deploy/SKILL.md')).toBe(true);
  });

  it('flags a nested .claude/skills tree', () => {
    expect(isRepoInternal('packages/api/.claude/skills/lint/SKILL.md')).toBe(true);
  });

  it('does not flag distributable skill directories', () => {
    expect(isRepoInternal('skills/deploy/SKILL.md')).toBe(false);
    expect(isRepoInternal('.claude/agents/reviewer.md')).toBe(false);
    expect(isRepoInternal('claude/skills/deploy/SKILL.md')).toBe(false);
    expect(isRepoInternal('my.claude/skills/x/SKILL.md')).toBe(false);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/inclusion-readme.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/src/lib/inclusion.ts' does not provide an export named 'hasReadme'`
- [ ] **Step 3: Write minimal implementation**
Delete these two lines from the end of `src/lib/inclusion.ts`:
```ts
// `TreeFile` is used by hasReadme, added in the next task.
void (0 as unknown as TreeFile | undefined);
```
Then append to `src/lib/inclusion.ts`:
```ts
const ROOT_README_RE = /^readme(\.[a-z0-9]+)?$/i;

/** Spec 6.4 "has a README" — a repository-root README, the one strangers actually land on. */
export function hasReadme(tree: readonly TreeFile[]): boolean {
  return tree.some(
    (file) => file.type === 'blob' && !file.path.includes('/') && ROOT_README_RE.test(file.path),
  );
}

/**
 * Spec 6.4 "not under .claude/skills/". A repo's own .claude/skills/ tree is internal glue,
 * not a distributable product: 41,984 of 351,232 SKILL.md files on GitHub live there.
 */
export function isRepoInternal(path: string): boolean {
  return path.startsWith('.claude/skills/') || path.includes('/.claude/skills/');
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/inclusion-readme.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/inclusion.ts tests/lib/inclusion-readme.test.ts
git commit -m "feat(inclusion): README presence and repo-internal path rules"
```

---

### Task A4.3: Inclusion filter — non-trivial, non-repo-specific description

**Files:**
- Modify: `src/lib/inclusion.ts` (append at end of file)
- Test: `tests/lib/inclusion-description.test.ts`

**Interfaces:**
- Consumes: nothing beyond the file itself
- Produces: `export const MIN_DESCRIPTION_CHARS = 20`; `export const MIN_DESCRIPTION_WORDS = 4`; `export const REPO_SPECIFIC_PHRASES`; `export function isMeaningfulDescription(description: unknown, repo: string): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/inclusion-description.test.ts
import { describe, expect, it } from 'vitest';
import {
  isMeaningfulDescription,
  MIN_DESCRIPTION_CHARS,
  MIN_DESCRIPTION_WORDS,
  REPO_SPECIFIC_PHRASES,
} from '../../src/lib/inclusion.ts';

describe('isMeaningfulDescription', () => {
  it('publishes its thresholds as constants', () => {
    expect(MIN_DESCRIPTION_CHARS).toBe(20);
    expect(MIN_DESCRIPTION_WORDS).toBe(4);
    expect([...REPO_SPECIFIC_PHRASES]).toContain('this repo');
  });

  it('accepts a real, reusable description', () => {
    expect(isMeaningfulDescription('Extract text from PDF files.', 'anthropics/skills')).toBe(true);
    expect(
      isMeaningfulDescription('Scans lockfiles for malicious packages.', 'owner/repo'),
    ).toBe(true);
  });

  it('rejects a missing or non-string description', () => {
    expect(isMeaningfulDescription(undefined, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription(null, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription(42, 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription({ en: 'x' }, 'owner/repo')).toBe(false);
  });

  it('rejects a trivially short description', () => {
    expect(isMeaningfulDescription('Deploy', 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription('   ', 'owner/repo')).toBe(false);
    expect(isMeaningfulDescription('A helper skill.', 'owner/repo')).toBe(false);
  });

  it('rejects a long description that is only three words', () => {
    expect(isMeaningfulDescription('Supercalifragilistic Expialidocious Skillmaker', 'o/r')).toBe(
      false,
    );
  });

  it('rejects a description that is about the host repository, not the skill', () => {
    expect(
      isMeaningfulDescription('Runs the release checklist for this repo before tagging.', 'o/r'),
    ).toBe(false);
    expect(
      isMeaningfulDescription('Internal use by our team when cutting a release build.', 'o/r'),
    ).toBe(false);
  });

  it('rejects a description that names its own repository', () => {
    expect(
      isMeaningfulDescription(
        'Helper wired into the trailofbits build pipeline and nothing else.',
        'trailofbits/skills',
      ),
    ).toBe(false);
  });

  it('does not treat a generic repo name as repo-specific', () => {
    expect(
      isMeaningfulDescription('Skills for reviewing dependency manifests.', 'anthropics/skills'),
    ).toBe(true);
    expect(
      isMeaningfulDescription('Tools for auditing container image layers.', 'someorg/tools'),
    ).toBe(true);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/inclusion-description.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/src/lib/inclusion.ts' does not provide an export named 'isMeaningfulDescription'`
- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/inclusion.ts`:
```ts
/** Spec 6.4 "non-trivial": published thresholds, so the rule is inspectable, not taste. */
export const MIN_DESCRIPTION_CHARS = 20;
export const MIN_DESCRIPTION_WORDS = 4;

/** Spec 6.4 "non-repo-specific": prose that only makes sense inside the host repository. */
export const REPO_SPECIFIC_PHRASES = [
  'this repo',
  'this repository',
  'our repo',
  'our team',
  'internal use',
  'this project only',
  'do not use outside',
] as const;

/** Names too generic to prove a description is about its own repo rather than the skill. */
const GENERIC_REPO_WORDS = new Set([
  'skill',
  'skills',
  'agent',
  'agents',
  'tool',
  'tools',
  'plugin',
  'plugins',
  'claude',
  'claude-code',
  'codex',
  'cursor',
  'openclaw',
  'mcp',
  'prompt',
  'prompts',
  'awesome',
  'docs',
  'examples',
]);

function distinctiveSegments(repo: string): string[] {
  return repo
    .toLowerCase()
    .split('/')
    .filter((segment) => segment.length >= 5 && !GENERIC_REPO_WORDS.has(segment));
}

export function isMeaningfulDescription(description: unknown, repo: string): boolean {
  if (typeof description !== 'string') return false;
  const text = description.trim();
  if (text.length < MIN_DESCRIPTION_CHARS) return false;
  if (text.split(/\s+/).length < MIN_DESCRIPTION_WORDS) return false;
  const lower = text.toLowerCase();
  if (REPO_SPECIFIC_PHRASES.some((phrase) => lower.includes(phrase))) return false;
  return !distinctiveSegments(repo).some((segment) => lower.includes(segment));
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/inclusion-description.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/inclusion.ts tests/lib/inclusion-description.test.ts
git commit -m "feat(inclusion): non-trivial, non-repo-specific description rule"
```

---

### Task A4.4: Inclusion filter — publisher cap (crawler trap 4)

**Files:**
- Modify: `src/lib/inclusion.ts` (append at end of file)
- Test: `tests/lib/inclusion-cap.test.ts`

**Interfaces:**
- Consumes: nothing beyond the file itself
- Produces: `export interface ConceptKey { publisher: string; concept: string }`; `export function publisherOf(repo: string): string`; `export function normalizeConcept(value: string): string`; `export function capPerPublisherPerConcept<T>(items: readonly T[], keyOf: (item: T) => ConceptKey, limit?: number): T[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/inclusion-cap.test.ts
import { describe, expect, it } from 'vitest';
import {
  capPerPublisherPerConcept,
  normalizeConcept,
  publisherOf,
} from '../../src/lib/inclusion.ts';

interface Entry {
  repo: string;
  name: string;
  primary: string;
}

const keyByName = (e: Entry) => ({
  publisher: publisherOf(e.repo),
  concept: normalizeConcept(e.name),
});

describe('publisherOf', () => {
  it('is the owner segment, lowercased', () => {
    expect(publisherOf('AliRezaRezvani/claude-skills')).toBe('alirezarezvani');
    expect(publisherOf('anthropics/skills')).toBe('anthropics');
  });

  it('tolerates a bare name with no slash', () => {
    expect(publisherOf('solo')).toBe('solo');
  });
});

describe('normalizeConcept', () => {
  it('folds case, punctuation and spacing to one slug', () => {
    expect(normalizeConcept('PDF Processing')).toBe('pdf-processing');
    expect(normalizeConcept('pdf_processing')).toBe('pdf-processing');
    expect(normalizeConcept('  --PDF--processing--  ')).toBe('pdf-processing');
  });
});

describe('capPerPublisherPerConcept', () => {
  it('keeps one entry per publisher per concept, in first-seen order', () => {
    const entries: Entry[] = [
      { repo: 'mono/skills', name: 'PDF Processing', primary: 'documents' },
      { repo: 'mono/skills', name: 'pdf-processing', primary: 'documents' },
      { repo: 'mono/skills', name: 'lockfile-audit', primary: 'security' },
      { repo: 'other/skills', name: 'pdf-processing', primary: 'documents' },
    ];

    expect(capPerPublisherPerConcept(entries, keyByName).map((e) => e.repo + ':' + e.name)).toEqual([
      'mono/skills:PDF Processing',
      'mono/skills:lockfile-audit',
      'other/skills:pdf-processing',
    ]);
  });

  it('honours an explicit limit above one', () => {
    const entries: Entry[] = [
      { repo: 'mono/skills', name: 'a', primary: 'p' },
      { repo: 'mono/skills', name: 'a', primary: 'p' },
      { repo: 'mono/skills', name: 'a', primary: 'p' },
    ];
    expect(capPerPublisherPerConcept(entries, keyByName, 2)).toHaveLength(2);
  });

  it('is the same function a category page applies with concept = primary', () => {
    const entries: Entry[] = Array.from({ length: 40 }, (_, i) => ({
      repo: 'mono/skills',
      name: `skill-${i}`,
      primary: 'security/supply-chain',
    }));
    entries.push({ repo: 'other/skills', name: 'x', primary: 'security/supply-chain' });

    const capped = capPerPublisherPerConcept(entries, (e) => ({
      publisher: publisherOf(e.repo),
      concept: e.primary,
    }));
    expect(capped).toHaveLength(2);
    expect(capped.map((e) => e.repo)).toEqual(['mono/skills', 'other/skills']);
  });

  it('handles an empty list', () => {
    expect(capPerPublisherPerConcept([] as Entry[], keyByName)).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/inclusion-cap.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/src/lib/inclusion.ts' does not provide an export named 'capPerPublisherPerConcept'`
- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/inclusion.ts`:
```ts
export interface ConceptKey {
  publisher: string;
  concept: string;
}

export function publisherOf(repo: string): string {
  const slash = repo.indexOf('/');
  return (slash === -1 ? repo : repo.slice(0, slash)).toLowerCase();
}

export function normalizeConcept(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Spec 6.3 trap 4: "cap one entry per publisher per concept, so a single 846-path monorepo
 * cannot swamp a category page". Deliberately generic over the concept key: harvest calls it
 * with the normalised skill name, a category page calls it with `skill.primary`.
 * First-seen order is preserved, so the caller's own ordering decides which entry survives.
 */
export function capPerPublisherPerConcept<T>(
  items: readonly T[],
  keyOf: (item: T) => ConceptKey,
  limit = 1,
): T[] {
  const counts = new Map<string, number>();
  const out: T[] = [];
  for (const item of items) {
    const { publisher, concept } = keyOf(item);
    const key = `${publisher} ${concept}`;
    const seen = counts.get(key) ?? 0;
    if (seen >= limit) continue;
    counts.set(key, seen + 1);
    out.push(item);
  }
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/inclusion-cap.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/inclusion.ts tests/lib/inclusion-cap.test.ts
git commit -m "feat(inclusion): one entry per publisher per concept cap"
```

---

### Task A4.5: Inclusion filter — the composed decision

**Files:**
- Modify: `src/lib/inclusion.ts` (append at end of file)
- Test: `tests/lib/inclusion-decision.test.ts`

**Interfaces:**
- Consumes: `isRepoInternal`, `isMeaningfulDescription` from `src/lib/inclusion.ts`
- Produces: `export type InclusionReason = 'included' | 'repo-internal' | 'no-readme' | 'weak-description'`; `export const INCLUSION_RULE_ORDER: readonly InclusionReason[]`; `export interface SkillCandidate { repo: string; path: string; hasReadme: boolean; description: unknown }`; `export function includeSkill(candidate: SkillCandidate): InclusionReason`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/inclusion-decision.test.ts
import { describe, expect, it } from 'vitest';
import {
  includeSkill,
  INCLUSION_RULE_ORDER,
  type SkillCandidate,
} from '../../src/lib/inclusion.ts';

function candidate(over: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    repo: 'owner/repo',
    path: 'skills/alpha/SKILL.md',
    hasReadme: true,
    description: 'Scans lockfiles for malicious packages.',
    ...over,
  };
}

describe('includeSkill', () => {
  it('publishes the rule order so /methodology can render it', () => {
    expect([...INCLUSION_RULE_ORDER]).toEqual(['repo-internal', 'no-readme', 'weak-description']);
  });

  it('includes a candidate that clears every rule', () => {
    expect(includeSkill(candidate())).toBe('included');
  });

  it('reports the first failing rule, in published order', () => {
    expect(
      includeSkill(
        candidate({ path: '.claude/skills/x/SKILL.md', hasReadme: false, description: 'no' }),
      ),
    ).toBe('repo-internal');
    expect(includeSkill(candidate({ hasReadme: false, description: 'no' }))).toBe('no-readme');
    expect(includeSkill(candidate({ description: 'no' }))).toBe('weak-description');
  });

  it('rejects a nested repo-internal path', () => {
    expect(includeSkill(candidate({ path: 'packages/api/.claude/skills/x/SKILL.md' }))).toBe(
      'repo-internal',
    );
  });

  it('rejects a missing description', () => {
    expect(includeSkill(candidate({ description: undefined }))).toBe('weak-description');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/inclusion-decision.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/src/lib/inclusion.ts' does not provide an export named 'includeSkill'`
- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/inclusion.ts`:
```ts
export type InclusionReason = 'included' | 'repo-internal' | 'no-readme' | 'weak-description';

/**
 * Spec 6.4: "these rules are published at /methodology". This array is the machine-readable
 * source of truth for that page's ordering; B5 supplies the hand-written prose for each id in
 * both locales. Add a rule here and the page's list is wrong until B5 writes its copy — which
 * is the intended pressure.
 */
export const INCLUSION_RULE_ORDER: readonly InclusionReason[] = [
  'repo-internal',
  'no-readme',
  'weak-description',
];

export interface SkillCandidate {
  repo: string;
  path: string;
  hasReadme: boolean;
  description: unknown;
}

/**
 * Per-skill half of spec 6.4. The repo half (`passesRepoGate`) runs earlier, at discovery,
 * because it decides whether the repo is fetched at all. Returns the first failing rule so the
 * harvest log says *why* something was dropped.
 */
export function includeSkill(candidate: SkillCandidate): InclusionReason {
  if (isRepoInternal(candidate.path)) return 'repo-internal';
  if (!candidate.hasReadme) return 'no-readme';
  if (!isMeaningfulDescription(candidate.description, candidate.repo)) return 'weak-description';
  return 'included';
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/inclusion-decision.test.ts && npm run typecheck`
Expected: PASS — 5 tests pass and typecheck prints nothing.
- [ ] **Step 5: Commit**
```bash
git add src/lib/inclusion.ts tests/lib/inclusion-decision.test.ts
git commit -m "feat(inclusion): composed per-skill decision with published rule order"
```

---

### Task A4.6: Search-bucket pacers

**Files:**
- Create: `scripts/harvest/discover.ts`
- Test: `tests/harvest/pacer.test.ts`

**Interfaces:**
- Consumes: nothing (first file of the harvest stage)
- Produces: `export type FetchLike = typeof globalThis.fetch`; `export const SEARCH_PER_MINUTE = 30`; `export const CODE_SEARCH_PER_MINUTE = 10`; `export function sleep(ms: number): Promise<void>`; `export interface PacerDeps { now?: () => number; sleep?: (ms: number) => Promise<void> }`; `export interface Pacer { take(): Promise<void> }`; `export function createPacer(perMinute: number, deps?: PacerDeps): Pacer`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/pacer.test.ts
import { describe, expect, it } from 'vitest';
import {
  CODE_SEARCH_PER_MINUTE,
  createPacer,
  SEARCH_PER_MINUTE,
  sleep,
} from '../../scripts/harvest/discover.ts';

describe('createPacer', () => {
  it('lets the first perMinute calls through without sleeping', async () => {
    const slept: number[] = [];
    let clock = 1_000_000;
    const pacer = createPacer(3, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    await pacer.take();
    await pacer.take();

    expect(slept).toEqual([]);
  });

  it('sleeps until the oldest hit leaves the 60s window', async () => {
    const slept: number[] = [];
    let clock = 1_000_000;
    const pacer = createPacer(3, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    await pacer.take();
    await pacer.take();
    await pacer.take();

    expect(slept).toEqual([60_050]);
    expect(clock).toBe(1_060_050);
  });

  it('does not sleep when calls are naturally spread out', async () => {
    const slept: number[] = [];
    let clock = 0;
    const pacer = createPacer(2, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    clock += 30_000;
    await pacer.take();
    clock += 31_000;
    await pacer.take();

    expect(slept).toEqual([]);
  });

  it('exposes both measured bucket limits and a real sleep', async () => {
    expect(SEARCH_PER_MINUTE).toBe(30);
    expect(CODE_SEARCH_PER_MINUTE).toBe(10);
    const start = Date.now();
    await sleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/pacer.test.ts`
Expected: FAIL — `scripts/harvest/discover.ts` does not exist yet, so Vitest cannot resolve the import and reports `Error: Failed to load url ../../scripts/harvest/discover.ts`.
- [ ] **Step 3: Write minimal implementation**
```ts
// scripts/harvest/discover.ts
export type FetchLike = typeof globalThis.fetch;

/** Measured GitHub `search` bucket limit: 30 requests per minute (spec 6.2). */
export const SEARCH_PER_MINUTE = 30;

/** Measured GitHub `code_search` bucket limit: 10 requests per minute (spec 6.2). */
export const CODE_SEARCH_PER_MINUTE = 10;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PacerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Pacer {
  take(): Promise<void>;
}

/** Sliding 60-second window; take() blocks until a slot is free. One pacer per bucket. */
export function createPacer(perMinute: number, deps: PacerDeps = {}): Pacer {
  const now = deps.now ?? (() => Date.now());
  const wait = deps.sleep ?? sleep;
  const hits: number[] = [];
  return {
    async take(): Promise<void> {
      for (;;) {
        const t = now();
        while (hits.length > 0 && t - hits[0] >= 60_000) hits.shift();
        if (hits.length < perMinute) {
          hits.push(t);
          return;
        }
        await wait(60_000 - (t - hits[0]) + 50);
      }
    },
  };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/pacer.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/pacer.test.ts
git commit -m "feat(harvest): sliding-window pacers for the search and code_search buckets"
```

---

### Task A4.7: Star-partitioned topic queries

**Files:**
- Modify: `scripts/harvest/discover.ts` (add one import at the top, append the rest at end of file)
- Test: `tests/harvest/queries.test.ts`

**Interfaces:**
- Consumes: `MIN_STARS` from `src/lib/inclusion.ts`
- Produces: `export const DISCOVERY_TOPICS`; `export const STAR_PARTITIONS: readonly string[]`; `export function buildSearchQueries(topics?: readonly string[], partitions?: readonly string[]): string[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/queries.test.ts
import { describe, expect, it } from 'vitest';
import { MIN_STARS } from '../../src/lib/inclusion.ts';
import {
  buildSearchQueries,
  DISCOVERY_TOPICS,
  STAR_PARTITIONS,
} from '../../scripts/harvest/discover.ts';

describe('buildSearchQueries', () => {
  it('sweeps every topic across every star partition', () => {
    const queries = buildSearchQueries();
    expect(queries).toHaveLength(DISCOVERY_TOPICS.length * STAR_PARTITIONS.length);
    expect(queries).toHaveLength(15);
    expect(queries[0]).toBe('topic:claude-skills stars:>=1000');
    expect(queries[1]).toBe('topic:claude-skills stars:100..999');
    expect(queries[2]).toBe('topic:claude-skills stars:10..99');
    expect(queries).toContain('topic:openclaw-skills stars:100..999');
    expect(queries).toContain('topic:mcp-server stars:10..99');
  });

  it('partitions so no single query can hit the hard 1000-result cap silently', () => {
    expect([...STAR_PARTITIONS]).toEqual(['>=1000', '100..999', '10..99']);
    expect([...DISCOVERY_TOPICS]).toEqual([
      'claude-skills',
      'agent-skills',
      'openclaw-skills',
      'claude-code',
      'mcp-server',
    ]);
  });

  it('derives its lowest band from the one published stars floor', () => {
    expect(MIN_STARS).toBe(10);
    expect(STAR_PARTITIONS[STAR_PARTITIONS.length - 1]).toBe(`${MIN_STARS}..99`);
    for (const q of buildSearchQueries()) {
      expect(q).not.toContain('stars:0');
      expect(q).not.toContain('stars:1..');
    }
  });

  it('accepts explicit topics and partitions', () => {
    expect(buildSearchQueries(['x'], ['10..99'])).toEqual(['topic:x stars:10..99']);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/queries.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/discover.ts' does not provide an export named 'buildSearchQueries'`
- [ ] **Step 3: Write minimal implementation**
Add as the first line of `scripts/harvest/discover.ts`:
```ts
import { MIN_STARS } from '../../src/lib/inclusion.ts';
```
Then append at the end of `scripts/harvest/discover.ts`:
```ts
/** Topic sweeps. Content categories are NEVER seeded from topics (spec 3.4). */
export const DISCOVERY_TOPICS = [
  'claude-skills',
  'agent-skills',
  'openclaw-skills',
  'claude-code',
  'mcp-server',
] as const;

/**
 * Star partitions beat the hard 1,000-result cap on /search/repositories.
 * The lowest band is derived from MIN_STARS so the swept band and the admitted band
 * cannot drift apart.
 */
export const STAR_PARTITIONS: readonly string[] = ['>=1000', '100..999', `${MIN_STARS}..99`];

export function buildSearchQueries(
  topics: readonly string[] = DISCOVERY_TOPICS,
  partitions: readonly string[] = STAR_PARTITIONS,
): string[] {
  const out: string[] = [];
  for (const topic of topics) {
    for (const partition of partitions) {
      out.push(`topic:${topic} stars:${partition}`);
    }
  }
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/queries.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/queries.test.ts
git commit -m "feat(harvest): star-partitioned topic query builder"
```

---

### Task A4.8: One paged repository search, with backoff

**Files:**
- Modify: `scripts/harvest/discover.ts` (append at end of file)
- Test: `tests/harvest/search-page.test.ts`

**Interfaces:**
- Consumes: `sleep`, `FetchLike` from `scripts/harvest/discover.ts`
- Produces: `export interface RepoSeed { repo: string; stars: number; isOrg: boolean }`; `export interface SearchPage { items: RepoSeed[]; totalCount: number }`; `export interface RequestDeps { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void> }`; `export async function searchPage(query: string, page: number, token: string, deps?: RequestDeps): Promise<SearchPage>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/search-page.test.ts
import { describe, expect, it } from 'vitest';
import { searchPage } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('searchPage', () => {
  it('requests 100 results per page, sorted by stars, and maps the payload', async () => {
    const urls: string[] = [];
    let seenAuth = '';
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seenAuth = headers.authorization;
      return new Response(
        JSON.stringify({
          total_count: 2,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
            {
              full_name: 'someone/skills',
              stargazers_count: 6908,
              owner: { type: 'User' },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await searchPage('topic:claude-skills stars:>=1000', 1, 'tok', { fetchImpl });

    expect(urls[0]).toBe(
      'https://api.github.com/search/repositories?q=topic%3Aclaude-skills%20stars%3A%3E%3D1000&sort=stars&order=desc&per_page=100&page=1',
    );
    expect(seenAuth).toBe('Bearer tok');
    expect(result.totalCount).toBe(2);
    expect(result.items).toEqual([
      { repo: 'anthropics/skills', stars: 172473, isOrg: true },
      { repo: 'someone/skills', stars: 6908, isOrg: false },
    ]);
  });

  it('honours retry-after on a 403 and then succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', {
          status: 403,
          headers: { 'retry-after': '2' },
        });
      }
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 });
    });

    const result = await searchPage('topic:agent-skills stars:10..99', 3, 'tok', {
      fetchImpl,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });

    expect(calls).toBe(2);
    expect(slept).toEqual([2000]);
    expect(result).toEqual({ items: [], totalCount: 0 });
  });

  it('throws on a non-retryable status', async () => {
    const fetchImpl = stubFetch(() => new Response('boom', { status: 422 }));
    await expect(searchPage('topic:x stars:10..99', 11, 'tok', { fetchImpl })).rejects.toThrow(
      'search "topic:x stars:10..99" page 11: HTTP 422',
    );
  });

  it('drops malformed items and defaults a missing owner type to not-an-org', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({ total_count: 2, items: [{ stargazers_count: 5 }, { full_name: 'a/b' }] }),
          { status: 200 },
        ),
    );
    const result = await searchPage('topic:x stars:10..99', 1, 'tok', { fetchImpl });
    expect(result.items).toEqual([{ repo: 'a/b', stars: 0, isOrg: false }]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/search-page.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/discover.ts' does not provide an export named 'searchPage'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/discover.ts`:
```ts
const API = 'https://api.github.com';

/**
 * Discovery-local repo shape. It carries `isOrg`, which the shared `RepoRef` deliberately does
 * not: the org flag only exists to feed `passesRepoGate` here, and A5's enrichment is the
 * authority on collection metadata afterwards.
 */
export interface RepoSeed {
  repo: string;
  stars: number;
  isOrg: boolean;
}

export interface SearchPage {
  items: RepoSeed[];
  totalCount: number;
}

export interface RequestDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'ai-tools-hub-harvest',
    'x-github-api-version': '2022-11-28',
  };
}

function backoffMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter !== null && retryAfter.trim() !== '') return Number(retryAfter) * 1000;
  const reset = res.headers.get('x-ratelimit-reset');
  if (reset !== null && reset.trim() !== '') {
    const ms = Number(reset) * 1000 - Date.now();
    if (ms > 0) return ms;
  }
  return 2000 * attempt;
}

interface RepoItem {
  full_name?: string;
  stargazers_count?: number;
  owner?: { type?: string };
}

function toSeed(item: RepoItem): RepoSeed | null {
  if (typeof item.full_name !== 'string') return null;
  return {
    repo: item.full_name,
    stars: item.stargazers_count ?? 0,
    isOrg: item.owner?.type === 'Organization',
  };
}

export async function searchPage(
  query: string,
  page: number,
  token: string,
  deps: RequestDeps = {},
): Promise<SearchPage> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const wait = deps.sleepImpl ?? sleep;
  const url =
    `${API}/search/repositories?q=${encodeURIComponent(query)}` +
    `&sort=stars&order=desc&per_page=100&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetchImpl(url, { headers: ghHeaders(token) });
    if (res.ok) {
      const body = (await res.json()) as { total_count?: number; items?: RepoItem[] };
      const items: RepoSeed[] = [];
      for (const item of body.items ?? []) {
        const seed = toSeed(item);
        if (seed !== null) items.push(seed);
      }
      return { items, totalCount: body.total_count ?? items.length };
    }
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await wait(backoffMs(res, attempt));
      continue;
    }
    throw new Error(`search "${query}" page ${page}: HTTP ${res.status}`);
  }
  throw new Error(`search "${query}" page ${page}: retries exhausted`);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/search-page.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/search-page.test.ts
git commit -m "feat(harvest): paged repository search with rate-limit backoff"
```

---

### Task A4.9: Code-search seed page — `.claude-plugin/marketplace.json`

**Files:**
- Modify: `scripts/harvest/discover.ts` (append at end of file)
- Test: `tests/harvest/code-search.test.ts`

**Interfaces:**
- Consumes: `RepoSeed`, `SearchPage`, `RequestDeps`, `sleep` from `scripts/harvest/discover.ts`
- Produces: `export const MARKETPLACE_CODE_QUERY = 'path:.claude-plugin filename:marketplace.json'`; `export async function codeSearchPage(page: number, token: string, deps?: RequestDeps): Promise<SearchPage>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/code-search.test.ts
import { describe, expect, it } from 'vitest';
import { codeSearchPage, MARKETPLACE_CODE_QUERY } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('codeSearchPage', () => {
  it('queries the highest-signal structured seed, authenticated', async () => {
    const urls: string[] = [];
    let seenAuth = '';
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      seenAuth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      return new Response(
        JSON.stringify({
          total_count: 1,
          items: [
            {
              path: '.claude-plugin/marketplace.json',
              repository: {
                full_name: 'anthropics/skills',
                stargazers_count: 172473,
                owner: { type: 'Organization' },
              },
            },
          ],
        }),
        { status: 200 },
      );
    });

    const result = await codeSearchPage(1, 'tok', { fetchImpl });

    expect(MARKETPLACE_CODE_QUERY).toBe('path:.claude-plugin filename:marketplace.json');
    expect(urls).toEqual([
      'https://api.github.com/search/code?q=path%3A.claude-plugin%20filename%3Amarketplace.json&per_page=100&page=1',
    ]);
    expect(seenAuth).toBe('Bearer tok');
    expect(result).toEqual({
      totalCount: 1,
      items: [{ repo: 'anthropics/skills', stars: 172473, isOrg: true }],
    });
  });

  it('collapses several marketplace files in one repo to a single seed', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            total_count: 3,
            items: [
              { repository: { full_name: 'mono/plugins', owner: { type: 'User' } } },
              { repository: { full_name: 'mono/plugins', owner: { type: 'User' } } },
              { repository: { full_name: 'other/plugins', owner: { type: 'Organization' } } },
            ],
          }),
          { status: 200 },
        ),
    );
    const result = await codeSearchPage(1, 'tok', { fetchImpl });
    expect(result.items).toEqual([
      { repo: 'mono/plugins', stars: 0, isOrg: false },
      { repo: 'other/plugins', stars: 0, isOrg: true },
    ]);
    expect(result.totalCount).toBe(3);
  });

  it('treats the 422 past the 1000-result cap as the end of the seed, not an error', async () => {
    const fetchImpl = stubFetch(() => new Response('too many results', { status: 422 }));
    await expect(codeSearchPage(11, 'tok', { fetchImpl })).resolves.toEqual({
      items: [],
      totalCount: 0,
    });
  });

  it('honours retry-after on a 403 and then succeeds', async () => {
    const slept: number[] = [];
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limited', { status: 403, headers: { 'retry-after': '6' } });
      }
      return new Response(JSON.stringify({ total_count: 0, items: [] }), { status: 200 });
    });
    const result = await codeSearchPage(1, 'tok', {
      fetchImpl,
      sleepImpl: async (ms) => {
        slept.push(ms);
      },
    });
    expect(calls).toBe(2);
    expect(slept).toEqual([6000]);
    expect(result.items).toEqual([]);
  });

  it('throws on an unexpected status', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(codeSearchPage(2, 'tok', { fetchImpl })).rejects.toThrow(
      'code search page 2: HTTP 500',
    );
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/code-search.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/discover.ts' does not provide an export named 'codeSearchPage'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/discover.ts`:
```ts
/**
 * Spec 6.1: "one code-search pass for `path:.claude-plugin filename:marketplace.json` — the
 * highest-signal structured seed". This is the ONLY user of the code_search 10/min bucket, and
 * it needs the fine-grained PAT: GITHUB_TOKEN cannot do global code search (spec 6.2).
 */
export const MARKETPLACE_CODE_QUERY = 'path:.claude-plugin filename:marketplace.json';

interface CodeItem {
  repository?: RepoItem;
}

export async function codeSearchPage(
  page: number,
  token: string,
  deps: RequestDeps = {},
): Promise<SearchPage> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const wait = deps.sleepImpl ?? sleep;
  const url =
    `${API}/search/code?q=${encodeURIComponent(MARKETPLACE_CODE_QUERY)}` +
    `&per_page=100&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const res = await fetchImpl(url, { headers: ghHeaders(token) });
    if (res.ok) {
      const body = (await res.json()) as { total_count?: number; items?: CodeItem[] };
      const seen = new Map<string, RepoSeed>();
      for (const item of body.items ?? []) {
        const seed = item.repository === undefined ? null : toSeed(item.repository);
        if (seed !== null && !seen.has(seed.repo)) seen.set(seed.repo, seed);
      }
      const items = [...seen.values()];
      return { items, totalCount: body.total_count ?? items.length };
    }
    // 422 is code search's own 1,000-result cap past page 10 — the end of the seed, not a fault.
    if (res.status === 422) return { items: [], totalCount: 0 };
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await wait(backoffMs(res, attempt));
      continue;
    }
    throw new Error(`code search page ${page}: HTTP ${res.status}`);
  }
  throw new Error(`code search page ${page}: retries exhausted`);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/code-search.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/code-search.test.ts
git commit -m "feat(harvest): marketplace.json code-search seed page"
```

---

### Task A4.10: discoverMarketplaceRepos — the paced seed sweep

**Files:**
- Modify: `scripts/harvest/discover.ts` (append at end of file)
- Test: `tests/harvest/marketplace-seed.test.ts`

**Interfaces:**
- Consumes: `codeSearchPage`, `createPacer`, `CODE_SEARCH_PER_MINUTE`, `RepoSeed`, `RequestDeps` from `scripts/harvest/discover.ts`
- Produces: `export interface DiscoverDeps extends RequestDeps { now?: () => number; log?: (msg: string) => void }`; `export async function discoverMarketplaceRepos(token: string, deps?: DiscoverDeps): Promise<RepoSeed[]>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/marketplace-seed.test.ts
import { describe, expect, it } from 'vitest';
import { discoverMarketplaceRepos } from '../../scripts/harvest/discover.ts';

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get('page') ?? '0');
}

describe('discoverMarketplaceRepos', () => {
  it('pages until the total is consumed and unions the seeds', async () => {
    const pagesSeen: number[] = [];
    const first = Array.from({ length: 100 }, (_, i) => ({
      repository: {
        full_name: `owner/a${String(i).padStart(3, '0')}`,
        stargazers_count: 40,
        owner: { type: 'User' },
      },
    }));
    const second = [
      {
        repository: {
          full_name: 'lateorg/plugins',
          stargazers_count: 2,
          owner: { type: 'Organization' },
        },
      },
    ];

    const fetchImpl = (async (input: RequestInfo | URL) => {
      const page = pageOf(String(input));
      pagesSeen.push(page);
      return json({ total_count: 150, items: page === 1 ? first : second });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(pagesSeen).toEqual([1, 2]);
    expect(seeds).toHaveLength(101);
    expect(seeds).toContainEqual({ repo: 'lateorg/plugins', stars: 2, isOrg: true });
  });

  it('stops after one request when the seed is empty', async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return json({ total_count: 0, items: [] });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(calls).toBe(1);
    expect(seeds).toEqual([]);
  });

  it('keeps the highest star count seen for a repo across pages', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const page = pageOf(String(input));
      const stars = page === 1 ? 5 : 900;
      return json({
        total_count: 200,
        items: Array.from({ length: 100 }, () => ({
          repository: {
            full_name: 'dup/plugins',
            stargazers_count: stars,
            owner: { type: 'User' },
          },
        })),
      });
    }) as typeof fetch;

    const seeds = await discoverMarketplaceRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(seeds).toEqual([{ repo: 'dup/plugins', stars: 900, isOrg: false }]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/marketplace-seed.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/discover.ts' does not provide an export named 'discoverMarketplaceRepos'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/discover.ts`:
```ts
export interface DiscoverDeps extends RequestDeps {
  now?: () => number;
  log?: (msg: string) => void;
}

/**
 * The marketplace seed finds repos that carry no `topic:` at all, which the sweeps can never
 * reach. Its results still face the same repo gate; the seed buys recall, not an exemption.
 * Star counts on code-search results are best-effort — A5's enrichment is the authority.
 */
export async function discoverMarketplaceRepos(
  token: string,
  deps: DiscoverDeps = {},
): Promise<RepoSeed[]> {
  const log = deps.log ?? (() => {});
  const pacer = createPacer(CODE_SEARCH_PER_MINUTE, { now: deps.now, sleep: deps.sleepImpl });
  const found = new Map<string, RepoSeed>();

  for (let page = 1; page <= 10; page += 1) {
    await pacer.take();
    const { items, totalCount } = await codeSearchPage(page, token, deps);
    for (const seed of items) {
      const previous = found.get(seed.repo);
      if (previous === undefined || seed.stars > previous.stars) found.set(seed.repo, seed);
    }
    log(`marketplace seed page ${page}: ${items.length} repos of ${totalCount} file hits`);
    if (items.length === 0 || page * 100 >= totalCount) break;
  }

  return [...found.values()];
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/marketplace-seed.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/marketplace-seed.test.ts
git commit -m "feat(harvest): paced marketplace.json seed sweep"
```

---

### Task A4.11: discoverRepos — union sweep, dedupe, repo gate

**Files:**
- Modify: `scripts/harvest/discover.ts` (replace the import line at the top, append the rest at end of file)
- Test: `tests/harvest/discover.test.ts`

**Interfaces:**
- Consumes: `RepoRef` from `src/types.ts`; `passesRepoGate` from `src/lib/inclusion.ts`; `buildSearchQueries`, `searchPage`, `discoverMarketplaceRepos`, `createPacer`, `SEARCH_PER_MINUTE`, `RepoSeed`, `DiscoverDeps` from `scripts/harvest/discover.ts`
- Produces: `export async function discoverRepos(token: string, deps?: DiscoverDeps): Promise<RepoRef[]>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/discover.test.ts
import { describe, expect, it } from 'vitest';
import { discoverRepos } from '../../scripts/harvest/discover.ts';

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

function queryOf(url: string): string {
  return new URL(url).searchParams.get('q') ?? '';
}

function pageOf(url: string): number {
  return Number(new URL(url).searchParams.get('page') ?? '0');
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

const EMPTY = { total_count: 0, items: [] };

describe('discoverRepos', () => {
  it('unions every sweep, dedupes by repo, and applies the repo gate', async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) return json(EMPTY);
      const query = queryOf(url);
      if (query === 'topic:claude-skills stars:>=1000') {
        return json({
          total_count: 2,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
            {
              full_name: 'trailofbits/skills',
              stargazers_count: 6908,
              owner: { type: 'Organization' },
            },
          ],
        });
      }
      if (query === 'topic:agent-skills stars:>=1000') {
        return json({
          total_count: 1,
          items: [
            {
              full_name: 'anthropics/skills',
              stargazers_count: 172473,
              owner: { type: 'Organization' },
            },
          ],
        });
      }
      if (query === 'topic:mcp-server stars:10..99') {
        return json({
          total_count: 3,
          items: [
            { full_name: 'someone/tiny-skills', stargazers_count: 11, owner: { type: 'User' } },
            { full_name: 'someone/too-small', stargazers_count: 5, owner: { type: 'User' } },
            { full_name: 'someorg/tiny', stargazers_count: 3, owner: { type: 'Organization' } },
          ],
        });
      }
      return json(EMPTY);
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(repos).toEqual([
      { repo: 'anthropics/skills', stars: 172473 },
      { repo: 'trailofbits/skills', stars: 6908 },
      { repo: 'someone/tiny-skills', stars: 11 },
      { repo: 'someorg/tiny', stars: 3 },
    ]);
  });

  it('admits marketplace-seeded repos the topic sweeps never reach', async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) {
        return json({
          total_count: 2,
          items: [
            {
              repository: {
                full_name: 'seedorg/plugins',
                stargazers_count: 1,
                owner: { type: 'Organization' },
              },
            },
            {
              repository: {
                full_name: 'seeduser/plugins',
                stargazers_count: 1,
                owner: { type: 'User' },
              },
            },
          ],
        });
      }
      return json(EMPTY);
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    // The org seed clears the gate on its account type; the 1-star personal seed does not.
    expect(repos).toEqual([{ repo: 'seedorg/plugins', stars: 1 }]);
  });

  it('pages through a partition until the cap or the last page', async () => {
    const pagesSeen: number[] = [];
    const first = Array.from({ length: 100 }, (_, i) => ({
      full_name: `owner/a${String(i).padStart(3, '0')}`,
      stargazers_count: 500,
      owner: { type: 'User' },
    }));
    const second = Array.from({ length: 50 }, (_, i) => ({
      full_name: `owner/b${String(i).padStart(3, '0')}`,
      stargazers_count: 500,
      owner: { type: 'User' },
    }));

    const fetchImpl = stubFetch((url) => {
      if (url.includes('/search/code')) return json(EMPTY);
      if (queryOf(url) !== 'topic:claude-code stars:100..999') return json(EMPTY);
      const page = pageOf(url);
      pagesSeen.push(page);
      return json({ total_count: 150, items: page === 1 ? first : second });
    });

    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });

    expect(pagesSeen).toEqual([1, 2]);
    expect(repos).toHaveLength(150);
    expect(repos.some((r) => r.repo === 'owner/b049')).toBe(true);
  });

  it('issues 15 topic requests plus one code-search request when everything is empty', async () => {
    let calls = 0;
    const fetchImpl = stubFetch(() => {
      calls += 1;
      return json(EMPTY);
    });
    const repos = await discoverRepos('tok', {
      fetchImpl,
      sleepImpl: async () => {},
      now: () => 1_000_000,
    });
    expect(calls).toBe(16);
    expect(repos).toEqual([]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/discover.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/discover.ts' does not provide an export named 'discoverRepos'`
- [ ] **Step 3: Write minimal implementation**
Replace line 1 of `scripts/harvest/discover.ts`, which currently reads:
```ts
import { MIN_STARS } from '../../src/lib/inclusion.ts';
```
with these two lines:
```ts
import type { RepoRef } from '../../src/types.ts';
import { MIN_STARS, passesRepoGate } from '../../src/lib/inclusion.ts';
```
Then append at the end of `scripts/harvest/discover.ts`:
```ts
/**
 * Union of the star-partitioned topic sweeps and the marketplace code-search seed, deduped by
 * repo and filtered through the published repo gate (spec 6.4). Returns the shared `RepoRef`
 * shape; `isOrg` was only ever a gate input and does not leave this module.
 */
export async function discoverRepos(token: string, deps: DiscoverDeps = {}): Promise<RepoRef[]> {
  const log = deps.log ?? (() => {});
  const pacer = createPacer(SEARCH_PER_MINUTE, { now: deps.now, sleep: deps.sleepImpl });
  const found = new Map<string, RepoSeed>();

  const remember = (seed: RepoSeed): void => {
    const previous = found.get(seed.repo);
    if (previous === undefined) {
      found.set(seed.repo, seed);
      return;
    }
    found.set(seed.repo, {
      repo: seed.repo,
      stars: Math.max(previous.stars, seed.stars),
      isOrg: previous.isOrg || seed.isOrg,
    });
  };

  for (const query of buildSearchQueries()) {
    for (let page = 1; page <= 10; page += 1) {
      await pacer.take();
      const { items, totalCount } = await searchPage(query, page, token, deps);
      for (const seed of items) remember(seed);
      log(`${query} page ${page}: ${items.length} of ${totalCount}`);
      if (items.length < 100 || page * 100 >= totalCount) break;
    }
  }

  for (const seed of await discoverMarketplaceRepos(token, deps)) remember(seed);

  const admitted = [...found.values()].filter((seed) => passesRepoGate(seed));
  log(`discovery: ${admitted.length} repos admitted of ${found.size} found (floor ${MIN_STARS})`);

  return admitted
    .map(({ repo, stars }) => ({ repo, stars }))
    .sort((a, b) => b.stars - a.stars || a.repo.localeCompare(b.repo));
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/discover.test.ts && npm run typecheck`
Expected: PASS — 4 tests pass and typecheck prints nothing.
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/discover.ts tests/harvest/discover.test.ts
git commit -m "feat(harvest): discoverRepos union sweep with seed, dedupe and repo gate"
```

---

### Task A4.12: One recursive tree call per repo

**Files:**
- Create: `scripts/harvest/enumerate.ts`
- Test: `tests/harvest/fetch-tree.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts` (`{ path: string; mode: string; sha: string; type: string }`); `FetchLike` (type) from `scripts/harvest/discover.ts`
- Produces: `export interface EnumerateDeps { fetchImpl?: FetchLike; sleepImpl?: (ms: number) => Promise<void>; now?: () => number; log?: (msg: string) => void }`; `export async function fetchTree(repo: string, token: string, deps?: EnumerateDeps): Promise<TreeFile[]>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/fetch-tree.test.ts
import { describe, expect, it } from 'vitest';
import { fetchTree } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchTree', () => {
  it('makes exactly one recursive tree request and maps the entries', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(
        JSON.stringify({
          sha: 'tree1',
          truncated: false,
          tree: [
            { path: 'skills', mode: '040000', sha: 'dir1', type: 'tree' },
            { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob1', type: 'blob' },
          ],
        }),
        { status: 200 },
      );
    });

    const files = await fetchTree('owner/repo', 'tok', { fetchImpl });

    expect(urls).toEqual(['https://api.github.com/repos/owner/repo/git/trees/HEAD?recursive=1']);
    expect(files).toEqual([
      { path: 'skills', mode: '040000', sha: 'dir1', type: 'tree' },
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob1', type: 'blob' },
    ]);
  });

  it('returns an empty tree for missing (404) and empty (409) repos', async () => {
    const notFound = stubFetch(() => new Response('', { status: 404 }));
    const empty = stubFetch(() => new Response('', { status: 409 }));
    expect(await fetchTree('owner/gone', 'tok', { fetchImpl: notFound })).toEqual([]);
    expect(await fetchTree('owner/empty', 'tok', { fetchImpl: empty })).toEqual([]);
  });

  it('logs loudly when GitHub truncates the tree but still returns what arrived', async () => {
    const logs: string[] = [];
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            truncated: true,
            tree: [{ path: 'a/SKILL.md', mode: '100644', sha: 'b1', type: 'blob' }],
          }),
          { status: 200 },
        ),
    );
    const files = await fetchTree('owner/huge', 'tok', { fetchImpl, log: (m) => logs.push(m) });
    expect(files).toHaveLength(1);
    expect(logs.join('\n')).toContain('TRUNCATED');
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(fetchTree('owner/repo', 'tok', { fetchImpl })).rejects.toThrow(
      'tree owner/repo: HTTP 500',
    );
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/fetch-tree.test.ts`
Expected: FAIL — `scripts/harvest/enumerate.ts` does not exist yet, so Vitest cannot resolve the import and reports `Error: Failed to load url ../../scripts/harvest/enumerate.ts`.
- [ ] **Step 3: Write minimal implementation**
```ts
// scripts/harvest/enumerate.ts
import type { TreeFile } from '../../src/types.ts';
import type { FetchLike } from './discover.ts';

const API = 'https://api.github.com';

export interface EnumerateDeps {
  fetchImpl?: FetchLike;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (msg: string) => void;
}

function ghHeaders(token: string): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'ai-tools-hub-harvest',
    'x-github-api-version': '2022-11-28',
  };
}

interface TreeEntry {
  path?: string;
  mode?: string;
  sha?: string;
  type?: string;
}

/** One recursive tree call per repo. Missing (404) and empty (409) repos yield []. */
export async function fetchTree(
  repo: string,
  token: string,
  deps: EnumerateDeps = {},
): Promise<TreeFile[]> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const log = deps.log ?? (() => {});
  const res = await fetchImpl(`${API}/repos/${repo}/git/trees/HEAD?recursive=1`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404 || res.status === 409) return [];
  if (!res.ok) throw new Error(`tree ${repo}: HTTP ${res.status}`);
  const body = (await res.json()) as { truncated?: boolean; tree?: TreeEntry[] };
  if (body.truncated === true) log(`tree ${repo}: TRUNCATED, result is partial`);
  const out: TreeFile[] = [];
  for (const entry of body.tree ?? []) {
    if (
      typeof entry.path !== 'string' ||
      typeof entry.mode !== 'string' ||
      typeof entry.sha !== 'string' ||
      typeof entry.type !== 'string'
    ) {
      continue;
    }
    out.push({ path: entry.path, mode: entry.mode, sha: entry.sha, type: entry.type });
  }
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/fetch-tree.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/fetch-tree.test.ts
git commit -m "feat(harvest): single recursive git-tree fetch per repo"
```

---

### Task A4.13: isSkillPath

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/skill-path.test.ts`

**Interfaces:**
- Consumes: `scripts/harvest/enumerate.ts` (already exports `fetchTree`, `EnumerateDeps`)
- Produces: `export function isSkillPath(path: string): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/skill-path.test.ts
import { describe, expect, it } from 'vitest';
import { isSkillPath } from '../../scripts/harvest/enumerate.ts';

describe('isSkillPath', () => {
  it('accepts a SKILL.md inside a skill directory', () => {
    expect(isSkillPath('skills/pdf-processing/SKILL.md')).toBe(true);
    expect(isSkillPath('a/b/c/d/SKILL.md')).toBe(true);
  });

  it('rejects anything that is not a directory-scoped SKILL.md', () => {
    expect(isSkillPath('SKILL.md')).toBe(false);
    expect(isSkillPath('skills/a/README.md')).toBe(false);
    expect(isSkillPath('skills/a/SKILL.md.bak')).toBe(false);
    expect(isSkillPath('skills/a/skill.md')).toBe(false);
    expect(isSkillPath('docs/HOW-TO-WRITE-A-SKILL.md')).toBe(false);
    expect(isSkillPath('')).toBe(false);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/skill-path.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'isSkillPath'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
/** A skill is a directory containing SKILL.md; a bare root SKILL.md is a repo README. */
export function isSkillPath(path: string): boolean {
  return path.endsWith('/SKILL.md');
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/skill-path.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/skill-path.test.ts
git commit -m "feat(harvest): isSkillPath predicate for tree entries"
```

---

### Task A4.14: Crawler trap (a) — skip git symlinks

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/symlink.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts`
- Produces: `export function isSymlink(file: TreeFile): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/symlink.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { isSymlink } from '../../scripts/harvest/enumerate.ts';

describe('isSymlink', () => {
  it('flags mode 120000 entries', () => {
    const link: TreeFile = {
      path: 'skills/mirror/SKILL.md',
      mode: '120000',
      sha: 'blob-a',
      type: 'blob',
    };
    expect(isSymlink(link)).toBe(true);
  });

  it('does not flag regular files, executables or trees', () => {
    expect(isSymlink({ path: 'a/SKILL.md', mode: '100644', sha: 's', type: 'blob' })).toBe(false);
    expect(isSymlink({ path: 'a/run.sh', mode: '100755', sha: 's', type: 'blob' })).toBe(false);
    expect(isSymlink({ path: 'a', mode: '040000', sha: 's', type: 'tree' })).toBe(false);
  });

  it('halves an inflated count: the sampled repo shape (458 links of 846 paths)', () => {
    const files: TreeFile[] = [];
    for (let i = 0; i < 388; i += 1) {
      files.push({ path: `skills/real${i}/SKILL.md`, mode: '100644', sha: `r${i}`, type: 'blob' });
    }
    for (let i = 0; i < 458; i += 1) {
      files.push({ path: `links/l${i}/SKILL.md`, mode: '120000', sha: `l${i}`, type: 'blob' });
    }
    expect(files).toHaveLength(846);
    expect(files.filter((f) => !isSymlink(f))).toHaveLength(388);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/symlink.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'isSymlink'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
/**
 * Crawler trap (a): git symlinks carry mode 120000 and point at another path.
 * One sampled repo had 458 of 846 SKILL.md paths as symlinks; counting them doubles totals.
 */
export function isSymlink(file: TreeFile): boolean {
  return file.mode === '120000';
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/symlink.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/symlink.test.ts
git commit -m "feat(harvest): skip mode-120000 symlink tree entries"
```

---

### Task A4.15: Crawler trap (b) — dedupe by blob SHA

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/dedupe.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts`
- Produces: `export function dedupeByBlobSha(files: TreeFile[]): TreeFile[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/dedupe.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { dedupeByBlobSha } from '../../scripts/harvest/enumerate.ts';

describe('dedupeByBlobSha', () => {
  it('keeps the first path for each blob sha', () => {
    const files: TreeFile[] = [
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'vendor/copy-of-a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'skills/b/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
    ];

    expect(dedupeByBlobSha(files)).toEqual([
      { path: 'skills/a/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
      { path: 'skills/b/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
    ]);
  });

  it('is a no-op when every blob is distinct', () => {
    const files: TreeFile[] = [
      { path: 'a/SKILL.md', mode: '100644', sha: 'x', type: 'blob' },
      { path: 'b/SKILL.md', mode: '100644', sha: 'y', type: 'blob' },
    ];
    expect(dedupeByBlobSha(files)).toEqual(files);
  });

  it('handles an empty list', () => {
    expect(dedupeByBlobSha([])).toEqual([]);
  });

  it('collapses a repo that ships the same skill under many paths', () => {
    const files: TreeFile[] = Array.from({ length: 50 }, (_, i) => ({
      path: `copies/c${i}/SKILL.md`,
      mode: '100644',
      sha: 'same-blob',
      type: 'blob',
    }));
    expect(dedupeByBlobSha(files)).toHaveLength(1);
    expect(dedupeByBlobSha(files)[0].path).toBe('copies/c0/SKILL.md');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/dedupe.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'dedupeByBlobSha'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
/**
 * Crawler trap (b): identical content committed at several paths inflates headline counts.
 * Tree entries arrive path-sorted, so keeping the first occurrence is deterministic.
 */
export function dedupeByBlobSha(files: TreeFile[]): TreeFile[] {
  const seen = new Set<string>();
  const out: TreeFile[] = [];
  for (const file of files) {
    if (seen.has(file.sha)) continue;
    seen.add(file.sha);
    out.push(file);
  }
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/dedupe.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/dedupe.test.ts
git commit -m "feat(harvest): dedupe skill paths by blob sha"
```

---

### Task A4.16: filterSkillFiles — the composed tree filter

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (replace the two import lines at the top, append the rest at end of file)
- Test: `tests/harvest/filter-skill-files.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts`; `isRepoInternal` from `src/lib/inclusion.ts`; `isSkillPath`, `isSymlink`, `dedupeByBlobSha` from `scripts/harvest/enumerate.ts`
- Produces: `export function filterSkillFiles(files: TreeFile[]): TreeFile[]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/filter-skill-files.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { filterSkillFiles } from '../../scripts/harvest/enumerate.ts';

describe('filterSkillFiles', () => {
  it('keeps only distributable, non-symlinked, deduped SKILL.md blobs', () => {
    const tree: TreeFile[] = [
      { path: 'skills', mode: '040000', sha: 'tree-1', type: 'tree' },
      { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: 'skills/beta/SKILL.md', mode: '120000', sha: 'blob-b', type: 'blob' },
      { path: 'mirror/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: '.claude/skills/internal/SKILL.md', mode: '100644', sha: 'blob-c', type: 'blob' },
      { path: 'skills/gamma/README.md', mode: '100644', sha: 'blob-d', type: 'blob' },
      { path: 'skills/delta/SKILL.md', mode: '100644', sha: 'blob-e', type: 'blob' },
    ];

    expect(filterSkillFiles(tree)).toEqual([
      { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
      { path: 'skills/delta/SKILL.md', mode: '100644', sha: 'blob-e', type: 'blob' },
    ]);
  });

  it('returns an empty list for a repo with no skills', () => {
    expect(
      filterSkillFiles([{ path: 'README.md', mode: '100644', sha: 'r', type: 'blob' }]),
    ).toEqual([]);
  });

  it('does not let a deduped internal copy steal the slot of a real skill', () => {
    const tree: TreeFile[] = [
      { path: '.claude/skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
      { path: 'skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
    ];
    expect(filterSkillFiles(tree)).toEqual([
      { path: 'skills/x/SKILL.md', mode: '100644', sha: 'shared', type: 'blob' },
    ]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/filter-skill-files.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'filterSkillFiles'`
- [ ] **Step 3: Write minimal implementation**
Replace the two import lines at the top of `scripts/harvest/enumerate.ts`, which currently read:
```ts
import type { TreeFile } from '../../src/types.ts';
import type { FetchLike } from './discover.ts';
```
with these three lines:
```ts
import type { TreeFile } from '../../src/types.ts';
import { isRepoInternal } from '../../src/lib/inclusion.ts';
import type { FetchLike } from './discover.ts';
```
Then append at the end of `scripts/harvest/enumerate.ts`:
```ts
/**
 * Tree entries to real, distributable skills. `isRepoInternal` is the inclusion filter's own
 * rule (spec 6.4), imported rather than restated. Dedupe runs LAST so an internal copy sharing
 * a blob with a real skill can never win the slot.
 */
export function filterSkillFiles(files: TreeFile[]): TreeFile[] {
  const kept = files.filter(
    (file) =>
      file.type === 'blob' &&
      !isSymlink(file) &&
      isSkillPath(file.path) &&
      !isRepoInternal(file.path),
  );
  return dedupeByBlobSha(kept);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/filter-skill-files.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/filter-skill-files.test.ts
git commit -m "feat(harvest): compose the skill-file filter from the four tree rules"
```

---

### Task A4.17: Fetch raw file content, unauthenticated

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/raw-file.test.ts`

**Interfaces:**
- Consumes: `EnumerateDeps` from `scripts/harvest/enumerate.ts`
- Produces: `export async function fetchRawFile(repo: string, ref: string, path: string, deps?: EnumerateDeps): Promise<string | null>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/raw-file.test.ts
import { describe, expect, it } from 'vitest';
import { fetchRawFile } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string, init?: RequestInit) => Response): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init)) as typeof fetch;
}

describe('fetchRawFile', () => {
  it('reads a commit-pinned path without an Authorization header', async () => {
    const urls: string[] = [];
    let headers: Record<string, string> = {};
    const fetchImpl = stubFetch((url, init) => {
      urls.push(url);
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response('---\nname: alpha\n---\nBody.', { status: 200 });
    });

    const text = await fetchRawFile('owner/repo', 'c0ffee1', 'skills/alpha/SKILL.md', {
      fetchImpl,
    });

    expect(urls).toEqual([
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md',
    ]);
    expect(headers.authorization).toBeUndefined();
    expect(text).toBe('---\nname: alpha\n---\nBody.');
  });

  it('percent-encodes each path segment but keeps the separators', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response('x', { status: 200 });
    });
    await fetchRawFile('owner/repo', 'c0ffee1', 'skills/my skill/SKILL.md', { fetchImpl });
    expect(urls[0]).toBe(
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/my%20skill/SKILL.md',
    );
  });

  it('returns null on 404', async () => {
    const fetchImpl = stubFetch(() => new Response('404: Not Found', { status: 404 }));
    expect(await fetchRawFile('owner/repo', 'c0ffee1', 'a/SKILL.md', { fetchImpl })).toBeNull();
  });

  it('throws on other failures', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 503 }));
    await expect(
      fetchRawFile('owner/repo', 'c0ffee1', 'a/SKILL.md', { fetchImpl }),
    ).rejects.toThrow('raw owner/repo:a/SKILL.md: HTTP 503');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/raw-file.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'fetchRawFile'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
const RAW = 'https://raw.githubusercontent.com';

/**
 * Content comes from raw.githubusercontent.com: unauthenticated, CORS *, no core-bucket cost.
 * `ref` must be a branch, tag or COMMIT sha — raw.githubusercontent.com does not resolve blob
 * shas, and passing one 404s silently. Callers pin a commit sha (see enumerateSkills).
 */
export async function fetchRawFile(
  repo: string,
  ref: string,
  path: string,
  deps: EnumerateDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetchImpl(`${RAW}/${repo}/${ref}/${encoded}`, {
    headers: { 'user-agent': 'ai-tools-hub-harvest' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`raw ${repo}:${path}: HTTP ${res.status}`);
  return await res.text();
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/raw-file.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/raw-file.test.ts
git commit -m "feat(harvest): unauthenticated commit-pinned raw content fetch"
```

---

### Task A4.18: Dependency-free frontmatter parser

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing beyond the file itself
- Produces: `export interface ParsedFrontmatter { frontmatter: Record<string, unknown>; body: string }`; `export function parseFrontmatter(text: string): ParsedFrontmatter`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/frontmatter.test.ts
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/harvest/enumerate.ts';

describe('parseFrontmatter', () => {
  it('parses the common name/description pair and returns the body', () => {
    const result = parseFrontmatter(
      '---\nname: pdf-processing\ndescription: Extract text from PDF files.\n---\n\n# PDF\n\nUse it.\n',
    );
    expect(result.frontmatter).toEqual({
      name: 'pdf-processing',
      description: 'Extract text from PDF files.',
    });
    expect(result.body).toBe('# PDF\n\nUse it.');
  });

  it('keeps colons inside an unquoted value and strips quotes from a quoted one', () => {
    const result = parseFrontmatter(
      '---\ndescription: Use this: it scans lockfiles\nname: "supply, chain"\n---\nx',
    );
    expect(result.frontmatter.description).toBe('Use this: it scans lockfiles');
    expect(result.frontmatter.name).toBe('supply, chain');
  });

  it('parses inline and block sequences', () => {
    const result = parseFrontmatter(
      '---\nallowed-tools: [Read, Write, Bash]\ncompatibility:\n  - claude-code\n  - openclaw\nempty: []\n---\nbody',
    );
    expect(result.frontmatter['allowed-tools']).toEqual(['Read', 'Write', 'Bash']);
    expect(result.frontmatter.compatibility).toEqual(['claude-code', 'openclaw']);
    expect(result.frontmatter.empty).toEqual([]);
  });

  it('parses a one-level nested map', () => {
    const result = parseFrontmatter(
      '---\nname: x\nmetadata:\n  author: someone\n  version: 2\n  stable: true\n---\nbody',
    );
    expect(result.frontmatter.metadata).toEqual({
      author: 'someone',
      version: 2,
      stable: true,
    });
  });

  it('parses literal and folded block scalars', () => {
    const literal = parseFrontmatter('---\ndescription: |\n  line one\n  line two\n---\nbody');
    expect(literal.frontmatter.description).toBe('line one\nline two');
    const folded = parseFrontmatter('---\ndescription: >-\n  line one\n  line two\n---\nbody');
    expect(folded.frontmatter.description).toBe('line one line two');
  });

  it('ignores comments and blank lines', () => {
    const result = parseFrontmatter('---\n# a comment\n\nname: x\n---\nbody');
    expect(result.frontmatter).toEqual({ name: 'x' });
  });

  it('handles CRLF, a BOM, and an empty frontmatter block', () => {
    const crlf = parseFrontmatter('---\r\nname: x\r\n---\r\nbody\r\n');
    expect(crlf.frontmatter).toEqual({ name: 'x' });
    expect(crlf.body).toBe('body');
    const bom = parseFrontmatter('﻿---\nname: y\n---\nbody');
    expect(bom.frontmatter).toEqual({ name: 'y' });
    const none = parseFrontmatter('---\n---\nbody');
    expect(none.frontmatter).toEqual({});
    expect(none.body).toBe('body');
  });

  it('returns an empty map when there is no frontmatter at all', () => {
    const result = parseFrontmatter('# Just a heading\n\ntext');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('# Just a heading\n\ntext');
    const unterminated = parseFrontmatter('---\nname: x\nstill going');
    expect(unterminated.frontmatter).toEqual({});
  });

  it('coerces booleans, numbers and null', () => {
    const result = parseFrontmatter(
      '---\na: true\nb: false\nc: 42\nd: 1.5\ne: null\nf: 1.2.3\n---\nx',
    );
    expect(result.frontmatter).toEqual({
      a: true,
      b: false,
      c: 42,
      d: 1.5,
      e: null,
      f: '1.2.3',
    });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/frontmatter.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'parseFrontmatter'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
export interface ParsedFrontmatter {
  frontmatter: Record<string, unknown>;
  body: string;
}

const KEY_RE = /^([A-Za-z0-9_.-]+):(.*)$/;
const BLOCK_SCALAR_RE = /^[|>][-+]?$/;

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function unquote(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

function coerce(raw: string): unknown {
  const t = raw.trim();
  if (t === '') return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null' || t === '~') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    return inner === '' ? [] : inner.split(',').map((part) => unquote(part));
  }
  return unquote(t);
}

/** YAML subset covering every field in the reference ALLOWED_FIELDS; no YAML dependency. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!src.startsWith('---\n')) return { frontmatter: {}, body: src.trim() };
  const close = /\n---[ \t]*(\n|$)/.exec(src.slice(3));
  if (close === null) return { frontmatter: {}, body: src.trim() };
  const head = src.slice(4, 3 + close.index);
  const body = src.slice(3 + close.index + close[0].length).trim();
  const lines = head === '' ? [] : head.split('\n');
  const fm: Record<string, unknown> = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '' || line.trimStart().startsWith('#') || indentOf(line) > 0) {
      i += 1;
      continue;
    }
    const key = KEY_RE.exec(line);
    if (key === null) {
      i += 1;
      continue;
    }
    const name = key[1];
    const inline = key[2].trim();

    if (BLOCK_SCALAR_RE.test(inline)) {
      i += 1;
      const block: string[] = [];
      while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
        block.push(lines[i].trim());
        i += 1;
      }
      while (block.length > 0 && block[block.length - 1] === '') block.pop();
      fm[name] = inline.startsWith('|') ? block.join('\n') : block.join(' ').trim();
      continue;
    }

    if (inline !== '') {
      fm[name] = coerce(inline);
      i += 1;
      continue;
    }

    i += 1;
    const child: string[] = [];
    while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > 0)) {
      if (lines[i].trim() !== '') child.push(lines[i].trim());
      i += 1;
    }
    if (child.length === 0) {
      fm[name] = '';
      continue;
    }
    if (child[0].startsWith('- ')) {
      fm[name] = child.filter((c) => c.startsWith('- ')).map((c) => unquote(c.slice(2)));
      continue;
    }
    const map: Record<string, unknown> = {};
    for (const c of child) {
      const entry = KEY_RE.exec(c);
      if (entry !== null) map[entry[1]] = coerce(entry[2]);
    }
    fm[name] = map;
  }

  return { frontmatter: fm, body };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/frontmatter.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/frontmatter.test.ts
git commit -m "feat(harvest): dependency-free SKILL.md frontmatter parser"
```

---

### Task A4.19: Per-path commit sha and age, plus the repo head commit

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (append at end of file)
- Test: `tests/harvest/path-commit.test.ts`

**Interfaces:**
- Consumes: `EnumerateDeps` from `scripts/harvest/enumerate.ts`
- Produces: `export interface PathCommit { sha: string; updatedDays: number }`; `export async function fetchPathCommit(repo: string, path: string, token: string, deps?: EnumerateDeps): Promise<PathCommit | null>`; `export async function fetchHeadCommit(repo: string, token: string, deps?: EnumerateDeps): Promise<string | null>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/path-commit.test.ts
import { describe, expect, it } from 'vitest';
import { fetchHeadCommit, fetchPathCommit } from '../../scripts/harvest/enumerate.ts';

function stubFetch(handler: (url: string) => Response): typeof fetch {
  return (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
}

const NOW = Date.parse('2026-08-29T00:00:00Z');

describe('fetchPathCommit', () => {
  it('asks for the newest commit touching that exact path', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(
        JSON.stringify([{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }]),
        { status: 200 },
      );
    });

    const result = await fetchPathCommit('owner/repo', 'skills/alpha/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });

    expect(urls).toEqual([
      'https://api.github.com/repos/owner/repo/commits?path=skills%2Falpha%2FSKILL.md&per_page=1',
    ]);
    expect(result).toEqual({ sha: 'c0ffee1', updatedDays: 45 });
  });

  it('falls back to the author date when there is no committer date', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify([{ sha: 'abc', commit: { author: { date: '2026-08-28T00:00:00Z' } } }]),
          { status: 200 },
        ),
    );
    const result = await fetchPathCommit('owner/repo', 'a/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });
    expect(result).toEqual({ sha: 'abc', updatedDays: 1 });
  });

  it('never reports a negative age', async () => {
    const fetchImpl = stubFetch(
      () =>
        new Response(
          JSON.stringify([{ sha: 'abc', commit: { committer: { date: '2026-09-30T00:00:00Z' } } }]),
          { status: 200 },
        ),
    );
    const result = await fetchPathCommit('owner/repo', 'a/SKILL.md', 'tok', {
      fetchImpl,
      now: () => NOW,
    });
    expect(result).toEqual({ sha: 'abc', updatedDays: 0 });
  });

  it('returns null when no commit, an empty repo or a missing repo comes back', async () => {
    const none = stubFetch(() => new Response('[]', { status: 200 }));
    const conflict = stubFetch(() => new Response('', { status: 409 }));
    const missing = stubFetch(() => new Response('', { status: 404 }));
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: none, now: () => NOW }),
    ).toBeNull();
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: conflict, now: () => NOW }),
    ).toBeNull();
    expect(
      await fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl: missing, now: () => NOW }),
    ).toBeNull();
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 500 }));
    await expect(
      fetchPathCommit('o/r', 'a/SKILL.md', 't', { fetchImpl, now: () => NOW }),
    ).rejects.toThrow('commits o/r:a/SKILL.md: HTTP 500');
  });
});

describe('fetchHeadCommit', () => {
  it('asks for the newest commit on the default branch, with no path filter', async () => {
    const urls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      urls.push(url);
      return new Response(JSON.stringify([{ sha: 'headc0m' }]), { status: 200 });
    });

    expect(await fetchHeadCommit('owner/repo', 'tok', { fetchImpl })).toBe('headc0m');
    expect(urls).toEqual(['https://api.github.com/repos/owner/repo/commits?per_page=1']);
  });

  it('returns null for an empty, missing or shaless response', async () => {
    const empty = stubFetch(() => new Response('[]', { status: 200 }));
    const conflict = stubFetch(() => new Response('', { status: 409 }));
    const missing = stubFetch(() => new Response('', { status: 404 }));
    const shaless = stubFetch(() => new Response(JSON.stringify([{ commit: {} }]), { status: 200 }));
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: empty })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: conflict })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: missing })).toBeNull();
    expect(await fetchHeadCommit('o/r', 't', { fetchImpl: shaless })).toBeNull();
  });

  it('throws on unexpected statuses', async () => {
    const fetchImpl = stubFetch(() => new Response('', { status: 502 }));
    await expect(fetchHeadCommit('o/r', 't', { fetchImpl })).rejects.toThrow('commits o/r: HTTP 502');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/path-commit.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'fetchHeadCommit'`
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enumerate.ts`:
```ts
export interface PathCommit {
  sha: string;
  updatedDays: number;
}

interface CommitItem {
  sha?: string;
  commit?: { committer?: { date?: string }; author?: { date?: string } };
}

/** Maintenance decays on the PATH's last commit, not the repo's; the sha also pins provenance. */
export async function fetchPathCommit(
  repo: string,
  path: string,
  token: string,
  deps: EnumerateDeps = {},
): Promise<PathCommit | null> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const now = deps.now ?? (() => Date.now());
  const url = `${API}/repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=1`;
  const res = await fetchImpl(url, { headers: ghHeaders(token) });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`commits ${repo}:${path}: HTTP ${res.status}`);
  const body = (await res.json()) as CommitItem[];
  const first = Array.isArray(body) ? body[0] : undefined;
  if (first === undefined || typeof first.sha !== 'string') return null;
  const iso = first.commit?.committer?.date ?? first.commit?.author?.date;
  if (iso === undefined) return null;
  const ms = now() - Date.parse(iso);
  return { sha: first.sha, updatedDays: Math.max(0, Math.floor(ms / 86_400_000)) };
}

/**
 * The repo's default-branch HEAD COMMIT sha. This is the only correct fallback when a path has
 * no commit history: raw.githubusercontent.com resolves commit shas, never blob shas, so
 * falling back to a tree entry's `sha` would 404 every content and safety fetch downstream.
 * Fetched lazily by enumerateSkills — most repos never need it.
 *
 * This is the ONE head-commit fetcher in the codebase. A6's collection LICENSE pass imports it
 * from here (`import { fetchHeadCommit } from './enumerate.ts'`) instead of writing a second
 * implementation, so there is exactly one place where "the repo's current commit" is defined.
 */
export async function fetchHeadCommit(
  repo: string,
  token: string,
  deps: EnumerateDeps = {},
): Promise<string | null> {
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const res = await fetchImpl(`${API}/repos/${repo}/commits?per_page=1`, {
    headers: ghHeaders(token),
  });
  if (res.status === 404 || res.status === 409) return null;
  if (!res.ok) throw new Error(`commits ${repo}: HTTP ${res.status}`);
  const body = (await res.json()) as CommitItem[];
  const first = Array.isArray(body) ? body[0] : undefined;
  return typeof first?.sha === 'string' ? first.sha : null;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/path-commit.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/path-commit.test.ts
git commit -m "feat(harvest): per-path commit sha, age, and repo head commit fallback"
```

---

### Task A4.20: enumerateSkills — the stage-1 entry point

**Files:**
- Modify: `scripts/harvest/enumerate.ts` (replace the three import lines at the top, append the rest at end of file)
- Test: `tests/harvest/enumerate.test.ts`

**Interfaces:**
- Consumes: `RawSkill`, `RepoRef`, `TreeFile` from `src/types.ts`; `capPerPublisherPerConcept`, `hasReadme`, `includeSkill`, `isRepoInternal`, `normalizeConcept`, `publisherOf` from `src/lib/inclusion.ts`; `fetchTree`, `filterSkillFiles`, `fetchRawFile`, `parseFrontmatter`, `fetchPathCommit`, `fetchHeadCommit`, `EnumerateDeps` from `scripts/harvest/enumerate.ts`
- Produces: `export const UNKNOWN_UPDATED_DAYS = 3650`; `export async function enumerateSkills(repo: RepoRef, token: string, deps?: EnumerateDeps): Promise<RawSkill[]>`

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/enumerate.test.ts
import { describe, expect, it } from 'vitest';
import { enumerateSkills, UNKNOWN_UPDATED_DAYS } from '../../scripts/harvest/enumerate.ts';

const NOW = Date.parse('2026-08-29T00:00:00Z');

const TREE = {
  truncated: false,
  tree: [
    { path: 'README.md', mode: '100644', sha: 'blob-readme', type: 'blob' },
    { path: 'skills', mode: '040000', sha: 'tree-1', type: 'tree' },
    { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
    { path: 'skills/beta/SKILL.md', mode: '120000', sha: 'blob-b', type: 'blob' },
    { path: 'mirror/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' },
    { path: '.claude/skills/internal/SKILL.md', mode: '100644', sha: 'blob-c', type: 'blob' },
  ],
};

const SKILL_MD = [
  '---',
  'name: alpha',
  'description: Scans lockfiles for malicious packages.',
  '---',
  '',
  'Run it on every PR.',
  '',
].join('\n');

interface RouteOptions {
  tree?: unknown;
  pathCommits?: unknown;
  headCommits?: unknown;
  raw?: (url: string) => Response;
}

function router(options: RouteOptions = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/git/trees/')) {
      return new Response(JSON.stringify(options.tree ?? TREE), { status: 200 });
    }
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return options.raw?.(url) ?? new Response(SKILL_MD, { status: 200 });
    }
    if (url.includes('/commits?path=')) {
      return new Response(JSON.stringify(options.pathCommits ?? []), { status: 200 });
    }
    if (url.includes('/commits?per_page=')) {
      return new Response(JSON.stringify(options.headCommits ?? []), { status: 200 });
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return { urls, fetchImpl };
}

const BASE = { sleepImpl: async () => {}, now: () => NOW } as const;

describe('enumerateSkills', () => {
  it('returns one RawSkill per real skill, pinned to the per-path commit sha', async () => {
    const { urls, fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills).toEqual([
      {
        repo: 'owner/repo',
        path: 'skills/alpha/SKILL.md',
        sha: 'c0ffee1',
        blobSha: 'blob-a',
        frontmatter: {
          name: 'alpha',
          description: 'Scans lockfiles for malicious packages.',
        },
        body: 'Run it on every PR.',
        updatedDays: 45,
      },
    ]);
    expect(urls).toContain(
      'https://raw.githubusercontent.com/owner/repo/c0ffee1/skills/alpha/SKILL.md',
    );
  });

  it('falls back to the repo HEAD commit sha, never to a blob sha', async () => {
    const { urls, fetchImpl } = router({ headCommits: [{ sha: 'headc0m' }] });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills[0].sha).toBe('headc0m');
    expect(skills[0].blobSha).toBe('blob-a');
    expect(skills[0].updatedDays).toBe(UNKNOWN_UPDATED_DAYS);
    expect(UNKNOWN_UPDATED_DAYS).toBe(3650);
    expect(urls).toContain(
      'https://raw.githubusercontent.com/owner/repo/headc0m/skills/alpha/SKILL.md',
    );
    expect(urls.some((u) => u.includes('/blob-a/'))).toBe(false);
  });

  it('skips a path when neither a path commit nor a head commit exists', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router();

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(urls.some((u) => u.startsWith('https://raw.githubusercontent.com/'))).toBe(false);
    expect(logs.join('\n')).toContain('no commit sha');
  });

  it('skips a path whose content 404s between tree and raw fetch', async () => {
    const { fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: () => new Response('404: Not Found', { status: 404 }),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
  });

  it('returns [] for a repo with no tree at all', async () => {
    const fetchImpl = (async () => new Response('', { status: 409 })) as typeof fetch;
    const skills = await enumerateSkills({ repo: 'owner/empty', stars: 50 }, 'tok', {
      ...BASE,
      fetchImpl,
    });
    expect(skills).toEqual([]);
  });

  it('excludes a repo with no root README after exactly one request', async () => {
    const logs: string[] = [];
    const { urls, fetchImpl } = router({
      tree: {
        truncated: false,
        tree: [{ path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-a', type: 'blob' }],
      },
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(urls).toHaveLength(1);
    expect(logs.join('\n')).toContain('README');
  });

  it('excludes a skill whose description fails the inclusion filter', async () => {
    const logs: string[] = [];
    const { fetchImpl } = router({
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: () => new Response('---\nname: alpha\ndescription: Helper.\n---\nBody.', { status: 200 }),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
      log: (m) => logs.push(m),
    });

    expect(skills).toEqual([]);
    expect(logs.join('\n')).toContain('weak-description');
  });

  it('caps one entry per publisher per concept', async () => {
    const tree = {
      truncated: false,
      tree: [
        { path: 'README.md', mode: '100644', sha: 'blob-readme', type: 'blob' },
        { path: 'packs/alpha/SKILL.md', mode: '100644', sha: 'blob-1', type: 'blob' },
        { path: 'skills/alpha/SKILL.md', mode: '100644', sha: 'blob-2', type: 'blob' },
        { path: 'skills/omega/SKILL.md', mode: '100644', sha: 'blob-3', type: 'blob' },
      ],
    };
    const { fetchImpl } = router({
      tree,
      pathCommits: [{ sha: 'c0ffee1', commit: { committer: { date: '2026-07-15T00:00:00Z' } } }],
      raw: (url) =>
        new Response(
          url.includes('/omega/')
            ? '---\nname: Omega\ndescription: Renders build provenance attestations.\n---\nBody.'
            : '---\nname: Alpha\ndescription: Scans lockfiles for malicious packages.\n---\nBody.',
          { status: 200 },
        ),
    });

    const skills = await enumerateSkills({ repo: 'owner/repo', stars: 120 }, 'tok', {
      ...BASE,
      fetchImpl,
    });

    expect(skills.map((s) => s.path)).toEqual([
      'packs/alpha/SKILL.md',
      'skills/omega/SKILL.md',
    ]);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/enumerate.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/scripts/harvest/enumerate.ts' does not provide an export named 'enumerateSkills'`
- [ ] **Step 3: Write minimal implementation**
Replace the three import lines at the top of `scripts/harvest/enumerate.ts`, which currently read:
```ts
import type { TreeFile } from '../../src/types.ts';
import { isRepoInternal } from '../../src/lib/inclusion.ts';
import type { FetchLike } from './discover.ts';
```
with these lines:
```ts
import type { RawSkill, RepoRef, TreeFile } from '../../src/types.ts';
import {
  capPerPublisherPerConcept,
  hasReadme,
  includeSkill,
  isRepoInternal,
  normalizeConcept,
  publisherOf,
} from '../../src/lib/inclusion.ts';
import type { FetchLike } from './discover.ts';
```
Then append at the end of `scripts/harvest/enumerate.ts`:
```ts
/** No commit history for the path: score it as maximally stale rather than inventing freshness. */
export const UNKNOWN_UPDATED_DAYS = 3650;

const RAW_PAUSE_MS = 50;

/** The concept a skill occupies for the publisher cap: its declared name, else its directory. */
function conceptOf(path: string, frontmatter: Record<string, unknown>): string {
  const declared = frontmatter.name;
  if (typeof declared === 'string' && declared.trim() !== '') return normalizeConcept(declared);
  const segments = path.split('/');
  return normalizeConcept(segments[segments.length - 2] ?? path);
}

/**
 * Stage 1 for one repo. Every `RawSkill.sha` returned here is a COMMIT sha — the per-path commit
 * when one exists, otherwise the repo HEAD commit from `fetchHeadCommit`; a path with neither is
 * skipped outright. A blob sha therefore never reaches `RawSkill.sha`, and downstream stages can
 * pin content, LICENSE and safety fetches to it directly. The tree entry's blob sha travels
 * separately as `blobSha`, for change detection only.
 */
export async function enumerateSkills(
  repo: RepoRef,
  token: string,
  deps: EnumerateDeps = {},
): Promise<RawSkill[]> {
  const log = deps.log ?? (() => {});
  const wait =
    deps.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const tree = await fetchTree(repo.repo, token, deps);
  if (tree.length === 0) return [];

  // Spec 6.4 "has a README" is a repo-level fact — check it once, before spending any requests.
  if (!hasReadme(tree)) {
    log(`${repo.repo}: excluded, no repository README (inclusion filter 6.4)`);
    return [];
  }

  const files: TreeFile[] = filterSkillFiles(tree);
  log(`${repo.repo}: ${files.length} candidate skills from ${tree.length} tree entries`);

  let headSha: string | null | undefined;
  const raws: RawSkill[] = [];

  for (const file of files) {
    const commit = await fetchPathCommit(repo.repo, file.path, token, deps);
    if (commit === null && headSha === undefined) {
      headSha = await fetchHeadCommit(repo.repo, token, deps);
    }
    // raw.githubusercontent.com resolves COMMIT shas only; a blob sha would 404 here and in
    // every downstream safety and license fetch, so a skill with no commit sha is dropped.
    const ref = commit?.sha ?? headSha ?? null;
    if (ref === null) {
      log(`${repo.repo}:${file.path} has no commit sha; skipped rather than pinned to a blob`);
      continue;
    }

    const text = await fetchRawFile(repo.repo, ref, file.path, deps);
    if (text === null) {
      log(`${repo.repo}:${file.path} vanished between tree and raw fetch`);
      continue;
    }

    const parsed = parseFrontmatter(text);
    const verdict = includeSkill({
      repo: repo.repo,
      path: file.path,
      hasReadme: true,
      description: parsed.frontmatter.description,
    });
    if (verdict !== 'included') {
      log(`${repo.repo}:${file.path} excluded: ${verdict}`);
      continue;
    }

    raws.push({
      repo: repo.repo,
      path: file.path,
      sha: ref,
      blobSha: file.sha,
      frontmatter: parsed.frontmatter,
      body: parsed.body,
      updatedDays: commit?.updatedDays ?? UNKNOWN_UPDATED_DAYS,
    });
    await wait(RAW_PAUSE_MS);
  }

  // Spec 6.3 trap 4: one 846-path monorepo must not ship the same concept a dozen times.
  return capPerPublisherPerConcept(raws, (raw) => ({
    publisher: publisherOf(raw.repo),
    concept: conceptOf(raw.path, raw.frontmatter),
  }));
}

// isRepoInternal is re-exported by the inclusion module; referenced here so the import is used
// by filterSkillFiles above and by nothing else.
void isRepoInternal;
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/ tests/lib/inclusion-repo-gate.test.ts tests/lib/inclusion-readme.test.ts tests/lib/inclusion-description.test.ts tests/lib/inclusion-cap.test.ts tests/lib/inclusion-decision.test.ts && npm run typecheck`
Expected: PASS — every harvest and inclusion test file passes and typecheck prints nothing.
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enumerate.ts tests/harvest/enumerate.test.ts
git commit -m "feat(harvest): enumerateSkills with commit-pinned refs and the inclusion filter"
```

---

### Task A5.1: Aliased GraphQL enrichment query builder

**Files:**
- Create: `scripts/harvest/enrich.ts`
- Test: `tests/harvest/enrich-query.test.ts`

**Interfaces:**
- Consumes: `RepoRef { repo: string; stars: number }` from `src/types.ts` (Task A1)
- Produces: `ENRICH_BATCH_SIZE = 50`; `splitRepo(repo: string): { owner: string; name: string }`; `repoAlias(index: number): string`; `buildEnrichQuery(repos: RepoRef[]): string`

Context (spec §6.2): the GraphQL bucket is 5,000 points/hour and one aliased `repository` field costs
1 point per 4 repos, so a 50-alias query costs ~13 points and 1,131 repos cost ~283 points — a single
nightly enrichment pass uses ~6% of the hourly budget.

Ownership note: A5 is the only section that creates `scripts/harvest/enrich.ts`, `src/lib/safety.ts`
and `src/lib/license.ts`. Every relative TypeScript import below carries an explicit `.ts` extension,
matching the repo-wide rule set by `allowImportingTsExtensions` in Task A1.4.

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/enrich-query.test.ts
import { describe, expect, it } from 'vitest';
import {
  ENRICH_BATCH_SIZE,
  buildEnrichQuery,
  repoAlias,
  splitRepo,
} from '../../scripts/harvest/enrich.ts';

describe('buildEnrichQuery', () => {
  it('emits one alias per repo plus every field enrichment needs', () => {
    const query = buildEnrichQuery([
      { repo: 'anthropics/skills', stars: 172473 },
      { repo: 'VoltAgent/awesome-openclaw-skills', stars: 52244 },
    ]);
    expect(query).toContain('r0: repository(owner: "anthropics", name: "skills") { ...repoFields }');
    expect(query).toContain(
      'r1: repository(owner: "VoltAgent", name: "awesome-openclaw-skills") { ...repoFields }',
    );
    expect(query).toContain('  rateLimit { cost remaining }');
    expect(query).toContain('  stargazerCount');
    expect(query).toContain('  forkCount');
    expect(query).toContain('  pushedAt');
    expect(query).toContain('  licenseInfo { spdxId }');
    expect(query).toContain('  repositoryTopics(first: 25) { nodes { topic { name } } }');
    expect(query).toContain('  owner { __typename }');
    expect(query.startsWith('fragment repoFields on Repository {')).toBe(true);
  });

  it('caps a batch at 50 aliases', () => {
    const many = Array.from({ length: ENRICH_BATCH_SIZE + 1 }, (_, i) => ({
      repo: `owner/repo-${i}`,
      stars: 10,
    }));
    expect(() => buildEnrichQuery(many)).toThrow('exceeds ENRICH_BATCH_SIZE 50');
    expect(() => buildEnrichQuery(many.slice(0, ENRICH_BATCH_SIZE))).not.toThrow();
  });

  it('rejects an empty batch and a malformed repo reference', () => {
    expect(() => buildEnrichQuery([])).toThrow('empty batch');
    expect(() => buildEnrichQuery([{ repo: 'not-a-repo', stars: 1 }])).toThrow(
      'invalid repo reference "not-a-repo"',
    );
    expect(() => buildEnrichQuery([{ repo: 'a/b/c', stars: 1 }])).toThrow('invalid repo reference');
  });

  it('exposes deterministic aliases and a repo splitter', () => {
    expect(repoAlias(0)).toBe('r0');
    expect(repoAlias(49)).toBe('r49');
    expect(splitRepo('anthropics/skills')).toEqual({ owner: 'anthropics', name: 'skills' });
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/enrich-query.test.ts`
Expected: FAIL — `scripts/harvest/enrich.ts` does not exist yet, so Vitest cannot resolve the import
and reports `Failed to load url ../../scripts/harvest/enrich.ts`. No test in the file runs.
- [ ] **Step 3: Write minimal implementation**
```ts
// scripts/harvest/enrich.ts
import type { RepoRef } from '../../src/types.ts';

/**
 * GraphQL costs 1 point per 4 aliased repositories against a 5,000 point/hour budget (spec §6.2),
 * so 50 aliases per query is ~13 points per call.
 */
export const ENRICH_BATCH_SIZE = 50;

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function splitRepo(repo: string): { owner: string; name: string } {
  if (!REPO_RE.test(repo)) {
    throw new Error(`enrich: invalid repo reference "${repo}"`);
  }
  const [owner, name] = repo.split('/');
  return { owner, name };
}

/** GraphQL aliases must match /^[_A-Za-z][_0-9A-Za-z]*$/, so index them rather than slugging names. */
export function repoAlias(index: number): string {
  return `r${index}`;
}

export function buildEnrichQuery(repos: RepoRef[]): string {
  if (repos.length === 0) {
    throw new Error('enrich: cannot build a query for an empty batch');
  }
  if (repos.length > ENRICH_BATCH_SIZE) {
    throw new Error(
      `enrich: batch of ${repos.length} exceeds ENRICH_BATCH_SIZE ${ENRICH_BATCH_SIZE}`,
    );
  }
  const aliases = repos.map((ref, index) => {
    const { owner, name } = splitRepo(ref.repo);
    return `  ${repoAlias(index)}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ...repoFields }`;
  });
  return [
    'fragment repoFields on Repository {',
    '  nameWithOwner',
    '  stargazerCount',
    '  forkCount',
    '  pushedAt',
    '  licenseInfo { spdxId }',
    '  repositoryTopics(first: 25) { nodes { topic { name } } }',
    '  owner { __typename }',
    '}',
    '',
    'query EnrichCollections {',
    '  rateLimit { cost remaining }',
    ...aliases,
    '}',
    '',
  ].join('\n');
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/enrich-query.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enrich.ts tests/harvest/enrich-query.test.ts
git commit -m "feat(harvest): build aliased GraphQL enrichment query, 50 repos per call"
```

---

### Task A5.2: Parse the enrichment response into Collection records

**Files:**
- Modify: `scripts/harvest/enrich.ts` (replace the import line, then append after `buildEnrichQuery`)
- Test: `tests/harvest/enrich-parse.test.ts`

**Interfaces:**
- Consumes: `repoAlias(index: number): string` (Task A5.1); `RepoRef`, `Collection` from `src/types.ts`
- Produces: `EnrichRepoNode`; `EnrichPayload`; `EnrichBatchResult { collections: Collection[]; missing: string[]; remaining: number }`; `parseEnrichResponse(payload: EnrichPayload, batch: RepoRef[], curated: ReadonlySet<string>): EnrichBatchResult`

A renamed, deleted or newly-private repo comes back as a `null` node beside a `NOT_FOUND` entry in
`errors[]` while every sibling alias still resolves — that is a `missing` entry, not a failed batch.
Topics are lower-cased here so `detectRuntimes` (Task A5.6) never has to case-fold.

`Collection` is the shape that A6 serialises to `data/collections.json` **as a bare array**
(`Collection[]`, never `{ collections: [...] }`) — this file is where stars and forks live; they are
repo-level facts and never appear on a `Skill`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/enrich-parse.test.ts
import { describe, expect, it } from 'vitest';
import { parseEnrichResponse } from '../../scripts/harvest/enrich.ts';

const CURATED = new Set(['anthropics/skills']);

describe('parseEnrichResponse', () => {
  it('maps each alias back onto its requested repo', () => {
    const result = parseEnrichResponse(
      {
        data: {
          rateLimit: { cost: 13, remaining: 4871 },
          r0: {
            nameWithOwner: 'anthropics/skills',
            stargazerCount: 172473,
            forkCount: 9012,
            pushedAt: '2026-08-27T11:04:00Z',
            licenseInfo: null,
            repositoryTopics: { nodes: [{ topic: { name: 'Claude-Code' } }, { topic: { name: 'agent-skills' } }] },
            owner: { __typename: 'Organization' },
          },
          r1: {
            nameWithOwner: 'someone/personal-skills',
            stargazerCount: 42,
            forkCount: 3,
            pushedAt: '2026-06-01T00:00:00Z',
            licenseInfo: { spdxId: 'MIT' },
            repositoryTopics: { nodes: [] },
            owner: { __typename: 'User' },
          },
        },
      },
      [
        { repo: 'anthropics/skills', stars: 170000 },
        { repo: 'someone/personal-skills', stars: 42 },
      ],
      CURATED,
    );

    expect(result.remaining).toBe(4871);
    expect(result.missing).toEqual([]);
    expect(result.collections).toEqual([
      {
        repo: 'anthropics/skills',
        stars: 172473,
        forks: 9012,
        pushedAt: '2026-08-27T11:04:00Z',
        license: null,
        topics: ['claude-code', 'agent-skills'],
        isOrg: true,
        curated: true,
      },
      {
        repo: 'someone/personal-skills',
        stars: 42,
        forks: 3,
        pushedAt: '2026-06-01T00:00:00Z',
        license: 'MIT',
        topics: [],
        isOrg: false,
        curated: false,
      },
    ]);
  });

  it('reports a null node as missing instead of failing the batch', () => {
    const result = parseEnrichResponse(
      {
        data: {
          rateLimit: { cost: 13, remaining: 4800 },
          r0: null,
          r1: {
            nameWithOwner: 'live/repo',
            stargazerCount: 7,
            forkCount: 0,
            pushedAt: '2026-08-01T00:00:00Z',
            licenseInfo: { spdxId: 'NOASSERTION' },
            repositoryTopics: null,
            owner: { __typename: 'User' },
          },
        },
        errors: [{ message: "Could not resolve to a Repository with the name 'gone/repo'." }],
      },
      [
        { repo: 'gone/repo', stars: 12 },
        { repo: 'live/repo', stars: 7 },
      ],
      CURATED,
    );

    expect(result.missing).toEqual(['gone/repo']);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].repo).toBe('live/repo');
    expect(result.collections[0].license).toBe('NOASSERTION');
    expect(result.collections[0].topics).toEqual([]);
  });

  it('throws loudly when the whole response carries no data', () => {
    expect(() =>
      parseEnrichResponse(
        { data: null, errors: [{ message: 'Bad credentials' }] },
        [{ repo: 'a/b', stars: 1 }],
        CURATED,
      ),
    ).toThrow('enrich: GraphQL response carried no data (Bad credentials)');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/enrich-parse.test.ts`
Expected: FAIL — `enrich.ts` loads but exports no `parseEnrichResponse`, so the ESM import throws a
`SyntaxError` naming that missing export and all three tests error before their bodies run.
- [ ] **Step 3: Write minimal implementation**
First replace this exact line at the top of `scripts/harvest/enrich.ts`:
```ts
import type { RepoRef } from '../../src/types.ts';
```
with:
```ts
import type { Collection, RepoRef } from '../../src/types.ts';
```
Then append to `scripts/harvest/enrich.ts`:
```ts
export interface EnrichRepoNode {
  nameWithOwner: string;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  licenseInfo: { spdxId: string | null } | null;
  repositoryTopics: { nodes: Array<{ topic: { name: string } } | null> } | null;
  owner: { __typename: string } | null;
}

export interface EnrichPayload {
  data?: Record<string, unknown> | null;
  errors?: Array<{ message: string }> | null;
}

export interface EnrichBatchResult {
  collections: Collection[];
  /** Aliases that resolved to null: renamed, deleted or gone private since discovery. */
  missing: string[];
  /** GraphQL points left in the hour, or -1 when the response omitted rateLimit. */
  remaining: number;
}

export function parseEnrichResponse(
  payload: EnrichPayload,
  batch: RepoRef[],
  curated: ReadonlySet<string>,
): EnrichBatchResult {
  const data = payload.data;
  if (!data) {
    const detail = (payload.errors ?? []).map((e) => e.message).join('; ') || 'no data field';
    throw new Error(`enrich: GraphQL response carried no data (${detail})`);
  }
  const rate = data.rateLimit as { cost: number; remaining: number } | null | undefined;
  const collections: Collection[] = [];
  const missing: string[] = [];

  batch.forEach((ref, index) => {
    const node = data[repoAlias(index)] as EnrichRepoNode | null | undefined;
    if (!node) {
      missing.push(ref.repo);
      return;
    }
    const topics = (node.repositoryTopics?.nodes ?? [])
      .filter((n): n is { topic: { name: string } } => Boolean(n && n.topic && n.topic.name))
      .map((n) => n.topic.name.toLowerCase());
    collections.push({
      // Key on the requested name, not nameWithOwner: skill ids were minted with it upstream.
      repo: ref.repo,
      stars: node.stargazerCount ?? 0,
      forks: node.forkCount ?? 0,
      pushedAt: node.pushedAt ?? '',
      license: node.licenseInfo?.spdxId ?? null,
      topics,
      isOrg: node.owner?.__typename === 'Organization',
      curated: curated.has(ref.repo.toLowerCase()),
    });
  });

  return { collections, missing, remaining: rate?.remaining ?? -1 };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/enrich-parse.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enrich.ts tests/harvest/enrich-parse.test.ts
git commit -m "feat(harvest): parse aliased GraphQL response into Collection records"
```

---

### Task A5.3: enrichCollections — batching, budget guard, loud failure

**Files:**
- Modify: `scripts/harvest/enrich.ts` (append after `parseEnrichResponse`)
- Test: `tests/harvest/enrich-collections.test.ts`

**Interfaces:**
- Consumes: `buildEnrichQuery`, `ENRICH_BATCH_SIZE` (Task A5.1); `parseEnrichResponse`, `EnrichPayload` (Task A5.2)
- Produces: `GITHUB_GRAPHQL_URL`; `ENRICH_MIN_BUDGET = 100`; `CURATED_REPOS: readonly string[]`; `curatedSet(extra?: readonly string[]): Set<string>`; `dedupeRepos(repos: RepoRef[]): RepoRef[]`; `enrichCollections(repos: RepoRef[], token: string): Promise<Collection[]>` — the shared-contract entrypoint, and the exact array A6 writes to `data/collections.json`

Per spec §13 a silent crawler is a P1 bug, so a drained GraphQL budget throws rather than returning a
short list that would be committed as if it were the whole corpus.

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/enrich-collections.test.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CURATED_REPOS,
  ENRICH_BATCH_SIZE,
  curatedSet,
  dedupeRepos,
  enrichCollections,
} from '../../scripts/harvest/enrich.ts';

const ALIAS_RE = /^ {2}(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/gm;

interface FetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Pull the GraphQL query text back out of one recorded fetch call. */
function queryOf(call: unknown[]): string {
  const init = call[1] as FetchInit;
  return (JSON.parse(init.body) as { query: string }).query;
}

function node(nameWithOwner: string) {
  return {
    nameWithOwner,
    stargazerCount: 100,
    forkCount: 10,
    pushedAt: '2026-08-20T00:00:00Z',
    licenseInfo: { spdxId: 'MIT' },
    repositoryTopics: { nodes: [{ topic: { name: 'agent-skills' } }] },
    owner: { __typename: 'User' },
  };
}

function stubFetch(remaining: number) {
  const mock = vi.fn(async (_url: unknown, init: unknown) => {
    const query = (JSON.parse((init as FetchInit).body) as { query: string }).query;
    const data: Record<string, unknown> = { rateLimit: { cost: 13, remaining } };
    for (const [, alias, owner, name] of query.matchAll(ALIAS_RE)) {
      data[alias] = node(`${owner}/${name}`);
    }
    return { ok: true, status: 200, json: async () => ({ data }), text: async () => '' };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('enrichCollections', () => {
  it('splits 51 repos into two queries and returns one Collection each', async () => {
    const repos = Array.from({ length: 51 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    const mock = stubFetch(4900);

    const collections = await enrichCollections(repos, 'ghp_test');

    expect(mock).toHaveBeenCalledTimes(2);
    expect([...queryOf(mock.mock.calls[0]).matchAll(ALIAS_RE)]).toHaveLength(ENRICH_BATCH_SIZE);
    expect([...queryOf(mock.mock.calls[1]).matchAll(ALIAS_RE)]).toHaveLength(1);
    expect(collections).toHaveLength(51);
    expect(collections[0].repo).toBe('owner/repo-0');
    expect(collections[50].repo).toBe('owner/repo-50');
    expect(collections[0].stars).toBe(100);
  });

  it('sends the token as a bearer credential to the GraphQL endpoint', async () => {
    const mock = stubFetch(4900);
    await enrichCollections([{ repo: 'anthropics/skills', stars: 1 }], 'ghp_secret');
    expect(mock.mock.calls[0][0]).toBe('https://api.github.com/graphql');
    const init = mock.mock.calls[0][1] as FetchInit;
    expect(init.method).toBe('POST');
    expect(init.headers.authorization).toBe('bearer ghp_secret');
  });

  it('throws instead of returning a partial corpus when the budget drains', async () => {
    stubFetch(50);
    const repos = Array.from({ length: 51 }, (_, i) => ({ repo: `owner/repo-${i}`, stars: i }));
    await expect(enrichCollections(repos, 'ghp_test')).rejects.toThrow(
      'enrich: GraphQL budget down to 50 points',
    );
  });

  it('throws on a non-OK HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'Bad credentials' })),
    );
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], 'bad')).rejects.toThrow(
      'enrich: GraphQL HTTP 401 — Bad credentials',
    );
  });

  it('requires a token', async () => {
    await expect(enrichCollections([{ repo: 'a/b', stars: 1 }], '')).rejects.toThrow(
      'a CATALOG_PAT token is required',
    );
  });

  it('dedupes case-insensitively and marks curated marketplaces', () => {
    expect(
      dedupeRepos([
        { repo: 'anthropics/skills', stars: 5 },
        { repo: 'Anthropics/Skills', stars: 5 },
        { repo: 'other/repo', stars: 1 },
      ]),
    ).toEqual([
      { repo: 'anthropics/skills', stars: 5 },
      { repo: 'other/repo', stars: 1 },
    ]);
    expect(CURATED_REPOS).toContain('anthropics/skills');
    expect(curatedSet().has('anthropics/skills')).toBe(true);
    expect(curatedSet(['My/Marketplace']).has('my/marketplace')).toBe(true);
    expect(curatedSet().has('random/repo')).toBe(false);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/enrich-collections.test.ts`
Expected: FAIL — `enrich.ts` exports no `enrichCollections` (nor `dedupeRepos`, `curatedSet`,
`CURATED_REPOS`), so the ESM import throws a `SyntaxError` naming the first missing export and every
test in the file errors before running.
- [ ] **Step 3: Write minimal implementation**
Append to `scripts/harvest/enrich.ts`:
```ts
export const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql';

/** Stop the pass while this many GraphQL points remain, rather than emit a truncated corpus. */
export const ENRICH_MIN_BUDGET = 100;

/** Curated marketplaces — worth +12 provenance in the score model (spec §5). */
export const CURATED_REPOS: readonly string[] = [
  'anthropics/skills',
  'openclaw/clawhub',
  'VoltAgent/awesome-openclaw-skills',
  'VoltAgent/awesome-agent-skills',
  'trailofbits/skills',
];

export function curatedSet(extra: readonly string[] = []): Set<string> {
  return new Set([...CURATED_REPOS, ...extra].map((repo) => repo.toLowerCase()));
}

export function dedupeRepos(repos: RepoRef[]): RepoRef[] {
  const seen = new Set<string>();
  const out: RepoRef[] = [];
  for (const ref of repos) {
    const key = ref.repo.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

async function postEnrichQuery(query: string, token: string): Promise<EnrichPayload> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      authorization: `bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': 'ai-tools-hub-harvest',
    },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`enrich: GraphQL HTTP ${res.status} — ${body.slice(0, 200)}`);
  }
  return (await res.json()) as EnrichPayload;
}

export async function enrichCollections(repos: RepoRef[], token: string): Promise<Collection[]> {
  if (!token) {
    throw new Error('enrich: a CATALOG_PAT token is required');
  }
  const unique = dedupeRepos(repos);
  const curated = curatedSet();
  const out: Collection[] = [];

  for (let i = 0; i < unique.length; i += ENRICH_BATCH_SIZE) {
    const batch = unique.slice(i, i + ENRICH_BATCH_SIZE);
    const payload = await postEnrichQuery(buildEnrichQuery(batch), token);
    const result = parseEnrichResponse(payload, batch, curated);
    out.push(...result.collections);
    for (const repo of result.missing) {
      console.warn(`enrich: no repository node for ${repo} (renamed, deleted or now private)`);
    }
    if (result.remaining >= 0 && result.remaining < ENRICH_MIN_BUDGET) {
      throw new Error(
        `enrich: GraphQL budget down to ${result.remaining} points after ${out.length} repos — failing loudly instead of committing a partial index`,
      );
    }
  }
  return out;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/enrich-collections.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enrich.ts tests/harvest/enrich-collections.test.ts
git commit -m "feat(harvest): enrichCollections with 50-repo batches and a budget guard"
```

---

### Task A5.4: Three-tier license resolution with a recorded source

**Files:**
- Create: `src/lib/license.ts`
- Test: `tests/lib/license.test.ts`

**Interfaces:**
- Consumes: `Skill` from `src/types.ts` (for the `licenseSource` union only)
- Produces: `LicenseSource = Skill['licenseSource']`; `LicenseInput { frontmatter: Record<string, unknown>; skillPath: string; treePaths: string[]; repoLicense: string | null; siblingLicenseText?: string | null }`; `LicenseResolution { license: string | null; licenseSource: LicenseSource }`; `SPDX_SIGNATURES`; `sniffSpdx(text: string): string | null`; `resolveLicense(input: LicenseInput): LicenseResolution`

**This is the one and only `resolveLicense` in the repo**, and it takes exactly one argument — a
`LicenseInput` object. No section defines a positional
`resolveLicense(frontmatter, siblingText, repoLicense)`; A6 imports this one from
`src/lib/license.ts` and builds the input object at the call site.

Spec §4.3: `anthropics/skills` has 172,473 stars and repo `license: null` while shipping per-skill
Apache-2.0 files. Repo SPDX alone throws that away, so the order is frontmatter → sibling `LICENSE*`
in the skill's own directory → repo SPDX → `null`, and the winning tier is recorded in
`licenseSource` so the UI can say where the answer came from. A `null` license is the
*undeclared-license* value the card renders in `--color-hazard`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/license.test.ts
import { describe, expect, it } from 'vitest';
import { resolveLicense, sniffSpdx } from '../../src/lib/license.ts';

const APACHE = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/`;

describe('resolveLicense', () => {
  it('takes a single LicenseInput object, not positional arguments', () => {
    expect(resolveLicense.length).toBe(1);
  });

  it('tier 1: frontmatter license wins over everything', () => {
    expect(
      resolveLicense({
        frontmatter: { name: 'pdf', license: ' MIT ' },
        skillPath: 'skills/pdf/SKILL.md',
        treePaths: ['skills/pdf/SKILL.md', 'skills/pdf/LICENSE.txt'],
        repoLicense: 'Apache-2.0',
        siblingLicenseText: APACHE,
      }),
    ).toEqual({ license: 'MIT', licenseSource: 'frontmatter' });
  });

  it('tier 2: a sibling LICENSE file in the skill directory, sniffed to an SPDX id', () => {
    // anthropics/skills: repo license is null, per-skill LICENSE.txt is Apache-2.0.
    expect(
      resolveLicense({
        frontmatter: { name: 'pdf', description: 'Fill PDF forms' },
        skillPath: 'document-skills/pdf/SKILL.md',
        treePaths: [
          'document-skills/pdf/SKILL.md',
          'document-skills/pdf/LICENSE.txt',
          'document-skills/docx/SKILL.md',
        ],
        repoLicense: null,
        siblingLicenseText: APACHE,
      }),
    ).toEqual({ license: 'Apache-2.0', licenseSource: 'sibling' });
  });

  it('tier 2 ignores a LICENSE that belongs to a different skill directory', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'document-skills/docx/SKILL.md',
        treePaths: ['document-skills/docx/SKILL.md', 'document-skills/pdf/LICENSE.txt'],
        repoLicense: null,
      }),
    ).toEqual({ license: null, licenseSource: null });
  });

  it('tier 2 records an unreadable sibling as a custom license reference', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md', 'skills/x/LICENCE'],
        repoLicense: null,
        siblingLicenseText: 'Copyright 2026. All rights reserved to nobody in particular.',
      }),
    ).toEqual({ license: 'LicenseRef-Custom', licenseSource: 'sibling' });
  });

  it('tier 3: repo SPDX, with NOASSERTION recorded as a custom reference', () => {
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md'],
        repoLicense: 'MIT',
      }),
    ).toEqual({ license: 'MIT', licenseSource: 'repo' });
    expect(
      resolveLicense({
        frontmatter: {},
        skillPath: 'skills/x/SKILL.md',
        treePaths: ['skills/x/SKILL.md'],
        repoLicense: 'NOASSERTION',
      }),
    ).toEqual({ license: 'LicenseRef-Custom', licenseSource: 'repo' });
  });

  it('tier 4: nothing declared anywhere', () => {
    expect(
      resolveLicense({
        frontmatter: { license: '   ' },
        skillPath: 'SKILL.md',
        treePaths: ['SKILL.md'],
        repoLicense: '',
      }),
    ).toEqual({ license: null, licenseSource: null });
  });

  it('sniffs the common SPDX ids out of license text', () => {
    expect(sniffSpdx(APACHE)).toBe('Apache-2.0');
    expect(sniffSpdx('MIT License\n\nPermission is hereby granted, free of charge')).toBe('MIT');
    expect(sniffSpdx('GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007')).toBe('GPL-3.0');
    expect(sniffSpdx('This is free and unencumbered software released into the public domain.')).toBe(
      'Unlicense',
    );
    expect(sniffSpdx('some prose')).toBeNull();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/license.test.ts`
Expected: FAIL — `src/lib/license.ts` does not exist yet, so Vitest cannot resolve the import and
reports `Failed to load url ../../src/lib/license.ts`. No test in the file runs.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/license.ts
import type { Skill } from '../types.ts';

/** Kept in lockstep with Skill.licenseSource so the two can never drift apart. */
export type LicenseSource = Skill['licenseSource'];

export interface LicenseInput {
  /** Parsed SKILL.md frontmatter. */
  frontmatter: Record<string, unknown>;
  /** Repo-relative path of the SKILL.md, e.g. "document-skills/pdf/SKILL.md". */
  skillPath: string;
  /** Every blob path in the repo tree. */
  treePaths: string[];
  /** Collection.license — GitHub's repo-level SPDX id, often null. */
  repoLicense: string | null;
  /** Text of the sibling LICENSE file when it was fetched; omit to skip sniffing. */
  siblingLicenseText?: string | null;
}

export interface LicenseResolution {
  license: string | null;
  licenseSource: LicenseSource;
}

export const SPDX_SIGNATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/apache license[\s\S]{0,40}version 2\.0/i, 'Apache-2.0'],
  [/mit license|permission is hereby granted, free of charge/i, 'MIT'],
  [/gnu affero general public license/i, 'AGPL-3.0'],
  [/gnu general public license[\s\S]{0,40}version 3/i, 'GPL-3.0'],
  [/gnu general public license[\s\S]{0,40}version 2/i, 'GPL-2.0'],
  [/gnu lesser general public license/i, 'LGPL-3.0'],
  [/mozilla public license[\s\S]{0,40}2\.0/i, 'MPL-2.0'],
  [/redistribution and use[\s\S]{0,400}neither the name/i, 'BSD-3-Clause'],
  [/redistribution and use/i, 'BSD-2-Clause'],
  [/creative commons legal code[\s\S]{0,80}cc0/i, 'CC0-1.0'],
  [/this is free and unencumbered software released into the public domain/i, 'Unlicense'],
  [/isc license/i, 'ISC'],
];

export function sniffSpdx(text: string): string | null {
  for (const [pattern, id] of SPDX_SIGNATURES) {
    if (pattern.test(text)) return id;
  }
  return null;
}

function parentDir(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

function baseName(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? path : path.slice(cut + 1);
}

/** The repo's only license resolver. One argument, four tiers, the winning tier recorded. */
export function resolveLicense(input: LicenseInput): LicenseResolution {
  // Tier 1 — the skill declares it itself.
  const declared = input.frontmatter.license;
  if (typeof declared === 'string' && declared.trim() !== '') {
    return { license: declared.trim(), licenseSource: 'frontmatter' };
  }

  // Tier 2 — a LICENSE* file sitting next to this SKILL.md. anthropics/skills needs this.
  const dir = parentDir(input.skillPath);
  const sibling = input.treePaths.find(
    (path) => parentDir(path) === dir && /^licen[cs]e/i.test(baseName(path)),
  );
  if (sibling) {
    const text = input.siblingLicenseText;
    const sniffed = typeof text === 'string' ? sniffSpdx(text) : null;
    return { license: sniffed ?? 'LicenseRef-Custom', licenseSource: 'sibling' };
  }

  // Tier 3 — the repo's own SPDX id. GitHub reports "NOASSERTION" for an unrecognised license file.
  const repo = (input.repoLicense ?? '').trim();
  if (repo !== '') {
    return {
      license: repo === 'NOASSERTION' ? 'LicenseRef-Custom' : repo,
      licenseSource: 'repo',
    };
  }

  return { license: null, licenseSource: null };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/license.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/license.ts tests/lib/license.test.ts
git commit -m "feat(license): sole three-tier resolver recording the winning tier"
```

---

### Task A5.5: Canonical runtime order, script-file selection and language mapping

**Files:**
- Create: `src/lib/safety.ts`
- Test: `tests/lib/safety-scripts.test.ts`

**Interfaces:**
- Consumes: `TreeFile { path: string; mode: string; sha: string; type: string }`, `Runtime = 'claude' | 'openclaw' | 'codex' | 'cursor' | 'generic'` from `src/types.ts`
- Produces: `RUNTIME_ORDER: readonly Runtime[]`; `SYMLINK_MODE = '120000'`; `EXECUTABLE_MODE = '100755'`; `SCRIPT_LANGUAGES: Record<string, string>`; `extensionOf(path: string): string`; `languageOf(path: string): string | null`; `skillDirOf(skillPath: string): string`; `isScriptEntry(file: TreeFile): boolean`; `scriptFilesFor(tree: TreeFile[], skillPath: string): TreeFile[]`

**`RUNTIME_ORDER` is declared here and nowhere else.** It is `claude, openclaw, codex, cursor,
generic` — the only ordering of runtimes anywhere in the repo, never alphabetical. It lives in
`src/lib/safety.ts` rather than in `scripts/harvest/enrich.ts` so UI code can import the order
without pulling GraphQL fetch code into the site build; A1.6's `src/types.ts` comment already points
here. `scripts/harvest/enrich.ts` imports it in Task A5.6, and it is not re-exported from there.

**`scriptFilesFor(tree, skillPath)` — tree first, path second — is the repo's only definition.** No
harvest script redefines it with the arguments reversed; A6 imports it from `src/lib/safety.ts`.

Spec §4.3 row 1: "count + languages of files under `scripts/` in the git tree", 100% coverage.
Spec §6.3 trap 1: 458 of 846 `SKILL.md` paths in one sampled repo are mode-`120000` symlinks — skip
them here too or a skill's script count double-counts its own symlinked twins.

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/safety-scripts.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import {
  EXECUTABLE_MODE,
  RUNTIME_ORDER,
  SYMLINK_MODE,
  extensionOf,
  isScriptEntry,
  languageOf,
  scriptFilesFor,
  skillDirOf,
} from '../../src/lib/safety.ts';

function file(path: string, mode = '100644', type = 'blob'): TreeFile {
  return { path, mode, sha: 'deadbeef', type };
}

const TREE: TreeFile[] = [
  file('skills/pdf/SKILL.md'),
  file('skills/pdf/README.md'),
  file('skills/pdf/scripts/fill_form.py'),
  file('skills/pdf/scripts/helpers/split.sh', EXECUTABLE_MODE),
  file('skills/pdf/scripts/notes.md'),
  file('skills/pdf/scripts/run', EXECUTABLE_MODE),
  file('skills/pdf/scripts/linked.py', SYMLINK_MODE),
  file('skills/pdf/scripts/vendor', '040000', 'tree'),
  file('skills/docx/scripts/convert.py'),
  file('scripts/build.py'),
];

describe('scriptFilesFor', () => {
  it('takes the tree first and the skill path second', () => {
    expect(scriptFilesFor.length).toBe(2);
  });

  it('selects only executable files under this skill’s scripts directory', () => {
    const paths = scriptFilesFor(TREE, 'skills/pdf/SKILL.md').map((f) => f.path);
    expect(paths).toEqual([
      'skills/pdf/scripts/fill_form.py',
      'skills/pdf/scripts/helpers/split.sh',
      'skills/pdf/scripts/run',
    ]);
  });

  it('excludes symlinks, trees, docs and other skills', () => {
    const paths = scriptFilesFor(TREE, 'skills/pdf/SKILL.md').map((f) => f.path);
    expect(paths).not.toContain('skills/pdf/scripts/linked.py');
    expect(paths).not.toContain('skills/pdf/scripts/notes.md');
    expect(paths).not.toContain('skills/pdf/scripts/vendor');
    expect(paths).not.toContain('skills/docx/scripts/convert.py');
    expect(paths).not.toContain('scripts/build.py');
  });

  it('handles a SKILL.md at the repo root', () => {
    expect(skillDirOf('SKILL.md')).toBe('');
    expect(skillDirOf('skills/pdf/SKILL.md')).toBe('skills/pdf');
    expect(scriptFilesFor(TREE, 'SKILL.md').map((f) => f.path)).toEqual(['scripts/build.py']);
  });

  it('returns an empty list for a skill with no scripts directory', () => {
    expect(scriptFilesFor([file('a/SKILL.md'), file('a/reference.md')], 'a/SKILL.md')).toEqual([]);
  });
});

describe('languageOf', () => {
  it('maps known script extensions', () => {
    expect(languageOf('a/scripts/x.py')).toBe('python');
    expect(languageOf('a/scripts/x.sh')).toBe('shell');
    expect(languageOf('a/scripts/x.bash')).toBe('shell');
    expect(languageOf('a/scripts/x.mjs')).toBe('javascript');
    expect(languageOf('a/scripts/x.ts')).toBe('typescript');
    expect(languageOf('a/scripts/x.PY')).toBe('python');
  });

  it('returns null for a file with no recognised language', () => {
    expect(languageOf('a/scripts/run')).toBeNull();
    expect(languageOf('a/scripts/notes.md')).toBeNull();
  });

  it('extracts extensions', () => {
    expect(extensionOf('a/b/c.tar.gz')).toBe('.gz');
    expect(extensionOf('a/b/run')).toBe('');
    expect(extensionOf('.gitignore')).toBe('');
  });
});

describe('isScriptEntry', () => {
  it('accepts a script blob under any scripts/ segment', () => {
    expect(isScriptEntry(file('skills/pdf/scripts/x.py'))).toBe(true);
    expect(isScriptEntry(file('scripts/x.py'))).toBe(true);
  });

  it('rejects symlinks, non-blobs and files outside scripts/', () => {
    expect(isScriptEntry(file('skills/pdf/scripts/x.py', SYMLINK_MODE))).toBe(false);
    expect(isScriptEntry(file('skills/pdf/scripts/x.py', '040000', 'tree'))).toBe(false);
    expect(isScriptEntry(file('skills/pdf/x.py'))).toBe(false);
  });
});

describe('RUNTIME_ORDER', () => {
  it('is the single canonical ordering, declared in the UI-safe module', () => {
    expect(RUNTIME_ORDER).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });

  it('is not alphabetical', () => {
    expect([...RUNTIME_ORDER].sort()).not.toEqual(RUNTIME_ORDER);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/safety-scripts.test.ts`
Expected: FAIL — `src/lib/safety.ts` does not exist yet, so Vitest cannot resolve the import and
reports `Failed to load url ../../src/lib/safety.ts`. No test in the file runs.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/safety.ts
import type { Runtime, TreeFile } from '../types.ts';

/**
 * The single runtime ordering used everywhere. Never sort runtimes alphabetically.
 * Declared here, in the UI-safe module, so a page can import the order without dragging
 * `scripts/harvest/enrich.ts` (and its GraphQL fetch code) into the site build.
 */
export const RUNTIME_ORDER: readonly Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

/** Git mode for a symlink. 458 of 846 SKILL.md paths in one sampled repo are these (spec §6.3). */
export const SYMLINK_MODE = '120000';
/** Git mode for an executable blob. */
export const EXECUTABLE_MODE = '100755';

export const SCRIPT_LANGUAGES: Record<string, string> = {
  '.py': 'python',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.ts': 'typescript',
  '.rb': 'ruby',
  '.go': 'go',
  '.pl': 'perl',
  '.ps1': 'powershell',
  '.rs': 'rust',
  '.php': 'php',
  '.lua': 'lua',
};

export function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot).toLowerCase();
}

export function languageOf(path: string): string | null {
  return SCRIPT_LANGUAGES[extensionOf(path)] ?? null;
}

/** "skills/pdf/SKILL.md" -> "skills/pdf"; "SKILL.md" -> "". */
export function skillDirOf(skillPath: string): string {
  const cut = skillPath.lastIndexOf('/');
  return cut === -1 ? '' : skillPath.slice(0, cut);
}

/** A real, executable blob living under some `scripts/` segment. */
export function isScriptEntry(file: TreeFile): boolean {
  if (file.type !== 'blob') return false;
  if (file.mode === SYMLINK_MODE) return false;
  if (!file.path.startsWith('scripts/') && !file.path.includes('/scripts/')) return false;
  return languageOf(file.path) !== null || file.mode === EXECUTABLE_MODE;
}

/**
 * Script files belonging to exactly this skill: `<skill dir>/scripts/**`.
 * Argument order is (tree, skillPath) and is fixed — this is the repo's only definition.
 */
export function scriptFilesFor(tree: TreeFile[], skillPath: string): TreeFile[] {
  const dir = skillDirOf(skillPath);
  const prefix = dir === '' ? 'scripts/' : `${dir}/scripts/`;
  return tree.filter((file) => file.path.startsWith(prefix) && isScriptEntry(file));
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/safety-scripts.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/safety.ts tests/lib/safety-scripts.test.ts
git commit -m "feat(safety): canonical RUNTIME_ORDER and script-file selection from the git tree"
```

---

### Task A5.6: Runtime detection from repo topics only

**Files:**
- Modify: `scripts/harvest/enrich.ts` (replace the import line, then append after `enrichCollections`)
- Test: `tests/harvest/runtimes.test.ts`

**Interfaces:**
- Consumes: `Runtime = 'claude' | 'openclaw' | 'codex' | 'cursor' | 'generic'` from `src/types.ts`; `RUNTIME_ORDER` from `src/lib/safety.ts` (Task A5.5)
- Produces: `TOPIC_RUNTIMES: Record<string, Runtime>`; `detectRuntimes(topics: string[]): Runtime[]`

`RUNTIME_ORDER` is **not** declared here: Task A5.5 declares it once, in `src/lib/safety.ts`, and this
module imports it — so a page can import the ordering without dragging GraphQL fetch code into the
site build. `enrich.ts` does not re-export it either; anything that needs the order imports
`src/lib/safety.ts` directly. `detectRuntimes` is the sole producer of `Skill.runtimes`; A6 imports it
from `scripts/harvest/enrich.ts` rather than defining a second derivation, so the order the harvest
writes is the order the UI renders.

Spec §3.4: topics are accurate for **runtime** and useless for **content** — only 8 of 300
`topic:agent-skills` repos carry a security topic. So runtime comes from topics and never from
scanning `SKILL.md` text; a repo with no runtime topic is `generic`, not "unknown".

- [ ] **Step 1: Write the failing test**
```ts
// tests/harvest/runtimes.test.ts
import { describe, expect, it } from 'vitest';
import { RUNTIME_ORDER } from '../../src/lib/safety.ts';
import { TOPIC_RUNTIMES, detectRuntimes } from '../../scripts/harvest/enrich.ts';

describe('detectRuntimes', () => {
  it('maps runtime topics and ignores content topics', () => {
    expect(detectRuntimes(['claude-code', 'security', 'sast'])).toEqual(['claude']);
    expect(detectRuntimes(['openclaw', 'clawhub'])).toEqual(['openclaw']);
    expect(detectRuntimes(['codex-cli'])).toEqual(['codex']);
    expect(detectRuntimes(['cursor-rules'])).toEqual(['cursor']);
  });

  it('returns multiple runtimes in RUNTIME_ORDER, never alphabetically', () => {
    expect(detectRuntimes(['cursor', 'openclaw', 'claude-skills'])).toEqual([
      'claude',
      'openclaw',
      'cursor',
    ]);
    expect(detectRuntimes(['claude-skills', 'openclaw', 'cursor'])).toEqual([
      'claude',
      'openclaw',
      'cursor',
    ]);
    // Alphabetical would be claude, cursor, openclaw — that ordering is a bug, not a variant.
    expect(detectRuntimes(['cursor', 'openclaw'])).toEqual(['openclaw', 'cursor']);
  });

  it('normalises case and whitespace', () => {
    expect(detectRuntimes([' Claude-Code ', 'OPENCLAW'])).toEqual(['claude', 'openclaw']);
  });

  it('falls back to generic rather than inventing a runtime from content words', () => {
    expect(detectRuntimes([])).toEqual(['generic']);
    expect(detectRuntimes(['bash', 'python', 'kubernetes'])).toEqual(['generic']);
  });

  it('publishes its vocabulary and orders by the shared RUNTIME_ORDER', () => {
    expect(detectRuntimes(['cursor', 'codex-cli', 'openclaw', 'claude-code'])).toEqual(
      RUNTIME_ORDER.filter((runtime) => runtime !== 'generic'),
    );
    expect(TOPIC_RUNTIMES['claude-code']).toBe('claude');
    expect(TOPIC_RUNTIMES.openclaw).toBe('openclaw');
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/harvest/runtimes.test.ts`
Expected: FAIL — `src/lib/safety.ts` resolves and supplies `RUNTIME_ORDER`, but `enrich.ts` exports no
`TOPIC_RUNTIMES` and no `detectRuntimes`, so that second ESM import throws a `SyntaxError` naming the
first missing export and all five tests error.
- [ ] **Step 3: Write minimal implementation**
First replace this exact line at the top of `scripts/harvest/enrich.ts`:
```ts
import type { Collection, RepoRef } from '../../src/types.ts';
```
with these two lines:
```ts
import { RUNTIME_ORDER } from '../../src/lib/safety.ts';
import type { Collection, RepoRef, Runtime } from '../../src/types.ts';
```
Then append to `scripts/harvest/enrich.ts`:
```ts
/**
 * Repo topics only (spec §3.4). Topics are accurate for runtime and useless for content —
 * of 300 `topic:agent-skills` repos only 8 carry a security topic. Never derive runtime from
 * SKILL.md text.
 */
export const TOPIC_RUNTIMES: Record<string, Runtime> = {
  'claude': 'claude',
  'claude-ai': 'claude',
  'claude-code': 'claude',
  'claude-skills': 'claude',
  'anthropic': 'claude',
  'openclaw': 'openclaw',
  'openclaw-skills': 'openclaw',
  'clawhub': 'openclaw',
  'codex': 'codex',
  'codex-cli': 'codex',
  'openai-codex': 'codex',
  'cursor': 'cursor',
  'cursor-ai': 'cursor',
  'cursor-rules': 'cursor',
};

export function detectRuntimes(topics: string[]): Runtime[] {
  const found = new Set<Runtime>();
  for (const raw of topics) {
    const runtime = TOPIC_RUNTIMES[raw.trim().toLowerCase()];
    if (runtime) found.add(runtime);
  }
  if (found.size === 0) return ['generic'];
  return RUNTIME_ORDER.filter((runtime) => found.has(runtime));
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/harvest/runtimes.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add scripts/harvest/enrich.ts tests/harvest/runtimes.test.ts
git commit -m "feat(harvest): derive runtime compatibility from repo topics in RUNTIME_ORDER"
```

---

### Task A5.7: Static scanners for network reach and environment reads

**Files:**
- Modify: `src/lib/safety.ts` (append after `scriptFilesFor`)
- Test: `tests/lib/safety-scan.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `NETWORK_PATTERNS: readonly RegExp[]`; `ENV_PATTERNS: readonly RegExp[]`; `scansNetwork(source: string): boolean`; `readsEnvironment(source: string): boolean`

Spec §4.3 row 2, and §1.1: descriptive rows only, ruleset published — these two exported pattern
arrays *are* the published ruleset that `/methodology` (B5) describes in prose. None of the patterns
carries the `g` flag: a global regex keeps `lastIndex` between `.test()` calls and would return
alternating false negatives.

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/safety-scan.test.ts
import { describe, expect, it } from 'vitest';
import {
  ENV_PATTERNS,
  NETWORK_PATTERNS,
  readsEnvironment,
  scansNetwork,
} from '../../src/lib/safety.ts';

describe('scansNetwork', () => {
  it('detects HTTP reach across languages', () => {
    expect(scansNetwork('import requests\nrequests.get("https://example.com")')).toBe(true);
    expect(scansNetwork('const res = await fetch(url)')).toBe(true);
    expect(scansNetwork('curl -sSL "$URL" | sh')).toBe(true);
    expect(scansNetwork('wget -q http://host/file')).toBe(true);
    expect(scansNetwork('import urllib.request')).toBe(true);
    expect(scansNetwork('import axios from "axios"')).toBe(true);
    expect(scansNetwork('require "net/http"')).toBe(true);
    expect(scansNetwork('sock.connect((host, 443))')).toBe(false);
    expect(scansNetwork('import socket\nsocket.create_connection((h, p))')).toBe(true);
  });

  it('does not fire on local-only code', () => {
    expect(scansNetwork('import json\nprint(json.dumps({"a": 1}))')).toBe(false);
    expect(scansNetwork('cat "$1" | sort | uniq -c')).toBe(false);
  });

  it('is stateless across repeated calls', () => {
    const source = 'fetch("https://example.com")';
    expect(scansNetwork(source)).toBe(true);
    expect(scansNetwork(source)).toBe(true);
    expect(NETWORK_PATTERNS.every((p) => !p.global)).toBe(true);
  });
});

describe('readsEnvironment', () => {
  it('detects environment reads across languages', () => {
    expect(readsEnvironment('const key = process.env.OPENAI_API_KEY')).toBe(true);
    expect(readsEnvironment('import os\nos.environ["HOME"]')).toBe(true);
    expect(readsEnvironment('token = getenv("GITHUB_TOKEN")')).toBe(true);
    expect(readsEnvironment('ENV["PATH"]')).toBe(true);
    expect(readsEnvironment('echo "$GITHUB_TOKEN"')).toBe(true);
    expect(readsEnvironment('echo "${AWS_SECRET_ACCESS_KEY}"')).toBe(true);
    expect(readsEnvironment('Deno.env.get("X")')).toBe(true);
  });

  it('does not fire on ordinary shell variables', () => {
    expect(readsEnvironment('echo "$1 $file $HOME"')).toBe(false);
    expect(readsEnvironment('print("environment is a word")')).toBe(false);
  });

  it('is stateless across repeated calls', () => {
    const source = 'process.env.TOKEN';
    expect(readsEnvironment(source)).toBe(true);
    expect(readsEnvironment(source)).toBe(true);
    expect(ENV_PATTERNS.every((p) => !p.global)).toBe(true);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/safety-scan.test.ts`
Expected: FAIL — `src/lib/safety.ts` loads but exports no `NETWORK_PATTERNS`, `ENV_PATTERNS`,
`readsEnvironment` or `scansNetwork`, so the ESM import throws a `SyntaxError` naming the first
missing export and all six tests error before running.
- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/safety.ts`:
```ts
/**
 * Published ruleset for the "network reach" row (spec §4.3). No `g` flag anywhere: a global
 * regex keeps lastIndex between .test() calls and starts returning false negatives.
 */
export const NETWORK_PATTERNS: readonly RegExp[] = [
  /\bhttps?:\/\//i,
  /\bcurl\b/,
  /\bwget\b/,
  /\bfetch\s*\(/,
  /\brequests\s*\.\s*(?:get|post|put|patch|delete|head|request|session|Session)\b/,
  /\burllib\b/,
  /\bhttp\.client\b/,
  /\baxios\b/,
  /\bnode-fetch\b/,
  /\bnet\/http\b/,
  /\bHttpClient\b/,
  /\bsocket\s*\.\s*(?:connect|create_connection)\b/,
  /\bInvoke-(?:WebRequest|RestMethod)\b/i,
];

/** Published ruleset for the "credential reach" row (spec §4.3). */
export const ENV_PATTERNS: readonly RegExp[] = [
  /\bprocess\.env\b/,
  /\bos\.environ\b/,
  /\bgetenv\s*\(/,
  /\bENV\[/,
  /\$ENV\b/,
  /\bSystem\.getenv\b/,
  /\bDeno\.env\b/,
  /\$\{?[A-Z0-9_]*(?:TOKEN|SECRET|API_KEY|APIKEY|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\}?/,
];

export function scansNetwork(source: string): boolean {
  return NETWORK_PATTERNS.some((pattern) => pattern.test(source));
}

export function readsEnvironment(source: string): boolean {
  return ENV_PATTERNS.some((pattern) => pattern.test(source));
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/safety-scan.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/safety.ts tests/lib/safety-scan.test.ts
git commit -m "feat(safety): publishable static scanners for network and env reads"
```

---

### Task A5.8: Frontmatter conformance — portable and declared tools

**Files:**
- Modify: `src/lib/safety.ts` (append after `readsEnvironment`)
- Test: `tests/lib/safety-frontmatter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `ALLOWED_FIELDS: readonly string[]`; `isPortable(frontmatter: Record<string, unknown>): boolean`; `declaredTools(frontmatter: Record<string, unknown>): string[] | null`

**`isPortable(frontmatter)` takes exactly one argument and lives only here**; the vocabulary constant
is named `ALLOWED_FIELDS` and nothing else. No harvest script defines a second `isPortable`, an
`ALLOWED_FRONTMATTER_FIELDS`, or a two-argument `isPortable(frontmatter, path)` — A6 imports these.

Spec §4.2: the reference validator's `ALLOWED_FIELDS` is exactly
`{name, description, license, allowed-tools, metadata, compatibility}` — no category, no tags, no
author, no version. `portable` is true when the frontmatter's keys are a subset of that set; it is
the +9 term of the completeness score (spec §5). `allowed-tools` is present on only 9% of skills, so
`declaredTools` returns `null` — rendered as *not declared* — rather than an empty array.

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/safety-frontmatter.test.ts
import { describe, expect, it } from 'vitest';
import { ALLOWED_FIELDS, declaredTools, isPortable } from '../../src/lib/safety.ts';

describe('isPortable', () => {
  it('takes frontmatter alone — no second path argument', () => {
    expect(isPortable.length).toBe(1);
  });

  it('accepts frontmatter whose keys are a subset of ALLOWED_FIELDS', () => {
    expect(isPortable({ name: 'pdf', description: 'Fill PDF forms' })).toBe(true);
    expect(
      isPortable({
        name: 'pdf',
        description: 'Fill PDF forms',
        license: 'Apache-2.0',
        'allowed-tools': ['Bash'],
        metadata: { x: 1 },
        compatibility: ['claude-code'],
      }),
    ).toBe(true);
  });

  it('rejects any field outside the reference validator vocabulary', () => {
    expect(isPortable({ name: 'pdf', category: 'security' })).toBe(false);
    expect(isPortable({ name: 'pdf', tags: ['sbom'] })).toBe(false);
    expect(isPortable({ name: 'pdf', version: '1.0.0' })).toBe(false);
    expect(isPortable({ name: 'pdf', author: 'someone' })).toBe(false);
  });

  it('is case-sensitive, matching the validator', () => {
    expect(isPortable({ Name: 'pdf' })).toBe(false);
    expect(isPortable({ 'allowed_tools': ['Bash'] })).toBe(false);
  });

  it('publishes the vocabulary', () => {
    expect([...ALLOWED_FIELDS].sort()).toEqual([
      'allowed-tools',
      'compatibility',
      'description',
      'license',
      'metadata',
      'name',
    ]);
  });
});

describe('declaredTools', () => {
  it('returns the array verbatim', () => {
    expect(declaredTools({ 'allowed-tools': ['Bash', 'Read', 'Write'] })).toEqual([
      'Bash',
      'Read',
      'Write',
    ]);
  });

  it('splits the comma-separated string form', () => {
    expect(declaredTools({ 'allowed-tools': 'Bash, Read , Grep' })).toEqual(['Bash', 'Read', 'Grep']);
  });

  it('returns null when nothing usable is declared — the 91% case', () => {
    expect(declaredTools({})).toBeNull();
    expect(declaredTools({ name: 'pdf' })).toBeNull();
    expect(declaredTools({ 'allowed-tools': '' })).toBeNull();
    expect(declaredTools({ 'allowed-tools': [] })).toBeNull();
    expect(declaredTools({ 'allowed-tools': ['', '  '] })).toBeNull();
    expect(declaredTools({ 'allowed-tools': 42 })).toBeNull();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/safety-frontmatter.test.ts`
Expected: FAIL — `src/lib/safety.ts` exports no `ALLOWED_FIELDS`, `declaredTools` or `isPortable`, so
the ESM import throws a `SyntaxError` naming the first missing export and all eight tests error.
- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/safety.ts`:
```ts
/** The reference validator's exact vocabulary (spec §4.2). No category, tags, author or version. */
export const ALLOWED_FIELDS: readonly string[] = [
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
];

const ALLOWED_FIELD_SET = new Set(ALLOWED_FIELDS);

/**
 * True when every frontmatter key is spec-conformant — the +9 completeness term (spec §5).
 * One argument, defined once, here. Portability is a property of the frontmatter alone.
 */
export function isPortable(frontmatter: Record<string, unknown>): boolean {
  return Object.keys(frontmatter).every((key) => ALLOWED_FIELD_SET.has(key));
}

/** `allowed-tools` verbatim, else null ("not declared"). Present on only 9% of skills. */
export function declaredTools(frontmatter: Record<string, unknown>): string[] | null {
  const raw = frontmatter['allowed-tools'];
  let tools: string[];
  if (Array.isArray(raw)) {
    tools = raw.map((tool) => String(tool).trim());
  } else if (typeof raw === 'string') {
    tools = raw.split(',').map((tool) => tool.trim());
  } else {
    return null;
  }
  const cleaned = tools.filter((tool) => tool !== '');
  return cleaned.length > 0 ? cleaned : null;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/safety-frontmatter.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/safety.ts tests/lib/safety-frontmatter.test.ts
git commit -m "feat(safety): portable check and declared-tools extraction from frontmatter"
```

---

### Task A5.9: deriveSafety — assemble the full derived safety surface

**Files:**
- Modify: `src/lib/safety.ts` (replace the import line, then append after `declaredTools`)
- Test: `tests/lib/safety-derive.test.ts`

**Interfaces:**
- Consumes: `isScriptEntry`, `languageOf` (Task A5.5); `scansNetwork`, `readsEnvironment` (Task A5.7); `declaredTools` (Task A5.8); `Safety`, `TreeFile` from `src/types.ts`
- Produces: `deriveSafety(files: TreeFile[], contents: Map<string, string>, frontmatter: Record<string, unknown>): Safety`

**Three required parameters.** `frontmatter` is not optional and has no default: it is the only path
by which `allowed-tools` reaches `Skill.safety.declaredTools`, and when it was optional the harvest
called `deriveSafety(files, contents)` and every entry in the corpus — including the 9% that do
declare tools — shipped `declaredTools: null`. A6 must build the object and pass it; a two-argument
call is now a TypeScript error, and `tests/lib/safety-derive.test.ts` pins `deriveSafety.length === 3`
so it cannot quietly regress.

`files` may be either the output of `scriptFilesFor` or every tree entry under the skill directory —
`isScriptEntry` re-filters defensively either way. A script whose content was not fetched contributes
nothing to `network`/`readsEnv` (absence of evidence, never evidence of absence), which is why the
site ships descriptive rows and never a green "safe" badge (spec §4.3).

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/safety-derive.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { deriveSafety } from '../../src/lib/safety.ts';

function file(path: string, mode = '100644', type = 'blob'): TreeFile {
  return { path, mode, sha: 'cafe1234', type };
}

describe('deriveSafety', () => {
  it('requires all three parameters, so frontmatter can never be dropped', () => {
    expect(deriveSafety.length).toBe(3);
  });

  it('derives the full surface from scripts and their contents', () => {
    const files = [
      file('skills/pdf/SKILL.md'),
      file('skills/pdf/scripts/fill_form.py'),
      file('skills/pdf/scripts/upload.sh', '100755'),
      file('skills/pdf/scripts/notes.md'),
      file('skills/pdf/scripts/linked.py', '120000'),
    ];
    const contents = new Map([
      ['skills/pdf/scripts/fill_form.py', 'import pypdf\nwith open(path) as fh:\n    pass\n'],
      ['skills/pdf/scripts/upload.sh', 'curl -X POST "$UPLOAD_TOKEN" https://example.com/api\n'],
    ]);

    expect(deriveSafety(files, contents, { name: 'pdf', 'allowed-tools': ['Bash', 'Read'] })).toEqual({
      executesCode: true,
      scriptCount: 2,
      languages: ['python', 'shell'],
      network: true,
      readsEnv: true,
      declaredTools: ['Bash', 'Read'],
    });
  });

  it('reports no execution for a documentation-only skill', () => {
    expect(
      deriveSafety([file('skills/style/SKILL.md'), file('skills/style/reference.md')], new Map(), {}),
    ).toEqual({
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    });
  });

  it('counts an executable file with no recognised extension without inventing a language', () => {
    const safety = deriveSafety(
      [file('skills/x/scripts/run', '100755'), file('skills/x/scripts/build.py')],
      new Map([['skills/x/scripts/build.py', 'print("hello")']]),
      {},
    );
    expect(safety.scriptCount).toBe(2);
    expect(safety.languages).toEqual(['python']);
    expect(safety.executesCode).toBe(true);
  });

  it('stays silent about network and env when script contents were not fetched', () => {
    const safety = deriveSafety([file('skills/x/scripts/a.py')], new Map(), {});
    expect(safety).toEqual({
      executesCode: true,
      scriptCount: 1,
      languages: ['python'],
      network: false,
      readsEnv: false,
      declaredTools: null,
    });
  });

  it('sorts and dedupes languages deterministically', () => {
    const safety = deriveSafety(
      [
        file('s/scripts/z.sh'),
        file('s/scripts/a.py'),
        file('s/scripts/b.py'),
        file('s/scripts/c.mjs'),
      ],
      new Map(),
      {},
    );
    expect(safety.languages).toEqual(['javascript', 'python', 'shell']);
    expect(safety.scriptCount).toBe(4);
  });

  it('yields declaredTools null when the frontmatter declares no allowed-tools', () => {
    expect(deriveSafety([file('s/scripts/a.py')], new Map(), { name: 'x' }).declaredTools).toBeNull();
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/safety-derive.test.ts`
Expected: FAIL — `src/lib/safety.ts` exports no `deriveSafety`, so the ESM import throws a
`SyntaxError` naming that missing export and all seven tests error before running.
- [ ] **Step 3: Write minimal implementation**
First replace this exact line at the top of `src/lib/safety.ts`:
```ts
import type { Runtime, TreeFile } from '../types.ts';
```
with:
```ts
import type { Runtime, Safety, TreeFile } from '../types.ts';
```
Then append to `src/lib/safety.ts`:
```ts
/**
 * The derived safety surface (spec §4.3). Derived, never declared: `allowed-tools` exists on only
 * 9% of skills. All three parameters are required — dropping `frontmatter` is what made
 * declaredTools null for the entire corpus. `files` may be the output of scriptFilesFor or every
 * entry under the skill dir; isScriptEntry re-filters either way. A script whose content was not
 * fetched contributes no network/env signal; this module never claims a skill is safe.
 */
export function deriveSafety(
  files: TreeFile[],
  contents: Map<string, string>,
  frontmatter: Record<string, unknown>,
): Safety {
  const scripts = files.filter(isScriptEntry);
  const languages = [
    ...new Set(
      scripts
        .map((file) => languageOf(file.path))
        .filter((language): language is string => language !== null),
    ),
  ].sort();

  let network = false;
  let readsEnv = false;
  for (const file of scripts) {
    const source = contents.get(file.path);
    if (source === undefined) continue;
    if (!network && scansNetwork(source)) network = true;
    if (!readsEnv && readsEnvironment(source)) readsEnv = true;
    if (network && readsEnv) break;
  }

  return {
    executesCode: scripts.length > 0,
    scriptCount: scripts.length,
    languages,
    network,
    readsEnv,
    declaredTools: declaredTools(frontmatter),
  };
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/safety-derive.test.ts`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add src/lib/safety.ts tests/lib/safety-derive.test.ts
git commit -m "feat(safety): deriveSafety with required frontmatter for declared tools"
```

---

### Task A6.1: Composite score model

**Files:**
- Create: `src/lib/score.ts`
- Test: `tests/lib/score.test.ts`

**Interfaces:**
- Consumes: `ScoreBreakdown` from `src/types.ts` (A1.6) — `{ adoption: number; maintenance: number; provenance: number; completeness: number; total: number }`
- Produces: `export interface SkillInput { stars: number; updatedDays: number; curated: boolean; isOrg: boolean; license: string | null; portable: boolean; description: string }` and `export function scoreSkill(s: SkillInput): ScoreBreakdown`

`tsconfig.json` is A1's file and already carries `"allowImportingTsExtensions": true` and `"noEmit": true` (Task A1.5), so this task patches nothing outside `src/lib/`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/score.test.ts
import { describe, expect, it } from 'vitest';
import { scoreSkill, type SkillInput } from '../../src/lib/score.ts';

function input(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    stars: 0,
    updatedDays: 0,
    curated: false,
    isOrg: false,
    license: null,
    portable: false,
    description: '',
    ...overrides,
  };
}

describe('adoption (0-25, log10 of repo stars normalised to a 200000 ceiling)', () => {
  it('gives 0 to a repo with no stars', () => {
    expect(scoreSkill(input({ stars: 0 })).adoption).toBe(0);
  });

  it('scores the measured corpus points', () => {
    expect(scoreSkill(input({ stars: 9 })).adoption).toBe(5);
    expect(scoreSkill(input({ stars: 999 })).adoption).toBe(14);
    expect(scoreSkill(input({ stars: 6908 })).adoption).toBe(18);
    expect(scoreSkill(input({ stars: 52244 })).adoption).toBe(22);
  });

  it('caps at 25 on and above the ceiling', () => {
    expect(scoreSkill(input({ stars: 200000 })).adoption).toBe(25);
  });
});

describe('maintenance (0-30, 90-day half-life on the PATH last-commit age)', () => {
  it('gives a full 30 to a path committed today', () => {
    expect(scoreSkill(input({ updatedDays: 0 })).maintenance).toBe(30);
  });

  it('halves every 90 days', () => {
    expect(scoreSkill(input({ updatedDays: 90 })).maintenance).toBe(15);
    expect(scoreSkill(input({ updatedDays: 180 })).maintenance).toBe(8);
  });

  it('decays smoothly between half-lives', () => {
    expect(scoreSkill(input({ updatedDays: 12 })).maintenance).toBe(27);
    expect(scoreSkill(input({ updatedDays: 30 })).maintenance).toBe(24);
    expect(scoreSkill(input({ updatedDays: 45 })).maintenance).toBe(21);
    expect(scoreSkill(input({ updatedDays: 200 })).maintenance).toBe(6);
    expect(scoreSkill(input({ updatedDays: 365 })).maintenance).toBe(2);
    expect(scoreSkill(input({ updatedDays: 1000 })).maintenance).toBe(0);
  });
});

describe('provenance (0-25: curated +12, org +8, license +5)', () => {
  it('sums the three flags', () => {
    expect(scoreSkill(input({ curated: true, isOrg: true, license: 'MIT' })).provenance).toBe(25);
    expect(scoreSkill(input({ curated: false, isOrg: true, license: null })).provenance).toBe(8);
    expect(scoreSkill(input({ curated: true, isOrg: false, license: 'MIT' })).provenance).toBe(17);
    expect(scoreSkill(input()).provenance).toBe(0);
  });
});

describe('completeness (0-20: portable +9, license +6, real description +5)', () => {
  it('sums the three flags', () => {
    expect(
      scoreSkill(input({ portable: true, license: 'MIT', description: 'Formats markdown tables for the console.' }))
        .completeness,
    ).toBe(20);
    expect(scoreSkill(input()).completeness).toBe(0);
  });

  it('treats 40 characters as the real-description threshold', () => {
    expect(scoreSkill(input({ description: 'Formats markdown tables for the console.' })).completeness).toBe(5);
    expect(scoreSkill(input({ description: 'Formats markdown tables for the console' })).completeness).toBe(0);
  });
});

describe('total', () => {
  it('is the sum of the four components', () => {
    const b = scoreSkill(
      input({
        stars: 6908,
        updatedDays: 12,
        curated: true,
        isOrg: true,
        license: 'Apache-2.0',
        portable: true,
        description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
      }),
    );
    expect(b).toEqual({ adoption: 18, maintenance: 27, provenance: 25, completeness: 20, total: 90 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/score.test.ts`

Expected: FAIL — `src/lib/score.ts` does not exist, so the import cannot be resolved. Vitest reports `Failed to load url ../../src/lib/score.ts` and no test in the file runs.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/score.ts
import type { ScoreBreakdown } from '../types.ts';

/**
 * Everything the score model is allowed to see. Safety is deliberately absent:
 * executing code is a fact, not a fault, so it stays descriptive (spec §5).
 */
export interface SkillInput {
  stars: number;
  updatedDays: number;
  curated: boolean;
  isOrg: boolean;
  license: string | null;
  portable: boolean;
  description: string;
}

const STAR_CEILING = 200_000;
const HALF_LIFE_DAYS = 90;
const MIN_REAL_DESCRIPTION = 40;

export function scoreSkill(s: SkillInput): ScoreBreakdown {
  const adoption = Math.round(Math.min(1, Math.log10(s.stars + 1) / Math.log10(STAR_CEILING)) * 25);
  const maintenance = Math.round(30 * Math.pow(0.5, s.updatedDays / HALF_LIFE_DAYS));
  const provenance = (s.curated ? 12 : 0) + (s.isOrg ? 8 : 0) + (s.license ? 5 : 0);
  const completeness =
    (s.portable ? 9 : 0) +
    (s.license ? 6 : 0) +
    (s.description.length >= MIN_REAL_DESCRIPTION ? 5 : 0);

  return {
    adoption,
    maintenance,
    provenance,
    completeness,
    total: adoption + maintenance + provenance + completeness,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/score.test.ts`

Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/score.ts tests/lib/score.test.ts
git commit -m "feat(score): implement the 25/30/25/20 composite score model"
```

---

### Task A6.2: Score invariants — bounds, per-path separation, and safety exclusion

**Files:**
- Modify: `src/lib/score.ts` (replace the whole file with the content in Step 3)
- Test: `tests/lib/score-invariants.test.ts`

**Interfaces:**
- Consumes: `scoreSkill(s: SkillInput): ScoreBreakdown`, `SkillInput` from `src/lib/score.ts`
- Produces: no new exports; `scoreSkill` gains input clamping so every component stays inside 25/30/25/20 for any numeric input, including negative and non-finite values

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/score-invariants.test.ts
import { describe, expect, it } from 'vitest';
import { scoreSkill, type SkillInput } from '../../src/lib/score.ts';

function input(overrides: Partial<SkillInput> = {}): SkillInput {
  return {
    stars: 0,
    updatedDays: 0,
    curated: false,
    isOrg: false,
    license: null,
    portable: false,
    description: '',
    ...overrides,
  };
}

describe('component bounds hold for hostile numeric input', () => {
  it('clamps negative stars to 0 adoption instead of producing NaN', () => {
    expect(scoreSkill(input({ stars: -5 })).adoption).toBe(0);
  });

  it('clamps a negative path age to a full-but-not-inflated 30 maintenance', () => {
    expect(scoreSkill(input({ updatedDays: -30 })).maintenance).toBe(30);
  });

  it('treats non-finite numbers as zero', () => {
    const b = scoreSkill(input({ stars: Number.NaN, updatedDays: Number.POSITIVE_INFINITY }));
    expect(b.adoption).toBe(0);
    expect(b.maintenance).toBe(30);
  });

  it('never exceeds 25 / 30 / 25 / 20 / 100', () => {
    const extremes: SkillInput[] = [
      input({ stars: 5_000_000, updatedDays: -1000, curated: true, isOrg: true, license: 'MIT', portable: true, description: 'x'.repeat(400) }),
      input({ stars: -1, updatedDays: 1e9 }),
      input({ stars: Number.NaN, updatedDays: Number.NaN }),
    ];
    for (const s of extremes) {
      const b = scoreSkill(s);
      expect(b.adoption).toBeGreaterThanOrEqual(0);
      expect(b.adoption).toBeLessThanOrEqual(25);
      expect(b.maintenance).toBeGreaterThanOrEqual(0);
      expect(b.maintenance).toBeLessThanOrEqual(30);
      expect(b.provenance).toBeGreaterThanOrEqual(0);
      expect(b.provenance).toBeLessThanOrEqual(25);
      expect(b.completeness).toBeGreaterThanOrEqual(0);
      expect(b.completeness).toBeLessThanOrEqual(20);
      expect(b.total).toBeLessThanOrEqual(100);
      expect(b.total).toBe(b.adoption + b.maintenance + b.provenance + b.completeness);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/score-invariants.test.ts`

Expected: FAIL — 3 of the 4 tests fail. `expected NaN to be +0` on "clamps negative stars to 0 adoption instead of producing NaN" (`Math.log10(-4)` is NaN), and `expected 38 to be 30` on the negative-path-age test (`30 * 0.5 ** (-30/90)` is 37.798).

- [ ] **Step 3: Write minimal implementation**

Replace the whole of `src/lib/score.ts` with:

```ts
// src/lib/score.ts
import type { ScoreBreakdown } from '../types.ts';

/**
 * Everything the score model is allowed to see. Safety is deliberately absent:
 * executing code is a fact, not a fault, so it stays descriptive (spec §5).
 */
export interface SkillInput {
  stars: number;
  updatedDays: number;
  curated: boolean;
  isOrg: boolean;
  license: string | null;
  portable: boolean;
  description: string;
}

const STAR_CEILING = 200_000;
const HALF_LIFE_DAYS = 90;
const MIN_REAL_DESCRIPTION = 40;

function finiteAtLeastZero(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function scoreSkill(s: SkillInput): ScoreBreakdown {
  const stars = finiteAtLeastZero(s.stars);
  const updatedDays = finiteAtLeastZero(s.updatedDays);

  const adoption = Math.round(Math.min(1, Math.log10(stars + 1) / Math.log10(STAR_CEILING)) * 25);
  const maintenance = Math.round(30 * Math.pow(0.5, updatedDays / HALF_LIFE_DAYS));
  const provenance = (s.curated ? 12 : 0) + (s.isOrg ? 8 : 0) + (s.license ? 5 : 0);
  const completeness =
    (s.portable ? 9 : 0) +
    (s.license ? 6 : 0) +
    (s.description.length >= MIN_REAL_DESCRIPTION ? 5 : 0);

  return {
    adoption,
    maintenance,
    provenance,
    completeness,
    total: adoption + maintenance + provenance + completeness,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/score-invariants.test.ts tests/lib/score.test.ts`

Expected: PASS — both files green, 12 tests.

- [ ] **Step 5: Add the per-path separation test**

This is the case the weighting exists for: ranking by repo-level signals alone ties every skill from the same repo. Append to `tests/lib/score-invariants.test.ts`:

```ts
describe('two skills from the SAME repo separate on per-path signals', () => {
  // Same repo: same stars, same org flag, same curated flag, same license.
  // Different: per-path updatedDays and per-skill portability.
  const repoLevel = { stars: 6908, curated: true, isOrg: true, license: 'Apache-2.0' as string | null };

  const fresh = scoreSkill({
    ...repoLevel,
    updatedDays: 12,
    portable: true,
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  });

  const stale = scoreSkill({
    ...repoLevel,
    updatedDays: 200,
    portable: false,
    description: 'Old helper.',
  });

  it('agrees on the repo-level components', () => {
    expect(fresh.adoption).toBe(stale.adoption);
    expect(fresh.adoption).toBe(18);
    expect(fresh.provenance).toBe(stale.provenance);
    expect(fresh.provenance).toBe(25);
  });

  it('produces different totals, not a tie', () => {
    expect(fresh.total).toBe(90);
    expect(stale.total).toBe(55);
    expect(fresh.total).not.toBe(stale.total);
    expect(fresh.total).toBeGreaterThan(stale.total);
  });
});
```

- [ ] **Step 6: Run the separation test**

Run: `npx vitest run tests/lib/score-invariants.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 7: Add the safety-is-not-an-input test**

Append to `tests/lib/score-invariants.test.ts`:

```ts
describe('safety is never an input to the score (spec §5)', () => {
  const base: SkillInput = {
    stars: 6908,
    updatedDays: 12,
    curated: true,
    isOrg: true,
    license: 'Apache-2.0',
    portable: true,
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  };

  it('has no safety key on SkillInput', () => {
    expect(Object.keys(base)).not.toContain('safety');
    expect(Object.keys(base).sort()).toEqual([
      'curated',
      'description',
      'isOrg',
      'license',
      'portable',
      'stars',
      'updatedDays',
    ]);
  });

  // No `@ts-expect-error` on the `safety:` lines below. A spread into an untyped
  // `const` has no contextual type, so excess-property checking never runs, the
  // directive would be unused, and `tsc --noEmit` would fail with TS2578 — turning
  // Task A1.5's committed typecheck test red for the rest of this plan. The
  // `as SkillInput` casts carry the intent instead.
  it('scores identically whether a skill executes everything or nothing', () => {
    const dangerous = {
      ...base,
      // safety is deliberately not part of SkillInput (spec §5)
      safety: { executesCode: true, scriptCount: 12, languages: ['python', 'bash'], network: true, readsEnv: true, declaredTools: null },
    };
    const inert = {
      ...base,
      // safety is deliberately not part of SkillInput (spec §5)
      safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: [] },
    };

    expect(scoreSkill(dangerous as SkillInput)).toEqual(scoreSkill(base));
    expect(scoreSkill(inert as SkillInput)).toEqual(scoreSkill(base));
    expect(scoreSkill(dangerous as SkillInput)).toEqual(scoreSkill(inert as SkillInput));
  });
});
```

- [ ] **Step 8: Run the full score suite**

Run: `npx vitest run tests/lib/score.test.ts tests/lib/score-invariants.test.ts`

Expected: PASS — 16 tests across 2 files.

- [ ] **Step 9: Commit**

```bash
git add src/lib/score.ts tests/lib/score-invariants.test.ts
git commit -m "test(score): pin component bounds, per-path separation and safety exclusion"
```

---

### Task A6.3: Skill identity, security relevance, and declared compatibility

**Files:**
- Create: `scripts/harvest/run.ts`
- Test: `tests/harvest/identity.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `export function skillId(repo: string, sha: string, path: string): string` — returns `"owner/repo@sha:path"`
  - `export function isSecurityRelevant(text: string): boolean`
  - `export function compatibilityTopics(frontmatter: Record<string, unknown>): string[]`

License resolution is **not** here: `resolveLicense(input: LicenseInput): LicenseResolution` and
`sniffSpdx` live in A5.4's `src/lib/license.ts` and this section consumes them. Runtime detection is
not here either: `detectRuntimes(topics)` lives in A5.6's `scripts/harvest/enrich.ts` and returns
`RUNTIME_ORDER` order. `compatibilityTopics` exists only to feed the frontmatter `compatibility`
field into that one function as extra topic strings, so the declared field is honoured without a
second runtime mapper.

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/identity.test.ts
import { describe, expect, it } from 'vitest';
import { compatibilityTopics, isSecurityRelevant, skillId } from '../../scripts/harvest/run.ts';

describe('skillId', () => {
  it('synthesises owner/repo@sha:path', () => {
    expect(skillId('trailofbits/skills', '9f1c2ab', 'skills/semgrep-triage/SKILL.md')).toBe(
      'trailofbits/skills@9f1c2ab:skills/semgrep-triage/SKILL.md',
    );
  });

  it('handles a root-level SKILL.md', () => {
    expect(skillId('someone/one-skill', 'abc1234', 'SKILL.md')).toBe('someone/one-skill@abc1234:SKILL.md');
  });

  it('round-trips into the three parts the catalog test re-derives', () => {
    const id = skillId('a/b', 'deadbee', 'skills/x/SKILL.md');
    const [repoAndSha, ...rest] = id.split(':');
    expect(repoAndSha).toBe('a/b@deadbee');
    expect(rest.join(':')).toBe('skills/x/SKILL.md');
  });
});

describe('isSecurityRelevant (cross-cutting flag, spec §3.4)', () => {
  it('flags security work regardless of the primary domain', () => {
    expect(isSecurityRelevant('Audit IAM policies for least privilege')).toBe(true);
    expect(isSecurityRelevant('Run Semgrep and triage vulnerabilities by severity.')).toBe(true);
    expect(isSecurityRelevant('Terraform module linter with supply chain checks')).toBe(true);
    expect(isSecurityRelevant('Test an agent for prompt injection')).toBe(true);
  });

  it('does not flag unrelated skills', () => {
    expect(isSecurityRelevant('Generate release notes from the git history since the last tag.')).toBe(false);
    expect(isSecurityRelevant('Convert a CSV file into a markdown table')).toBe(false);
  });

  it('does not fire on acronyms embedded in ordinary words', () => {
    expect(isSecurityRelevant('Plan a trip to Miami')).toBe(false);
  });
});

describe('compatibilityTopics (frontmatter compatibility, spec §4.2)', () => {
  it('returns an array field verbatim', () => {
    expect(compatibilityTopics({ compatibility: ['cursor', 'openclaw'] })).toEqual(['cursor', 'openclaw']);
  });

  it('wraps a scalar string', () => {
    expect(compatibilityTopics({ compatibility: 'openclaw' })).toEqual(['openclaw']);
  });

  it('drops non-string entries and returns empty when the field is absent', () => {
    expect(compatibilityTopics({ compatibility: ['cursor', 7, null] })).toEqual(['cursor']);
    expect(compatibilityTopics({})).toEqual([]);
    expect(compatibilityTopics({ compatibility: 42 })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/identity.test.ts`

Expected: FAIL — `scripts/harvest/run.ts` does not exist, so the import cannot be resolved. Vitest reports `Failed to load url ../../scripts/harvest/run.ts` and no test in the file runs.

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/harvest/run.ts

/** Primary key for a skill: skills have no version and no namespace primitive (spec §4.1). */
export function skillId(repo: string, sha: string, path: string): string {
  return `${repo}@${sha}:${path}`;
}

const SECURITY_PATTERNS: RegExp[] = [
  /\b(security|secure|vulnerabilit(y|ies)|cve|exploit|malware|hardening)\b/i,
  /\b(sast|dast|sbom|slsa|owasp|iam|rbac|oauth|oidc|siem|mfa|sso|cspm|ciem)\b/i,
  /\b(secret|secrets|credential|credentials|vault|rotation)\b/i,
  /\b(threat model|threat modeling|attack surface|penetration test|pentest|red team)\b/i,
  /\b(supply chain|least privilege|prompt injection|sql injection|xss|csrf)\b/i,
  /\b(compliance|soc\s?2|hipaa|pci[- ]dss|gdpr|iso\s?27001|audit)\b/i,
  /\b(forensic|forensics|incident response|encryption|cryptograph(y|ic))\b/i,
];

/** Cross-cutting flag: true even when the primary domain is not `security` (spec §3.4). */
export function isSecurityRelevant(text: string): boolean {
  return SECURITY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * The frontmatter `compatibility` field as plain topic strings, so it can be appended to the
 * repo topics and handed to A5's single detectRuntimes(). There is no second runtime mapper.
 */
export function compatibilityTopics(frontmatter: Record<string, unknown>): string[] {
  const declared = frontmatter['compatibility'];
  const list: unknown[] = Array.isArray(declared) ? declared : typeof declared === 'string' ? [declared] : [];
  return list.filter((entry): entry is string => typeof entry === 'string');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harvest/identity.test.ts`

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/identity.test.ts
git commit -m "feat(harvest): add skill identity, security relevance and compatibility topics"
```

---

### Task A6.4: buildSkill — compose a catalog entry

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 3; add the import lines shown there to the top of the file)
- Test: `tests/harvest/build-skill.test.ts`

**Interfaces:**
- Consumes:
  - `Assignment`, `Collection`, `RawSkill`, `Safety`, `Skill` from `src/types.ts` (A1.6)
  - `scoreSkill(s: SkillInput): ScoreBreakdown` from `src/lib/score.ts` (A6.1)
  - `resolveLicense(input: LicenseInput): LicenseResolution` from `src/lib/license.ts` (A5.4)
  - `isPortable(frontmatter: Record<string, unknown>): boolean` from `src/lib/safety.ts` (A5.8)
  - `detectRuntimes(topics: string[]): Runtime[]` from `scripts/harvest/enrich.ts` (A5.6) — returns `RUNTIME_ORDER` order, never alphabetical
  - `skillId`, `isSecurityRelevant`, `compatibilityTopics` from `scripts/harvest/run.ts` (A6.3)
- Produces:
  - `export const UNCLASSIFIED_PRIMARY = 'vertical-domain/general'`
  - `export interface BuildSkillInput { raw: RawSkill; collection: Collection; safety: Safety; treePaths: string[]; siblingLicenseText: string | null; assignment: Assignment | undefined; indexedAt: string }`
  - `export function buildSkill(input: BuildSkillInput): Skill`

`Assignment` and `Assignments` are declared exactly once in A1's `src/types.ts` (Task A1.6); this
task and `src/lib/data.ts` (Task A6.6) both import them from there and neither re-declares them.
The canonical row is exactly `{ primary: string; also: string[]; tags: string[] }` — the
classification PR writes nothing else. `securityRelevant` is therefore always derived, and
`descriptionPt` / `longPt` are always `null` out of harvest: the harvest is deterministic and never
invents a translation.

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/build-skill.test.ts
import { describe, expect, it } from 'vitest';
import type { Assignment, Collection, RawSkill, Safety } from '../../src/types.ts';
import { buildSkill } from '../../scripts/harvest/run.ts';

const SHA = '9f1c2ab3d4e5f60718293a4b5c6d7e8f90a1b2c3';

const collection: Collection = {
  repo: 'trailofbits/skills',
  stars: 6908,
  forks: 412,
  pushedAt: '2026-08-20T10:00:00Z',
  license: 'Apache-2.0',
  topics: ['claude-skills', 'security'],
  isOrg: true,
  curated: true,
};

const safety: Safety = {
  executesCode: true,
  scriptCount: 2,
  languages: ['python'],
  network: true,
  readsEnv: false,
  declaredTools: null,
};

const raw: RawSkill = {
  repo: 'trailofbits/skills',
  path: 'skills/semgrep-triage/SKILL.md',
  sha: SHA,
  blobSha: '1111111111111111111111111111111111111111',
  frontmatter: {
    name: 'semgrep-triage',
    description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
  },
  body: '# Semgrep triage\n',
  updatedDays: 12,
};

/** No LICENSE next to the SKILL.md, so tier 2 cannot fire and the repo SPDX wins. */
const bareTree = ['skills/semgrep-triage/SKILL.md', 'skills/semgrep-triage/scripts/scan.py'];

describe('buildSkill', () => {
  it('composes an unclassified entry with a repo-level license fallback', () => {
    const skill = buildSkill({
      raw,
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill).toEqual({
      id: `trailofbits/skills@${SHA}:skills/semgrep-triage/SKILL.md`,
      type: 'skill',
      name: 'semgrep-triage',
      description: 'Run Semgrep across the repository and triage vulnerabilities by severity.',
      descriptionPt: null,
      longPt: null,
      repo: 'trailofbits/skills',
      path: 'skills/semgrep-triage/SKILL.md',
      sha: SHA,
      updatedDays: 12,
      indexedAt: '2026-08-29T00:00:00.000Z',
      license: 'Apache-2.0',
      licenseSource: 'repo',
      portable: true,
      runtimes: ['claude'],
      safety,
      primary: 'vertical-domain/general',
      also: [],
      tags: [],
      securityRelevant: true,
      score: 90,
      breakdown: { adoption: 18, maintenance: 27, provenance: 25, completeness: 20, total: 90 },
    });
  });

  it('applies an assignment and caps also at 2 and tags at 10', () => {
    const assignment: Assignment = {
      primary: 'security/code-application',
      also: ['coding-software/general', 'devops-infra/general', 'productivity/general'],
      tags: ['sast', 'semgrep', 'triage', 'python', 'static-analysis', 'cli', 'ci', 'review', 'scanning', 'findings', 'eleventh'],
    };

    const skill = buildSkill({
      raw,
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.primary).toBe('security/code-application');
    expect(skill.also).toEqual(['coding-software/general', 'devops-infra/general']);
    expect(skill.tags).toHaveLength(10);
    expect(skill.tags[9]).toBe('findings');
    expect(skill.descriptionPt).toBeNull();
    expect(skill.longPt).toBeNull();
  });

  it('falls back to the directory name, marks a non-conformant skill unportable, and scores it lower', () => {
    const skill = buildSkill({
      raw: {
        repo: 'trailofbits/skills',
        path: 'skills/release-notes/SKILL.md',
        sha: SHA,
        blobSha: '2222222222222222222222222222222222222222',
        frontmatter: {
          description: 'Generate release notes from the git history since the last tag.',
          category: 'writing',
        },
        body: '',
        updatedDays: 200,
      },
      collection,
      safety,
      treePaths: ['skills/release-notes/SKILL.md'],
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.name).toBe('release-notes');
    expect(skill.portable).toBe(false);
    expect(skill.securityRelevant).toBe(false);
    expect(skill.breakdown).toEqual({ adoption: 18, maintenance: 6, provenance: 25, completeness: 11, total: 60 });
    expect(skill.score).toBe(60);
  });

  it('prefers a sibling LICENSE over a null repo license (anthropics/skills case)', () => {
    const skill = buildSkill({
      raw,
      collection: { ...collection, license: null },
      treePaths: [...bareTree, 'skills/semgrep-triage/LICENSE'],
      safety,
      siblingLicenseText: '                    Apache License\n              Version 2.0, January 2004\n',
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    expect(skill.license).toBe('Apache-2.0');
    expect(skill.licenseSource).toBe('sibling');
  });

  it('honours the frontmatter compatibility field in RUNTIME_ORDER, never alphabetically', () => {
    const skill = buildSkill({
      raw: { ...raw, frontmatter: { ...raw.frontmatter, compatibility: ['cursor', 'openclaw'] } },
      collection,
      safety,
      treePaths: bareTree,
      siblingLicenseText: null,
      assignment: undefined,
      indexedAt: '2026-08-29T00:00:00.000Z',
    });

    // RUNTIME_ORDER (exported from src/lib/safety.ts, A5) is claude, openclaw, codex, cursor,
    // generic. Alphabetical would be claude, cursor, openclaw — a real ordering bug.
    expect(skill.runtimes).toEqual(['claude', 'openclaw', 'cursor']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/build-skill.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'buildSkill'`. Every module this test imports already exists (`src/types.ts` from A1.6, `scripts/harvest/run.ts` from A6.3), so the missing export is the only error.

- [ ] **Step 3: Write minimal implementation**

Add these imports at the top of `scripts/harvest/run.ts`:

```ts
import type { Assignment, Collection, RawSkill, Safety, Skill } from '../../src/types.ts';
import { scoreSkill } from '../../src/lib/score.ts';
import { isPortable } from '../../src/lib/safety.ts';
import { resolveLicense } from '../../src/lib/license.ts';
import { detectRuntimes } from './enrich.ts';
```

Append to `scripts/harvest/run.ts`:

```ts
/**
 * Where a skill sits until the classification PR lands. It is a real taxonomy node,
 * so referential integrity holds and nothing disappears (spec §13).
 */
export const UNCLASSIFIED_PRIMARY = 'vertical-domain/general';

const MAX_ALSO = 2;
const MAX_TAGS = 10;

export interface BuildSkillInput {
  raw: RawSkill;
  collection: Collection;
  safety: Safety;
  /** Every blob path in the repo tree — resolveLicense needs it to spot a sibling LICENSE. */
  treePaths: string[];
  siblingLicenseText: string | null;
  assignment: Assignment | undefined;
  indexedAt: string;
}

export function buildSkill(input: BuildSkillInput): Skill {
  const { raw, collection, safety, treePaths, siblingLicenseText, assignment, indexedAt } = input;
  const frontmatter = raw.frontmatter;

  const segments = raw.path.split('/');
  const declaredName = frontmatter['name'];
  const name =
    typeof declaredName === 'string' && declaredName.trim() !== ''
      ? declaredName.trim()
      : (segments.length >= 2 ? segments[segments.length - 2] : segments[0]) ?? raw.path;

  const declaredDescription = frontmatter['description'];
  const description = typeof declaredDescription === 'string' ? declaredDescription.trim() : '';

  const { license, licenseSource } = resolveLicense({
    frontmatter,
    skillPath: raw.path,
    treePaths,
    repoLicense: collection.license,
    siblingLicenseText,
  });

  const portable = isPortable(frontmatter);
  const runtimes = detectRuntimes([...collection.topics, ...compatibilityTopics(frontmatter)]);

  const breakdown = scoreSkill({
    stars: collection.stars,
    updatedDays: raw.updatedDays,
    curated: collection.curated,
    isOrg: collection.isOrg,
    license,
    portable,
    description,
  });

  return {
    id: skillId(raw.repo, raw.sha, raw.path),
    type: 'skill',
    name,
    description,
    // Harvest is deterministic and never translates. The translation PR fills these in.
    descriptionPt: null,
    longPt: null,
    repo: raw.repo,
    path: raw.path,
    sha: raw.sha,
    updatedDays: raw.updatedDays,
    indexedAt,
    license,
    licenseSource,
    portable,
    runtimes,
    safety,
    primary: assignment?.primary ?? UNCLASSIFIED_PRIMARY,
    also: (assignment?.also ?? []).slice(0, MAX_ALSO),
    tags: (assignment?.tags ?? []).slice(0, MAX_TAGS),
    securityRelevant: isSecurityRelevant(`${name} ${description}`),
    score: breakdown.total,
    breakdown,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harvest/build-skill.test.ts`

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/build-skill.test.ts
git commit -m "feat(harvest): compose catalog entries with buildSkill"
```

---

### Task A6.5: Sibling-LICENSE lookup and content fetching pinned to the repo head commit

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 4; add the import lines shown there)
- Modify: `src/lib/license.ts` (Step 3 — guarded, idempotent insertion above an exact anchor; A5 owns this file)
- Test: `tests/harvest/content.test.ts`

**Interfaces:**
- Consumes: `TreeFile` from `src/types.ts` (A1.6); `fetchRawFile(repo, ref, path, deps?)` from `scripts/harvest/enumerate.ts` (A4.17) and `EnumerateDeps` from the same file (A4.12)
- Produces:
  - `export const MAX_SCRIPT_FILES = 25`
  - `export async function fetchScriptContents(repo: string, commitSha: string, files: TreeFile[], deps?: EnumerateDeps): Promise<Map<string, string>>`
  - and, in `src/lib/license.ts`, `export function siblingLicensePath(skillPath: string, treePaths: string[]): string | null`

**Why the repo head commit, and why this section defines no head-commit fetcher.**
`enumerateSkills` (A4.20) guarantees `RawSkill.sha` is a **commit** sha — the per-path commit when
one exists, the repo HEAD commit otherwise, and the path is skipped outright when neither can be
resolved. A blob sha never reaches `RawSkill.sha`. That sha pins *the SKILL.md's own last change*,
which is the wrong ref for its neighbours: `fetchTree` (A4.12) reads `git/trees/HEAD`, so every
sibling path in `treePaths` — `scripts/*`, `LICENSE*` — is a HEAD path, and a script added after the
SKILL.md last changed simply does not exist at the per-path commit. Content and sibling-LICENSE
fetches are therefore pinned to the repository head commit, resolved once per repo by A4.19's
`fetchHeadCommit` — **the one head-commit fetcher in the codebase**. This section imports it
(in Task A6.9) and writes no second implementation.

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/content.test.ts
import { describe, expect, it } from 'vitest';
import type { TreeFile } from '../../src/types.ts';
import { siblingLicensePath } from '../../src/lib/license.ts';
import { MAX_SCRIPT_FILES, fetchScriptContents } from '../../scripts/harvest/run.ts';

const COMMIT = '4c9e1f7a2b3d5e6f7081920a3b4c5d6e7f809102';
const BLOB = '1111111111111111111111111111111111111111';

function recordingFetch(handler: (url: string) => Response): { impl: typeof fetch; urls: string[] } {
  const urls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { impl, urls };
}

describe('fetchScriptContents', () => {
  const files: TreeFile[] = [
    { path: 'skills/x/scripts/a.py', mode: '100644', sha: '1', type: 'blob' },
    { path: 'skills/x/scripts/b.py', mode: '100644', sha: '2', type: 'blob' },
    { path: 'skills/x/scripts/gone.py', mode: '100644', sha: '3', type: 'blob' },
  ];

  it('pins every request to the commit sha it was given, never to a blob sha', async () => {
    const rec = recordingFetch(() => new Response('print(1)', { status: 200 }));
    await fetchScriptContents('a/b', COMMIT, files.slice(0, 1), { fetchImpl: rec.impl });

    expect(rec.urls).toEqual([`https://raw.githubusercontent.com/a/b/${COMMIT}/skills/x/scripts/a.py`]);
    expect(rec.urls[0]).not.toContain(BLOB);
  });

  it('maps every readable file by path and drops the unreadable ones', async () => {
    const rec = recordingFetch((url) =>
      url.endsWith('gone.py') ? new Response('404', { status: 404 }) : new Response(`# ${url.split('/').pop()}`, { status: 200 }),
    );

    const contents = await fetchScriptContents('a/b', COMMIT, files, { fetchImpl: rec.impl });
    expect(contents.size).toBe(2);
    expect(contents.get('skills/x/scripts/a.py')).toBe('# a.py');
    expect(contents.has('skills/x/scripts/gone.py')).toBe(false);
  });

  it('survives a server error on one file instead of aborting the crawl', async () => {
    const rec = recordingFetch((url) =>
      url.endsWith('b.py') ? new Response('boom', { status: 500 }) : new Response('ok', { status: 200 }),
    );

    const contents = await fetchScriptContents('a/b', COMMIT, files.slice(0, 2), { fetchImpl: rec.impl });
    expect(contents.size).toBe(1);
    expect(contents.has('skills/x/scripts/a.py')).toBe(true);
  });

  it('never fetches more than MAX_SCRIPT_FILES per skill', async () => {
    const many: TreeFile[] = Array.from({ length: 40 }, (_unused, i) => ({
      path: `skills/x/scripts/f${i}.py`,
      mode: '100644',
      sha: String(i),
      type: 'blob',
    }));
    const rec = recordingFetch(() => new Response('print(1)', { status: 200 }));

    const contents = await fetchScriptContents('a/b', COMMIT, many, { fetchImpl: rec.impl });
    expect(MAX_SCRIPT_FILES).toBe(25);
    expect(rec.urls).toHaveLength(25);
    expect(contents.size).toBe(25);
  });
});

describe('siblingLicensePath (spec §4.3, exported from src/lib/license.ts)', () => {
  const treePaths = [
    'skills/sast/SKILL.md',
    'skills/sast/LICENSE.txt',
    'skills/sast/sub/LICENSE',
    'skills/other/LICENSE',
  ];

  it('finds a LICENSE file next to SKILL.md', () => {
    expect(siblingLicensePath('skills/sast/SKILL.md', treePaths)).toBe('skills/sast/LICENSE.txt');
  });

  it('ignores a nested LICENSE and another skill directory', () => {
    expect(siblingLicensePath('skills/none/SKILL.md', treePaths)).toBeNull();
  });

  it('matches LICENCE case-insensitively at the repo root', () => {
    expect(siblingLicensePath('SKILL.md', ['SKILL.md', 'licence'])).toBe('licence');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/content.test.ts`

Expected: FAIL — `src/lib/license.ts` is the first module linked and A5.4 exports no such symbol:
`does not provide an export named 'siblingLicensePath'`. No test in the file runs.

- [ ] **Step 3: Export the sibling-LICENSE path finder from A5's license module**

`resolveLicense` finds the sibling LICENSE itself, but the harvest must know the *path* before it
can fetch the text to hand back in. This adds the accessor and nothing else. It is idempotent and
a no-op if A5 already exports the symbol.

```bash
if grep -q 'export function siblingLicensePath' src/lib/license.ts; then
  echo "siblingLicensePath already exported by A5 — nothing to do"
else
  awk '
    /^export function resolveLicense\(input: LicenseInput\): LicenseResolution \{$/ && !done {
      print "/**";
      print " * The LICENSE* file sitting next to a SKILL.md, or null. Selects exactly the file";
      print " * resolveLicense tier 2 looks for; the harvest fetches its text and passes it back in.";
      print " */";
      print "export function siblingLicensePath(skillPath: string, treePaths: string[]): string | null {";
      print "  const cut = skillPath.lastIndexOf(\"/\");";
      print "  const dir = cut === -1 ? \"\" : skillPath.slice(0, cut + 1);";
      print "  for (const path of treePaths) {";
      print "    if (!path.startsWith(dir)) continue;";
      print "    const name = path.slice(dir.length);";
      print "    if (name.includes(\"/\")) continue;";
      print "    if (/^licen[cs]e/i.test(name)) return path;";
      print "  }";
      print "  return null;";
      print "}";
      print "";
      done = 1;
    }
    { print }
  ' src/lib/license.ts > src/lib/license.ts.tmp && mv src/lib/license.ts.tmp src/lib/license.ts
fi
grep -c 'export function siblingLicensePath' src/lib/license.ts
```

Expected output: `1` — exactly one definition, whoever wrote it.

- [ ] **Step 4: Write minimal implementation**

Replace the `src/types.ts` type-import line at the top of `scripts/harvest/run.ts` with exactly:

```ts
import type { Assignment, Collection, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
```

and add this new import line:

```ts
import { fetchRawFile, type EnumerateDeps } from './enumerate.ts';
```

Append to `scripts/harvest/run.ts`:

```ts
/** Per-skill cap on raw content requests, so one 846-path monorepo cannot burn the core budget. */
export const MAX_SCRIPT_FILES = 25;

/**
 * Fetch the given files at one ref. The caller passes the repository head COMMIT sha: the tree
 * these paths came from was read at HEAD (A4.12), so HEAD is the ref at which all of them resolve.
 */
export async function fetchScriptContents(
  repo: string,
  commitSha: string,
  files: TreeFile[],
  deps: EnumerateDeps = {},
): Promise<Map<string, string>> {
  const contents = new Map<string, string>();

  for (const file of files.slice(0, MAX_SCRIPT_FILES)) {
    try {
      const text = await fetchRawFile(repo, commitSha, file.path, deps);
      if (text !== null) contents.set(file.path, text);
    } catch {
      // One unreadable script costs that script's network/env signal, never the whole crawl.
    }
  }

  return contents;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/harvest/content.test.ts`

Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add scripts/harvest/run.ts src/lib/license.ts tests/harvest/content.test.ts
git commit -m "feat(harvest): fetch skill content and sibling LICENSE at the repo head commit"
```

---

### Task A6.6: The data loaders and the seed data files

**Files:**
- Create: `src/lib/data.ts`
- Create: `data/skills.json`
- Create: `data/collections.json`
- Create: `data/meta.json`
- Create: `data/assignments.json`
- Test: `tests/lib/data.test.ts`

**Interfaces:**
- Consumes: `Assignments`, `Collection`, `Meta`, `Skill` from `src/types.ts` (A1.6)
- Produces — the single reader for every `data/*.json` file in the repo; **no other module may call `JSON.parse` on these paths**:
  - `export const NEVER_CRAWLED = '1970-01-01T00:00:00.000Z'`, `export const EMPTY_META: Meta`, `export const DEFAULT_DATA_DIR: string`
  - `export function loadSkills(dataDir?: string): Skill[]`
  - `export function loadCollections(dataDir?: string): Collection[]`
  - `export function loadMeta(dataDir?: string): Meta`
  - `export function loadAssignments(dataDir?: string): Assignments`

`Meta`, `Assignment` and `Assignments` are declared exactly once, in A1's `src/types.ts` (Task
A1.6). This module imports them and re-declares nothing; consumers that need the *types* import
them from `src/types.ts` too, and only the loaders and constants come from here. The file shapes are
fixed: `data/skills.json` is a **bare `Skill[]`**, `data/collections.json` is a **bare
`Collection[]`** (stars and forks live there, not on the skill), `data/assignments.json` is a
**`Record<id, Assignment>` keyed by `owner/repo@sha:path`**, never an array. The loaders take an
optional directory purely so the harvest can read a scratch directory in tests; the zero-argument
call is the one every page uses.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/data.test.ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_DIR,
  EMPTY_META,
  NEVER_CRAWLED,
  loadAssignments,
  loadCollections,
  loadMeta,
  loadSkills,
} from '../../src/lib/data.ts';

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ai-tools-hub-data-'));
}

describe('loading tolerates a missing, broken or wrongly-shaped file', () => {
  it('returns empty values when nothing is on disk', async () => {
    const dir = await scratch();
    expect(loadSkills(dir)).toEqual([]);
    expect(loadCollections(dir)).toEqual([]);
    expect(loadMeta(dir)).toEqual(EMPTY_META);
    expect(loadAssignments(dir)).toEqual({});
  });

  it('returns empty values for unparseable JSON', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '{ broken', 'utf8');
    await writeFile(join(dir, 'meta.json'), 'nope', 'utf8');
    expect(loadSkills(dir)).toEqual([]);
    expect(loadMeta(dir)).toEqual(EMPTY_META);
  });

  it('rejects the wrapped {"skills": []} shape — skills.json is a bare array', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '{"skills":[{"id":"a/b@c:SKILL.md"}]}', 'utf8');
    expect(loadSkills(dir)).toEqual([]);
  });

  it('rejects an assignments file that is an array — it is keyed by skill id', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'assignments.json'), '[{"primary":"security/general"}]', 'utf8');
    expect(loadAssignments(dir)).toEqual({});
  });
});

describe('loading returns the canonical shapes', () => {
  it('reads bare arrays from skills.json and collections.json', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'skills.json'), '[{"id":"a/b@c:SKILL.md","name":"x"}]', 'utf8');
    await writeFile(join(dir, 'collections.json'), '[{"repo":"a/b","stars":10,"forks":1}]', 'utf8');
    expect(loadSkills(dir)).toHaveLength(1);
    expect(loadSkills(dir)[0]!.id).toBe('a/b@c:SKILL.md');
    expect(loadCollections(dir)[0]!.repo).toBe('a/b');
  });

  it('normalises a partial meta.json instead of returning undefined fields', async () => {
    const dir = await scratch();
    await writeFile(join(dir, 'meta.json'), '{"skillCount":7}', 'utf8');
    expect(loadMeta(dir)).toEqual({ crawledAt: NEVER_CRAWLED, classifiedAt: null, skillCount: 7, sourceCount: 0 });
  });

  it('keeps well-formed assignment rows and drops malformed ones', async () => {
    const dir = await scratch();
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        'a/b@c:SKILL.md': { primary: 'security/general', also: ['devops-infra/general'], tags: ['sast'] },
        'a/b@c:bare/SKILL.md': { primary: 'security/general' },
        'a/b@c:junk/SKILL.md': { also: [], tags: [] },
      }),
      'utf8',
    );

    const assignments = loadAssignments(dir);
    expect(Object.keys(assignments).sort()).toEqual(['a/b@c:SKILL.md', 'a/b@c:bare/SKILL.md']);
    expect(assignments['a/b@c:SKILL.md']).toEqual({
      primary: 'security/general',
      also: ['devops-infra/general'],
      tags: ['sast'],
    });
    expect(assignments['a/b@c:bare/SKILL.md']).toEqual({ primary: 'security/general', also: [], tags: [] });
  });
});

describe('the committed data directory', () => {
  it('points DEFAULT_DATA_DIR at the repository data/ folder and parses every file there', () => {
    expect(existsSync(join(DEFAULT_DATA_DIR, 'skills.json'))).toBe(true);
    expect(existsSync(join(DEFAULT_DATA_DIR, 'collections.json'))).toBe(true);
    expect(Array.isArray(loadSkills())).toBe(true);
    expect(Array.isArray(loadCollections())).toBe(true);
    expect(typeof loadMeta().crawledAt).toBe('string');
    expect(typeof loadAssignments()).toBe('object');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/data.test.ts`

Expected: FAIL — `src/lib/data.ts` does not exist, so the import cannot be resolved. Vitest reports `Failed to load url ../../src/lib/data.ts` and no test in the file runs.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/data.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Assignments, Collection, Meta, Skill } from '../types.ts';

/** No crawl has ever run. Honest and maximally stale, so the banner tells the truth. */
export const NEVER_CRAWLED = '1970-01-01T00:00:00.000Z';

export const EMPTY_META: Meta = {
  crawledAt: NEVER_CRAWLED,
  classifiedAt: null,
  skillCount: 0,
  sourceCount: 0,
};

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../data/', import.meta.url));

function readJson(dataDir: string, file: string): unknown {
  try {
    return JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

export function loadSkills(dataDir: string = DEFAULT_DATA_DIR): Skill[] {
  const parsed = readJson(dataDir, 'skills.json');
  return Array.isArray(parsed) ? (parsed as Skill[]) : [];
}

export function loadCollections(dataDir: string = DEFAULT_DATA_DIR): Collection[] {
  const parsed = readJson(dataDir, 'collections.json');
  return Array.isArray(parsed) ? (parsed as Collection[]) : [];
}

export function loadMeta(dataDir: string = DEFAULT_DATA_DIR): Meta {
  const parsed = readJson(dataDir, 'meta.json') as Partial<Meta> | null;
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...EMPTY_META };
  return {
    crawledAt: typeof parsed.crawledAt === 'string' ? parsed.crawledAt : NEVER_CRAWLED,
    classifiedAt: typeof parsed.classifiedAt === 'string' ? parsed.classifiedAt : null,
    skillCount: typeof parsed.skillCount === 'number' ? parsed.skillCount : 0,
    sourceCount: typeof parsed.sourceCount === 'number' ? parsed.sourceCount : 0,
  };
}

export function loadAssignments(dataDir: string = DEFAULT_DATA_DIR): Assignments {
  const parsed = readJson(dataDir, 'assignments.json');
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out: Assignments = {};
  for (const [id, row] of Object.entries(parsed as Record<string, unknown>)) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (typeof record['primary'] !== 'string' || record['primary'] === '') continue;
    out[id] = {
      primary: record['primary'],
      also: stringList(record['also']),
      tags: stringList(record['tags']),
    };
  }
  return out;
}
```

- [ ] **Step 4: Seed the four committed data files**

Every page and the validator read these paths, so they must exist and parse before the first crawl.

```bash
mkdir -p data
printf '[]\n' > data/skills.json
printf '[]\n' > data/collections.json
printf '{}\n' > data/assignments.json
cat > data/meta.json <<'JSON'
{
  "crawledAt": "1970-01-01T00:00:00.000Z",
  "classifiedAt": null,
  "skillCount": 0,
  "sourceCount": 0
}
JSON
node --input-type=module -e '
import { readFileSync } from "node:fs";
const skills = JSON.parse(readFileSync("data/skills.json", "utf8"));
const collections = JSON.parse(readFileSync("data/collections.json", "utf8"));
const assignments = JSON.parse(readFileSync("data/assignments.json", "utf8"));
const meta = JSON.parse(readFileSync("data/meta.json", "utf8"));
if (!Array.isArray(skills)) throw new Error("skills.json must be a bare array");
if (!Array.isArray(collections)) throw new Error("collections.json must be a bare array");
if (Array.isArray(assignments) || typeof assignments !== "object") throw new Error("assignments.json must be an object keyed by skill id");
if (typeof meta.crawledAt !== "string") throw new Error("meta.crawledAt must be a string");
console.log("seed data files parse");
'
```

Expected output: `seed data files parse`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/data.test.ts`

Expected: PASS — 8 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/data.ts tests/lib/data.test.ts data/skills.json data/collections.json data/meta.json data/assignments.json
git commit -m "feat(data): add the single data loader and seed the catalog files"
```

---

### Task A6.7: Catalog persistence

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 3; add the import lines shown there)
- Test: `tests/harvest/persistence.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Meta`, `Skill` from `src/types.ts` (A1.6); `EMPTY_META`, `loadCollections`, `loadMeta`, `loadSkills` from `src/lib/data.ts` (A6.6)
- Produces:
  - `export interface CatalogSnapshot { skills: Skill[]; collections: Collection[] }` — an in-memory pair, **not** a file shape
  - `export async function writeCatalog(dataDir: string, snapshot: CatalogSnapshot): Promise<void>` — writes `skills.json` and `collections.json` as two bare arrays
  - `export async function writeMeta(dataDir: string, meta: Meta): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/persistence.test.ts
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection } from '../../src/types.ts';
import { EMPTY_META, loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { writeCatalog, writeMeta } from '../../scripts/harvest/run.ts';

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'ai-tools-hub-write-'));
}

const collection: Collection = {
  repo: 'a/b',
  stars: 1,
  forks: 0,
  pushedAt: '2026-08-01T00:00:00Z',
  license: 'MIT',
  topics: ['claude-skills'],
  isOrg: false,
  curated: false,
};

describe('writing produces stable, diff-friendly, canonically shaped files', () => {
  it('writes two bare arrays, not one wrapper object', async () => {
    const dir = await scratch();
    await writeCatalog(dir, { skills: [], collections: [collection] });

    const skillsRaw = await readFile(join(dir, 'skills.json'), 'utf8');
    const collectionsRaw = await readFile(join(dir, 'collections.json'), 'utf8');

    expect(skillsRaw).toBe('[]\n');
    expect(collectionsRaw.startsWith('[')).toBe(true);
    expect(collectionsRaw.endsWith('\n')).toBe(true);
    expect(collectionsRaw).not.toContain('"collections"');
  });

  it('round-trips through the loaders', async () => {
    const dir = await scratch();
    await writeCatalog(dir, { skills: [], collections: [collection] });
    expect(loadSkills(dir)).toEqual([]);
    expect(loadCollections(dir)).toEqual([collection]);
  });

  it('round-trips meta', async () => {
    const dir = await scratch();
    const meta = {
      crawledAt: '2026-08-29T06:37:00.000Z',
      classifiedAt: '2026-08-28T00:00:00.000Z',
      skillCount: 24,
      sourceCount: 3,
    };
    await writeMeta(dir, meta);
    expect(loadMeta(dir)).toEqual(meta);
  });

  it('creates the data directory when it is absent', async () => {
    const dir = join(await scratch(), 'nested', 'data');
    await writeMeta(dir, EMPTY_META);
    await writeCatalog(dir, { skills: [], collections: [] });
    expect(loadMeta(dir)).toEqual(EMPTY_META);
    expect(loadCollections(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/persistence.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'writeCatalog'`.

- [ ] **Step 3: Write minimal implementation**

Replace the `src/types.ts` type-import line at the top of `scripts/harvest/run.ts` with exactly:

```ts
import type { Assignment, Collection, Meta, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
```

and add these two new import lines:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
```

Append to `scripts/harvest/run.ts`:

```ts
/** The two catalog arrays in memory. On disk they are two separate bare-array files. */
export interface CatalogSnapshot {
  skills: Skill[];
  collections: Collection[];
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeCatalog(dataDir: string, snapshot: CatalogSnapshot): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeJson(join(dataDir, 'skills.json'), snapshot.skills);
  await writeJson(join(dataDir, 'collections.json'), snapshot.collections);
}

export async function writeMeta(dataDir: string, meta: Meta): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeJson(join(dataDir, 'meta.json'), meta);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harvest/persistence.test.ts`

Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/persistence.test.ts
git commit -m "feat(harvest): persist skills and collections as two bare arrays"
```

---

### Task A6.8: Incremental crawl — skip repos whose pushedAt is unchanged

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 3)
- Test: `tests/harvest/incremental.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Skill` from `src/types.ts` (A1.6); `CatalogSnapshot` from `scripts/harvest/run.ts` (A6.7)
- Produces:
  - `export function pushedAtIndex(previous: CatalogSnapshot): Map<string, string>`
  - `export function partitionRepos(fresh: Collection[], index: Map<string, string>): { crawl: Collection[]; skipped: Collection[] }`
  - `export function carryForward(previous: CatalogSnapshot, skipped: Collection[]): Skill[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/incremental.test.ts
import { describe, expect, it } from 'vitest';
import type { Collection, Skill } from '../../src/types.ts';
import { carryForward, partitionRepos, pushedAtIndex, type CatalogSnapshot } from '../../scripts/harvest/run.ts';

function collection(repo: string, pushedAt: string): Collection {
  return { repo, stars: 10, forks: 1, pushedAt, license: 'MIT', topics: [], isOrg: false, curated: false };
}

function skill(repo: string, id: string): Skill {
  return {
    id,
    type: 'skill',
    name: 'n',
    description: 'A carried-forward entry with a description long enough to be real.',
    descriptionPt: null,
    longPt: null,
    repo,
    path: 'SKILL.md',
    sha: 'abc',
    updatedDays: 1,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    // adoption 10 + maintenance 30 + provenance 5 (license) + completeness 20 (portable+license+description)
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
  };
}

const previous: CatalogSnapshot = {
  skills: [skill('cached/repo', 'cached/repo@abc:SKILL.md'), skill('changed/repo', 'changed/repo@abc:SKILL.md')],
  collections: [collection('cached/repo', '2026-08-01T00:00:00Z'), collection('changed/repo', '2026-08-01T00:00:00Z')],
};

describe('pushedAtIndex', () => {
  it('maps each previously seen repo to its pushedAt', () => {
    const index = pushedAtIndex(previous);
    expect(index.get('cached/repo')).toBe('2026-08-01T00:00:00Z');
    expect(index.size).toBe(2);
  });

  it('is empty for an empty snapshot', () => {
    expect(pushedAtIndex({ skills: [], collections: [] }).size).toBe(0);
  });
});

describe('partitionRepos (spec §6.1: skip repos whose pushedAt is unchanged)', () => {
  it('skips unchanged repos and crawls changed and unseen ones', () => {
    const fresh = [
      collection('cached/repo', '2026-08-01T00:00:00Z'),
      collection('changed/repo', '2026-08-28T09:00:00Z'),
      collection('brand/new', '2026-08-29T09:00:00Z'),
    ];

    const { crawl, skipped } = partitionRepos(fresh, pushedAtIndex(previous));
    expect(skipped.map((c) => c.repo)).toEqual(['cached/repo']);
    expect(crawl.map((c) => c.repo)).toEqual(['changed/repo', 'brand/new']);
  });

  it('crawls everything on a cold start', () => {
    const fresh = [collection('a/b', '2026-08-29T00:00:00Z')];
    const { crawl, skipped } = partitionRepos(fresh, new Map());
    expect(crawl).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});

describe('carryForward', () => {
  it('keeps exactly the previous skills of the skipped repos', () => {
    const kept = carryForward(previous, [collection('cached/repo', '2026-08-01T00:00:00Z')]);
    expect(kept.map((s) => s.id)).toEqual(['cached/repo@abc:SKILL.md']);
  });

  it('keeps nothing when nothing was skipped', () => {
    expect(carryForward(previous, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/incremental.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'partitionRepos'`.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/harvest/run.ts`:

```ts
export function pushedAtIndex(previous: CatalogSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  for (const collection of previous.collections) {
    index.set(collection.repo, collection.pushedAt);
  }
  return index;
}

/** A repo whose pushedAt has not moved cannot have new or changed skills (spec §6.1). */
export function partitionRepos(
  fresh: Collection[],
  index: Map<string, string>,
): { crawl: Collection[]; skipped: Collection[] } {
  const crawl: Collection[] = [];
  const skipped: Collection[] = [];

  for (const collection of fresh) {
    const seen = index.get(collection.repo);
    if (seen !== undefined && seen === collection.pushedAt) {
      skipped.push(collection);
    } else {
      crawl.push(collection);
    }
  }

  return { crawl, skipped };
}

export function carryForward(previous: CatalogSnapshot, skipped: Collection[]): Skill[] {
  const repos = new Set(skipped.map((collection) => collection.repo));
  return previous.skills.filter((skill) => repos.has(skill.repo));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harvest/incremental.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/incremental.test.ts
git commit -m "feat(harvest): skip repos whose pushedAt is unchanged"
```

---

### Task A6.9: runHarvest — the pipeline

**Files:**
- Modify: `scripts/harvest/run.ts` (replace the whole import header with the block in Step 3, then append the rest)
- Test: `tests/harvest/run-harvest.test.ts`

**Interfaces:**
- Consumes:
  - `discoverRepos(token, deps?)` from `scripts/harvest/discover.ts` (A4.11)
  - `enumerateSkills(repo, token, deps?)` (A4.20), `fetchTree(repo, token, deps?)` (A4.12), `fetchRawFile(repo, ref, path, deps?)` (A4.17) and `fetchHeadCommit(repo, token, deps?)` (A4.19), all from `scripts/harvest/enumerate.ts`
  - `detectRuntimes(topics)` (A5.6) and `enrichCollections(repos, token)` (A5.3) from `scripts/harvest/enrich.ts`
  - `deriveSafety(files, contents, frontmatter)` (A5.9), `isPortable(frontmatter)` (A5.8) and `scriptFilesFor(tree, skillPath)` (A5.5) from `src/lib/safety.ts`
  - `resolveLicense(input)` (A5.4) and `siblingLicensePath(skillPath, treePaths)` (A6.5 Step 3) from `src/lib/license.ts`
  - `scoreSkill(input)` from `src/lib/score.ts` (A6.1)
  - `loadSkills`, `loadCollections`, `loadMeta`, `loadAssignments` from `src/lib/data.ts` (A6.6)
  - `buildSkill`, `fetchScriptContents`, `writeCatalog`, `writeMeta`, `pushedAtIndex`, `partitionRepos`, `carryForward`, `skillId` from `scripts/harvest/run.ts`
- Produces:
  - `export interface HarvestDeps { discoverRepos(token: string): Promise<RepoRef[]>; enrichCollections(repos: RepoRef[], token: string): Promise<Collection[]>; enumerateSkills(repo: RepoRef, token: string): Promise<RawSkill[]>; fetchTree(repo: string, token: string): Promise<TreeFile[]>; fetchHeadCommit(repo: string, token: string): Promise<string | null>; fetchRawFile(repo: string, ref: string, path: string): Promise<string | null>; fetchScriptContents(repo: string, ref: string, files: TreeFile[]): Promise<Map<string, string>>; deriveSafety(files: TreeFile[], contents: Map<string, string>, frontmatter: Record<string, unknown>): Safety; now(): Date }`
  - `export interface HarvestOptions { token: string; dataDir: string; allowlist?: string[] | null; deps?: Partial<HarvestDeps> }`
  - `export async function runHarvest(options: HarvestOptions): Promise<{ skills: Skill[]; collections: Collection[]; meta: Meta }>`

Two invariants this task exists to hold. **Sibling content is fetched at the repository head
commit, never at `raw.sha`**: `raw.sha` is a valid commit sha (A4.20 guarantees it), but it is
*this SKILL.md's* commit, while `treePaths` came from `git/trees/HEAD` (A4.12) — a `scripts/` file
added after the SKILL.md last changed does not exist at that older commit. And **frontmatter reaches
`deriveSafety`**, so `safety.declaredTools` is populated for the 9% of skills that declare
`allowed-tools` (spec §4.3).

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/run-harvest.test.ts
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Collection, RawSkill, Safety, Skill, TreeFile } from '../../src/types.ts';
import { loadSkills } from '../../src/lib/data.ts';
import { runHarvest, type HarvestDeps } from '../../scripts/harvest/run.ts';

const HEAD_COMMIT = '4c9e1f7a2b3d5e6f7081920a3b4c5d6e7f809102';
const PATH_SHA = 'newsha0000000000000000000000000000000000';
const BLOB_SHA = 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1';

const INERT: Safety = {
  executesCode: false,
  scriptCount: 0,
  languages: [],
  network: false,
  readsEnv: false,
  declaredTools: null,
};

function collection(repo: string, pushedAt: string, stars: number): Collection {
  return { repo, stars, forks: 3, pushedAt, license: 'MIT', topics: ['claude-skills'], isOrg: true, curated: true };
}

function cachedSkill(): Skill {
  return {
    id: 'cached/repo@old:SKILL.md',
    type: 'skill',
    name: 'cached',
    description: 'A skill carried forward untouched from the previous crawl run.',
    descriptionPt: null,
    longPt: null,
    repo: 'cached/repo',
    path: 'SKILL.md',
    sha: 'old',
    updatedDays: 5,
    indexedAt: '2026-08-01T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: INERT,
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    score: 100,
    breakdown: { adoption: 25, maintenance: 30, provenance: 25, completeness: 20, total: 100 },
  };
}

async function seededDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-tools-hub-run-'));
  await writeFile(join(dir, 'skills.json'), `${JSON.stringify([cachedSkill()], null, 2)}\n`, 'utf8');
  await writeFile(
    join(dir, 'collections.json'),
    `${JSON.stringify([collection('cached/repo', '2026-08-01T00:00:00Z', 500)], null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(dir, 'meta.json'),
    `${JSON.stringify({ crawledAt: '2026-08-01T00:00:00.000Z', classifiedAt: '2026-08-10T00:00:00.000Z', skillCount: 1, sourceCount: 1 }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

interface Spy {
  enumerated: string[];
  contentRefs: string[];
  licenseRefs: string[];
  safetyFrontmatter: Array<Record<string, unknown>>;
}

function spy(): Spy {
  return { enumerated: [], contentRefs: [], licenseRefs: [], safetyFrontmatter: [] };
}

const tree: TreeFile[] = [
  { path: 'skills/fresh/SKILL.md', mode: '100644', sha: BLOB_SHA, type: 'blob' },
  { path: 'skills/fresh/LICENSE', mode: '100644', sha: 'lic', type: 'blob' },
  { path: 'skills/fresh/scripts/run.py', mode: '100755', sha: 'b2', type: 'blob' },
];

const raw: RawSkill = {
  repo: 'fresh/repo',
  path: 'skills/fresh/SKILL.md',
  sha: PATH_SHA,
  blobSha: BLOB_SHA,
  frontmatter: {
    name: 'fresh',
    description: 'Scan container images and report vulnerabilities by severity.',
    'allowed-tools': ['Bash'],
  },
  body: '',
  updatedDays: 0,
};

function deps(s: Spy, headSha: string | null = HEAD_COMMIT): Partial<HarvestDeps> {
  return {
    discoverRepos: async () => {
      throw new Error('discovery must not run when an allowlist is supplied');
    },
    enrichCollections: async () => [
      collection('cached/repo', '2026-08-01T00:00:00Z', 500),
      collection('fresh/repo', '2026-08-29T00:00:00Z', 999),
    ],
    enumerateSkills: async (repo) => {
      s.enumerated.push(repo.repo);
      return repo.repo === 'fresh/repo' ? [raw] : [];
    },
    fetchTree: async () => tree,
    fetchHeadCommit: async () => headSha,
    fetchRawFile: async (_repo, ref) => {
      s.licenseRefs.push(ref);
      return 'MIT License\n';
    },
    fetchScriptContents: async (_repo, ref) => {
      s.contentRefs.push(ref);
      return new Map([['skills/fresh/scripts/run.py', 'import os\n']]);
    },
    deriveSafety: (_files, _contents, frontmatter) => {
      s.safetyFrontmatter.push(frontmatter);
      return { ...INERT, executesCode: true, scriptCount: 1, languages: ['python'], declaredTools: ['Bash'] };
    },
    now: () => new Date('2026-08-29T06:37:00.000Z'),
  };
}

describe('runHarvest', () => {
  it('skips unchanged repos, carries their skills forward, and writes both catalog files', async () => {
    const dir = await seededDataDir();
    const s = spy();

    const { skills, collections, meta } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo', 'fresh/repo'],
      deps: deps(s),
    });

    expect(s.enumerated).toEqual(['fresh/repo']);
    expect(skills.map((k) => k.id).sort()).toEqual([
      'cached/repo@old:SKILL.md',
      `fresh/repo@${PATH_SHA}:skills/fresh/SKILL.md`,
    ]);
    expect(collections.map((c) => c.repo)).toEqual(['cached/repo', 'fresh/repo']);
    expect(loadSkills(dir)).toHaveLength(2);
    expect(meta).toEqual({
      crawledAt: '2026-08-29T06:37:00.000Z',
      classifiedAt: '2026-08-10T00:00:00.000Z',
      skillCount: 2,
      sourceCount: 2,
    });
  });

  it('pins every raw fetch to the head COMMIT sha, never to the skill or blob sha', async () => {
    const dir = await seededDataDir();
    const s = spy();
    await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.contentRefs).toEqual([HEAD_COMMIT]);
    expect(s.licenseRefs).toEqual([HEAD_COMMIT]);
    expect(s.contentRefs).not.toContain(PATH_SHA);
    expect(s.contentRefs).not.toContain(BLOB_SHA);
  });

  it('makes no raw request at all when the head commit sha cannot be resolved', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s, null) });

    expect(s.contentRefs).toEqual([]);
    expect(s.licenseRefs).toEqual([]);
    // The entry still lands, with a tree-only safety surface.
    expect(skills.find((k) => k.repo === 'fresh/repo')).toBeDefined();
  });

  it('passes the frontmatter through to deriveSafety so declaredTools is populated (spec §4.3)', async () => {
    const dir = await seededDataDir();
    const s = spy();
    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(s) });

    expect(s.safetyFrontmatter).toHaveLength(1);
    expect(s.safetyFrontmatter[0]!['allowed-tools']).toEqual(['Bash']);

    const fresh = skills.find((k) => k.repo === 'fresh/repo');
    expect(fresh?.safety.declaredTools).toEqual(['Bash']);
    expect(fresh?.securityRelevant).toBe(true);
    expect(fresh?.indexedAt).toBe('2026-08-29T06:37:00.000Z');
  });

  it('sorts by score descending, then by id', async () => {
    const dir = await seededDataDir();
    const { skills } = await runHarvest({
      token: 'tok',
      dataDir: dir,
      allowlist: ['cached/repo', 'fresh/repo'],
      deps: deps(spy()),
    });

    for (let i = 1; i < skills.length; i += 1) {
      expect(skills[i - 1]!.score).toBeGreaterThanOrEqual(skills[i]!.score);
    }
    expect(skills[0]!.id).toBe('cached/repo@old:SKILL.md');
  });

  it('applies data/assignments.json when it is present', async () => {
    const dir = await seededDataDir();
    await writeFile(
      join(dir, 'assignments.json'),
      JSON.stringify({
        [`fresh/repo@${PATH_SHA}:skills/fresh/SKILL.md`]: {
          primary: 'security/containers-kubernetes',
          also: [],
          tags: ['trivy'],
        },
      }),
      'utf8',
    );

    const { skills } = await runHarvest({ token: 'tok', dataDir: dir, allowlist: ['fresh/repo'], deps: deps(spy()) });
    const fresh = skills.find((k) => k.repo === 'fresh/repo');
    expect(fresh?.primary).toBe('security/containers-kubernetes');
    expect(fresh?.tags).toEqual(['trivy']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/run-harvest.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'runHarvest'`.

- [ ] **Step 3: Replace the import header**

**Delete every `import` line currently at the top of `scripts/harvest/run.ts` — the ones Tasks A6.4,
A6.5 and A6.7 added — and paste this block in their place. Do not append.** This is the complete
header for the file as of this task: every identifier the module needs, each listed exactly once,
one import statement per module. Applied literally it cannot double-bind `detectRuntimes` and it
cannot drop `isPortable` or `scoreSkill`.

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  Assignment,
  Collection,
  Meta,
  RawSkill,
  RepoRef,
  Safety,
  Skill,
  TreeFile,
} from '../../src/types.ts';
import { loadAssignments, loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { resolveLicense, siblingLicensePath } from '../../src/lib/license.ts';
import { deriveSafety, isPortable, scriptFilesFor } from '../../src/lib/safety.ts';
import { scoreSkill } from '../../src/lib/score.ts';
import { discoverRepos } from './discover.ts';
import { enumerateSkills, fetchHeadCommit, fetchRawFile, fetchTree, type EnumerateDeps } from './enumerate.ts';
import { detectRuntimes, enrichCollections } from './enrich.ts';
```

- [ ] **Step 4: Write minimal implementation**

Append to `scripts/harvest/run.ts`:

```ts
export interface HarvestDeps {
  discoverRepos(token: string): Promise<RepoRef[]>;
  enrichCollections(repos: RepoRef[], token: string): Promise<Collection[]>;
  enumerateSkills(repo: RepoRef, token: string): Promise<RawSkill[]>;
  fetchTree(repo: string, token: string): Promise<TreeFile[]>;
  fetchHeadCommit(repo: string, token: string): Promise<string | null>;
  fetchRawFile(repo: string, ref: string, path: string): Promise<string | null>;
  fetchScriptContents(repo: string, ref: string, files: TreeFile[]): Promise<Map<string, string>>;
  deriveSafety(files: TreeFile[], contents: Map<string, string>, frontmatter: Record<string, unknown>): Safety;
  now(): Date;
}

export interface HarvestOptions {
  token: string;
  dataDir: string;
  allowlist?: string[] | null;
  deps?: Partial<HarvestDeps>;
}

const DEFAULT_DEPS: HarvestDeps = {
  discoverRepos: (token) => discoverRepos(token),
  enrichCollections,
  enumerateSkills: (repo, token) => enumerateSkills(repo, token),
  fetchTree: (repo, token) => fetchTree(repo, token),
  fetchHeadCommit: (repo, token) => fetchHeadCommit(repo, token),
  fetchRawFile: (repo, ref, path) => fetchRawFile(repo, ref, path),
  fetchScriptContents: (repo, ref, files) => fetchScriptContents(repo, ref, files),
  deriveSafety,
  now: () => new Date(),
};

export async function runHarvest(
  options: HarvestOptions,
): Promise<{ skills: Skill[]; collections: Collection[]; meta: Meta }> {
  const deps: HarvestDeps = { ...DEFAULT_DEPS, ...(options.deps ?? {}) };
  const { token, dataDir } = options;
  const allowlist = options.allowlist ?? null;

  const repos: RepoRef[] =
    allowlist !== null && allowlist.length > 0
      ? allowlist.map((repo) => ({ repo, stars: 0 }))
      : await deps.discoverRepos(token);

  const collections = await deps.enrichCollections(repos, token);

  const previous: CatalogSnapshot = { skills: loadSkills(dataDir), collections: loadCollections(dataDir) };
  const previousMeta = loadMeta(dataDir);
  const assignments = loadAssignments(dataDir);

  const { crawl, skipped } = partitionRepos(collections, pushedAtIndex(previous));
  const skills: Skill[] = carryForward(previous, skipped);
  const indexedAt = deps.now().toISOString();

  for (const collection of crawl) {
    const raws = await deps.enumerateSkills({ repo: collection.repo, stars: collection.stars }, token);
    if (raws.length === 0) continue;

    const tree = await deps.fetchTree(collection.repo, token);
    const treePaths = tree.filter((file) => file.type === 'blob').map((file) => file.path);

    // treePaths came from git/trees/HEAD (A4.12), so the neighbours listed there exist at HEAD,
    // not necessarily at the SKILL.md's own per-path commit. Resolve the head COMMIT sha once
    // per repo with A4.19's fetchHeadCommit and pin every sibling fetch to it.
    const commitSha = await deps.fetchHeadCommit(collection.repo, token);

    for (const raw of raws) {
      const scriptFiles = scriptFilesFor(tree, raw.path);
      const contents =
        commitSha === null
          ? new Map<string, string>()
          : await deps.fetchScriptContents(collection.repo, commitSha, scriptFiles);

      const safety = deps.deriveSafety(scriptFiles, contents, raw.frontmatter);

      const licensePath = siblingLicensePath(raw.path, treePaths);
      const siblingLicenseText =
        licensePath === null || commitSha === null
          ? null
          : await deps.fetchRawFile(collection.repo, commitSha, licensePath);

      skills.push(
        buildSkill({
          raw,
          collection,
          safety,
          treePaths,
          siblingLicenseText,
          assignment: assignments[skillId(raw.repo, raw.sha, raw.path)],
          indexedAt,
        }),
      );
    }
  }

  skills.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  const meta: Meta = {
    crawledAt: indexedAt,
    // Harvest never classifies; the classification PR owns this field (spec §6.1).
    classifiedAt: previousMeta.classifiedAt,
    skillCount: skills.length,
    sourceCount: collections.length,
  };

  await writeCatalog(dataDir, { skills, collections });
  await writeMeta(dataDir, meta);

  return { skills, collections, meta };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/harvest/run-harvest.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 6: Run the whole harvest and lib suite**

Run: `npx vitest run tests/harvest/ tests/lib/`

Expected: PASS — every file green, including A4's and A5's.

- [ ] **Step 7: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/run-harvest.test.ts
git commit -m "feat(harvest): wire discover, enumerate, enrich, safety and score into runHarvest"
```

---

### Task A6.10: Harvest CLI entrypoint

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 3; add the import line shown there)
- Modify: `package.json` (A1 owns this file — an anchored, idempotent one-line insertion into the `"scripts"` object)
- Test: `tests/harvest/cli.test.ts`

**Interfaces:**
- Consumes: `runHarvest(options: HarvestOptions)` from `scripts/harvest/run.ts` (A6.9); `"type": "module"` and `engines.node ">=22.18.0"` from `package.json` (A1.1); the `"typecheck": "tsc --noEmit"` line in the `"scripts"` object (A1.5)
- Produces:
  - `export function parseArgs(argv: string[]): { allowlist: string[] | null; dataDir: string }`
  - `export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number>` — returns the process exit code
  - the npm script `harvest` → `node scripts/harvest/run.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/cli.test.ts
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../scripts/harvest/run.ts';

function runCli(env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['scripts/harvest/run.ts'],
      { cwd: process.cwd(), env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : 0;
        resolve({ code, stdout, stderr });
      },
    );
  });
}

describe('parseArgs', () => {
  it('defaults to a full crawl into data/', () => {
    expect(parseArgs([])).toEqual({ allowlist: null, dataDir: 'data' });
  });

  it('splits a comma-separated allowlist and trims each entry', () => {
    expect(parseArgs(['--allowlist=anthropics/skills, trailofbits/skills'])).toEqual({
      allowlist: ['anthropics/skills', 'trailofbits/skills'],
      dataDir: 'data',
    });
  });

  it('drops empty allowlist entries', () => {
    expect(parseArgs(['--allowlist=a/b,,'])).toEqual({ allowlist: ['a/b'], dataDir: 'data' });
  });

  it('accepts a custom data directory', () => {
    expect(parseArgs(['--data-dir=/tmp/out'])).toEqual({ allowlist: null, dataDir: '/tmp/out' });
  });
});

describe('the CLI fails loudly without a PAT (spec §6.2)', () => {
  it('runs on a Node that strips types without a flag', () => {
    // `node scripts/harvest/run.ts` needs TypeScript type stripping on by default, which Node has
    // since 22.18.0 — exactly the floor package.json declares in engines.node (A1.1). crawl.yml
    // pins Node 24. If this assertion fires, upgrade before reading the next failure.
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    expect(major > 22 || (major === 22 && minor >= 18)).toBe(true);
  });

  it('exits 1 and names CATALOG_PAT', async () => {
    const result = await runCli({ CATALOG_PAT: '' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('CATALOG_PAT');
    expect(result.stderr).toContain('GITHUB_TOKEN');
  }, 30_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/cli.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'parseArgs'`.

- [ ] **Step 3: Write minimal implementation**

Add this import at the top of `scripts/harvest/run.ts`. `node:url` appears in no other import line,
so this is purely additive to the header Task A6.9 installed:

```ts
import { pathToFileURL } from 'node:url';
```

Append to `scripts/harvest/run.ts`:

```ts
export function parseArgs(argv: string[]): { allowlist: string[] | null; dataDir: string } {
  let allowlist: string[] | null = null;
  let dataDir = 'data';

  for (const arg of argv) {
    if (arg.startsWith('--allowlist=')) {
      allowlist = arg
        .slice('--allowlist='.length)
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
    } else if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length);
    }
  }

  return { allowlist, dataDir };
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  const token = env['CATALOG_PAT'] ?? '';
  if (token === '') {
    console.error(
      'CATALOG_PAT is unset or empty. A fine-grained PAT with public-repo read is mandatory: ' +
        'GITHUB_TOKEN is repo-scoped and cannot perform global search (spec §6.2).',
    );
    return 1;
  }

  const { allowlist, dataDir } = parseArgs(argv);
  const { meta } = await runHarvest({ token, dataDir, allowlist });
  console.log(`harvest: ${meta.skillCount} skills from ${meta.sourceCount} sources at ${meta.crawledAt}`);
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2), process.env)
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Add the harvest npm script**

`package.json` belongs to A1, which already sets `"type": "module"` and `engines.node` `>=22.18.0`.
This inserts one line into the `"scripts"` object, anchored on the exact line A1.5 writes, and
rewrites nothing else. It is idempotent.

```bash
grep -q '"harvest": "node scripts/harvest/run.ts"' package.json || \
  sed -i 's|"typecheck": "tsc --noEmit"|"typecheck": "tsc --noEmit",\n    "harvest": "node scripts/harvest/run.ts"|' package.json
node -e '
const pkg = require("./package.json");
if (pkg.type !== "module") throw new Error("package.json must keep \"type\": \"module\" (A1.1)");
if (pkg.engines.node !== ">=22.18.0") throw new Error("engines.node must stay >=22.18.0 (A1.1)");
if (pkg.scripts.harvest !== "node scripts/harvest/run.ts") throw new Error("scripts.harvest was not added");
if (pkg.scripts.typecheck !== "tsc --noEmit") throw new Error("the typecheck anchor is gone");
console.log("scripts.harvest wired");
'
```

Expected output: `scripts.harvest wired`

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/harvest/cli.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 6: Verify the npm script resolves the same way**

```bash
CATALOG_PAT= npm run harvest; echo "exit=$?"
```

Expected: the CATALOG_PAT error on stderr and `exit=1`.

- [ ] **Step 7: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/cli.test.ts package.json
git commit -m "feat(harvest): add the CLI entrypoint and the npm harvest script"
```

---

### Task A6.11: crawl.yml — the nightly self-sustaining crawl

**Files:**
- Create: `.github/workflows/crawl.yml`
- Test: `tests/workflows/crawl.test.ts`

**Interfaces:**
- Consumes: `node scripts/harvest/run.ts [--allowlist=<csv>]` from Task A6.10; the repository secret `CATALOG_PAT`
- Produces: `.github/workflows/crawl.yml` — a nightly `schedule` at `37 6 * * *` plus `workflow_dispatch`, committing `data/skills.json`, `data/collections.json` and `data/meta.json`

**Operational prerequisite — not a step in this task.** The workflow cannot run until the secret
exists: create a fine-grained PAT with **Public repositories (read-only)** access and a 1-year
expiry, then `gh secret set CATALOG_PAT` and confirm with `gh secret list`. Set a calendar reminder
11 months out; PAT expiry silently kills the refresh cron (spec §6.2, §13). This is repository
provisioning, has no red/green cycle, and blocks nothing below — every step here is testable
offline.

- [ ] **Step 1: Write the failing test**

```ts
// tests/workflows/crawl.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const yml = readFileSync('.github/workflows/crawl.yml', 'utf8');

describe('crawl.yml schedule hygiene (spec §6.5)', () => {
  it('contains no tab characters', () => {
    expect(yml).not.toMatch(/\t/);
  });

  it('runs off the hour, in an off-peak UTC window', () => {
    const match = yml.match(/cron:\s*'(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*'/);
    expect(match).not.toBeNull();
    const minute = Number(match![1]);
    const hour = Number(match![2]);
    expect(minute).toBeGreaterThan(0);
    expect(minute).toBeLessThan(60);
    expect(hour).toBeGreaterThanOrEqual(3);
    expect(hour).toBeLessThanOrEqual(9);
  });

  it('always offers the manual escape hatch', () => {
    expect(yml).toContain('workflow_dispatch:');
  });
});

describe('crawl.yml authentication (spec §6.2)', () => {
  it('passes the PAT, never GITHUB_TOKEN, as CATALOG_PAT', () => {
    expect(yml).toContain('CATALOG_PAT: ${{ secrets.CATALOG_PAT }}');
    expect(yml).not.toContain('CATALOG_PAT: ${{ secrets.GITHUB_TOKEN }}');
  });

  it('fails loudly when the PAT is missing or expired', () => {
    expect(yml).toContain('::error::');
    expect(yml).toContain('exit 1');
  });
});

describe('crawl.yml keeps its own schedule alive (spec §6.5)', () => {
  it('commits and pushes all three refreshed data files', () => {
    expect(yml).toContain('git add data/skills.json data/collections.json data/meta.json');
    expect(yml).toContain('--allow-empty');
    expect(yml).toContain('git push');
  });

  it('grants the write permission the commit needs', () => {
    expect(yml).toContain('contents: write');
  });

  it('opens an issue when the crawl fails', () => {
    expect(yml).toContain('if: failure()');
    expect(yml).toContain('gh issue create');
    expect(yml).toContain('issues: write');
  });
});

describe('crawl.yml pins its actions and never injects inputs into a shell', () => {
  it('pins checkout and setup-node, on a Node that strips types by default', () => {
    expect(yml).toContain('actions/checkout@v5');
    expect(yml).toContain('actions/setup-node@v5');
    expect(yml).toContain("node-version: '24'");
  });

  it('routes every workflow input through an environment variable', () => {
    for (const line of yml.split('\n')) {
      if (line.includes('${{ inputs.')) {
        expect(line.trim()).toMatch(/^[A-Z_]+:\s*\$\{\{\s*inputs\.[a-z_]+\s*\}\}$/);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/workflows/crawl.test.ts`

Expected: FAIL — `ENOENT: no such file or directory, open '.github/workflows/crawl.yml'`. `readFileSync` throws while the file is being collected, so all 10 tests error rather than fail individually.

- [ ] **Step 3: Write minimal implementation**

```yaml
# .github/workflows/crawl.yml
name: crawl

on:
  schedule:
    # 06:37 UTC. Off the hour on purpose: schedule events at :00 are dropped under
    # load, and the nightly commit below is itself the repository activity that keeps
    # this schedule from being auto-disabled after 60 days (spec §6.5).
    - cron: '37 6 * * *'
  workflow_dispatch:
    inputs:
      allowlist:
        description: 'Comma-separated owner/repo list. Leave empty for a full discovery crawl.'
        required: false
        default: ''

permissions:
  contents: write
  issues: write

concurrency:
  group: crawl
  cancel-in-progress: false

jobs:
  harvest:
    runs-on: ubuntu-latest
    timeout-minutes: 50
    steps:
      - name: Check out the repository
        uses: actions/checkout@v5

      - name: Set up Node
        uses: actions/setup-node@v5
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run the harvest
        env:
          # GITHUB_TOKEN is repo-scoped and cannot perform global search (spec §6.2).
          CATALOG_PAT: ${{ secrets.CATALOG_PAT }}
          ALLOWLIST: ${{ inputs.allowlist }}
        run: |
          if [ -z "$CATALOG_PAT" ]; then
            echo "::error::CATALOG_PAT is unset or expired. A fine-grained PAT with public-repo read is mandatory; GITHUB_TOKEN cannot perform global search."
            exit 1
          fi
          if [ -n "$ALLOWLIST" ]; then
            node scripts/harvest/run.ts --allowlist="$ALLOWLIST"
          else
            node scripts/harvest/run.ts
          fi

      - name: Commit the refreshed catalog
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/skills.json data/collections.json data/meta.json
          git commit --allow-empty -m "chore(crawl): refresh catalog data $(date -u +%Y-%m-%dT%H:%MZ)"
          git pull --rebase --autostash origin "$GITHUB_REF_NAME"
          git push origin "HEAD:$GITHUB_REF_NAME"

      - name: Open a P1 issue when the crawl fails
        if: failure()
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          gh issue create \
            --title "P1: nightly crawl failed on $(date -u +%Y-%m-%d)" \
            --body "The nightly harvest failed. A silent crawler is a P1 bug, not a maintenance chore (spec §13). Run: $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/workflows/crawl.test.ts`

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/crawl.yml tests/workflows/crawl.test.ts
git commit -m "ci(crawl): add the nightly self-sustaining harvest workflow"
```

---

### Task A6.12: Catalog invariants, and a real three-repo harvest

**Files:**
- Modify: `scripts/harvest/run.ts` (append the block in Step 3)
- Modify: `data/skills.json` (replaced by the real harvest output in Step 5)
- Modify: `data/collections.json` (replaced by the real harvest output in Step 5)
- Modify: `data/meta.json` (replaced by the real harvest output in Step 5)
- Test: `tests/harvest/catalog-shape.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Meta`, `ScoreBreakdown`, `Skill` from `src/types.ts` (A1.6); `loadCollections`, `loadMeta`, `loadSkills` from `src/lib/data.ts` (A6.6); the `harvest` npm script from Task A6.10
- Produces:
  - `export interface CatalogProblem { id: string; problem: string }`
  - `export function validateCatalog(skills: Skill[], collections: Collection[], meta: Meta): CatalogProblem[]` — empty means the committed data is internally consistent

The committed test asserts **invariants**, never upstream facts. It says nothing about how many
repos there are or what they are called, so a legitimate change upstream can never turn it red;
only a broken pipeline can. The three-repo run in Steps 5–7 is a one-off proof, and each repo
proves something different:

| Repo | Proves |
|---|---|
| `anthropics/skills` | the license chain — repo `license: null` while shipping per-skill Apache-2.0 files (spec §4.3) |
| `trailofbits/skills` | per-path score separation — several skills, one repo, one star count (spec §5) |
| `heilcheng/awesome-agent-skills` | the phantom-catalog guard — an abandoned awesome-list contributes 0 skills (spec §6.3) |

- [ ] **Step 1: Write the failing test**

```ts
// tests/harvest/catalog-shape.test.ts
import { describe, expect, it } from 'vitest';
import type { Collection, Meta, Skill } from '../../src/types.ts';
import { loadCollections, loadMeta, loadSkills } from '../../src/lib/data.ts';
import { validateCatalog } from '../../scripts/harvest/run.ts';

const collection: Collection = {
  repo: 'a/b',
  stars: 10,
  forks: 0,
  pushedAt: '2026-08-01T00:00:00Z',
  license: 'MIT',
  topics: [],
  isOrg: false,
  curated: false,
};

function skill(overrides: Partial<Skill> = {}): Skill {
  const base: Skill = {
    id: 'a/b@abc1234:SKILL.md',
    type: 'skill',
    name: 'x',
    description: 'A description long enough to clear the forty-character threshold.',
    descriptionPt: null,
    longPt: null,
    repo: 'a/b',
    path: 'SKILL.md',
    sha: 'abc1234',
    updatedDays: 1,
    indexedAt: '2026-08-29T00:00:00.000Z',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['generic'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    primary: 'vertical-domain/general',
    also: [],
    tags: [],
    securityRelevant: false,
    score: 65,
    breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 65 },
  };
  return { ...base, ...overrides };
}

function meta(overrides: Partial<Meta> = {}): Meta {
  return { crawledAt: '2026-08-29T00:00:00.000Z', classifiedAt: null, skillCount: 1, sourceCount: 1, ...overrides };
}

describe('validateCatalog accepts a consistent catalog', () => {
  it('reports no problems for one good entry', () => {
    expect(validateCatalog([skill()], [collection], meta())).toEqual([]);
  });

  it('reports no problems for an empty catalog', () => {
    expect(validateCatalog([], [], meta({ skillCount: 0, sourceCount: 0 }))).toEqual([]);
  });
});

describe('validateCatalog catches every way the pipeline can lie', () => {
  function problems(skills: Skill[], collections: Collection[], m: Meta): string[] {
    return validateCatalog(skills, collections, m).map((p) => p.problem);
  }

  it('catches a duplicate id', () => {
    const m = meta({ skillCount: 2 });
    expect(problems([skill(), skill()], [collection], m)).toContain('duplicate id');
  });

  it('catches an id that does not re-derive from repo, sha and path', () => {
    expect(problems([skill({ id: 'a/b@wrong:SKILL.md' })], [collection], meta())).toContain(
      'id is not repo@sha:path',
    );
  });

  it('catches a breakdown that does not sum, and a score that disagrees with it', () => {
    const bad = skill({ breakdown: { adoption: 10, maintenance: 30, provenance: 5, completeness: 20, total: 99 } });
    expect(problems([bad], [collection], meta())).toContain('breakdown does not sum to total');
    expect(problems([skill({ score: 1 })], [collection], meta())).toContain('score does not equal breakdown.total');
  });

  it('catches a component over its cap', () => {
    const bad = skill({
      score: 96,
      breakdown: { adoption: 41, maintenance: 30, provenance: 5, completeness: 20, total: 96 },
    });
    expect(problems([bad], [collection], meta())).toContain('adoption outside 0..25');
  });

  it('catches a license without a source, and a source without a license', () => {
    expect(problems([skill({ licenseSource: null })], [collection], meta())).toContain(
      'license set but licenseSource is null',
    );
    expect(problems([skill({ license: null })], [collection], meta())).toContain(
      'licenseSource set but license is null',
    );
  });

  it('catches an over-full also list, an over-full tag list and an empty runtime list', () => {
    const bad = skill({ also: ['a/x', 'a/y', 'a/z'], tags: Array.from({ length: 11 }, (_u, i) => `t${i}`), runtimes: [] });
    const found = problems([bad], [collection], meta());
    expect(found).toContain('more than 2 also entries');
    expect(found).toContain('more than 10 tags');
    expect(found).toContain('no runtimes');
  });

  it('catches an entry whose repo has no collection row', () => {
    expect(problems([skill()], [], meta({ sourceCount: 0 }))).toContain('repo has no collection row');
  });

  it('catches an out-of-order catalog', () => {
    const low = skill({ id: 'a/b@abc1234:low/SKILL.md', path: 'low/SKILL.md', score: 5, breakdown: { adoption: 5, maintenance: 0, provenance: 0, completeness: 0, total: 5 } });
    expect(problems([low, skill()], [collection], meta({ skillCount: 2 }))).toContain('not sorted by score descending');
  });

  it('catches meta counts and a non-ISO crawl date', () => {
    const found = problems([skill()], [collection], meta({ skillCount: 9, sourceCount: 9, crawledAt: 'last tuesday' }));
    expect(found).toContain('meta.skillCount does not match the catalog');
    expect(found).toContain('meta.sourceCount does not match the catalog');
    expect(found).toContain('meta.crawledAt is not an ISO timestamp');
  });
});

describe('the committed data files are internally consistent', () => {
  it('produces no problems, whatever the last crawl found', () => {
    expect(validateCatalog(loadSkills(), loadCollections(), loadMeta())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/harvest/catalog-shape.test.ts`

Expected: FAIL — the module loads but the symbol is missing: `does not provide an export named 'validateCatalog'`.

- [ ] **Step 3: Write minimal implementation**

Replace the `src/types.ts` type-import block at the top of `scripts/harvest/run.ts` with exactly:

```ts
import type {
  Assignment,
  Collection,
  Meta,
  RawSkill,
  RepoRef,
  Safety,
  ScoreBreakdown,
  Skill,
  TreeFile,
} from '../../src/types.ts';
```

Append to `scripts/harvest/run.ts`:

```ts
export interface CatalogProblem {
  id: string;
  problem: string;
}

const COMPONENT_CAPS: ReadonlyArray<readonly [keyof ScoreBreakdown, number]> = [
  ['adoption', 25],
  ['maintenance', 30],
  ['provenance', 25],
  ['completeness', 20],
];

/**
 * Every invariant the published catalog claims, checked against itself. Deliberately says nothing
 * about which repos exist or how many: upstream changing is normal, the pipeline lying is not.
 */
export function validateCatalog(skills: Skill[], collections: Collection[], meta: Meta): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const add = (id: string, problem: string): void => {
    problems.push({ id, problem });
  };

  const seenIds = new Set<string>();
  const repos = new Set(collections.map((collection) => collection.repo));

  for (const skill of skills) {
    if (seenIds.has(skill.id)) add(skill.id, 'duplicate id');
    seenIds.add(skill.id);

    if (skill.id !== skillId(skill.repo, skill.sha, skill.path)) add(skill.id, 'id is not repo@sha:path');
    if (!repos.has(skill.repo)) add(skill.id, 'repo has no collection row');

    const b = skill.breakdown;
    for (const [component, cap] of COMPONENT_CAPS) {
      const value = b[component];
      if (!Number.isFinite(value) || value < 0 || value > cap) add(skill.id, `${component} outside 0..${cap}`);
    }
    if (b.adoption + b.maintenance + b.provenance + b.completeness !== b.total) {
      add(skill.id, 'breakdown does not sum to total');
    }
    if (skill.score !== b.total) add(skill.id, 'score does not equal breakdown.total');

    if (skill.license !== null && skill.licenseSource === null) add(skill.id, 'license set but licenseSource is null');
    if (skill.license === null && skill.licenseSource !== null) add(skill.id, 'licenseSource set but license is null');

    if (skill.runtimes.length === 0) add(skill.id, 'no runtimes');
    if (skill.also.length > 2) add(skill.id, 'more than 2 also entries');
    if (skill.tags.length > 10) add(skill.id, 'more than 10 tags');

    const safety = skill.safety;
    if (
      typeof safety.executesCode !== 'boolean' ||
      typeof safety.scriptCount !== 'number' ||
      !Array.isArray(safety.languages) ||
      typeof safety.network !== 'boolean' ||
      typeof safety.readsEnv !== 'boolean' ||
      (safety.declaredTools !== null && !Array.isArray(safety.declaredTools))
    ) {
      add(skill.id, 'incomplete safety surface');
    }
  }

  for (let i = 1; i < skills.length; i += 1) {
    const previous = skills[i - 1]!;
    const current = skills[i]!;
    if (previous.score < current.score) add(current.id, 'not sorted by score descending');
    else if (previous.score === current.score && previous.id.localeCompare(current.id) > 0) {
      add(current.id, 'ties not sorted by id');
    }
  }

  if (meta.skillCount !== skills.length) add('meta', 'meta.skillCount does not match the catalog');
  if (meta.sourceCount !== collections.length) add('meta', 'meta.sourceCount does not match the catalog');

  const crawled = new Date(meta.crawledAt);
  if (Number.isNaN(crawled.getTime()) || crawled.toISOString() !== meta.crawledAt) {
    add('meta', 'meta.crawledAt is not an ISO timestamp');
  }

  return problems;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/harvest/catalog-shape.test.ts`

Expected: PASS — 12 tests. The last one passes over the empty seed committed in Task A6.6, and will
keep passing over real data.

- [ ] **Step 5: Run the harvest for real against the three-repo allowlist**

The allowlist path skips discovery entirely, so a repo-scoped token is enough for this proof run.
Production still needs the PAT.

```bash
CATALOG_PAT="$(gh auth token)" npm run harvest -- \
  --allowlist=anthropics/skills,trailofbits/skills,heilcheng/awesome-agent-skills
```

Expected: one summary line on stdout of the form
`harvest: <n> skills from 3 sources at <ISO timestamp>`, with `<n>` in the tens. The exact count
tracks upstream and is not asserted anywhere.

- [ ] **Step 6: Read the three things this run exists to prove**

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const skills = JSON.parse(readFileSync("data/skills.json", "utf8"));
const collections = JSON.parse(readFileSync("data/collections.json", "utf8"));

console.log("collections:", collections.length, "skills:", skills.length);
for (const c of collections) {
  const count = skills.filter((s) => s.repo === c.repo).length;
  console.log(`  ${c.repo}  stars=${c.stars} repoLicense=${c.license} org=${c.isOrg} skills=${count}`);
}

const anth = skills.filter((s) => s.repo === "anthropics/skills");
console.log("1. license chain:", [...new Set(anth.map((s) => s.licenseSource))]);

const tob = skills.filter((s) => s.repo === "trailofbits/skills");
console.log("2. per-path separation: adoption", [...new Set(tob.map((s) => s.breakdown.adoption))],
            "totals", tob.map((s) => s.score).sort((a, b) => b - a));

console.log("3. phantom catalog:", collections.filter((c) => skills.every((s) => s.repo !== c.repo)).map((c) => c.repo));
console.log("meta:", readFileSync("data/meta.json", "utf8").trim());
'
```

Expected, and worth reading rather than skimming:
1. **License chain** — `anthropics/skills` has `repoLicense=null` in `collections`, yet its entries
   report `licenseSource` `sibling` (some may report `frontmatter`). If this prints `[null]`, the
   sibling fetch is broken.
2. **Per-path separation** — the `trailofbits/skills` entries share **one** adoption value but their
   totals differ. If every total is identical, ranking has collapsed back to repo-level signals.
3. **Phantom catalog** — `heilcheng/awesome-agent-skills` is listed as the repo with zero skills. It
   contributes provenance and nothing else, exactly as intended.

- [ ] **Step 7: Re-run the harvest to prove the incremental skip**

```bash
CATALOG_PAT="$(gh auth token)" npm run harvest -- \
  --allowlist=anthropics/skills,trailofbits/skills,heilcheng/awesome-agent-skills
git diff --stat data/
```

Expected: the same skill count, and `git diff --stat data/` lists **only** `data/meta.json` (a new
`crawledAt`). No repo's `pushedAt` moved between the two runs, so every repo was skipped and every
skill was carried forward untouched.

- [ ] **Step 8: Run the invariants over the real data**

Run: `npx vitest run tests/harvest/catalog-shape.test.ts`

Expected: PASS — 12 tests, now including real entries in the last one.

- [ ] **Step 9: Run the full suite**

Run: `npm test`

Expected: PASS — every file green. The Astro build runs once, in the `globalSetup` A1 declares in
`vitest.config.ts`; nothing in this section builds or reads `dist/`.

- [ ] **Step 10: Commit**

```bash
git add scripts/harvest/run.ts tests/harvest/catalog-shape.test.ts data/skills.json data/collections.json data/meta.json
git commit -m "feat(data): add catalog invariants and seed from a real three-repo harvest"
```

---
