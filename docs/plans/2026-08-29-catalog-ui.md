# Catalog UI — Implementation Plan

> **Execution:** Implement task-by-task, in order. Every task ends with a passing test and a commit, so the plan can be stopped and resumed at any task boundary. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the bilingual browsing interface over the harvested data — a home that goes straight to the taxonomy, a faceted catalog whose first filter is risk, cards that expand in place while also existing as shareable static pages, and a staleness banner that reports crawl and classification rot separately.

**Architecture:** Static pages generated per locale, per taxonomy node and per skill, with Pagefind providing faceted browse over a flat filter index and MiniSearch providing the typo rescue Pagefind lacks. No runtime API calls: star counts are baked at build time. Card expansion and the per-skill static page render the same data from the same source, so a click expands instantly and a shared link still opens a real page.

**Tech Stack:** Astro 7.2.9 · Pagefind 1.5.2 via `astro-pagefind` 2.0.1 · MiniSearch 7.2.0 · Tailwind CSS 4.3.3 · Vitest 3.

**Spec:** `docs/specs/2026-08-29-ai-tools-hub-design.md`
**Depends on:** `docs/plans/2026-08-29-foundation-and-data.md` (all tasks complete)

## Global Constraints

- **Base path is `/ai-tools-hub/`**, and **Pagefind has its own independent path config** (`bundle-path`, `baseUrl`). If the two disagree the search bundle 404s silently while the page still renders (spec §11.2).
- **The taxonomy is encoded as flat parallel filter keys** (`domain`, `subdomain`, `runtime`, `risk`, `license`) via `data-pagefind-filter`. Nesting is enforced in the UI, never in the index — cheap now, expensive after 1,000 entries are tagged.
- **Facet rail order is Risk → Subdomain → Runtime → License.** Risk leads deliberately: *"hide anything that executes code"* is the query no other catalog can answer.
- **`--color-hazard` is reserved exclusively for the safety module** and stale dates. Nothing else on the site may use it (spec §9.2).
- **Never render a green "safe" badge.** With 36.8% of audited skills carrying a flaw, a wrong green badge is a real liability. Safety rows are descriptive only (spec §4.3).
- **No license chip in a card's primary row** — it resolves to unknown often enough that a frequently-empty chip trains users to ignore chips (spec §10.3).
- **Sort tabs, not a dropdown; numbered pagination, not infinite scroll.** Each is a distinct crawlable URL (spec §10.2).
- **There is no editorial override.** Order is the composite score alone; when the ranking is wrong, fix the formula, not the result (spec §5).
- **WCAG 2.2:** facet rows and chips need ≥24×24 CSS px hit areas (2.5.8); the sticky header needs `scroll-margin-top` equal to its height (2.4.11); the search box is a real ARIA combobox; result counts are `aria-live="polite"` on a ~300 ms debounce (spec §10.5).
- **Both locales must have identical i18n key sets.** A missing key is a silent English leak in production.
- **Three honest node states on the home:** active (≥ minimum mass 5), thin (dimmed, not clickable), empty (em-dash). Governance made visible, not decoration (spec §10.1).

---


## Section B1 — chrome, i18n and the site root

**Files this section creates, and no other section may create:**
`src/lib/i18n/core.ts` · `src/lib/i18n/index.ts` · `src/lib/format.ts` ·
`src/components/Layout.astro` · `src/pages/index.astro`

**What B1 deliberately does not create:** `src/pages/[lang]/index.astro` (B2),
`src/components/SkillCard.astro` / `SafetyStrip.astro` / `src/lib/slug.ts` (B4),
`src/pages/[lang]/catalog.astro` / `src/components/SearchBox.astro` / `src/lib/facets.ts` (B3),
`src/components/StalenessBanner.astro` / `src/pages/[lang]/methodology.astro` (B5),
`src/lib/data.ts` (A6), `src/styles/theme.css` (A2), `src/types.ts` / `src/lib/link.ts` /
`vitest.config.ts` (A1). B1 reads no data file — every `Skill`, `Collection`, `Meta` and
`Assignments` read in Plan 2 goes through A6's loaders, never through B1.

**Anchors B1 publishes for later sections** (exact, unique lines in `src/components/Layout.astro`
after Task B1.7):

| Anchor line | Who modifies it | Why |
|---|---|---|
| `    <slot name="head" />` | B3, B5 | per-page `<head>` additions (Pagefind bundle path, per-route metadata) |

The footer is **not** an anchor: it ships complete from Task B1.5 with both persistent links
(catalog and `/{lang}/methodology/`, spec §10.6 / RULE 8), so no later section inserts into it and
no later section re-imports `withBase` into this file.

**i18n ownership.** `src/lib/i18n/index.ts` merges every sibling namespace file automatically
through `import.meta.glob`. A section adds strings by **creating its own namespace file** —
`home.ts` (B2), `catalog.ts` (B3), `skill.ts` (B4), `search.ts` and `methodology.ts` (B5) — and
never edits `index.ts` or another section's file. `core.ts` holds the 19 strings shared across
surfaces: the chrome `Layout.astro` itself renders, plus the site identity a second surface prints —
`site.thesis` and `site.support`, which the locale home (B2) shows and which the document title is
built from, and `nav.methodology`, which the footer here and the methodology route (B5) both label.
Those three are shared identity, not home-page copy, so they are single-sourced here rather than in
`home.ts`. Defining a key another namespace already defines is not a convention here:
`mergeNamespaces()` throws and the build fails.

---


### Task B1.1: i18n directory — locale constants, namespace merge, and the two guards

**Files:**
- Create: `src/lib/i18n/core.ts`
- Create: `src/lib/i18n/index.ts`
- Test: `tests/lib/i18n.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` — `export type Lang = 'en' | 'pt';` (A1)
- Produces: from `src/lib/i18n/index.ts` — `LANGS: readonly Lang[]`, `DEFAULT_LANG: Lang`,
  `LANG_STORAGE_KEY: string`, `isLang(value: unknown): value is Lang`,
  `t(key: string, lang: Lang): string`, `UI: Record<Lang, Record<string, string>>`,
  `NAMESPACES: Record<string, Namespace>`, `KEY_OWNERS: Record<string, string>`,
  `mergeNamespaces(namespaces: Record<string, Namespace>): MergedStrings`,
  `type Namespace = Record<Lang, Record<string, string>>`, and a re-export of `type Lang`;
  from `src/lib/i18n/core.ts` — a default export `{ en, pt }` with identical key sets, holding the
  19 shared strings including `site.thesis`, `site.support` and `nav.methodology`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANG,
  KEY_OWNERS,
  LANGS,
  LANG_STORAGE_KEY,
  NAMESPACES,
  UI,
  isLang,
  mergeNamespaces,
  t,
} from '../../src/lib/i18n/index.ts';

describe('locale constants', () => {
  it('exposes exactly the two routed locales', () => {
    expect([...LANGS]).toEqual(['en', 'pt']);
    expect(DEFAULT_LANG).toBe('en');
    expect(LANG_STORAGE_KEY).toBe('aith:lang');
  });

  it('accepts routed locales and rejects everything else', () => {
    expect(isLang('en')).toBe(true);
    expect(isLang('pt')).toBe(true);
    expect(isLang('pt-BR')).toBe(false);
    expect(isLang(undefined)).toBe(false);
  });
});

describe('namespace merge', () => {
  it('picks up every namespace file in src/lib/i18n/, and never itself', () => {
    expect(Object.keys(NAMESPACES)).toContain('core');
    expect(Object.keys(NAMESPACES)).not.toContain('index');
  });

  it('gives every namespace identical key sets in both locales', () => {
    for (const [name, namespace] of Object.entries(NAMESPACES)) {
      expect(Object.keys(namespace.pt).sort(), `${name}.ts pt keys`).toEqual(
        Object.keys(namespace.en).sort(),
      );
    }
  });

  it('never ships an empty string', () => {
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(UI[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('refuses a key two namespaces both define', () => {
    expect(() =>
      mergeNamespaces({
        core: { en: { 'nav.home': 'Home' }, pt: { 'nav.home': 'Início' } },
        catalog: { en: { 'nav.home': 'Start' }, pt: { 'nav.home': 'Começo' } },
      }),
    ).toThrowError('i18n key "nav.home" is defined by both catalog.ts and core.ts');
  });

  it('records exactly one owner per key', () => {
    expect(KEY_OWNERS['site.name']).toBe('core');
    expect(KEY_OWNERS['nav.catalog']).toBe('core');
  });
});

describe('t()', () => {
  it('returns the string for the requested locale', () => {
    expect(t('nav.catalog', 'en')).toBe('Catalog');
    expect(t('nav.catalog', 'pt')).toBe('Catálogo');
    expect(t('nav.methodology', 'en')).toBe('Methodology');
    expect(t('nav.methodology', 'pt')).toBe('Metodologia');
    expect(t('nav.skipToResults', 'pt')).toBe('Ir para os resultados');
    // The thesis and its supporting sentence are hand-written per locale, never shared.
    expect(t('site.thesis', 'pt')).not.toBe(t('site.thesis', 'en'));
    expect(t('site.support', 'pt')).not.toBe(t('site.support', 'en'));
  });

  it('returns the key itself when it is unknown, so a leak is visible', () => {
    expect(t('nav.nothing', 'pt')).toBe('nav.nothing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/i18n.test.ts`

Expected: FAIL — the module does not exist yet, so Vitest reports
`Error: Failed to load url ../../src/lib/i18n/index.ts` and the whole file errors out before any
test runs.

- [ ] **Step 3: Write the chrome namespace**

Create `src/lib/i18n/core.ts`:

```ts
import type { Lang } from '../../types.ts';

/**
 * Shared identity and layout chrome: the thesis, the header, navigation, the language switcher,
 * the theme control, the footer and the root language gateway. Strings only one surface prints
 * belong to that section's own namespace file in this directory — restating one here is a build
 * error.
 */
const en = {
  'site.name': 'AI Tools Hub',
  'site.thesis': 'A small, deep, auditable catalog of agent skills.',
  'site.support':
    'Every entry shows what it can do to your machine, where it came from, and why it is filed where it is.',
  'nav.label': 'Main navigation',
  'nav.home': 'Home',
  'nav.catalog': 'Catalog',
  'nav.methodology': 'Methodology',
  'nav.skipToResults': 'Skip to results',
  'lang.label': 'Language',
  'lang.en': 'English',
  'lang.pt': 'Portuguese (Brazil)',
  'theme.label': 'Theme',
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',
  'footer.label': 'Footer navigation',
  'footer.note': 'Every entry links to the source file it was read from.',
  'gateway.heading': 'Choose your language',
  'gateway.body': 'You are being sent to the English site. Portuguese is one click away.',
} as const;

/** The annotation makes a missing or extra Portuguese key a compile error. */
const pt: Record<keyof typeof en, string> = {
  'site.name': 'AI Tools Hub',
  'site.thesis': 'Um catálogo pequeno, profundo e auditável de skills de agentes.',
  'site.support':
    'Cada entrada mostra o que pode fazer na sua máquina, de onde veio e por que está classificada onde está.',
  'nav.label': 'Navegação principal',
  'nav.home': 'Início',
  'nav.catalog': 'Catálogo',
  'nav.methodology': 'Metodologia',
  'nav.skipToResults': 'Ir para os resultados',
  'lang.label': 'Idioma',
  'lang.en': 'Inglês',
  'lang.pt': 'Português (Brasil)',
  'theme.label': 'Tema',
  'theme.system': 'Sistema',
  'theme.light': 'Claro',
  'theme.dark': 'Escuro',
  'footer.label': 'Navegação do rodapé',
  'footer.note': 'Cada entrada aponta para o arquivo de origem de onde foi lida.',
  'gateway.heading': 'Escolha seu idioma',
  'gateway.body': 'Você está sendo levado ao site em inglês. O português fica a um clique.',
};

const core: Record<Lang, Record<string, string>> = { en, pt };

export default core;
```

`'site.name'` is identical in both locales on purpose — it is a proper noun, the same rule §3.5
applies to the `PROTECTED` taxonomy terms. `nav.skipToResults` uses *Ir para os resultados* so it
agrees verbatim with B5's `search.skipToResults`; a reader must not meet two different Portuguese
phrases for the same control.

Three of the 19 keys are printed by a surface B1 does not own, and belong here anyway.
`site.thesis` and `site.support` are the spec's §10.1 opener; B2's locale home renders them and
builds its `<title>` from the thesis, so they are the site's identity, not home-page copy — putting
them in `home.ts` would mean the day a second surface quotes the thesis it would have to restate it,
which `mergeNamespaces()` refuses. `nav.methodology` labels the persistent footer link this section
renders (Task B1.5) *and* B5's `/{lang}/methodology/` route: one label, two renderers, one owner.
Both Portuguese sentences are hand-written editorial text, never machine-translated (spec §8).

- [ ] **Step 4: Write the merging barrel**

Create `src/lib/i18n/index.ts`:

```ts
import type { Lang } from '../../types.ts';

export type { Lang };

/** Every locale the site routes, in menu order. */
export const LANGS: readonly Lang[] = ['en', 'pt'];
export const DEFAULT_LANG: Lang = 'en';
/** localStorage key holding the visitor's last explicit language choice. */
export const LANG_STORAGE_KEY = 'aith:lang';

export function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'pt';
}

/** One namespace file: the same key set under every locale. */
export type Namespace = Record<Lang, Record<string, string>>;

export interface MergedStrings {
  tables: Record<Lang, Record<string, string>>;
  /** key -> the namespace that defines it, so a collision can name both sides. */
  owners: Record<string, string>;
}

/**
 * Merges namespaces into one table per locale, refusing a key two namespaces both define.
 * Namespaces are visited in sorted order so the error names the same two files every run.
 */
export function mergeNamespaces(namespaces: Record<string, Namespace>): MergedStrings {
  const tables: Record<Lang, Record<string, string>> = { en: {}, pt: {} };
  const owners: Record<string, string> = {};
  for (const name of Object.keys(namespaces).sort()) {
    const namespace = namespaces[name];
    for (const lang of LANGS) {
      for (const [key, value] of Object.entries(namespace[lang] ?? {})) {
        const owner = owners[key];
        if (owner !== undefined && owner !== name) {
          throw new Error(`i18n key "${key}" is defined by both ${owner}.ts and ${name}.ts`);
        }
        owners[key] = name;
        tables[lang][key] = value;
      }
    }
  }
  return { tables, owners };
}

/**
 * Every sibling namespace file, eagerly, index.ts excluded. A section adds strings by creating
 * its own file in this directory — it never edits this one, so no two sections share a file.
 */
const modules = import.meta.glob(['./*.ts', '!./index.ts'], { eager: true }) as Record<
  string,
  { default?: Namespace }
>;

export const NAMESPACES: Record<string, Namespace> = {};
for (const [file, module] of Object.entries(modules)) {
  const table = module.default;
  if (!table) {
    throw new Error(`i18n namespace ${file} must default-export { en, pt }`);
  }
  NAMESPACES[file.slice('./'.length, -'.ts'.length)] = table;
}

const merged = mergeNamespaces(NAMESPACES);

export const UI: Record<Lang, Record<string, string>> = merged.tables;
export const KEY_OWNERS: Record<string, string> = merged.owners;

/** Looks up a UI string. Missing keys fall back to English, then to the key itself. */
export function t(key: string, lang: Lang): string {
  const table = UI[lang] ?? UI[DEFAULT_LANG];
  return table[key] ?? UI[DEFAULT_LANG][key] ?? key;
}
```

Two guards, deliberately both: the `Record<keyof typeof en, string>` annotation in each namespace
file catches a missing translation at `tsc` time, and the runtime parity test in Step 1 catches it
for anyone editing without a type-checking editor — a missing key is a silent English leak in
production. The collision throw is what makes RULE 3 mechanical: a section that restates another
section's string breaks the build instead of quietly winning the merge.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/lib/i18n.test.ts && npm run typecheck`

Expected: PASS — 9 tests green, `tsc --noEmit` prints nothing.

- [ ] **Step 6: Commit**

```bash
git add src/lib/i18n/core.ts src/lib/i18n/index.ts tests/lib/i18n.test.ts
git commit -m "feat(i18n): namespace directory with EN/pt-BR parity and collision guards"
```

---

### Task B1.2: Locale path helpers — `localePath()` and `pathBelowLocale()`

The language switcher must offer *this page* in the other locale, not the home page, and the
canonical link must name the page it is on. Both need the path below the locale segment, which
is pure string work and therefore testable without a build.

**Files:**
- Modify: `src/lib/i18n/index.ts` — insert directly above the exact line
  `/** One namespace file: the same key set under every locale. */`
- Modify: `tests/lib/i18n.test.ts` — replace the import block, then append two describe blocks
  below the final line

**Interfaces:**
- Consumes: `isLang(value: unknown): value is Lang` from `src/lib/i18n/index.ts` (Task B1.1)
- Produces: `localePath(lang: Lang, path?: string): string` and
  `pathBelowLocale(pathname: string, base?: string): string`

- [ ] **Step 1: Write the failing test**

In `tests/lib/i18n.test.ts`, replace the import block

```ts
import {
  DEFAULT_LANG,
  KEY_OWNERS,
  LANGS,
  LANG_STORAGE_KEY,
  NAMESPACES,
  UI,
  isLang,
  mergeNamespaces,
  t,
} from '../../src/lib/i18n/index.ts';
```

with

```ts
import {
  DEFAULT_LANG,
  KEY_OWNERS,
  LANGS,
  LANG_STORAGE_KEY,
  NAMESPACES,
  UI,
  isLang,
  localePath,
  mergeNamespaces,
  pathBelowLocale,
  t,
} from '../../src/lib/i18n/index.ts';
```

Then append below the final line of the file:

```ts

describe('localePath()', () => {
  it('prefixes the locale and normalises the slashes', () => {
    expect(localePath('en', '/')).toBe('/en/');
    expect(localePath('pt', '/catalog/')).toBe('/pt/catalog/');
    expect(localePath('pt', 'catalog')).toBe('/pt/catalog/');
    expect(localePath('en')).toBe('/en/');
  });

  it('keeps a deep path intact', () => {
    expect(localePath('en', '/skills/anthropics/skills/document-skills/pdf/')).toBe(
      '/en/skills/anthropics/skills/document-skills/pdf/',
    );
  });
});

describe('pathBelowLocale()', () => {
  it('strips the base path and the locale segment', () => {
    expect(pathBelowLocale('/ai-tools-hub/en/catalog/', '/ai-tools-hub/')).toBe('/catalog/');
    expect(pathBelowLocale('/ai-tools-hub/pt/', '/ai-tools-hub/')).toBe('/');
    expect(pathBelowLocale('/ai-tools-hub/', '/ai-tools-hub/')).toBe('/');
  });

  it('works just as well when the pathname carries no base', () => {
    expect(pathBelowLocale('/en/catalog/', '/')).toBe('/catalog/');
    expect(pathBelowLocale('/pt/skills/owner/repo/name', '/')).toBe('/skills/owner/repo/name/');
    expect(pathBelowLocale('/')).toBe('/');
  });

  it('does not mistake a path segment that merely starts like a locale', () => {
    expect(pathBelowLocale('/entrypoints/', '/')).toBe('/entrypoints/');
    expect(pathBelowLocale('/ptolemy/', '/')).toBe('/ptolemy/');
  });

  it('round-trips against localePath, which is what the switcher relies on', () => {
    const here = pathBelowLocale('/ai-tools-hub/en/catalog/', '/ai-tools-hub/');
    expect(localePath('pt', here)).toBe('/pt/catalog/');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/i18n.test.ts`

Expected: FAIL — `src/lib/i18n/index.ts` exports neither helper, so every call in the two new
describe blocks throws `TypeError: localePath is not a function` /
`TypeError: pathBelowLocale is not a function`. The nine tests from Task B1.1 still pass.

- [ ] **Step 3: Write the helpers**

In `src/lib/i18n/index.ts`, insert directly above the line
`/** One namespace file: the same key set under every locale. */`:

```ts
/** Leading and trailing slash, so path segments concatenate without a double slash. */
function normalize(path: string): string {
  const withLead = path.startsWith('/') ? path : `/${path}`;
  return withLead.endsWith('/') ? withLead : `${withLead}/`;
}

/** The locale-prefixed path of a page, before the base path is applied by withBase(). */
export function localePath(lang: Lang, path: string = '/'): string {
  return `/${lang}${normalize(path)}`;
}

/**
 * The path below the locale segment — what the language switcher and the canonical link need.
 * Tolerates a pathname that carries the base path and one that does not, so it is correct
 * whether Astro hands us "/ai-tools-hub/en/catalog/" or "/en/catalog/".
 */
export function pathBelowLocale(pathname: string, base: string = '/'): string {
  let rest = normalize(pathname);
  const prefix = normalize(base);
  if (prefix !== '/' && rest.startsWith(prefix)) {
    rest = rest.slice(prefix.length - 1);
  }
  const segment = rest.split('/')[1] ?? '';
  if (isLang(segment)) {
    rest = rest.slice(segment.length + 1) || '/';
  }
  return normalize(rest);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/i18n.test.ts && npm run typecheck`

Expected: PASS — 15 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/index.ts tests/lib/i18n.test.ts
git commit -m "feat(i18n): locale path helpers for the switcher and canonical links"
```

---

### Task B1.3: `relativeDays()` and the one staleness threshold

Two surfaces grade the same crawl date: B2's home stats strip and B5's staleness banner and card
dates. If each carries its own number, the site can call one date fresh and the other stale on the
same page load. `STALE_DAYS` is exported here, from the module that already owns date formatting, so
both import it and neither writes a literal.

**Files:**
- Create: `src/lib/format.ts`
- Test: `tests/lib/format.test.ts`

**Interfaces:**
- Consumes: `src/types.ts` — `export type Lang = 'en' | 'pt';` (A1)
- Produces: `relativeDays(days: number, lang: Lang): string` and `STALE_DAYS: 60` — the single
  staleness threshold, imported by B2 and B5, hardcoded by neither

- [ ] **Step 1: Write the failing test**

Create `tests/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { STALE_DAYS, relativeDays } from '../../src/lib/format.ts';

describe('relativeDays()', () => {
  it('calls anything under a day today', () => {
    expect(relativeDays(0, 'en')).toBe('today');
    expect(relativeDays(0, 'pt')).toBe('hoje');
    expect(relativeDays(0.9, 'en')).toBe('today');
  });

  it('uses a shared day unit under 30 days', () => {
    expect(relativeDays(1, 'en')).toBe('1d');
    expect(relativeDays(29, 'pt')).toBe('29d');
  });

  it('switches to months at 30 days with a per-locale unit', () => {
    expect(relativeDays(30, 'en')).toBe('1mo');
    expect(relativeDays(30, 'pt')).toBe('1m');
    expect(relativeDays(120, 'en')).toBe('4mo');
    expect(relativeDays(120, 'pt')).toBe('4m');
    expect(relativeDays(364, 'en')).toBe('12mo');
  });

  it('switches to years at 365 days', () => {
    expect(relativeDays(365, 'en')).toBe('1y');
    expect(relativeDays(365, 'pt')).toBe('1a');
    expect(relativeDays(900, 'pt')).toBe('2a');
  });

  it('reads negative and non-finite input as today rather than throwing', () => {
    expect(relativeDays(-4, 'en')).toBe('today');
    expect(relativeDays(Number.NaN, 'pt')).toBe('hoje');
  });
});

describe('STALE_DAYS', () => {
  it('is the one staleness threshold every surface reads', () => {
    expect(STALE_DAYS).toBe(60);
    expect(Number.isInteger(STALE_DAYS) && STALE_DAYS > 0, 'not a positive whole day count').toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/format.test.ts`

Expected: FAIL — the module does not exist yet, so Vitest reports
`Error: Failed to load url ../../src/lib/format.ts` and no test in the file runs.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/format.ts`:

```ts
import type { Lang } from '../types.ts';

/**
 * Days after which a crawl date is presented as stale (spec §13). Single-sourced on purpose:
 * B2's home stats strip and B5's staleness banner and card dates both import this, so the site
 * cannot call one date fresh and another stale on the same page load.
 */
export const STALE_DAYS = 60;

/**
 * Compact age label: "today"/"hoje", "12d", "4mo"/"4m", "2y"/"2a".
 * Months are 30 days, years 365; both floor. Negative and non-finite input reads as today.
 */
export function relativeDays(days: number, lang: Lang): string {
  const d = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (d === 0) return lang === 'pt' ? 'hoje' : 'today';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}${lang === 'pt' ? 'm' : 'mo'}`;
  return `${Math.floor(d / 365)}${lang === 'pt' ? 'a' : 'y'}`;
}
```

`STALE_DAYS` sits above `relativeDays()` so the closing brace of `relativeDays()` stays the final
line of the file — Task B1.4 appends there.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/format.test.ts`

Expected: PASS — 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/lib/format.test.ts
git commit -m "feat(format): relativeDays age labels and the shared STALE_DAYS threshold"
```

---

### Task B1.4: `compactNumber()` — locale separators on star and fork counts

**Files:**
- Modify: `src/lib/format.ts` — append below the closing brace of `relativeDays()`, the final line
  of the file
- Modify: `tests/lib/format.test.ts` — replace the import line, then append one describe block
  below the final line

**Interfaces:**
- Consumes: `src/types.ts` — `export type Lang = 'en' | 'pt';` (A1)
- Produces: `compactNumber(n: number, lang: Lang): string`

- [ ] **Step 1: Write the failing test**

In `tests/lib/format.test.ts`, replace the line

```ts
import { STALE_DAYS, relativeDays } from '../../src/lib/format.ts';
```

with

```ts
import { STALE_DAYS, compactNumber, relativeDays } from '../../src/lib/format.ts';
```

Then append below the final line of the file:

```ts

describe('compactNumber()', () => {
  it('leaves counts under a thousand alone', () => {
    expect(compactNumber(0, 'en')).toBe('0');
    expect(compactNumber(7, 'pt')).toBe('7');
    expect(compactNumber(999, 'pt')).toBe('999');
  });

  it('uses the locale decimal separator with a shared K unit', () => {
    expect(compactNumber(1000, 'en')).toBe('1K');
    expect(compactNumber(1234, 'en')).toBe('1.2K');
    expect(compactNumber(1234, 'pt')).toBe('1,2K');
    expect(compactNumber(1500, 'pt')).toBe('1,5K');
  });

  it('drops the fraction once the scaled value reaches ten', () => {
    expect(compactNumber(52244, 'en')).toBe('52K');
    expect(compactNumber(52244, 'pt')).toBe('52K');
    expect(compactNumber(388017, 'en')).toBe('388K');
  });

  it('promotes the unit before rounding could print 1,000K', () => {
    expect(compactNumber(999499, 'en')).toBe('999K');
    expect(compactNumber(999500, 'en')).toBe('1M');
    expect(compactNumber(1234567, 'pt')).toBe('1,2M');
    expect(compactNumber(1500000000, 'pt')).toBe('1,5B');
  });

  it('reads non-finite input as zero rather than printing NaN', () => {
    expect(compactNumber(Number.NaN, 'en')).toBe('0');
    expect(compactNumber(Number.POSITIVE_INFINITY, 'pt')).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/format.test.ts`

Expected: FAIL — `src/lib/format.ts` exports no `compactNumber`, so every call in the new describe
block throws `TypeError: compactNumber is not a function`. The six tests from Task B1.3 still pass.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/format.ts`, below the final line:

```ts

/** Intl locale tags backing each site language. */
const LOCALES: Record<Lang, string> = { en: 'en-US', pt: 'pt-BR' };

function scaled(locale: string, value: number, suffix: string): string {
  const maximumFractionDigits = Math.abs(value) < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
  return `${formatted}${suffix}`;
}

/**
 * Metric count with locale separators: 1234 -> "1.2K" (en) / "1,2K" (pt).
 * K/M/B stay verbatim in both locales; the unit is promoted before rounding
 * could print "1,000K". Non-finite input reads as zero.
 */
export function compactNumber(n: number, lang: Lang): string {
  const locale = LOCALES[lang] ?? LOCALES.en;
  const value = Number.isFinite(n) ? Math.trunc(n) : 0;
  const abs = Math.abs(value);
  if (abs < 1000) return new Intl.NumberFormat(locale).format(value);
  if (abs < 999_500) return scaled(locale, value / 1000, 'K');
  if (abs < 999_500_000) return scaled(locale, value / 1_000_000, 'M');
  return scaled(locale, value / 1_000_000_000, 'B');
}
```

Node's own `notation: 'compact'` is deliberately not used: pt-BR renders it as `52 mil` and
`1,2 mi`, words that break the monospace metric column and diverge from the shared `K`/`M`
convention the cards use in both locales.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/format.test.ts && npm run typecheck`

Expected: PASS — 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts tests/lib/format.test.ts
git commit -m "feat(format): compactNumber with locale separators and unit promotion"
```

---

### Task B1.5: `Layout.astro`, the site root, and the locale-routing frame

`Layout.astro` is the shell every page in Plan 2 renders inside, and `src/pages/index.astro` is the
only page B1 owns — so they arrive together: the layout is unobservable in `dist/` until a page
renders it, and the root gateway is the page that does. The same task publishes
`tests/build/locale-routes.test.ts`, the tree-wide guard on the routing contract this pair
establishes: it proves the root dispatches into every routed locale, and then holds every
locale-prefixed page any later section emits to the same `<html lang>`, canonical and `hreflang`
rules. B2, B3, B4 and B5 run it; none of them writes it.

**Files:**
- Create: `src/components/Layout.astro`
- Create: `src/pages/index.astro` — nothing is being replaced: A1.2 creates
  `src/pages/base-check.astro` and explicitly leaves this path unrouted for B1
- Test: `tests/build/layout.test.ts`
- Test: `tests/build/locale-routes.test.ts`

**Interfaces:**
- Consumes: `t(key: string, lang: Lang): string`, `LANGS: readonly Lang[]`, `DEFAULT_LANG: Lang`,
  `localePath(lang: Lang, path?: string): string`,
  `pathBelowLocale(pathname: string, base?: string): string` from `src/lib/i18n/index.ts`;
  `withBase(path: string): string` from `src/lib/link.ts` (A1); `src/styles/theme.css` (A2) for
  `--background`, `--foreground`, `--border`, `--muted-foreground`, `--font-mono` and the
  `bg-background` / `text-foreground` utilities; `astro.config.mjs` with `base: '/ai-tools-hub/'`
  (A1); the `astro build` run by A1's `tests/global-setup.ts` before the suite
- Produces: `src/components/Layout.astro` with
  `Props { lang: Lang; title: string; description?: string; path?: string }` — `description` is
  **optional**, so a page that has nothing to add beyond its title simply omits it and emits no
  `<meta name="description">` — the named slot `head`, the DOM hooks `[data-skip-link]`,
  `[data-site-header]`, `[data-site-footer]`, `[data-footer-link]` (catalog **and** methodology),
  and `<main id="results">`; `dist/index.html`; `tests/build/locale-routes.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/build/layout.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(process.cwd(), 'dist');

/** Reads a page the vitest globalSetup build emitted. No test here ever runs a build. */
function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

/**
 * Assertions read DOM hooks, never class attributes: Astro 7 rewrites the class list of any
 * element in a component with scoped styles by appending data-astro-cid-*.
 */
describe('Layout chrome', () => {
  it('renders the header, the results landmark and the footer', () => {
    const page = built('index.html');
    expect(page.includes('data-site-header'), 'dist/index.html has no data-site-header').toBe(true);
    expect(page.includes('id="results"'), 'dist/index.html has no id="results"').toBe(true);
    expect(page.includes('data-site-footer'), 'dist/index.html has no data-site-footer').toBe(true);
  });

  it('puts the skip link first in the body, per WCAG 2.4.1', () => {
    const body = built('index.html').split('<body')[1] ?? '';
    const firstAnchor = body.match(/<a[^>]*>/);
    expect(firstAnchor !== null, 'no anchor at all in the body').toBe(true);
    expect(
      (firstAnchor?.[0] ?? '').includes('data-skip-link'),
      'the first anchor in the body is not the skip link',
    ).toBe(true);
    expect(
      (firstAnchor?.[0] ?? '').includes('href="#results"'),
      'the skip link does not target #results',
    ).toBe(true);
  });

  it('reaches the catalog and the methodology page from the footer', () => {
    const page = built('index.html');
    expect(
      page.includes('href="/ai-tools-hub/en/catalog/"'),
      'no base-prefixed catalog link',
    ).toBe(true);
    const footer = page.split('data-site-footer')[1] ?? '';
    expect(footer.includes('data-footer-link'), 'the footer has no navigation link').toBe(true);
    expect(
      footer.includes('href="/ai-tools-hub/en/catalog/"'),
      'the footer does not reach the catalog',
    ).toBe(true);
    expect(
      footer.includes('href="/ai-tools-hub/en/methodology/"'),
      'the footer does not reach the methodology page (spec §10.6)',
    ).toBe(true);
  });

  it('declares a canonical URL and both hreflang alternates', () => {
    const page = built('index.html');
    expect(
      page.includes('rel="canonical" href="/ai-tools-hub/en/"'),
      'no canonical link to the default locale',
    ).toBe(true);
    expect(
      page.includes('rel="alternate" hreflang="en" href="/ai-tools-hub/en/"'),
      'no en alternate',
    ).toBe(true);
    expect(
      page.includes('rel="alternate" hreflang="pt-BR" href="/ai-tools-hub/pt/"'),
      'no pt-BR alternate',
    ).toBe(true);
  });

  it('composes the document title from the page title and the site name', () => {
    expect(
      built('index.html').includes('<title>Choose your language · AI Tools Hub</title>'),
      'the composed <title> is missing',
    ).toBe(true);
  });
});

describe('language gateway at the site root', () => {
  it('sends a visitor without JavaScript to the default locale', () => {
    const page = built('index.html');
    expect(page.includes('http-equiv="refresh"'), 'no meta refresh').toBe(true);
    expect(
      page.includes('content="0; url=/ai-tools-hub/en/"'),
      'the meta refresh does not target the base-prefixed default locale',
    ).toBe(true);
  });

  it('offers both locales as real, base-prefixed links', () => {
    const page = built('index.html');
    expect(page.includes('href="/ai-tools-hub/en/"'), 'no link to /en/').toBe(true);
    expect(page.includes('href="/ai-tools-hub/pt/"'), 'no link to /pt/').toBe(true);
  });

  it('labels each locale in its own language', () => {
    const page = built('index.html');
    expect(page.includes('English'), 'the English option is unlabelled').toBe(true);
    expect(page.includes('Português (Brasil)'), 'the Portuguese option is not in Portuguese').toBe(
      true,
    );
  });

  it('declares the document language', () => {
    expect(built('index.html').includes('<html lang="en"'), 'no lang on <html>').toBe(true);
  });
});
```

Create `tests/build/locale-routes.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Lang } from '../../src/types.ts';
import { DEFAULT_LANG, LANGS } from '../../src/lib/i18n/index.ts';

const BASE = '/ai-tools-hub/';
const DIST = resolve(process.cwd(), 'dist');
/** Anything shaped like a locale directory, routed or not: "en", "pt", "pt-BR", "es". */
const LOCALE_SHAPED = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;

function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

function topLevelDirs(): string[] {
  if (!existsSync(DIST)) {
    throw new Error('dist/ was not emitted by the globalSetup astro build');
  }
  return readdirSync(DIST).filter((entry) => statSync(join(DIST, entry)).isDirectory());
}

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (full.endsWith('.html')) out.push(full);
  }
  return out;
}

interface LocalePage {
  lang: Lang;
  path: string;
  html: string;
}

/**
 * Every emitted page under a routed locale segment. Empty while B1 is the only section that has
 * run — the root gateway is not a locale page — and it fills up on its own as B2, B3, B4 and B5
 * add routes, which is exactly when these guards start biting.
 */
function localePages(): LocalePage[] {
  const out: LocalePage[] = [];
  for (const lang of LANGS) {
    const root = join(DIST, lang);
    if (!existsSync(root)) continue;
    for (const file of htmlFiles(root)) {
      out.push({ lang, path: file.slice(DIST.length + 1), html: readFileSync(file, 'utf8') });
    }
  }
  return out;
}

/** The hreflang tag a routed locale is published under. */
function hreflangOf(lang: Lang): string {
  return lang === 'pt' ? 'pt-BR' : 'en';
}

describe('the site root dispatches into every routed locale', () => {
  it('offers one base-prefixed entry per routed locale', () => {
    const page = built('index.html');
    for (const lang of LANGS) {
      expect(page.includes(`href="${BASE}${lang}/"`), `the root offers no link to /${lang}/`).toBe(
        true,
      );
    }
  });

  it('falls back to the default locale with JavaScript off', () => {
    expect(
      built('index.html').includes(`content="0; url=${BASE}${DEFAULT_LANG}/"`),
      'the root has no meta refresh into the default locale',
    ).toBe(true);
  });
});

describe('every page emitted under a locale segment', () => {
  it('routes no locale the site does not list', () => {
    const routed: readonly string[] = LANGS;
    const strays = topLevelDirs().filter((dir) => LOCALE_SHAPED.test(dir) && !routed.includes(dir));
    expect(strays).toEqual([]);
  });

  it('declares that locale as its document language and in its canonical', () => {
    const offenders: string[] = [];
    for (const page of localePages()) {
      const tag = hreflangOf(page.lang);
      if (!page.html.includes(`<html lang="${tag}"`)) {
        offenders.push(`${page.path}: <html lang> is not "${tag}"`);
      }
      if (!page.html.includes(`rel="canonical" href="${BASE}${page.lang}/`)) {
        offenders.push(`${page.path}: canonical is not under ${BASE}${page.lang}/`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('offers itself in every routed locale through hreflang', () => {
    const offenders: string[] = [];
    for (const page of localePages()) {
      for (const lang of LANGS) {
        const alternate = `rel="alternate" hreflang="${hreflangOf(lang)}" href="${BASE}${lang}/`;
        if (!page.html.includes(alternate)) {
          offenders.push(`${page.path}: no ${hreflangOf(lang)} alternate`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/build/layout.test.ts tests/build/locale-routes.test.ts`

Expected: FAIL — Plan 1 routes nothing at the site root: A1.2 creates the permanent
`src/pages/base-check.astro` and explicitly leaves `src/pages/index.astro` to this section, so the
globalSetup build emits `dist/base-check/index.html` and no `dist/index.html`. Every assertion that
reads the root throws
`Error: dist/index.html was not emitted by the globalSetup astro build` — all 9 in
`layout.test.ts` and the 2 root tests in `locale-routes.test.ts`. Its other 3 pass on an empty set:
the build has emitted no page under a locale segment yet, and `base-check` is not locale-shaped.

- [ ] **Step 3: Create the layout**

Create `src/components/Layout.astro`:

```astro
---
import type { Lang } from '../types.ts';
import { LANGS, localePath, pathBelowLocale, t } from '../lib/i18n/index.ts';
import { withBase } from '../lib/link.ts';
import '../styles/theme.css';

interface Props {
  lang: Lang;
  title: string;
  /** Optional: a page with nothing to add beyond its title emits no meta description. */
  description?: string;
  /**
   * Path below the locale segment, leading and trailing slash ("/" is the locale home).
   * Defaults to the path of the page being rendered, which is what the switcher needs.
   */
  path?: string;
}

const { lang, title, description, path } = Astro.props;
const here = path ?? pathBelowLocale(Astro.url.pathname, import.meta.env.BASE_URL);
const htmlLang = lang === 'pt' ? 'pt-BR' : 'en';
---
<html lang={htmlLang}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title} · {t('site.name', lang)}</title>
    {description && <meta name="description" content={description} />}
    <link rel="canonical" href={withBase(localePath(lang, here))} />
    {
      LANGS.map((code) => (
        <link
          rel="alternate"
          hreflang={code === 'pt' ? 'pt-BR' : 'en'}
          href={withBase(localePath(code, here))}
        />
      ))
    }
    <slot name="head" />
  </head>
  <body class="bg-background text-foreground">
    <a class="skip-link" href="#results" data-skip-link>{t('nav.skipToResults', lang)}</a>
    <header class="site-header" data-site-header>
      <a class="site-header__name" href={withBase(localePath(lang, '/'))}>{t('site.name', lang)}</a>
      <nav aria-label={t('nav.label', lang)}>
        <a href={withBase(localePath(lang, '/'))}>{t('nav.home', lang)}</a>
        <a href={withBase(localePath(lang, '/catalog/'))}>{t('nav.catalog', lang)}</a>
      </nav>
    </header>
    <main id="results">
      <slot />
    </main>
    <footer class="site-footer" data-site-footer>
      <nav aria-label={t('footer.label', lang)}>
        <a data-footer-link href={withBase(localePath(lang, '/catalog/'))}>{t('nav.catalog', lang)}</a>
        <a data-footer-link href={withBase(localePath(lang, '/methodology/'))}>{t('nav.methodology', lang)}</a>
      </nav>
      <p class="site-footer__note">{t('footer.note', lang)}</p>
    </footer>
  </body>
</html>

<style>
  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: 100;
    padding: 0.5rem 0.75rem;
    background: var(--background);
    color: var(--foreground);
    border: 1px solid var(--border);
  }
  .skip-link:focus {
    left: 0;
  }
  .site-header,
  .site-footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
  }
  .site-header {
    border-bottom: 1px solid var(--border);
  }
  .site-footer {
    border-top: 1px solid var(--border);
  }
  .site-header__name {
    font-family: var(--font-mono);
    font-weight: 600;
  }
  .site-header nav,
  .site-footer nav {
    display: flex;
    gap: 1rem;
  }
  /* WCAG 2.2 2.5.8: every chrome target clears 24 px. */
  .site-header a,
  .site-footer a {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    color: inherit;
  }
  .site-footer__note {
    color: var(--muted-foreground);
  }
</style>
```

`id="results"` lives on `<main>` and nowhere else in the site: it is the skip link's target, so a
later section that needs a focus target of its own gives it a different id rather than a second
`#results`.

The methodology link ships in the footer from this task, not later: spec §10.6 requires it to be
reachable *from anywhere*, and a link added by whichever section happens to build the page it points
at is reachable from that page only. `localePath(lang, '/methodology/')` renders exactly
`/{lang}/methodology/`, so both footer links are spelled the same way and both go through
`withBase`. Until B5 builds the route, that href 404s in a local preview — an expected intermediate
state, not a defect; nothing in this section asserts the target exists.

The header is intentionally **not** sticky: `position: sticky` would make WCAG 2.2 2.4.11
(`scroll-margin-top` equal to header height) a cross-page obligation, and that requirement is
already owned where the anchors actually are — the facet rail and the per-skill route.

- [ ] **Step 4: Create the site root**

Create `src/pages/index.astro`:

```astro
---
import Layout from '../components/Layout.astro';
import { DEFAULT_LANG, LANGS, localePath, t } from '../lib/i18n/index.ts';
import { withBase } from '../lib/link.ts';

const fallback = withBase(localePath(DEFAULT_LANG, '/'));
const targets = Object.fromEntries(LANGS.map((lang) => [lang, withBase(localePath(lang, '/'))]));
---
<Layout
  lang={DEFAULT_LANG}
  title={t('gateway.heading', DEFAULT_LANG)}
  description={t('gateway.body', DEFAULT_LANG)}
>
  <Fragment slot="head">
    <meta http-equiv="refresh" content={`0; url=${fallback}`} />
  </Fragment>
  <h1>{t('gateway.heading', DEFAULT_LANG)}</h1>
  <p>{t('gateway.body', DEFAULT_LANG)}</p>
  <ul>
    {
      LANGS.map((lang) => (
        <li>
          <a href={targets[lang]} hreflang={lang === 'pt' ? 'pt-BR' : 'en'}>
            {t(`lang.${lang}`, lang)}
          </a>
        </li>
      ))
    }
  </ul>
</Layout>
```

`path` is deliberately not passed, so the build exercises `pathBelowLocale()` against whatever
`Astro.url.pathname` really is under a configured base — that is the one thing the unit test in
Task B1.2 cannot prove. Each locale is labelled in its own language (`t('lang.pt', 'pt')`), because
a visitor who cannot read the current locale still has to recognise their own.

- [ ] **Step 5: Run both tests to verify they pass**

Run: `npx vitest run tests/build/layout.test.ts tests/build/locale-routes.test.ts && npm run typecheck`

Expected: PASS — 14 tests green (9 + 5). The globalSetup build runs once at the start of the run and
both files are read from `dist/`.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.astro src/pages/index.astro tests/build/layout.test.ts tests/build/locale-routes.test.ts
git commit -m "feat(chrome): base-aware Layout shell, root language gateway and the locale-routing guard"
```

---

### Task B1.6: Language switcher, with a guarded write and a remembered choice

**Files:**
- Modify: `src/components/Layout.astro` — one insertion above the exact line `    </header>`, one
  insertion above the exact line `  </body>`, and one added import
- Modify: `src/pages/index.astro` — one insertion below the exact line
  `    <meta http-equiv="refresh" content={`0; url=${fallback}`} />`, and one added import
- Test: `tests/build/lang-switcher.test.ts`

**Interfaces:**
- Consumes: `LANGS`, `LANG_STORAGE_KEY`, `localePath`, `t` from `src/lib/i18n/index.ts`;
  `withBase` from `src/lib/link.ts`; `Layout.astro` and `src/pages/index.astro` (Task B1.5)
- Produces: the hooks `[data-lang-switcher]` and `a[data-lang]` inside `Layout.astro`, the
  `aith:lang` localStorage contract, and the root gateway's upgrade from *default locale* to
  *remembered locale*

- [ ] **Step 1: Write the failing test**

Create `tests/build/lang-switcher.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(process.cwd(), 'dist');

function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

describe('language switcher', () => {
  it('offers both locales on the page', () => {
    const page = built('index.html');
    expect(page.includes('data-lang-switcher'), 'no switcher in dist/index.html').toBe(true);
    expect(page.includes('data-lang="en"'), 'no en option').toBe(true);
    expect(page.includes('data-lang="pt"'), 'no pt option').toBe(true);
  });

  it('labels the options in the page language', () => {
    const page = built('index.html');
    expect(page.includes('Portuguese (Brazil)'), 'the pt option is not labelled in English').toBe(
      true,
    );
  });

  it('marks the active locale for assistive tech, and only that one', () => {
    const page = built('index.html');
    expect(/data-lang="en"[^>]*aria-current="page"/.test(page), 'en is not current').toBe(true);
    expect(/data-lang="pt"[^>]*aria-current="page"/.test(page), 'pt is wrongly current').toBe(
      false,
    );
  });

  it('persists the choice behind a guarded localStorage write', () => {
    const page = built('index.html');
    expect(page.includes('aith:lang'), 'the storage key never reaches the page').toBe(true);
    expect(page.includes('localStorage.setItem'), 'nothing writes the choice').toBe(true);
    expect(/catch\s*[({]/.test(page), 'the storage write is unguarded').toBe(true);
  });

  it('prefers a remembered choice at the site root, behind a guarded read', () => {
    const page = built('index.html');
    expect(page.includes('localStorage.getItem'), 'the root never reads the choice').toBe(true);
    expect(page.includes('location.replace'), 'the root never acts on the choice').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/lang-switcher.test.ts`

Expected: FAIL — `Layout.astro` renders no switcher yet. First failure:
`AssertionError: no switcher in dist/index.html: expected false to be true`.

- [ ] **Step 3: Add the switcher to the layout**

In `src/components/Layout.astro`, replace the import line

```ts
import { LANGS, localePath, pathBelowLocale, t } from '../lib/i18n/index.ts';
```

with

```ts
import { LANGS, LANG_STORAGE_KEY, localePath, pathBelowLocale, t } from '../lib/i18n/index.ts';
```

Insert directly above the line `    </header>`:

```astro
      <nav class="lang-switcher" aria-label={t('lang.label', lang)} data-lang-switcher>
        {
          LANGS.map((code) => (
            <a
              href={withBase(localePath(code, here))}
              hreflang={code === 'pt' ? 'pt-BR' : 'en'}
              data-lang={code}
              aria-current={code === lang ? 'page' : undefined}
            >
              {t(`lang.${code}`, lang)}
            </a>
          ))
        }
      </nav>
```

Insert directly above the line `  </body>`:

```astro
    <script is:inline define:vars={{ storageKey: LANG_STORAGE_KEY }}>
      document.querySelectorAll('[data-lang-switcher] a[data-lang]').forEach(function (link) {
        link.addEventListener('click', function () {
          try {
            window.localStorage.setItem(storageKey, link.dataset.lang);
          } catch (error) {
            /* storage blocked (private window, site data off) — navigation still works */
          }
        });
      });
    </script>
```

The script is inline with `define:vars` rather than a bundled module that imports
`LANG_STORAGE_KEY`: importing `src/lib/i18n/index.ts` into a client bundle would ship every
namespace table — the whole catalog of strings, in both locales — to the browser on every page.
`define:vars` carries the one value it needs and keeps the key single-sourced.

- [ ] **Step 4: Remember the choice at the site root**

In `src/pages/index.astro`, replace the import line

```ts
import { DEFAULT_LANG, LANGS, localePath, t } from '../lib/i18n/index.ts';
```

with

```ts
import { DEFAULT_LANG, LANGS, LANG_STORAGE_KEY, localePath, t } from '../lib/i18n/index.ts';
```

Insert directly below the line
`    <meta http-equiv="refresh" content={`0; url=${fallback}`} />`:

```astro
    <script is:inline define:vars={{ targets, fallback, storageKey: LANG_STORAGE_KEY }}>
      (function () {
        var next = fallback;
        try {
          var stored = window.localStorage.getItem(storageKey);
          if (stored && targets[stored]) next = targets[stored];
        } catch (error) {
          /* storage blocked (private window, site data off) — the meta refresh still fires */
        }
        window.location.replace(next);
      })();
    </script>
```

It sits in the `head` slot ahead of the body so it runs before the browser paints, and it carries
the base path Astro resolved rather than a hand-written string. The meta refresh stays as the
no-JavaScript floor.

- [ ] **Step 5: Run both build tests to verify they pass**

Run: `npx vitest run tests/build/lang-switcher.test.ts tests/build/layout.test.ts`

Expected: PASS — 14 tests green; the switcher must not have broken any Task B1.5 assertion.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.astro src/pages/index.astro tests/build/lang-switcher.test.ts
git commit -m "feat(i18n): language switcher persisting the choice in guarded localStorage"
```

---

### Task B1.7: Three-state theme control

`src/styles/theme.css` defines the light palette on bare `:root`, the dark palette under
`prefers-color-scheme` guarded as `:root:not([data-theme="light"])`, and repeats it under
`:root[data-theme="dark"]` (spec §9.1). Nothing in either plan writes `data-theme`, so two of those
three states are unreachable. This task supplies the writer.

**Files:**
- Modify: `src/components/Layout.astro` — one insertion above the exact line
  `    <slot name="head" />`, one above the exact line `    </header>`, one above the exact line
  `  </body>`, and one added frontmatter constant
- Test: `tests/build/theme-control.test.ts`

**Interfaces:**
- Consumes: `t(key: string, lang: Lang): string` from `src/lib/i18n/index.ts`; the
  `[data-theme="dark"]` / `[data-theme="light"]` selectors defined in `src/styles/theme.css` (A2)
- Produces: the hooks `[data-theme-control]` and `[data-theme-option]` with the values
  `system` / `light` / `dark`, and the `aith:theme` localStorage contract

- [ ] **Step 1: Write the failing test**

Create `tests/build/theme-control.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(process.cwd(), 'dist');

function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

describe('theme control', () => {
  it('offers all three states, labelled', () => {
    const page = built('index.html');
    expect(page.includes('data-theme-control'), 'no theme control').toBe(true);
    for (const mode of ['system', 'light', 'dark']) {
      expect(page.includes(`data-theme-option="${mode}"`), `no ${mode} option`).toBe(true);
    }
    expect(page.includes('>System<'), 'the system option is unlabelled').toBe(true);
  });

  it('exposes the pressed state to assistive tech', () => {
    expect(built('index.html').includes('aria-pressed'), 'no aria-pressed on the options').toBe(
      true,
    );
  });

  it('resolves the stored theme in the head, before the first paint', () => {
    const head = built('index.html').split('</head>')[0] ?? '';
    expect(head.includes('aith:theme'), 'the theme key is not read in the head').toBe(true);
    expect(head.includes('data-theme'), 'the head script never sets data-theme').toBe(true);
    expect(/catch\s*[({]/.test(head), 'the storage read is unguarded').toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/theme-control.test.ts`

Expected: FAIL — `Layout.astro` renders no theme control. First failure:
`AssertionError: no theme control: expected false to be true`.

- [ ] **Step 3: Add the storage key and the pre-paint script**

In `src/components/Layout.astro`, replace the frontmatter line

```ts
const htmlLang = lang === 'pt' ? 'pt-BR' : 'en';
```

with

```ts
const htmlLang = lang === 'pt' ? 'pt-BR' : 'en';
/** localStorage key holding an explicit light/dark choice; absent means follow the system. */
const THEME_STORAGE_KEY = 'aith:theme';
```

Insert directly above the line `    <slot name="head" />`:

```astro
    <script is:inline define:vars={{ storageKey: THEME_STORAGE_KEY }}>
      try {
        var stored = window.localStorage.getItem(storageKey);
        if (stored === 'light' || stored === 'dark') {
          document.documentElement.setAttribute('data-theme', stored);
        }
      } catch (error) {
        /* storage blocked — prefers-color-scheme still decides */
      }
    </script>
```

It must be inline and in `<head>`: a bundled module would run after the first paint and the page
would flash the wrong palette.

- [ ] **Step 4: Add the control and its behaviour**

Insert directly above the line `    </header>`:

```astro
      <div class="theme-control" role="group" aria-label={t('theme.label', lang)} data-theme-control>
        {
          (['system', 'light', 'dark'] as const).map((mode) => (
            <button
              type="button"
              data-theme-option={mode}
              aria-pressed={mode === 'system' ? 'true' : 'false'}
            >
              {t(`theme.${mode}`, lang)}
            </button>
          ))
        }
      </div>
```

Insert directly above the line `  </body>`:

```astro
    <script is:inline define:vars={{ storageKey: THEME_STORAGE_KEY }}>
      (function () {
        var root = document.documentElement;
        var group = document.querySelector('[data-theme-control]');
        if (!group) return;

        function paint(mode) {
          if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
          else root.removeAttribute('data-theme');
          group.querySelectorAll('[data-theme-option]').forEach(function (button) {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === mode));
          });
        }

        group.addEventListener('click', function (event) {
          var button = event.target.closest('[data-theme-option]');
          if (!button) return;
          var mode = button.dataset.themeOption;
          try {
            if (mode === 'system') window.localStorage.removeItem(storageKey);
            else window.localStorage.setItem(storageKey, mode);
          } catch (error) {
            /* storage blocked — the choice still applies for this page view */
          }
          paint(mode);
        });

        var current = 'system';
        try {
          current = window.localStorage.getItem(storageKey) || 'system';
        } catch (error) {
          /* storage blocked — fall back to following the system */
        }
        paint(current);
      })();
    </script>
```

`aria-pressed` ships as `system` and is corrected on load, because a static build cannot know what
this visitor stored. Choosing *System* removes the attribute rather than writing a third value, so
`prefers-color-scheme` resumes control — that is the third state, not a stored one.

- [ ] **Step 5: Run the three build tests to verify they pass**

Run: `npx vitest run tests/build/theme-control.test.ts tests/build/lang-switcher.test.ts tests/build/layout.test.ts`

Expected: PASS — 17 tests green.

- [ ] **Step 6: Commit**

```bash
git add src/components/Layout.astro tests/build/theme-control.test.ts
git commit -m "feat(chrome): three-state theme control with a pre-paint resolver"
```

---

### Task B1.8: Build-time guard — no root-relative URL escapes the base path

Spec §11.2 calls a hand-written `href="/skills/…"` the single most common Pages failure: it works
locally and 404s in production. This guard is repository-wide and runs against every page every
later section adds.

**Files:**
- Test: `tests/build/base-path.test.ts`
- Temporary: `src/pages/base-probe.astro` — created in Step 2, deleted in Step 4, never committed

**Interfaces:**
- Consumes: the `dist/` tree the vitest `globalSetup` build emits (A1)
- Produces: a repository-wide assertion that every emitted `href` and `src` beginning with `/`
  starts with `/ai-tools-hub/`

- [ ] **Step 1: Write the guard**

Create `tests/build/base-path.test.ts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BASE = '/ai-tools-hub/';
const DIST = resolve(process.cwd(), 'dist');
const ROOT_RELATIVE = /\s(?:href|src)="(\/[^"]*)"/g;

function htmlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (full.endsWith('.html')) out.push(full);
  }
  return out;
}

describe('base path', () => {
  it('emits no root-relative URL outside the base path', () => {
    if (!existsSync(DIST)) {
      throw new Error('dist/ was not emitted by the globalSetup astro build');
    }
    const files = htmlFiles(DIST);
    expect(files.length, 'the build emitted no HTML at all').toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(ROOT_RELATIVE)) {
        const url = match[1];
        if (url.startsWith('//')) continue;
        if (url.startsWith(BASE)) continue;
        offenders.push(`${file.slice(DIST.length + 1)} -> ${url}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
```

The guard asserts against the built tree only. It deliberately makes no claim about
`withBase()` in-process: under Vitest `import.meta.env.BASE_URL` is `/`, so `withBase('/en/')`
returns `/en/` there — the configured base exists only inside a real build, which is exactly what
this reads. `withBase` itself is unit-tested by A1.

- [ ] **Step 2: Plant a violation so the guard is proven to bite**

Create `src/pages/base-probe.astro` — a throwaway page, deleted in Step 4 and never committed:

```astro
---
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>base probe</title>
  </head>
  <body>
    <a href="/en/">hand-written root-relative link</a>
  </body>
</html>
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/build/base-path.test.ts`

Expected: FAIL with
`AssertionError: expected [ 'base-probe/index.html -> /en/' ] to deeply equal []`.
The globalSetup build emitted the probe page before the assertions ran; no test invoked a build
itself.

- [ ] **Step 4: Remove the probe page**

Run: `rm src/pages/base-probe.astro`

- [ ] **Step 5: Run the whole suite to verify it passes**

Run: `npx vitest run`

Expected: PASS. Astro empties `outDir` at the start of every build, so the globalSetup rebuild
cannot leave the deleted probe's HTML behind. Green in this section:
`tests/lib/i18n.test.ts` (15), `tests/lib/format.test.ts` (11),
`tests/build/layout.test.ts` (9), `tests/build/locale-routes.test.ts` (5),
`tests/build/lang-switcher.test.ts` (5), `tests/build/theme-control.test.ts` (3) and
`tests/build/base-path.test.ts` (1) — alongside everything Plan 1 already had green.

- [ ] **Step 6: Commit**

```bash
git add tests/build/base-path.test.ts
git commit -m "test(build): assert no emitted URL escapes the /ai-tools-hub/ base path"
```

---

## Section B2 — Home: the taxonomy, honestly stated

**Execution order (RULE 4):** B1 → **B2** → B4 → B3 → B5. This section runs second, so it may
consume everything Plan 1 shipped plus B1's frame, and nothing from B3, B4 or B5.

**Prerequisites — created by earlier sections, must exist before the first `astro build`:**
`package.json`, `astro.config.mjs` (`base: '/ai-tools-hub/'`), `tsconfig.json`, `vitest.config.ts`
(with the `tests/global-setup.ts` `globalSetup` that runs `astro build` once per vitest invocation),
`src/types.ts`, `src/lib/link.ts` (A1) · `src/styles/theme.css` with `--color-hazard`, the
`--motion-*` tokens and the shadcn aliases (A2) · `data/taxonomy.json`, `src/lib/taxonomy.ts` with
`loadTaxonomy()`, `flattenTaxonomy()`, `nodeName()` (A3) · `src/lib/data.ts` with
`loadSkills(): Skill[]` and `loadMeta(): Meta`, and the committed `data/skills.json` /
`data/meta.json` they read (A6) · from B1: `src/components/Layout.astro` with
`Props { lang: Lang; title: string; description?: string; path?: string }` (`description` is
optional — this page passes it anyway), `src/lib/i18n/index.ts` exporting `t(key, lang)`, `LANGS`,
`DEFAULT_LANG`, `isLang`, `src/lib/i18n/core.ts` holding the `site.*` chrome — including
`site.thesis` and `site.support` — and the `nav.*` chrome, `src/lib/format.ts` exporting
`compactNumber`, `relativeDays` and `export const STALE_DAYS = 60`, and the frame's build tests
`tests/build/locale-routes.test.ts`, `tests/build/lang-switcher.test.ts`,
`tests/build/base-path.test.ts`.

**Ownership notes.** This section creates exactly three source files:
`src/lib/i18n/home.ts`, `src/pages/[lang]/index.astro`, `src/components/TaxonomyNode.astro`.
B1 does **not** create `src/pages/[lang]/index.astro` — B2 does, and it renders through B1's
`Layout.astro`, so B1's `locale-routes.test.ts` and `lang-switcher.test.ts` assertions about
`dist/en/index.html` (the canonical link, `href="/ai-tools-hub/en/"`, `data-lang="en"`, the skip
link into `#results`, which is the `id` on B1's `<main>`) are satisfied by the frame, not restated
here — and both of those test files are **created by B1**; this section only runs them. The one
change B2 makes to a file it does not own is Task B2.2's anchored append to `src/lib/taxonomy.ts`
(A3).

**i18n ownership.** A namespace module defines its own keys and nobody else's. B1's `core.ts` owns
`site.*` and `nav.*`; this section's `src/lib/i18n/home.ts` owns `home.*` **and** the four `stats.*`
labels the strip prints. Consumers only ever call `t()`.

**Shared constants.** The staleness threshold has exactly one definition: `STALE_DAYS` in
`src/lib/format.ts` (B1). This section imports it in both the page and the test and never writes the
number 60 in code, so the home page and B5's rescue banner cannot grade the same crawl differently.

**Data contract.** `data/skills.json` is a bare `Skill[]` and `data/meta.json` is
`{ crawledAt, classifiedAt, skillCount, sourceCount }`; both are read only through A6's loaders,
never with a local `JSON.parse` and never written by this section.

**Test contract (RULE 6).** `vitest.config.ts` runs `astro build` once in `globalSetup` before the
suite, so every build test here only *reads* `dist/`. No test in this section runs a build, and no
test writes to `data/`. Build assertions derive their expectations from `loadSkills()`,
`loadMeta()`, `loadTaxonomy()` and `t()` at test time, so they hold for whatever corpus is
committed — an empty catalog, the seeded one, or a full nightly harvest.

---

---

### Task B2.1: The `home` i18n namespace

Every string this section prints that no other namespace owns lives here — including the four stat
labels, which this file owns outright. `src/lib/i18n/core.ts` (B1) owns the chrome that other
surfaces also show: the thesis (`site.thesis`), the supporting sentence (`site.support`), the word
*Catalog* (`nav.catalog`). Those are consumed through `t()` and never restated (RULE 3). Keys are
fully qualified (`home.*`, `stats.*`) so `src/lib/i18n/index.ts` can merge the namespace modules by
spread and `t('home.nodeEmpty', lang)` resolves without a prefixing rule.

**Files:**
- Create: `src/lib/i18n/home.ts`
- Test: `tests/lib/i18n-home.test.ts`

**Interfaces:**
- Consumes: `Lang` from `src/types.ts`; `t(key: string, lang: Lang): string` from
  `src/lib/i18n/index.ts` (B1), which merges every namespace module in `src/lib/i18n/`
- Produces: `src/lib/i18n/home.ts` — `export default { en, pt }`, eleven keys, identical key sets:
  `home.description`, `home.securityLead`, `home.otherHeading`, `home.otherLead`,
  `home.nodeThin`, `home.nodeEmpty`, `home.staleNote`, and the four stat labels this file owns,
  `stats.skills`, `stats.sources`, `stats.domains`, `stats.lastRefresh`

- [ ] **Step 1: Write the failing test**
```bash
mkdir -p tests/lib
cat > tests/lib/i18n-home.test.ts <<'TS'
import { describe, expect, it } from 'vitest';
import home from '../../src/lib/i18n/home.ts';
import { t } from '../../src/lib/i18n/index.ts';

const KEYS = [
  'home.description',
  'home.nodeEmpty',
  'home.nodeThin',
  'home.otherHeading',
  'home.otherLead',
  'home.securityLead',
  'home.staleNote',
  'stats.domains',
  'stats.lastRefresh',
  'stats.skills',
  'stats.sources',
];

describe('the home i18n namespace', () => {
  it('ships exactly the keys this section owns', () => {
    expect(Object.keys(home.en).sort()).toEqual(KEYS);
  });

  it('has identical key sets in both locales', () => {
    expect(Object.keys(home.pt).sort()).toEqual(Object.keys(home.en).sort());
  });

  it('qualifies every key under a namespace this file owns, so merging cannot collide', () => {
    for (const key of Object.keys(home.en)) {
      expect(
        key.startsWith('home.') || key.startsWith('stats.'),
        `${key} belongs to no namespace this file owns`,
      ).toBe(true);
    }
  });

  it('never ships an empty string', () => {
    for (const locale of ['en', 'pt'] as const) {
      for (const [key, value] of Object.entries(home[locale])) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('translates every value rather than leaking English into pt-BR', () => {
    for (const key of Object.keys(home.en)) {
      expect(home.pt[key], `${key} is identical in both locales`).not.toBe(home.en[key]);
    }
  });

  it('resolves through the merged t(), so index.ts really registered this file', () => {
    expect(t('home.otherHeading', 'en')).toBe('Other domains');
    expect(t('home.otherHeading', 'pt')).toBe('Outros domínios');
    expect(t('stats.lastRefresh', 'en')).toBe('Last refresh');
    expect(t('stats.lastRefresh', 'pt')).toBe('Última atualização');
  });

  it('does not restate a string core.ts owns', () => {
    for (const key of Object.keys(home.en)) {
      expect(key.startsWith('site.') || key.startsWith('nav.'), `${key} belongs to core.ts`).toBe(
        false,
      );
    }
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/i18n-home.test.ts`
Expected: FAIL with `Error: Failed to load url ../../src/lib/i18n/home.ts (resolved id: /home/kyo/projects/ai-tools-hub/src/lib/i18n/home.ts). Does the file exist?`

- [ ] **Step 3: Write the namespace**
```bash
mkdir -p src/lib/i18n
cat > src/lib/i18n/home.ts <<'TS'
import type { Lang } from '../../types.ts';

/**
 * Home-page strings, plus the four stat labels this namespace owns. Chrome that other surfaces
 * also show — site.thesis, site.support, nav.* — belongs to src/lib/i18n/core.ts and is consumed
 * through t(); it is never restated here. Keys are fully qualified so index.ts merges by spread.
 */
const en = {
  'home.description':
    'A small, deep, auditable catalog of agent skills: the security domain fully expanded, every other domain present and honestly thin.',
  'home.securityLead':
    'Every security subdomain, expanded — including the ones nothing has been filed under yet.',
  'home.otherHeading': 'Other domains',
  'home.otherLead':
    'Present, and honestly thin. A domain link opens the catalog filtered to everything beneath it.',
  'home.nodeThin': 'below minimum mass',
  'home.nodeEmpty': 'no entries yet',
  // No day count and no cadence in the prose: STALE_DAYS (src/lib/format.ts, B1) is the only
  // place the threshold is written, and the schedule (a local systemd timer every 4h, with the
  // weekly Action as fallback — §6.1) lives in ops/, not in a string.
  'home.staleNote': 'this figure is stale — the refresh may be stuck',
  'stats.skills': 'Skills indexed',
  'stats.sources': 'Sources',
  'stats.domains': 'Domains',
  'stats.lastRefresh': 'Last refresh',
} as const;

/** The annotation makes a missing or extra pt-BR key a compile error, not a silent English leak. */
const pt: Record<keyof typeof en, string> = {
  'home.description':
    'Um catálogo pequeno, profundo e auditável de skills de agentes: o domínio de segurança totalmente expandido, os demais presentes e honestamente rasos.',
  'home.securityLead':
    'Todos os subdomínios de segurança, expandidos — inclusive aqueles onde nada foi classificado ainda.',
  'home.otherHeading': 'Outros domínios',
  'home.otherLead':
    'Presentes, e honestamente rasos. O link de um domínio abre o catálogo filtrado por tudo que está abaixo dele.',
  'home.nodeThin': 'abaixo da massa mínima',
  'home.nodeEmpty': 'sem entradas ainda',
  'home.staleNote': 'este número está defasado — a atualização pode ter parado',
  'stats.skills': 'Skills indexadas',
  'stats.sources': 'Fontes',
  'stats.domains': 'Domínios',
  'stats.lastRefresh': 'Última atualização',
};

const home: Record<Lang, Record<string, string>> = { en, pt };

export default home;
TS
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/i18n-home.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Type-check**
Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**
```bash
git add src/lib/i18n/home.ts tests/lib/i18n-home.test.ts
git commit -m "feat(i18n): home namespace and the stats labels, with EN/pt-BR parity"
```

---

### Task B2.2: Node counting and the three-state derivation

`src/lib/taxonomy.ts` (A3) already exports `loadTaxonomy()`, `flattenTaxonomy()` and `nodeName()`.
This task appends the three pure functions the home grid needs: how many entries a slug holds, how
many a whole domain holds, and which of the three honest states a count maps to. A count includes
`primary` **and** every `also` — spec §3.1: the entry really does appear in those lists — counted
once per skill, and **only when `listed` is true**. An entry the per-subdomain cap evicted (§5.1)
keeps its row, its score and its page, but it is counted nowhere: otherwise an evicted entry could
prop a node above minimum mass and make a node navigable on the strength of entries it does not
list. Both counting functions apply that filter themselves, so no call site can forget it.

This is a `Modify` against a file A3 owns, so both edits are anchored on strings that appear
verbatim in A3.2 and A3.3 and the edit refuses to run if either anchor is missing.

**Files:**
- Modify: `src/lib/taxonomy.ts` — anchor 1 is the type-import line A3.3 leaves behind,
  `import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';`; anchor 2 is the tail of
  `nodeName()`, the file's final two lines, `  return node.name[lang];` followed by `}`
- Test: `tests/lib/taxonomy-counts.test.ts`

**Interfaces:**
- Consumes: `Skill` from `src/types.ts` (A1), including the `listed: boolean` flag §5.1 adds
- Produces, from `src/lib/taxonomy.ts` — every count below is a count of **listed** entries:
  - `export type NodeState = 'active' | 'thin' | 'empty'`
  - `export function countBySlug(skills: Skill[]): Map<string, number>`
  - `export function countDomain(skills: Skill[], domainSlug: string): number`
  - `export function nodeState(count: number, minimumMass: number): NodeState`

- [ ] **Step 1: Write the failing test**
```bash
cat > tests/lib/taxonomy-counts.test.ts <<'TS'
import { describe, expect, it } from 'vitest';
import { countBySlug, countDomain, nodeState } from '../../src/lib/taxonomy.ts';
import type { Skill } from '../../src/types.ts';

/**
 * A fixture Skill the score contract accepts: score === breakdown.total and every
 * component inside its cap (adoption 25, maintenance 30, provenance 25, completeness 20).
 * Every slug used below exists in data/taxonomy.json. `listed` defaults to true; pass false
 * for an entry the per-subdomain cap evicted (§5.1).
 */
function makeSkill(
  name: string,
  primary: string,
  also: string[] = [],
  listed = true,
): Skill {
  return {
    id: `owner/repo@abc1234:${name}/SKILL.md`,
    type: 'skill',
    name,
    description: 'fixture entry used only by the taxonomy counting tests',
    descriptionPt: null,
    longPt: null,
    repo: 'owner/repo',
    path: `${name}/SKILL.md`,
    sha: 'abc1234',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'Apache-2.0',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    },
    primary,
    also,
    tags: [],
    securityRelevant: true,
    score: 78,
    breakdown: { adoption: 18, maintenance: 27, provenance: 13, completeness: 20, total: 78 },
    listed,
  };
}

describe('countBySlug', () => {
  it('counts primary placements', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/supply-chain'),
      makeSkill('c', 'security/threat-modeling'),
    ]);
    expect(counts.get('security/supply-chain')).toBe(2);
    expect(counts.get('security/threat-modeling')).toBe(1);
  });

  it('counts "also" placements, because the entry really appears in that list', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain', ['security/cicd-pipeline']),
    ]);
    expect(counts.get('security/cicd-pipeline')).toBe(1);
  });

  it('counts a skill once per slug even if primary is repeated in also', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain', ['security/supply-chain']),
    ]);
    expect(counts.get('security/supply-chain')).toBe(1);
  });

  it('returns no key at all for a slug nothing is filed under', () => {
    const counts = countBySlug([makeSkill('a', 'security/supply-chain')]);
    expect(counts.get('security/detection-forensics')).toBeUndefined();
  });

  it('returns an empty map for an empty catalog', () => {
    expect(countBySlug([]).size).toBe(0);
  });

  it('ignores an entry the cap evicted, on its primary and on every also', () => {
    const counts = countBySlug([
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/supply-chain', ['security/cicd-pipeline'], false),
    ]);
    expect(counts.get('security/supply-chain')).toBe(1);
    expect(counts.get('security/cicd-pipeline')).toBeUndefined();
  });
});

describe('countDomain', () => {
  it('aggregates every child of the domain', () => {
    const skills = [
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/threat-modeling'),
      makeSkill('c', 'devops-infra/general'),
    ];
    expect(countDomain(skills, 'security')).toBe(2);
    expect(countDomain(skills, 'devops-infra')).toBe(1);
    expect(countDomain(skills, 'writing-docs')).toBe(0);
  });

  it('counts a skill once even when two of its slugs sit in the same domain', () => {
    const skills = [makeSkill('a', 'security/supply-chain', ['security/cicd-pipeline'])];
    expect(countDomain(skills, 'security')).toBe(1);
  });

  it('counts a skill filed on the bare domain slug as well as on a child', () => {
    expect(countDomain([makeSkill('a', 'productivity')], 'productivity')).toBe(1);
  });

  it('does not treat a shared prefix as the same domain', () => {
    expect(countDomain([makeSkill('a', 'security-theatre/general')], 'security')).toBe(0);
  });

  it('ignores an evicted entry, so a domain count is a count of what is listed', () => {
    const skills = [
      makeSkill('a', 'security/supply-chain'),
      makeSkill('b', 'security/threat-modeling', [], false),
    ];
    expect(countDomain(skills, 'security')).toBe(1);
  });
});

describe('nodeState', () => {
  it('is empty at zero', () => {
    expect(nodeState(0, 5)).toBe('empty');
  });

  it('is thin between one and one below minimum mass', () => {
    expect(nodeState(1, 5)).toBe('thin');
    expect(nodeState(4, 5)).toBe('thin');
  });

  it('is active at exactly minimum mass and above', () => {
    expect(nodeState(5, 5)).toBe('active');
    expect(nodeState(120, 5)).toBe('active');
  });

  it('treats a negative count as empty rather than throwing', () => {
    expect(nodeState(-1, 5)).toBe('empty');
  });
});

describe('eviction and minimum mass', () => {
  it('never lets an evicted entry prop a node above minimum mass', () => {
    const slug = 'security/threat-modeling';
    const count =
      countBySlug([
        makeSkill('a', slug),
        makeSkill('b', slug),
        makeSkill('c', slug),
        makeSkill('d', slug, [], false),
        makeSkill('e', slug, [], false),
      ]).get(slug) ?? 0;
    expect(count).toBe(3);
    expect(nodeState(count, 5)).toBe('thin');
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/taxonomy-counts.test.ts`
Expected: FAIL with `SyntaxError: The requested module '/home/kyo/projects/ai-tools-hub/src/lib/taxonomy.ts' does not provide an export named 'countBySlug'`

- [ ] **Step 3: Append the three functions to `src/lib/taxonomy.ts`**
```bash
python3 - <<'PY'
from pathlib import Path

p = Path('src/lib/taxonomy.ts')
s = p.read_text(encoding='utf-8')

old_import = "import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';"
new_import = "import type { Lang, Skill, Taxonomy, TaxonomyNode } from '../types.ts';"
assert s.count(old_import) == 1, 'anchor 1 not found: A3.3 leaves exactly one Lang/Taxonomy type import'

tail = "  return node.name[lang];\n}\n"
assert s.endswith(tail), 'anchor 2 not found: the file must still end with nodeName()'

block = """
/** The three honest states a taxonomy node can render in (spec §10.1). */
export type NodeState = 'active' | 'thin' | 'empty';

/**
 * Entries per taxonomy slug: `primary` plus every `also`, counted once per skill (spec §3.1).
 * Listed entries only: a row the per-subdomain cap evicted (§5.1) keeps its page and keeps being
 * re-scored, but counting it here would let it prop a node above minimum mass.
 */
export function countBySlug(skills: Skill[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    if (!skill.listed) continue;
    for (const slug of new Set<string>([skill.primary, ...skill.also])) {
      counts.set(slug, (counts.get(slug) ?? 0) + 1);
    }
  }
  return counts;
}

/** Entries anywhere under a top-level domain, counted once per skill; listed only (§5.1). */
export function countDomain(skills: Skill[], domainSlug: string): number {
  const prefix = `${domainSlug}/`;
  let total = 0;
  for (const skill of skills) {
    if (!skill.listed) continue;
    const slugs = [skill.primary, ...skill.also];
    if (slugs.some((slug) => slug === domainSlug || slug.startsWith(prefix))) total += 1;
  }
  return total;
}

/** Minimum mass is governance: below it a node is shown but is not navigable (spec §10.1). */
export function nodeState(count: number, minimumMass: number): NodeState {
  if (count <= 0) return 'empty';
  return count >= minimumMass ? 'active' : 'thin';
}
"""

p.write_text(s.replace(old_import, new_import, 1) + block, encoding='utf-8')
PY
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/taxonomy-counts.test.ts`
Expected: PASS — 16 tests.

- [ ] **Step 5: Confirm A3's own taxonomy tests still pass**
Run: `npx vitest run tests/lib/taxonomy-load.test.ts tests/lib/node-name.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 6: Type-check**
Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**
```bash
git add src/lib/taxonomy.ts tests/lib/taxonomy-counts.test.ts
git commit -m "feat(taxonomy): countBySlug, countDomain and the three-state nodeState"
```

---

### Task B2.3: Home page shell — thesis, supporting sentence, stats strip

The home goes straight to the taxonomy (spec §10.1), so there is no marketing layer: one thesis
line, one supporting sentence, a link into the catalog, then a four-cell stats strip read from
`loadMeta()` and `loadTaxonomy()`. The page owns none of its own document chrome — `Layout.astro`
(B1) supplies `<html>`, `<head>`, the skip link, `<main id="results">`, the header, the language
switcher and the footer — and none of its own shared strings: the thesis and the supporting
sentence come from B1's `core.ts` through `t()`, the four stat labels from B2.1's `home.ts`.
The grid arrives in B2.5.

The catalog route itself lands in B3 (execution order B1 → B2 → B4 → B3 → B5), so these links
resolve only once B3 has run; the query shape `?subdomain=` / `?domain=` is the one B3's
`parseQuery` reads.

**Files:**
- Create: `src/pages/[lang]/index.astro`
- Test: `tests/build/home.test.ts`

**Interfaces:**
- Consumes: `Layout.astro` with `Props { lang: Lang; title: string; description?: string; path?: string }`
  (`description` is optional; this page passes it), `t(key, lang)`, `LANGS`, `DEFAULT_LANG`,
  `isLang` from `src/lib/i18n/index.ts`, `compactNumber(n, lang)`, `relativeDays(days, lang)` from
  `src/lib/format.ts` (B1); `loadMeta(): Meta` from `src/lib/data.ts` (A6); `loadTaxonomy(): Taxonomy`
  from `src/lib/taxonomy.ts` (A3); `withBase(path)` from `src/lib/link.ts` (A1); `Lang` from
  `src/types.ts`
- Produces: the static routes `/{base}/en/` and `/{base}/pt/`; stat cells addressable as
  `<dd data-stat="skills" | "sources" | "domains" | "refresh">`, the refresh cell also carrying
  `data-days="<integer>"`

- [ ] **Step 1: Write the failing test**
```bash
mkdir -p tests/build
cat > tests/build/home.test.ts <<'TS'
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMeta } from '../../src/lib/data.ts';
import { compactNumber, relativeDays } from '../../src/lib/format.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** vitest.config.ts builds once in globalSetup (RULE 6); no test here builds anything. */
function built(page: string): string {
  const file = `${ROOT}dist/${page}`;
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

function statTag(html: string, key: string): string {
  const match = html.match(new RegExp(`<dd[^>]*data-stat="${key}"[^>]*>`));
  if (match === null) throw new Error(`the built page has no <dd data-stat="${key}"> cell`);
  return match[0];
}

function statValue(html: string, key: string): string {
  const match = html.match(new RegExp(`<dd[^>]*data-stat="${key}"[^>]*>([^<]*)`));
  if (match === null) throw new Error(`the built page has no <dd data-stat="${key}"> cell`);
  return match[1].trim();
}

function refreshDays(html: string): number {
  const match = statTag(html, 'refresh').match(/data-days="(\d+)"/);
  if (match === null) throw new Error('the refresh cell carries no data-days attribute');
  return Number(match[1]);
}

const en = built('en/index.html');
const pt = built('pt/index.html');
const meta = loadMeta();
const taxonomy = loadTaxonomy();

describe('home page shell', () => {
  it('renders one page per routed locale, each in its own document language', () => {
    expect(en.includes('<html lang="en"'), 'the en route is not lang="en"').toBe(true);
    expect(pt.includes('<html lang="pt-BR"'), 'the pt route is not lang="pt-BR"').toBe(true);
  });

  it('opens with the thesis and one supporting sentence, from core.ts', () => {
    expect(en.includes(t('site.thesis', 'en')), 'no en thesis').toBe(true);
    expect(en.includes(t('site.support', 'en')), 'no en supporting sentence').toBe(true);
    expect(pt.includes(t('site.thesis', 'pt')), 'no pt thesis').toBe(true);
    expect(pt.includes(t('site.support', 'pt')), 'no pt supporting sentence').toBe(true);
  });

  it('never leaks the English thesis into the Portuguese page', () => {
    expect(pt.includes(t('site.thesis', 'en')), 'English thesis on the pt route').toBe(false);
  });

  it('shows the skill and source counts meta.json actually holds', () => {
    expect(statValue(en, 'skills')).toBe(compactNumber(meta.skillCount, 'en'));
    expect(statValue(en, 'sources')).toBe(compactNumber(meta.sourceCount, 'en'));
    expect(statValue(pt, 'skills')).toBe(compactNumber(meta.skillCount, 'pt'));
  });

  it('reads the domain count off the taxonomy rather than hard-coding 13', () => {
    expect(statValue(en, 'domains')).toBe(compactNumber(taxonomy.domains.length, 'en'));
  });

  it('exposes the crawl age as a machine-readable whole number of days', () => {
    const days = refreshDays(en);
    expect(Number.isInteger(days) && days >= 0, `data-days="${days}" is not a day count`).toBe(true);
  });

  it('prints that same day count as the locale-aware label', () => {
    expect(statValue(en, 'refresh')).toBe(relativeDays(refreshDays(en), 'en'));
    expect(statValue(pt, 'refresh')).toBe(relativeDays(refreshDays(pt), 'pt'));
  });

  it('agrees with meta.json about how old the crawl is', () => {
    const expected = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(meta.crawledAt)) / 86_400_000),
    );
    const drift = Math.abs(refreshDays(en) - expected);
    expect(drift <= 1, `rendered crawl age is ${drift} days away from meta.json`).toBe(true);
  });

  it('labels the strip in both locales, from the keys this section owns', () => {
    expect(en.includes(t('stats.lastRefresh', 'en')), 'no en refresh label').toBe(true);
    expect(pt.includes(t('stats.lastRefresh', 'pt')), 'no pt refresh label').toBe(true);
    expect(pt.includes(t('stats.domains', 'pt')), 'no pt domains label').toBe(true);
  });

  it('links into the catalog through the configured base path', () => {
    expect(en).toMatch(/<a[^>]+href="\/ai-tools-hub\/en\/catalog\/"/);
    expect(pt).toMatch(/<a[^>]+href="\/ai-tools-hub\/pt\/catalog\/"/);
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/home.test.ts`
Expected: FAIL with `Error: dist/en/index.html was not built — read the globalSetup "astro build" output`
(the route does not exist yet, so the globalSetup build emits no `en/index.html`)

- [ ] **Step 3: Write the page**
```bash
mkdir -p 'src/pages/[lang]'
cat > 'src/pages/[lang]/index.astro' <<'ASTRO'
---
import type { Lang } from '../../types.ts';
import Layout from '../../components/Layout.astro';
import { loadMeta } from '../../lib/data.ts';
import { compactNumber, relativeDays } from '../../lib/format.ts';
import { DEFAULT_LANG, LANGS, isLang, t } from '../../lib/i18n/index.ts';
import { withBase } from '../../lib/link.ts';
import { loadTaxonomy } from '../../lib/taxonomy.ts';

export function getStaticPaths() {
  return LANGS.map((value) => ({ params: { lang: value } }));
}

const lang: Lang = isLang(Astro.params.lang) ? Astro.params.lang : DEFAULT_LANG;
const meta = loadMeta();
const taxonomy = loadTaxonomy();

// A6 always writes an ISO crawledAt; an unparsable one reads as 0 days rather than NaN.
const crawledAtMs = Date.parse(meta.crawledAt);
const crawlDays = Number.isNaN(crawledAtMs)
  ? 0
  : Math.max(0, Math.floor((Date.now() - crawledAtMs) / 86_400_000));

const stats = [
  { key: 'skills', label: t('stats.skills', lang), value: compactNumber(meta.skillCount, lang) },
  { key: 'sources', label: t('stats.sources', lang), value: compactNumber(meta.sourceCount, lang) },
  {
    key: 'domains',
    label: t('stats.domains', lang),
    value: compactNumber(taxonomy.domains.length, lang),
  },
];

const catalogHref = withBase(`/${lang}/catalog/`);
const title = `${t('site.name', lang)} — ${t('site.thesis', lang)}`;
---

<Layout lang={lang} title={title} description={t('home.description', lang)}>
  <section class="intro">
    <h1 class="intro__thesis">{t('site.thesis', lang)}</h1>
    <p class="intro__support">{t('site.support', lang)}</p>
    <p class="intro__actions">
      <a class="intro__catalog" href={catalogHref}>{t('nav.catalog', lang)}</a>
    </p>
  </section>

  <dl class="stats">
    {
      stats.map((stat) => (
        <div class="stat">
          <dt class="stat__label">{stat.label}</dt>
          <dd class="stat__value" data-stat={stat.key}>{stat.value}</dd>
        </div>
      ))
    }
    <div class="stat">
      <dt class="stat__label">{t('stats.lastRefresh', lang)}</dt>
      <dd class="stat__value" data-stat="refresh" data-days={crawlDays}>{relativeDays(crawlDays, lang)}</dd>
    </div>
  </dl>
</Layout>

<style>
  .intro {
    max-width: 62ch;
  }
  .intro__thesis {
    margin: 0 0 0.5rem;
    font-size: var(--text-3xl);
    line-height: var(--text-3xl--line-height);
  }
  .intro__support {
    margin: 0;
    color: var(--muted-foreground);
  }
  .intro__actions {
    margin: 1rem 0 0;
  }
  .intro__catalog {
    color: var(--color-a-11);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 1px;
    margin: 2rem 0 3rem;
    padding: 0;
    background: var(--border);
    border: 1px solid var(--border);
  }
  .stat {
    flex: 1 1 9rem;
    padding: 0.75rem 1rem;
    background: var(--card);
  }
  .stat__label {
    font-size: var(--text-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted-foreground);
  }
  .stat__value {
    margin: 0.25rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-variant-numeric: tabular-nums;
  }
</style>
ASTRO
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/build/home.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Confirm B1's frame assertions still hold on this route**
Run: `npx vitest run tests/build/locale-routes.test.ts tests/build/lang-switcher.test.ts tests/build/base-path.test.ts`
Expected: PASS — all three files are B1's, created with the frame; this section only runs them. The
frame supplies the canonical link, the switcher and the skip link into `<main id="results">`; this
page supplies the thesis and the supporting sentence B1's locale test looks for.

- [ ] **Step 6: Commit**
```bash
git add 'src/pages/[lang]/index.astro' tests/build/home.test.ts
git commit -m "feat(home): thesis, supporting sentence and stats strip for both locales"
```

---

### Task B2.4: A stale crawl says so, in words and in hazard orange

§13 makes a silently frozen pipeline the project's largest risk, and §9.2 reserves hazard orange for
exactly this. The refresh cell gains `data-stale`, driven by the same `crawlDays` the cell already
prints and by the one shared threshold `STALE_DAYS`, exported from `src/lib/format.ts` (B1) — the
same constant B5's rescue banner reads, so no two surfaces can grade the same crawl differently.
This page never writes the number itself. A sentence goes with the colour, because colour alone
would fail WCAG 1.4.1.

The token is `--color-hazard`, spelled with no fallback and no numbered variant (RULE 5), read from
the selector `.meta__updated--stale`. That name is deliberate: it is one of the three selectors
B4.13's site-wide allowlist permits (`.safety-row--hazard`, `.meta__updated--stale`,
`.license__value--undeclared`), so the stale date here and the stale date on a card are the same
decision spelled the same way, and the allowlist stays three entries long.

**Files:**
- Modify: `src/pages/[lang]/index.astro` (four anchored edits, below)
- Test: `tests/build/home-staleness.test.ts`

**Interfaces:**
- Consumes: `STALE_DAYS` from `src/lib/format.ts` (B1); `crawlDays` and `t('home.staleNote', lang)`
  from this page; `--color-hazard` from `src/styles/theme.css` (A2)
- Produces: `<dd data-stat="refresh" data-days="<n>" data-stale="true" | "false">`, carrying the
  class `meta__updated--stale` and the stale sentence exactly when `data-stale="true"`

- [ ] **Step 1: Write the failing test**
```bash
cat > tests/build/home-staleness.test.ts <<'TS'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STALE_DAYS } from '../../src/lib/format.ts';
import { t } from '../../src/lib/i18n/index.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');

function built(page: string): string {
  const file = join(DIST, page);
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Astro may inline a small stylesheet or emit it as a file; look in both. */
function allStyles(): string {
  const files = walk(DIST);
  const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8'));
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      css.push(match[1]);
    }
  }
  return css.join('\n');
}

function refreshCell(html: string): string {
  const match = html.match(/<dd[^>]*data-stat="refresh"[\s\S]*?<\/dd>/);
  if (match === null) throw new Error('the built page has no <dd data-stat="refresh"> cell');
  return match[0];
}

function refreshDays(html: string): number {
  const match = refreshCell(html).match(/data-days="(\d+)"/);
  if (match === null) throw new Error('the refresh cell carries no data-days attribute');
  return Number(match[1]);
}

const pages = [
  { lang: 'en' as const, html: built('en/index.html') },
  { lang: 'pt' as const, html: built('pt/index.html') },
];
const styles = allStyles();

describe('the last-refresh cell', () => {
  it('states plainly whether the crawl is stale', () => {
    for (const { lang, html } of pages) {
      const declared = /data-stale="(true|false)"/.test(refreshCell(html));
      expect(declared, `${lang}: the refresh cell does not say whether the crawl is stale`).toBe(
        true,
      );
    }
  });

  it('flags exactly the crawls past the one shared STALE_DAYS threshold', () => {
    for (const { lang, html } of pages) {
      const days = refreshDays(html);
      const stale = /data-stale="true"/.test(refreshCell(html));
      expect(
        stale,
        `${lang}: data-stale disagrees with data-days="${days}" at STALE_DAYS=${STALE_DAYS}`,
      ).toBe(days > STALE_DAYS);
    }
  });

  it('says it in words as well as in colour, per WCAG 1.4.1', () => {
    for (const { lang, html } of pages) {
      const cell = refreshCell(html);
      const stale = /data-stale="true"/.test(cell);
      expect(cell.includes(t('home.staleNote', lang)), `${lang}: stale note out of step`).toBe(
        stale,
      );
    }
  });

  it('carries the hazard class only while it is stale', () => {
    for (const { lang, html } of pages) {
      const cell = refreshCell(html);
      const stale = /data-stale="true"/.test(cell);
      expect(cell.includes('meta__updated--stale'), `${lang}: hazard class out of step`).toBe(stale);
    }
  });

  it('reads hazard orange from the stale-date selector', () => {
    const found = /\.meta__updated--stale[^{}]*\{[^}]*var\(--color-hazard\)/.test(styles);
    expect(found, 'no .meta__updated--stale rule reads var(--color-hazard)').toBe(true);
  });

  it('spells the token exactly, with no variant and no fallback', () => {
    expect(styles.includes('--color-hazard-9'), 'there is no --color-hazard-9').toBe(false);
    expect(styles.includes('var(--hazard'), 'there is no --hazard token').toBe(false);
    expect(
      styles.includes('var(--color-hazard,'),
      'a fallback would hide the token from the site-wide guard',
    ).toBe(false);
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/home-staleness.test.ts`
Expected: FAIL — the refresh cell has no `data-stale` attribute yet, so the first assertion fires
with `AssertionError: en: the refresh cell does not say whether the crawl is stale: expected false to be true`

- [ ] **Step 3: Add the flag, the sentence and the hazard rule**
```bash
python3 - <<'PY'
from pathlib import Path

p = Path('src/pages/[lang]/index.astro')
s = p.read_text(encoding='utf-8')

fmt = "import { compactNumber, relativeDays } from '../../lib/format.ts';"
assert s.count(fmt) == 1, 'anchor 1 not found: the format import from Task B2.3'
s = s.replace(
    fmt,
    "import { STALE_DAYS, compactNumber, relativeDays } from '../../lib/format.ts';",
    1,
)

age = """const crawlDays = Number.isNaN(crawledAtMs)
  ? 0
  : Math.max(0, Math.floor((Date.now() - crawledAtMs) / 86_400_000));
"""
assert s.count(age) == 1, 'anchor 2 not found: the crawlDays constant from Task B2.3'
s = s.replace(
    age,
    age + """
/* Spec §9.2: past the one shared threshold the cell renders in hazard orange and says so in
   words. STALE_DAYS lives in src/lib/format.ts (B1) and is the only definition of it in the
   project; B5's rescue banner reads the same constant. */
const stale = crawlDays > STALE_DAYS;
""",
    1,
)

cell = """      <dd class="stat__value" data-stat="refresh" data-days={crawlDays}>{relativeDays(crawlDays, lang)}</dd>
"""
assert s.count(cell) == 1, 'anchor 3 not found: the refresh cell from Task B2.3'
s = s.replace(
    cell,
    """      <dd
        class:list={['stat__value', stale && 'meta__updated--stale']}
        data-stat="refresh"
        data-days={crawlDays}
        data-stale={stale ? 'true' : 'false'}
      >
        {relativeDays(crawlDays, lang)}
        {stale && <span class="stat__flag">{t('home.staleNote', lang)}</span>}
      </dd>
""",
    1,
)

assert s.count('</style>') == 1, 'anchor 4 not found: this page has exactly one style block'
s = s.replace(
    '</style>',
    """  /* Hazard orange means one thing (§9.2). `.meta__updated--stale` is one of the three
     selectors allowed to read the token; the site-wide allowlist lives in
     tests/build/hazard-token.test.ts (B4.13). No fallback: a fallback would hide this
     usage from that guard. */
  .meta__updated--stale {
    color: var(--color-hazard);
  }
  .stat__flag {
    display: block;
    margin-top: 0.25rem;
    font-family: var(--font-sans);
    font-size: var(--text-xs);
    color: var(--muted-foreground);
  }
</style>""",
    1,
)

p.write_text(s, encoding='utf-8')
PY
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/build/home-staleness.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Confirm the shell test still passes**
Run: `npx vitest run tests/build/home.test.ts`
Expected: PASS — the refresh cell's text is still `relativeDays(days, lang)`; the note is a
separate element and does not enter the captured value.

- [ ] **Step 6: Commit**
```bash
git add 'src/pages/[lang]/index.astro' tests/build/home-staleness.test.ts
git commit -m "feat(home): flag a stale crawl in words and in hazard orange"
```

---

### Task B2.5: TaxonomyNode and the expanded Security grid

Security ships fully expanded: every subdomain `data/taxonomy.json` declares, rendered by one
component in one of the three states of spec §10.1 — **active** (at or above minimum mass: accent,
clickable, count shown), **thin** (has entries, too few to navigate to: dimmed, not clickable, and
it says how far it is from the threshold), **empty** (nothing indexed: an em-dash, not a zero,
because a zero reads as a measurement and an em-dash reads as an absence).

The strongest form of "not clickable" is structural: a non-active node contains no `<a>` element at
all. Clicking is the promise that broke every awesome-list, and a disabled-looking link that still
navigates is the same lie with extra steps.

The component takes no `label` prop: `nodeName(slug, lang)` is the only way any page in this project
renders a taxonomy label (A3.3), and it throws on an unknown slug rather than rendering a blank.

Every number here is a count of **listed** entries: `countBySlug` (B2.2) drops anything the §5.1 cap
evicted, so a node's state describes what a visitor can actually browse to and an evicted entry
cannot push a node over minimum mass. The evicted entry keeps its own page (B4) — it is only gone
from the grid.

**Files:**
- Create: `src/components/TaxonomyNode.astro`
- Modify: `src/pages/[lang]/index.astro` (five anchored edits, below)
- Test: `tests/build/home-taxonomy.test.ts`

**Interfaces:**
- Consumes: `nodeState(count, minimumMass)`, `countBySlug(skills)`, `nodeName(slug, lang)`,
  `loadTaxonomy()` from `src/lib/taxonomy.ts`; `loadSkills(): Skill[]` from `src/lib/data.ts`;
  `withBase(path)` from `src/lib/link.ts`; `t(key, lang)` from `src/lib/i18n/index.ts`; `Lang`
- Produces: `src/components/TaxonomyNode.astro` with
  `Props { slug: string; count: number; minimumMass: number; lang: Lang; filterKey?: 'subdomain' | 'domain' }`;
  each node emits `<li class="node" data-slug="<slug>" data-state="active|thin|empty" data-count="<n>">`;
  an active node links to `/{lang}/catalog/?subdomain=<encoded slug>` (or `?domain=` when
  `filterKey="domain"`), through `withBase`; the page emits
  `<section id="taxonomy">` holding `<ul class="grid" data-grid="security">`

- [ ] **Step 1: Write the failing test**
```bash
cat > tests/build/home-taxonomy.test.ts <<'TS'
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { countBySlug, loadTaxonomy, nodeName } from '../../src/lib/taxonomy.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function built(page: string): string {
  const file = `${ROOT}dist/${page}`;
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

interface RenderedNode {
  slug: string;
  state: string;
  count: number;
  html: string;
}

function grid(html: string, key: string): string {
  const open = html.indexOf(`data-grid="${key}"`);
  if (open === -1) throw new Error(`the built page has no <ul data-grid="${key}"> grid`);
  const close = html.indexOf('</ul>', open);
  return html.slice(open, close);
}

function nodes(html: string, key: string): RenderedNode[] {
  const section = grid(html, key);
  const out: RenderedNode[] = [];
  for (const match of section.matchAll(/<li[^>]*data-slug="([^"]+)"[^>]*>/g)) {
    const start = match.index ?? 0;
    const stop = section.indexOf('</li>', start);
    out.push({
      slug: match[1],
      state: /data-state="([a-z]+)"/.exec(match[0])?.[1] ?? '',
      count: Number(/data-count="(\d+)"/.exec(match[0])?.[1] ?? Number.NaN),
      html: section.slice(start, stop + 5).replace(/\s+/g, ' '),
    });
  }
  return out;
}

/** Astro escapes `&` in a text expression; accept either the numeric or the named form. */
function showsLabel(html: string, label: string): boolean {
  return [label, label.replace(/&/g, '&#38;'), label.replace(/&/g, '&amp;')].some((form) =>
    html.includes(form),
  );
}

const en = built('en/index.html');
const pt = built('pt/index.html');
const taxonomy = loadTaxonomy();
const skills = loadSkills();
const counts = countBySlug(skills);
const securityChildren = taxonomy.domains.find((d) => d.slug === 'security')?.children ?? [];

describe('the expanded security grid', () => {
  it('renders every security subdomain the taxonomy declares, in taxonomy order', () => {
    expect(nodes(en, 'security').map((node) => node.slug)).toEqual(
      securityChildren.map((child) => child.slug),
    );
  });

  it('counts primary and also placements, exactly as countBySlug does', () => {
    for (const node of nodes(en, 'security')) {
      expect(node.count, `${node.slug} count`).toBe(counts.get(node.slug) ?? 0);
    }
  });

  it('counts only listed entries, so an evicted one cannot prop a node above minimum mass', () => {
    const listedCounts = new Map<string, number>();
    for (const skill of skills) {
      if (!skill.listed) continue;
      for (const slug of new Set<string>([skill.primary, ...skill.also])) {
        listedCounts.set(slug, (listedCounts.get(slug) ?? 0) + 1);
      }
    }
    for (const node of nodes(en, 'security')) {
      expect(node.count, `${node.slug} counts an entry the cap evicted`).toBe(
        listedCounts.get(node.slug) ?? 0,
      );
    }
  });

  it('puts every node in the one state its count earns', () => {
    const mass = taxonomy.minimumMass;
    for (const node of nodes(en, 'security')) {
      const expected = node.count === 0 ? 'empty' : node.count < mass ? 'thin' : 'active';
      expect(node.state, `${node.slug} holds ${node.count} of ${mass}`).toBe(expected);
    }
  });

  it('makes an active node a real link into the pre-filtered catalog', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'active')) {
      const href = `/ai-tools-hub/en/catalog/?subdomain=${encodeURIComponent(node.slug)}`;
      expect(node.html.includes(`href="${href}"`), `${node.slug} does not link to ${href}`).toBe(
        true,
      );
      expect(node.html.includes(`>${node.count}<`), `${node.slug} hides its count`).toBe(true);
    }
  });

  it('renders no anchor at all on a node a visitor cannot use', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state !== 'active')) {
      expect(
        node.html.includes('<a'),
        `${node.slug} is ${node.state} but still renders an anchor`,
      ).toBe(false);
    }
  });

  it('tells a thin node how far it is from the threshold, and why it is not navigable', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'thin')) {
      const ratio = `${node.count} / ${taxonomy.minimumMass}`;
      expect(node.html.includes(ratio), `${node.slug} does not show "${ratio}"`).toBe(true);
      expect(
        node.html.includes(t('home.nodeThin', 'en')),
        `${node.slug} does not say why it is not navigable`,
      ).toBe(true);
    }
  });

  it('renders an absence as an em-dash rather than a zero', () => {
    for (const node of nodes(en, 'security').filter((n) => n.state === 'empty')) {
      expect(node.html.includes('—'), `${node.slug} renders no em-dash`).toBe(true);
      expect(
        node.html.includes('aria-hidden="true"'),
        `${node.slug} reads its em-dash out to screen readers`,
      ).toBe(true);
      expect(
        node.html.includes(t('home.nodeEmpty', 'en')),
        `${node.slug} does not say it is empty`,
      ).toBe(true);
      expect(/>\s*0\s*</.test(node.html), `${node.slug} prints a zero`).toBe(false);
    }
  });

  it('labels every node from the taxonomy, in the page locale', () => {
    for (const node of nodes(en, 'security')) {
      expect(
        showsLabel(node.html, nodeName(node.slug, 'en')),
        `${node.slug} is not labelled in en`,
      ).toBe(true);
    }
    for (const node of nodes(pt, 'security')) {
      expect(
        showsLabel(node.html, nodeName(node.slug, 'pt')),
        `${node.slug} is not labelled in pt-BR`,
      ).toBe(true);
    }
  });

  it('keeps every catalog link inside the page locale', () => {
    for (const node of nodes(pt, 'security').filter((n) => n.state === 'active')) {
      expect(
        node.html.includes('/ai-tools-hub/pt/catalog/?subdomain='),
        `${node.slug} links out of the pt locale`,
      ).toBe(true);
    }
  });

  it('heads and anchors the section with the taxonomy own label for security', () => {
    expect(en.includes('id="taxonomy"'), 'no #taxonomy anchor on the home page').toBe(true);
    expect(en.includes(t('home.securityLead', 'en')), 'no en security lead').toBe(true);
    expect(showsLabel(pt, nodeName('security', 'pt')), 'no pt security heading').toBe(true);
    expect(pt.includes(t('home.securityLead', 'pt')), 'no pt security lead').toBe(true);
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/home-taxonomy.test.ts`
Expected: FAIL with `Error: the built page has no <ul data-grid="security"> grid`

- [ ] **Step 3: Write the component**
```bash
mkdir -p src/components
cat > src/components/TaxonomyNode.astro <<'ASTRO'
---
import type { Lang } from '../types.ts';
import { t } from '../lib/i18n/index.ts';
import { withBase } from '../lib/link.ts';
import { nodeName, nodeState } from '../lib/taxonomy.ts';

interface Props {
  slug: string;
  count: number;
  minimumMass: number;
  lang: Lang;
  /** `subdomain` filters the catalog to one leaf, `domain` to everything beneath a domain. */
  filterKey?: 'subdomain' | 'domain';
}

const { slug, count, minimumMass, lang, filterKey = 'subdomain' } = Astro.props;

const state = nodeState(count, minimumMass);
// nodeName throws on an unknown slug, so a taxonomy typo fails the build instead of
// rendering a blank tile (A3.3).
const label = nodeName(slug, lang);
const href = withBase(`/${lang}/catalog/?${filterKey}=${encodeURIComponent(slug)}`);
const ratio = `${count} / ${minimumMass}`;
---

<li class="node" data-slug={slug} data-state={state} data-count={count}>
  {
    state === 'active' && (
      <a class="node__link" href={href}>
        <span class="node__label">{label}</span>
        <span class="node__count">{count}</span>
      </a>
    )
  }
  {
    state === 'thin' && (
      <div class="node__body">
        <span class="node__label">{label}</span>
        <span class="node__count">{ratio}</span>
        <span class="node__note">{t('home.nodeThin', lang)}</span>
      </div>
    )
  }
  {
    state === 'empty' && (
      <div class="node__body">
        <span class="node__label">{label}</span>
        <span class="node__count" aria-hidden="true">—</span>
        <span class="node__note">{t('home.nodeEmpty', lang)}</span>
      </div>
    )
  }
</li>

<style>
  .node {
    list-style: none;
    border: 1px solid var(--border);
    background: var(--card);
  }
  .node[data-state='active'] {
    border-color: var(--color-a-7);
  }
  /* An absence gets no card fill: the tile reads as a gap in the grid, not as a result. */
  .node[data-state='empty'] {
    background: none;
  }
  .node__link,
  .node__body {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.5rem;
    /* WCAG 2.2 2.5.8 asks for 24px; the grid is the primary navigation, so 44. */
    min-height: 44px;
    padding: 0.625rem 0.75rem;
  }
  .node__link {
    color: var(--color-a-11);
    text-decoration: none;
    transition: background-color var(--motion-state) var(--motion-ease);
  }
  .node__link:hover {
    background: var(--accent);
  }
  .node__link:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: -2px;
  }
  /* Dimming is a token swap, not an opacity: the label keeps its contrast ratio (§10.5). */
  .node__body {
    color: var(--muted-foreground);
  }
  .node__label {
    flex: 1 1 auto;
  }
  .node__count {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .node__note {
    flex: 1 0 100%;
    font-size: var(--text-xs);
    letter-spacing: 0.02em;
  }
</style>
ASTRO
```

- [ ] **Step 4: Wire the grid into the page**
```bash
python3 - <<'PY'
from pathlib import Path

p = Path('src/pages/[lang]/index.astro')
s = p.read_text(encoding='utf-8')

imports = """import Layout from '../../components/Layout.astro';
import { loadMeta } from '../../lib/data.ts';
"""
assert s.count(imports) == 1, 'anchor 1 not found: the Layout and data imports from Task B2.3'
s = s.replace(
    imports,
    """import Layout from '../../components/Layout.astro';
import TaxonomyNode from '../../components/TaxonomyNode.astro';
import { loadMeta, loadSkills } from '../../lib/data.ts';
""",
    1,
)

tax_import = "import { loadTaxonomy } from '../../lib/taxonomy.ts';"
assert s.count(tax_import) == 1, 'anchor 2 not found: the taxonomy import from Task B2.3'
s = s.replace(
    tax_import,
    "import { countBySlug, loadTaxonomy, nodeName } from '../../lib/taxonomy.ts';",
    1,
)

load = "const taxonomy = loadTaxonomy();\n"
assert s.count(load) == 1, 'anchor 3 not found: the loadTaxonomy call from Task B2.3'
s = s.replace(
    load,
    load
    + """const skills = loadSkills();
const counts = countBySlug(skills);
const security = taxonomy.domains.find((domain) => domain.slug === 'security');
if (security === undefined) {
  throw new Error('data/taxonomy.json has no "security" domain: the home page cannot expand it');
}
const securityChildren = security.children ?? [];
""",
    1,
)

tail = """  </dl>
</Layout>
"""
assert s.count(tail) == 1, 'anchor 4 not found: the end of the stats strip from Task B2.3'
s = s.replace(
    tail,
    """  </dl>

  <section id="taxonomy" class="domain" aria-labelledby="security-heading">
    <h2 class="domain__title" id="security-heading">{nodeName('security', lang)}</h2>
    <p class="domain__lead">{t('home.securityLead', lang)}</p>
    <ul class="grid" data-grid="security">
      {
        securityChildren.map((child) => (
          <TaxonomyNode
            slug={child.slug}
            count={counts.get(child.slug) ?? 0}
            minimumMass={taxonomy.minimumMass}
            lang={lang}
          />
        ))
      }
    </ul>
  </section>
</Layout>
""",
    1,
)

assert s.count('</style>') == 1, 'anchor 5 not found: this page has exactly one style block'
s = s.replace(
    '</style>',
    """  .domain {
    margin-block: 2.5rem;
    /* WCAG 2.2 2.4.11: a sticky header must not cover the node a link jumps to. */
    scroll-margin-top: 5rem;
  }
  .domain__title {
    margin: 0 0 0.25rem;
    font-family: var(--font-mono);
    font-size: var(--text-lg);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .domain__lead {
    margin: 0 0 1rem;
    max-width: 62ch;
    font-size: var(--text-sm);
    color: var(--muted-foreground);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
    gap: 0.5rem;
    margin: 0;
    padding: 0;
  }
</style>""",
    1,
)

p.write_text(s, encoding='utf-8')
PY
```

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/build/home-taxonomy.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 6: Type-check**
Run: `npm run typecheck`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**
```bash
git add src/components/TaxonomyNode.astro 'src/pages/[lang]/index.astro' tests/build/home-taxonomy.test.ts
git commit -m "feat(home): expand Security into a grid whose three states never lie"
```

---

### Task B2.6: The other domains, present and honestly thin

Below Security sit the remaining top-level domains. They reuse the same component and the same
three states, but at domain granularity: a domain's count aggregates every **listed** entry filed
anywhere beneath it, counted once per skill, since one skill can hold two slugs in the same domain.
`countDomain` (B2.2) applies the `listed` filter itself, so an entry the §5.1 cap evicted cannot
lift a domain over minimum mass here either. Their links carry `?domain=` rather than `?subdomain=`,
so the catalog filters to the whole subtree.

**Files:**
- Modify: `src/pages/[lang]/index.astro` (three anchored edits, below)
- Test: `tests/build/home-domains.test.ts`

**Interfaces:**
- Consumes: `countDomain(skills, domainSlug)` from `src/lib/taxonomy.ts`;
  `src/components/TaxonomyNode.astro` with `filterKey="domain"`
- Produces: `<section id="other-domains">` holding `<ul class="grid" data-grid="domains">`, one
  node per non-security domain, each active one linking to `/{lang}/catalog/?domain=<encoded slug>`

- [ ] **Step 1: Write the failing test**
```bash
cat > tests/build/home-domains.test.ts <<'TS'
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { countDomain, loadTaxonomy, nodeName } from '../../src/lib/taxonomy.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function built(page: string): string {
  const file = `${ROOT}dist/${page}`;
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

interface RenderedNode {
  slug: string;
  state: string;
  count: number;
  html: string;
}

function grid(html: string, key: string): string {
  const open = html.indexOf(`data-grid="${key}"`);
  if (open === -1) throw new Error(`the built page has no <ul data-grid="${key}"> grid`);
  const close = html.indexOf('</ul>', open);
  return html.slice(open, close);
}

function nodes(html: string, key: string): RenderedNode[] {
  const section = grid(html, key);
  const out: RenderedNode[] = [];
  for (const match of section.matchAll(/<li[^>]*data-slug="([^"]+)"[^>]*>/g)) {
    const start = match.index ?? 0;
    const stop = section.indexOf('</li>', start);
    out.push({
      slug: match[1],
      state: /data-state="([a-z]+)"/.exec(match[0])?.[1] ?? '',
      count: Number(/data-count="(\d+)"/.exec(match[0])?.[1] ?? Number.NaN),
      html: section.slice(start, stop + 5).replace(/\s+/g, ' '),
    });
  }
  return out;
}

const en = built('en/index.html');
const pt = built('pt/index.html');
const taxonomy = loadTaxonomy();
const skills = loadSkills();
const others = taxonomy.domains.filter((domain) => domain.slug !== 'security');

describe('the other top-level domains', () => {
  it('renders every domain except security, once each, in taxonomy order', () => {
    const slugs = nodes(en, 'domains').map((node) => node.slug);
    expect(slugs).toEqual(others.map((domain) => domain.slug));
    expect(slugs).not.toContain('security');
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('counts everything filed anywhere beneath a domain, once per skill', () => {
    for (const node of nodes(en, 'domains')) {
      expect(node.count, `${node.slug} count`).toBe(countDomain(skills, node.slug));
    }
  });

  it('counts only listed entries, so an evicted one cannot prop a domain above minimum mass', () => {
    for (const node of nodes(en, 'domains')) {
      const listed = skills.filter(
        (skill) =>
          skill.listed &&
          [skill.primary, ...skill.also].some(
            (slug) => slug === node.slug || slug.startsWith(`${node.slug}/`),
          ),
      ).length;
      expect(node.count, `${node.slug} counts an entry the cap evicted`).toBe(listed);
    }
  });

  it('puts every domain in the one state its count earns', () => {
    const mass = taxonomy.minimumMass;
    for (const node of nodes(en, 'domains')) {
      const expected = node.count === 0 ? 'empty' : node.count < mass ? 'thin' : 'active';
      expect(node.state, `${node.slug} holds ${node.count} of ${mass}`).toBe(expected);
    }
  });

  it('filters the catalog by domain, never by subdomain, from this section', () => {
    expect(grid(en, 'domains').includes('?subdomain='), 'a domain node filters by subdomain').toBe(
      false,
    );
    for (const node of nodes(en, 'domains').filter((n) => n.state === 'active')) {
      const href = `/ai-tools-hub/en/catalog/?domain=${encodeURIComponent(node.slug)}`;
      expect(node.html.includes(`href="${href}"`), `${node.slug} does not link to ${href}`).toBe(
        true,
      );
    }
  });

  it('leaves a thin or empty domain unclickable, exactly like a subdomain', () => {
    for (const node of nodes(en, 'domains').filter((n) => n.state !== 'active')) {
      expect(
        node.html.includes('<a'),
        `${node.slug} is ${node.state} but still renders an anchor`,
      ).toBe(false);
    }
  });

  it('heads the section in both locales', () => {
    expect(en.includes(t('home.otherHeading', 'en')), 'no en heading').toBe(true);
    expect(en.includes(t('home.otherLead', 'en')), 'no en lead').toBe(true);
    expect(pt.includes(t('home.otherHeading', 'pt')), 'no pt heading').toBe(true);
    expect(pt.includes(t('home.otherLead', 'pt')), 'no pt lead').toBe(true);
  });

  it('labels each domain from the taxonomy on the pt route', () => {
    for (const node of nodes(pt, 'domains')) {
      expect(
        node.html.includes(nodeName(node.slug, 'pt')),
        `${node.slug} is not labelled in pt-BR`,
      ).toBe(true);
    }
  });
});
TS
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/home-domains.test.ts`
Expected: FAIL with `Error: the built page has no <ul data-grid="domains"> grid`

- [ ] **Step 3: Add the section to the page**
```bash
python3 - <<'PY'
from pathlib import Path

p = Path('src/pages/[lang]/index.astro')
s = p.read_text(encoding='utf-8')

tax_import = "import { countBySlug, loadTaxonomy, nodeName } from '../../lib/taxonomy.ts';"
assert s.count(tax_import) == 1, 'anchor 1 not found: the taxonomy import from Task B2.5'
s = s.replace(
    tax_import,
    "import { countBySlug, countDomain, loadTaxonomy, nodeName } from '../../lib/taxonomy.ts';",
    1,
)

children = "const securityChildren = security.children ?? [];\n"
assert s.count(children) == 1, 'anchor 2 not found: the securityChildren constant from Task B2.5'
s = s.replace(
    children,
    children
    + "const otherDomains = taxonomy.domains.filter((domain) => domain.slug !== 'security');\n",
    1,
)

tail = """  </section>
</Layout>
"""
assert s.count(tail) == 1, 'anchor 3 not found: the end of the security section from Task B2.5'
s = s.replace(
    tail,
    """  </section>

  <section id="other-domains" class="domain" aria-labelledby="other-heading">
    <h2 class="domain__title" id="other-heading">{t('home.otherHeading', lang)}</h2>
    <p class="domain__lead">{t('home.otherLead', lang)}</p>
    <ul class="grid" data-grid="domains">
      {
        otherDomains.map((domain) => (
          <TaxonomyNode
            slug={domain.slug}
            count={countDomain(skills, domain.slug)}
            minimumMass={taxonomy.minimumMass}
            lang={lang}
            filterKey="domain"
          />
        ))
      }
    </ul>
  </section>
</Layout>
""",
    1,
)

p.write_text(s, encoding='utf-8')
PY
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/build/home-domains.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Type-check and run the whole suite**
Run: `npm run typecheck && npx vitest run`
Expected: no type errors; every test passes, including B1's `locale-routes`, `lang-switcher` and
`base-path` build tests over the same `dist/en/index.html` this section now produces.

- [ ] **Step 6: Commit**
```bash
git add 'src/pages/[lang]/index.astro' tests/build/home-domains.test.ts
git commit -m "feat(home): list the other domains with domain-level counts and states"
```

---

## Section B4 — the skill card and the per-skill page

**Execution order (RULE 4):** B1 → B2 → **B4** → B3 → B5. This section consumes nothing from B3.
It produces the card, the per-skill route and that route's Pagefind index block, which B3's catalog
and B5's rescue index both build on. No other section edits a file B4 owns.

**Files this section creates, and no other section may create:**
`src/lib/slug.ts` · `src/lib/i18n/skill.ts` · `src/components/SkillCard.astro` ·
`src/components/SafetyStrip.astro` · `src/pages/[lang]/skills/[...slug].astro`
(plus its own tests and `tests/helpers/skill-card.ts`).

**Files this section reads but never writes:** `src/types.ts`, `src/lib/link.ts` (A1);
`src/styles/theme.css` (A2 — including the sole definition of `--color-hazard`);
`src/lib/taxonomy.ts` (A3); `src/lib/data.ts` (A6); `src/components/Layout.astro`,
`src/lib/format.ts` (B1); `data/skills.json`, `data/collections.json` (seeded by B2, overwritten by
the crawl). **All data access goes through A6's loaders** — `loadSkills(): Skill[]`,
`loadCollections(): Collection[]` — in pages *and* in tests. There is no `JSON.parse` of a data
file anywhere in this section.

**Tests never build (RULE 6).** `vitest.config.ts` (A1) runs `astro build` once in
`tests/global-setup.ts`; every command below is `npx vitest run <file>` and every build-output test
only reads `dist/`.

---

---

### Task B4.1: Per-skill identity and source URLs

**Files:**
- Create: `src/lib/slug.ts`
- Test: `tests/lib/skill-slug.test.ts`

**Interfaces:**
- Consumes: `Lang`, `Skill` from `src/types.ts` (A1); `withBase(path: string): string` from `src/lib/link.ts` (A1)
- Produces: `skillSlug(skill: Skill): string` — **the one and only slug function in the project (RULE 4)**; `skillHref(skill: Skill, lang: Lang): string`; `officialFileUrl(skill: Skill): string`; `rawFileUrl(skill: Skill): string`

The slug is built from `repo` plus the directory of `path`, and **never from `sha`**: the sha changes
on every upstream commit, so a sha-shaped URL would break every bookmark the night after it is
shared. The two source URLs go the other way — they *must* pin the sha, because "the exact bytes we
indexed" is the claim (§1.1). Both use `skill.sha`, the **commit** sha carried by
`skill.id` = `owner/repo@sha:path`, never a blob sha (RULE 5).

- [ ] **Step 1: Write the failing test**

Create `tests/lib/skill-slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Skill } from '../../src/types.ts';
import { withBase } from '../../src/lib/link.ts';
import { officialFileUrl, rawFileUrl, skillHref, skillSlug } from '../../src/lib/slug.ts';

const SHA = 'a71b0c3d5e2f48916d84ab0c5f7e3d2190b46c8a';

/** A contract-valid Skill: score === breakdown.total, every component inside its cap, listed. */
function makeSkill(overrides: Partial<Skill> = {}): Skill {
  const repo = overrides.repo ?? 'anthropics/skills';
  const path = overrides.path ?? 'document-skills/pdf/SKILL.md';
  const sha = overrides.sha ?? SHA;
  return {
    id: `${repo}@${sha}:${path}`,
    type: 'skill',
    name: 'PDF Toolkit',
    description: 'Fills, merges and extracts text from PDF documents using local tooling.',
    descriptionPt: null,
    longPt: null,
    repo,
    path,
    sha,
    updatedDays: 12,
    indexedAt: '2026-08-28',
    license: 'Apache-2.0',
    licenseSource: 'sibling',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false,
      scriptCount: 0,
      languages: [],
      network: false,
      readsEnv: false,
      declaredTools: null,
    },
    primary: 'security/supply-chain',
    also: [],
    tags: ['pdf'],
    securityRelevant: false,
    score: 86,
    breakdown: { adoption: 25, maintenance: 27, provenance: 20, completeness: 14, total: 86 },
    listed: true,
    ...overrides,
  };
}

describe('skillSlug', () => {
  it('drops the SKILL.md filename and keeps owner, repo and directory', () => {
    expect(skillSlug(makeSkill())).toBe('anthropics/skills/document-skills/pdf');
  });

  it('returns owner/repo for a SKILL.md sitting at the repository root', () => {
    expect(skillSlug(makeSkill({ repo: 'acme-labs/agent-kit', path: 'SKILL.md' })))
      .toBe('acme-labs/agent-kit');
  });

  it('lowercases and replaces characters that are not URL safe', () => {
    expect(skillSlug(makeSkill({ repo: 'Acme Labs/Agent Kit', path: 'Skills/K8s Audit/SKILL.md' })))
      .toBe('acme-labs/agent-kit/skills/k8s-audit');
  });

  it('matches the SKILL.md filename case-insensitively', () => {
    expect(skillSlug(makeSkill({ repo: 'a/b', path: 'x/skill.md' }))).toBe('a/b/x');
  });

  it('never puts the sha in the slug, so a new commit cannot break a bookmark', () => {
    const before = makeSkill();
    const after = makeSkill({ sha: '0f1e2d3c4b5a69788796a5b4c3d2e1f009182736' });
    expect(skillSlug(after)).toBe(skillSlug(before));
    expect(skillSlug(after)).not.toContain(after.sha);
  });
});

describe('skillHref', () => {
  it('builds a base-aware, language-scoped, trailing-slash URL', () => {
    expect(skillHref(makeSkill(), 'en'))
      .toBe(withBase('/en/skills/anthropics/skills/document-skills/pdf/'));
  });

  it('scopes the same skill under each locale', () => {
    const skill = makeSkill();
    expect(skillHref(skill, 'pt')).toBe(withBase('/pt/skills/anthropics/skills/document-skills/pdf/'));
    expect(skillHref(skill, 'pt')).not.toBe(skillHref(skill, 'en'));
  });
});

describe('officialFileUrl and rawFileUrl', () => {
  it('links the GitHub blob for the exact indexed commit', () => {
    expect(officialFileUrl(makeSkill())).toBe(
      `https://github.com/anthropics/skills/blob/${SHA}/document-skills/pdf/SKILL.md`,
    );
  });

  it('points the raw fetch at raw.githubusercontent.com', () => {
    expect(rawFileUrl(makeSkill())).toBe(
      `https://raw.githubusercontent.com/anthropics/skills/${SHA}/document-skills/pdf/SKILL.md`,
    );
  });

  it('builds both source URLs from the commit sha carried by the id, never a blob sha', () => {
    const skill = makeSkill();
    const commit = skill.id.split('@')[1].split(':')[0];
    expect(commit).toBe(skill.sha);
    expect(officialFileUrl(skill)).toContain(`/blob/${commit}/`);
    expect(rawFileUrl(skill)).toContain(`/${commit}/`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/skill-slug.test.ts`

Expected: FAIL — the module does not exist, so Vite cannot resolve it and the file never runs:
`Error: Failed to resolve import "../../src/lib/slug.ts" from "tests/lib/skill-slug.test.ts". Does the file exist?`

- [ ] **Step 3: Write the module**

Create `src/lib/slug.ts`:

```ts
import type { Lang, Skill } from '../types.ts';
import { withBase } from './link.ts';

const SKILL_FILE = /(^|\/)SKILL\.md$/i;

function slugSegment(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Stable per-skill path segment: owner/repo/<dir of SKILL.md>. Never includes the sha. */
export function skillSlug(skill: Skill): string {
  const dir = skill.path.replace(SKILL_FILE, '');
  return [...skill.repo.split('/'), ...dir.split('/')]
    .map(slugSegment)
    .filter(Boolean)
    .join('/');
}

export function skillHref(skill: Skill, lang: Lang): string {
  return withBase(`/${lang}/skills/${skillSlug(skill)}/`);
}

/** The source file on GitHub, pinned to the commit we indexed. */
export function officialFileUrl(skill: Skill): string {
  return `https://github.com/${skill.repo}/blob/${skill.sha}/${skill.path}`;
}

/** The same file as plain text: unauthenticated, CORS `*`, fetchable from the browser (§6.1). */
export function rawFileUrl(skill: Skill): string {
  return `https://raw.githubusercontent.com/${skill.repo}/${skill.sha}/${skill.path}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/skill-slug.test.ts`

Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slug.ts tests/lib/skill-slug.test.ts
git commit -m "feat(slug): one skill slug plus base-aware and commit-pinned source URLs"
```

---

### Task B4.2: The `skill` i18n namespace

**Files:**
- Create: `src/lib/i18n/skill.ts`
- Test: `tests/lib/i18n-skill.test.ts`

**Interfaces:**
- Consumes: `Lang` from `src/types.ts` (A1)
- Produces: default export `{ en, pt }` keyed by `Lang`, every key prefixed `skill.`; the named type export `SkillKey`

RULE 3: one i18n file per owner, identical EN/PT key sets, and **never a string another section
owns** — nothing here duplicates B1's chrome or B3's facet labels. The
`Record<keyof typeof en, string>` annotation on `pt` makes a missing or extra Portuguese key a
compile error; B1's merged-namespace parity test catches the same defect at runtime once
`src/lib/i18n/index.ts` merges this file.

`SkillCard.astro` and `SafetyStrip.astro` import this module **directly** rather than through B1's
`t()`. Both routes are equivalent for the reader, but the direct import is typed — `L('skill.nope')`
is a compile error, where `t('skill.nope', lang)` silently returns the key — and it means the card
cannot render key names on a page if B1's merge list ever misses a namespace.

- [ ] **Step 1: Write the failing test**

Create `tests/lib/i18n-skill.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import strings from '../../src/lib/i18n/skill.ts';

describe('the skill i18n namespace', () => {
  it('default-exports an en and a pt table', () => {
    expect(Object.keys(strings).sort()).toEqual(['en', 'pt']);
  });

  it('carries identical key sets in both locales', () => {
    expect(Object.keys(strings.pt).sort()).toEqual(Object.keys(strings.en).sort());
  });

  it('namespaces every key under skill., so nothing collides on merge', () => {
    for (const key of Object.keys(strings.en)) {
      expect(key.startsWith('skill.'), `${key} is not namespaced`).toBe(true);
    }
  });

  it('has no empty value in either locale', () => {
    for (const locale of ['en', 'pt'] as const) {
      for (const [key, value] of Object.entries(strings[locale])) {
        expect(value.trim(), `${locale}.${key} is empty`).not.toBe('');
      }
    }
  });

  it('is really translated, not an English copy', () => {
    const same = Object.keys(strings.en).filter((key) => {
      const k = key as keyof typeof strings.en;
      return strings.en[k] === strings.pt[k];
    });
    // "script", "scripts", "Forks" and "Total" are the same word in both locales.
    expect(same.length).toBeLessThanOrEqual(4);
  });

  it('never offers a safe or success word as a safety state', () => {
    for (const locale of ['en', 'pt'] as const) {
      for (const value of Object.values(strings[locale])) {
        expect(value).not.toMatch(/\bsafe\b|\bsecure\b|\bsuccess\b|\bseguro\b|\bsegura\b/i);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/i18n-skill.test.ts`

Expected: FAIL — the module does not exist, so Vite cannot resolve it and the file never runs:
`Error: Failed to resolve import "../../src/lib/i18n/skill.ts" from "tests/lib/i18n-skill.test.ts". Does the file exist?`

- [ ] **Step 3: Write the namespace**

Create `src/lib/i18n/skill.ts`:

```ts
import type { Lang } from '../../types.ts';

const en = {
  'skill.breadcrumb': 'Breadcrumb',
  'skill.home': 'Home',
  'skill.rankLabel': 'Rank',
  'skill.scoreLabel': 'Score',
  'skill.runtimes': 'Runtime compatibility',
  'skill.supported': 'supported',
  'skill.unsupported': 'not supported',
  'skill.safetyTitle': 'Derived safety signals',
  'skill.executes': 'Executes code',
  'skill.script': 'script',
  'skill.scripts': 'scripts',
  'skill.noScripts': 'No scripts',
  'skill.network': 'Network',
  'skill.networkYes': 'Makes network calls',
  'skill.networkNo': 'No network calls',
  'skill.env': 'Environment',
  'skill.envYes': 'Reads environment variables',
  'skill.envNo': 'No environment reads',
  'skill.tools': 'Declared tools',
  'skill.toolsNotDeclared': 'Not declared',
  'skill.source': 'Source',
  'skill.stars': 'Stars',
  'skill.forks': 'Forks',
  'skill.picked': 'Picked',
  'skill.updated': 'Updated',
  'skill.scoreBreakdown': 'Score breakdown',
  'skill.adoption': 'Adoption',
  'skill.maintenance': 'Maintenance',
  'skill.provenanceScore': 'Provenance',
  'skill.completeness': 'Completeness',
  'skill.total': 'Total',
  'skill.provenance': 'Provenance',
  'skill.officialFile': 'Official file',
  'skill.install': 'Install',
  'skill.copy': 'Copy',
  'skill.copied': 'Copied',
  'skill.license': 'License',
  'skill.licenseNotDeclared': 'Not declared',
  'skill.bodySource': 'Full text is fetched from the source repository.',
  'skill.bodyUnavailable': 'The full text could not be fetched. The description above is what we indexed.',
  'skill.machineTranslated': 'Machine-translated.',
  'skill.seeOriginal': 'See original',
} as const;

const pt: Record<keyof typeof en, string> = {
  'skill.breadcrumb': 'Trilha de navegação',
  'skill.home': 'Início',
  'skill.rankLabel': 'Posição',
  'skill.scoreLabel': 'Pontuação',
  'skill.runtimes': 'Compatibilidade de runtime',
  'skill.supported': 'compatível',
  'skill.unsupported': 'não compatível',
  'skill.safetyTitle': 'Sinais de risco derivados',
  'skill.executes': 'Executa código',
  'skill.script': 'script',
  'skill.scripts': 'scripts',
  'skill.noScripts': 'Sem scripts',
  'skill.network': 'Rede',
  'skill.networkYes': 'Faz chamadas de rede',
  'skill.networkNo': 'Sem chamadas de rede',
  'skill.env': 'Ambiente',
  'skill.envYes': 'Lê variáveis de ambiente',
  'skill.envNo': 'Não lê o ambiente',
  'skill.tools': 'Ferramentas declaradas',
  'skill.toolsNotDeclared': 'Não declaradas',
  'skill.source': 'Origem',
  'skill.stars': 'Estrelas',
  'skill.forks': 'Forks',
  'skill.picked': 'Coletado',
  'skill.updated': 'Atualizado',
  'skill.scoreBreakdown': 'Composição da pontuação',
  'skill.adoption': 'Adoção',
  'skill.maintenance': 'Manutenção',
  'skill.provenanceScore': 'Procedência',
  'skill.completeness': 'Completude',
  'skill.total': 'Total',
  'skill.provenance': 'Procedência',
  'skill.officialFile': 'Arquivo oficial',
  'skill.install': 'Instalar',
  'skill.copy': 'Copiar',
  'skill.copied': 'Copiado',
  'skill.license': 'Licença',
  'skill.licenseNotDeclared': 'Não declarada',
  'skill.bodySource': 'O texto completo é buscado no repositório de origem.',
  'skill.bodyUnavailable': 'Não foi possível buscar o texto completo. A descrição acima é a que indexamos.',
  'skill.machineTranslated': 'Tradução automática.',
  'skill.seeOriginal': 'Ver original',
};

export type SkillKey = keyof typeof en;

const strings: Record<Lang, Record<SkillKey, string>> = { en, pt };
export default strings;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/i18n-skill.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n/skill.ts tests/lib/i18n-skill.test.ts
git commit -m "feat(i18n): hand-written EN and pt-BR strings for the skill card"
```

---

### Task B4.3: The card identity block and the per-skill route

**Files:**
- Create: `src/components/SkillCard.astro`
- Create: `src/pages/[lang]/skills/[...slug].astro`
- Create: `tests/helpers/skill-card.ts`
- Test: `tests/build/skill-page-routes.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Lang`, `Skill` from `src/types.ts` (A1); `withBase` from `src/lib/link.ts` (A1); `nodeName(slug: string, lang: Lang): string` from `src/lib/taxonomy.ts` (A3); `loadSkills(): Skill[]`, `loadCollections(): Collection[]` from `src/lib/data.ts` (A6); `Layout.astro` from `src/components/Layout.astro` (B1) with `Props { lang: Lang; title: string; description?: string; path?: string }` and its named slot `head`; the `Skill.listed` field (A1, §5.1); `skillSlug` from `src/lib/slug.ts`; the default export of `src/lib/i18n/skill.ts`
- Produces: `src/components/SkillCard.astro` with
  `Props { skill: Skill; lang: Lang; rank?: number | null; collection?: Collection | null; expanded?: boolean; filteredCategory?: string | null }`;
  the routes `/{lang}/skills/{skillSlug}/`; the test helper module every later task reuses
- **A page for every skill, listed or not (§5.1):** eviction from the per-subdomain cap sets
  `listed` to false; it never removes the row, so this route keeps generating the page from the
  skill's current score and dates. The only thing `listed` changes here is one line in `<head>`:
  when `!skill.listed` the page emits `<meta name="robots" content="noindex">` through the layout's
  `head` slot, so a search engine is not offered an entry the catalog does not list. **No banner, no
  tombstone styling, no dimming** — the page renders exactly as a listed one. That is a product
  decision, not an oversight: the entry is still real, still scored and still dated, it simply is not
  one of the 60 its subdomain lists. Task B4.13 drops the Pagefind block on the same condition, and
  those two are the route's only branches on `listed`.
- **The score chip is a link, emitted here (RULE 8, §10.6):** the chip is

  ```astro
  <a class="skill-card__score" data-field="score" href={withBase(`/${lang}/methodology/#score`)}>{skill.score}</a>
  ```

  B5 builds `/{lang}/methodology/` later in the plan, so until that task lands the link 404s. That is
  the expected intermediate state of a plan applied in dependency order, not a defect — and no later
  section modifies this element.
- **The rank carries two hooks:** `data-field="rank"`, which this section's assertions read, and
  `data-rank`, which B3's catalog reads when it renumbers on a sort change. One element, both
  attributes, so neither side has to edit the other's file.
- **Contract for B3:** every prop but `skill` and `lang` is optional, so `<SkillCard skill={…} lang={lang} />`
  compiles. The card is a grid *item*: it exposes `[open]` and `data-skill-id`, and the catalog owner
  sets `grid-template-columns` and the `[open]` span. B4 ships no grid.

There is exactly **one** per-skill route and it is a rest route (RULE 4): the slug carries slashes
(`anthropics/skills/document-skills/pdf`), which `[slug].astro` cannot express. Two skills resolving
to one slug throws at build time naming both ids — a silently dropped skill would be a lie about the
corpus.

`<summary>` here holds flow content (a heading, a list, a metadata block). That is outside the
letter of the HTML content model and universally supported; the alternative — a button plus a
separately toggled region — costs the native exclusive-accordion behaviour used in Task B4.11 and
the working open state with JavaScript off.

- [ ] **Step 1: Write the shared test helper**

Create `tests/helpers/skill-card.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Lang, Skill } from '../../src/types.ts';
import { skillSlug } from '../../src/lib/slug.ts';

export const ROOT = process.cwd();
export const DIST = join(ROOT, 'dist');

export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function distFiles(extension: string): string[] {
  return walk(DIST).filter((file) => file.endsWith(extension));
}

/** Every stylesheet the site ships: real .css files and inlined <style> blocks, with their source. */
export function sheets(): Array<{ from: string; css: string }> {
  const out: Array<{ from: string; css: string }> = [];
  for (const file of distFiles('.css')) {
    out.push({ from: relative(ROOT, file), css: readFileSync(file, 'utf8') });
  }
  for (const file of distFiles('.html')) {
    const html = readFileSync(file, 'utf8');
    for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      out.push({ from: relative(ROOT, file), css: match[1] });
    }
  }
  return out;
}

export function allCss(): string {
  return sheets().map((sheet) => sheet.css).join('\n');
}

/** Every hoisted client bundle the site ships. */
export function bundles(): Array<{ from: string; js: string }> {
  return distFiles('.js').map((file) => ({ from: relative(ROOT, file), js: readFileSync(file, 'utf8') }));
}

export function pageFor(lang: Lang, skill: Skill): string {
  const file = join(DIST, lang, 'skills', ...skillSlug(skill).split('/'), 'index.html');
  if (!existsSync(file)) throw new Error(`no built page at ${relative(ROOT, file)}`);
  return readFileSync(file, 'utf8');
}

export function mainOf(html: string): string {
  const open = html.indexOf('<main');
  const close = html.indexOf('</main>', open);
  if (open === -1 || close === -1) throw new Error('no <main> element in the built page');
  return html.slice(open, close);
}

export function cardOf(html: string): string {
  const open = html.indexOf('<details');
  const close = html.indexOf('</details>', open);
  if (open === -1 || close === -1) throw new Error('no skill card in the built page');
  return html.slice(open, close + '</details>'.length);
}

export function summaryOf(card: string): string {
  const at = card.indexOf('</summary>');
  if (at === -1) throw new Error('the skill card has no <summary>');
  return card.slice(0, at);
}

export function panelOf(card: string): string {
  const at = card.indexOf('</summary>');
  if (at === -1) throw new Error('the skill card has no <summary>');
  return card.slice(at + '</summary>'.length);
}

/** The opening tag of the first element carrying `attribute`, e.g. 'data-signal="env"'. */
export function tagWith(html: string, attribute: string): string {
  const at = html.indexOf(attribute);
  if (at === -1) throw new Error(`no element with ${attribute} in the built card`);
  const open = html.lastIndexOf('<', at);
  const close = html.indexOf('>', at);
  if (open === -1 || close === -1) throw new Error(`malformed tag around ${attribute}`);
  return html.slice(open, close + 1);
}

/** The first element carrying `attribute`, opening tag through its matching close tag. */
export function elementWith(html: string, attribute: string): string {
  const tag = tagWith(html, attribute);
  const name = /^<([a-z0-9-]+)/i.exec(tag)?.[1];
  if (!name) throw new Error(`could not read a tag name from ${tag}`);
  const start = html.indexOf(tag);
  const opener = new RegExp(`<${name}[\\s>]`, 'gi');
  const closer = `</${name}>`;
  let depth = 0;
  let cursor = start;
  while (cursor < html.length) {
    opener.lastIndex = cursor;
    const next = opener.exec(html);
    const end = html.indexOf(closer, cursor);
    if (end === -1) throw new Error(`unclosed <${name}> around ${attribute}`);
    if (next && next.index < end) {
      depth += 1;
      cursor = next.index + 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) return html.slice(start, end + closer.length);
    cursor = end + closer.length;
  }
  throw new Error(`unclosed <${name}> around ${attribute}`);
}

/**
 * Class tokens of an opening tag, as a set. Never compare a whole class="…" string:
 * Astro rewrites markup around it and attribute order is not ours to promise.
 */
export function classesOf(tag: string): string[] {
  const match = /class="([^"]*)"/.exec(tag);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ',
};

/** Visible text of an HTML fragment, tags stripped and entities decoded. */
export function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => ENTITIES[name])
    .replace(/\s+/g, ' ')
    .trim();
}

export function occurrences(haystack: string, needle: string): number {
  return needle === '' ? 0 : haystack.split(needle).length - 1;
}

/** The corpus in the order the route ranks it: score descending, id as tie-break. */
export function ranked(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/build/skill-page-routes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { withBase } from '../../src/lib/link.ts';
import { nodeName } from '../../src/lib/taxonomy.ts';
import {
  cardOf, classesOf, elementWith, mainOf, pageFor, ranked, summaryOf, tagWith, text,
} from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const ORDER = ranked(SKILLS);
const LOCALES = ['en', 'pt'] as const;

/** §7's rule, restated here rather than imported, so one edit cannot move both sides. */
function clip(input: string): string {
  const value = input.trim().replace(/\s+/g, ' ');
  return value.length <= 160 ? value : `${value.slice(0, 159).trimEnd()}…`;
}

describe('the per-skill static page', () => {
  it('has a corpus to render at all', () => {
    expect(SKILLS.length).toBeGreaterThan(0);
  });

  it('builds one page per skill in both locales, carrying the skill id', () => {
    for (const lang of LOCALES) {
      for (const skill of SKILLS) {
        expect(cardOf(pageFor(lang, skill))).toContain(`data-skill-id="${skill.id}"`);
      }
    }
  });

  it('noindexes an evicted entry and leaves a listed one indexable', () => {
    for (const lang of LOCALES) {
      for (const skill of SKILLS) {
        const noindexed = /<meta[^>]+name="robots"[^>]+content="noindex"/.test(pageFor(lang, skill));
        expect(noindexed, skill.id).toBe(!skill.listed);
      }
    }
  });

  it('gives every card the same class list, so an evicted entry gets no tombstone styling', () => {
    for (const skill of SKILLS) {
      const tag = tagWith(cardOf(pageFor('en', skill)), 'data-skill-id=');
      expect(classesOf(tag), skill.id).toEqual(['skill-card']);
    }
  });

  it('sets the document language per locale', () => {
    const skill = ORDER[0];
    expect(pageFor('en', skill)).toContain('lang="en"');
    expect(pageFor('pt', skill)).toContain('lang="pt-BR"');
  });

  it('titles the page with the skill name', () => {
    for (const skill of SKILLS) {
      const title = /<title>([\s\S]*?)<\/title>/.exec(pageFor('en', skill))?.[1] ?? '';
      expect(text(title)).toContain(text(skill.name));
    }
  });

  it('opens the card on arrival', () => {
    const tag = tagWith(cardOf(pageFor('en', ORDER[0])), 'data-skill-id=');
    expect(tag).toMatch(/\sopen(?=[\s>])/);
  });

  it('numbers the rank by descending score starting at 1', () => {
    expect(text(elementWith(cardOf(pageFor('en', ORDER[0])), 'data-field="rank"'))).toBe('#1');
    if (ORDER.length > 1) {
      expect(text(elementWith(cardOf(pageFor('en', ORDER[1])), 'data-field="rank"'))).toBe('#2');
    }
  });

  it('prints the composite score in a chip that links to the published formula', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      expect(text(elementWith(card, 'data-field="score"'))).toBe(String(skill.score));
      expect(tagWith(card, 'data-field="score"'))
        .toContain(`href="${withBase('/en/methodology/#score')}"`);
    }
  });

  it('shows the author name in the closed part of the card', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      expect(text(elementWith(summary, 'data-field="name"'))).toBe(text(skill.name));
    }
  });

  it('clips the card description to 160 characters', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      const shown = text(elementWith(summary, 'data-field="description"'));
      expect(shown.length).toBeLessThanOrEqual(160);
      expect(shown).toBe(clip(skill.description));
    }
  });

  it('prefers the translated short description on the pt route', () => {
    for (const skill of SKILLS.filter((s) => s.descriptionPt)) {
      const summary = summaryOf(cardOf(pageFor('pt', skill)));
      expect(text(elementWith(summary, 'data-field="description"'))).toBe(clip(skill.descriptionPt!));
    }
  });

  it('breadcrumbs home and the taxonomy path in the page language', () => {
    for (const lang of LOCALES) {
      const skill = ORDER[0];
      const crumbs = text(elementWith(mainOf(pageFor(lang, skill)), 'data-field="crumbs"'));
      expect(crumbs).toContain(strings[lang]['skill.home']);
      expect(crumbs).toContain(nodeName(skill.primary.split('/')[0], lang));
      expect(crumbs).toContain(nodeName(skill.primary, lang));
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-page-routes.test.ts`

Expected: FAIL — the route does not exist, so the global build emits no per-skill pages and
`pageFor` throws `Error: no built page at` followed by the missing `dist/en/skills/<slug>/index.html`
path. Twelve of the thirteen tests fail this way; `has a corpus to render at all` passes.

- [ ] **Step 4: Write the card**

Create `src/components/SkillCard.astro`:

```astro
---
import type { Lang, Skill } from '../types.ts';
import strings, { type SkillKey } from '../lib/i18n/skill.ts';
import { withBase } from '../lib/link.ts';

interface Props {
  skill: Skill;
  lang: Lang;
  rank?: number | null;
  collection?: import('../types.ts').Collection | null;
  expanded?: boolean;
  filteredCategory?: string | null;
}

const { skill, lang, rank = null, expanded = false } = Astro.props;
const L = (key: SkillKey): string => strings[lang][key];

/** §7: the author's own text, truncated on the card and full on expand. */
const MAX_DESCRIPTION = 160;
function clip(input: string): string {
  const value = input.trim().replace(/\s+/g, ' ');
  return value.length <= MAX_DESCRIPTION ? value : `${value.slice(0, MAX_DESCRIPTION - 1).trimEnd()}…`;
}
const shortDescription = clip(lang === 'pt' && skill.descriptionPt ? skill.descriptionPt : skill.description);
---

<details class="skill-card" data-skill-id={skill.id} open={expanded}>
  <summary class="skill-card__summary">
    <div class="skill-card__head">
      {rank !== null && <span class="skill-card__rank" data-field="rank" data-rank={rank}>#{rank}</span>}
      <a class="skill-card__score" data-field="score" href={withBase(`/${lang}/methodology/#score`)}>{skill.score}</a>
    </div>
    <h2 class="skill-card__name" data-field="name">{skill.name}</h2>
    <p class="skill-card__description" data-field="description">{shortDescription}</p>
  </summary>
  <div class="skill-card__panel">
  </div>
</details>

<style>
  .skill-card {
    border: 1px solid var(--color-n-6);
    background: var(--color-n-2);
    padding: 0;
  }
  .skill-card__summary {
    display: block;
    padding: 0.75rem;
    cursor: pointer;
    list-style: none;
  }
  .skill-card__summary::-webkit-details-marker { display: none; }
  .skill-card__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.75rem;
  }
  .skill-card__rank { color: var(--color-n-11); }
  .skill-card__score {
    margin-left: auto;
    color: var(--color-a-9);
    font-variant-numeric: tabular-nums;
  }
  .skill-card__name {
    margin: 0.5rem 0 0.25rem;
    font-size: 0.95rem;
    color: var(--color-n-12);
  }
  .skill-card__description {
    margin: 0;
    color: var(--color-n-11);
    font-size: 0.8rem;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .skill-card__panel {
    border-top: 1px solid var(--color-n-6);
    padding: 0.75rem;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
```

- [ ] **Step 5: Write the route**

Create `src/pages/[lang]/skills/[...slug].astro`:

```astro
---
import type { Collection, Lang, Skill } from '../../../types.ts';
import Layout from '../../../components/Layout.astro';
import SkillCard from '../../../components/SkillCard.astro';
import strings from '../../../lib/i18n/skill.ts';
import { loadCollections, loadSkills } from '../../../lib/data.ts';
import { nodeName } from '../../../lib/taxonomy.ts';
import { skillSlug } from '../../../lib/slug.ts';
import { withBase } from '../../../lib/link.ts';

type PageProps = { skill: Skill; rank: number; collection: Collection | null };

export function getStaticPaths() {
  const byRepo = new Map(loadCollections().map((collection) => [collection.repo, collection]));
  const ranked = [...loadSkills()].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const claimed = new Map<string, string>();
  const routes: Array<{ params: { lang: Lang; slug: string }; props: PageProps }> = [];

  ranked.forEach((skill, index) => {
    const slug = skillSlug(skill);
    const owner = claimed.get(slug);
    if (owner !== undefined) {
      throw new Error(`Duplicate skill slug "${slug}" claimed by ${owner} and ${skill.id}`);
    }
    claimed.set(slug, skill.id);
    for (const lang of ['en', 'pt'] as const) {
      routes.push({
        params: { lang, slug },
        props: { skill, rank: index + 1, collection: byRepo.get(skill.repo) ?? null },
      });
    }
  });

  return routes;
}

const { skill, rank, collection } = Astro.props as PageProps;
const lang = Astro.params.lang as Lang;
const s = strings[lang];
const domainSlug = skill.primary.split('/')[0];
const showNode = skill.primary !== domainSlug;
---

<Layout
  lang={lang}
  title={skill.name}
  description={skill.description}
  path={`/skills/${skillSlug(skill)}/`}
>
  {/* §5.1: an evicted row keeps this page, with its current score and dates, and leaves every
      index. Head only — nothing visible changes, and there is no tombstone. */}
  {!skill.listed && <meta slot="head" name="robots" content="noindex" />}
  <nav class="crumbs" data-field="crumbs" aria-label={s['skill.breadcrumb']}>
    <a class="crumbs__home" href={withBase(`/${lang}/`)}>{s['skill.home']}</a>
    <span class="crumbs__domain" data-field="crumb-domain">{nodeName(domainSlug, lang)}</span>
    {showNode && <span class="crumbs__node" data-field="crumb-node">{nodeName(skill.primary, lang)}</span>}
  </nav>
  <div class="detail">
    <SkillCard skill={skill} lang={lang} rank={rank} collection={collection} expanded={true} />
  </div>
</Layout>

<style>
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-n-11);
  }
  .crumbs__home { color: var(--color-a-9); }
  .detail { max-width: 44rem; }
</style>
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-page-routes.test.ts`

Expected: PASS — 13 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/SkillCard.astro "src/pages/[lang]/skills/[...slug].astro" \
        tests/helpers/skill-card.ts tests/build/skill-page-routes.test.ts
git commit -m "feat(skills): card identity block and one static page per skill"
```

---

### Task B4.4: Runtime LEDs, always all five

**Files:**
- Modify: `src/components/SkillCard.astro` (frontmatter constant, `.skill-card__head`, `<style>`)
- Test: `tests/build/skill-card-runtimes.test.ts`

**Interfaces:**
- Consumes: `Runtime` from `src/types.ts`; `skill.runtimes: Runtime[]`
- Produces: five `<li data-runtime>` elements per card, lit ones carrying the `led--on` class token

All five runtimes always render. An unlit LED says *we checked and it is not supported*; a missing
LED would say nothing at all. The order is `RUNTIME_ORDER` — claude, openclaw, codex, cursor,
generic — **never alphabetical** (RULE 5). The tuple is a local constant here rather than an import:
A5 owns the harvest-side copy in `scripts/harvest/enrich.ts` (a Node script the browser bundle must
not pull in) and B3 owns the rail copy in `src/lib/facets.ts`, which runs *after* this section and
which B4 may not consume. All three are the same five values, and each has a test pinning it to the
literal.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-runtimes.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const ORDER = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

function leds(card: string): string[] {
  return [...card.matchAll(/data-runtime="([^"]+)"/g)].map((match) => match[1]);
}

describe('runtime LEDs', () => {
  it('renders all five runtimes on every card, supported or not', () => {
    for (const skill of SKILLS) {
      expect(leds(cardOf(pageFor('en', skill)))).toHaveLength(5);
    }
  });

  it('keeps them in RUNTIME_ORDER, never alphabetical', () => {
    for (const skill of SKILLS) {
      expect(leds(cardOf(pageFor('en', skill)))).toEqual(ORDER);
    }
  });

  it('lights exactly the runtimes the skill declares', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      for (const runtime of ORDER) {
        const lit = classesOf(tagWith(card, `data-runtime="${runtime}"`)).includes('led--on');
        expect(lit, `${skill.id} / ${runtime}`).toBe(skill.runtimes.includes(runtime as never));
      }
    }
  });

  it('gives every LED a screen-reader state in the page language', () => {
    for (const lang of ['en', 'pt'] as const) {
      const skill = SKILLS[0];
      const card = cardOf(pageFor(lang, skill));
      for (const runtime of ORDER) {
        const expected = skill.runtimes.includes(runtime as never)
          ? strings[lang]['skill.supported']
          : strings[lang]['skill.unsupported'];
        expect(text(elementWith(card, `data-runtime="${runtime}"`))).toContain(expected);
      }
    }
  });

  it('hides the coloured dot itself from assistive technology', () => {
    const led = elementWith(cardOf(pageFor('en', SKILLS[0])), 'data-runtime="claude"');
    expect(led).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-runtimes.test.ts`

Expected: FAIL — the card renders no LEDs, so `leds()` returns an empty array
(`AssertionError: expected [] to have a length of 5 but got +0`) and the tests that reach for one
throw the helper's `Error: no element with data-runtime="claude" in the built card`.

- [ ] **Step 3: Add the constant**

In `src/components/SkillCard.astro`, insert immediately after the line
`const L = (key: SkillKey): string => strings[lang][key];`:

```ts

/** RULE 5. A5's harvest copy and B3's rail copy carry the same five values in the same order. */
const RUNTIME_ORDER = ['claude', 'openclaw', 'codex', 'cursor', 'generic'] as const;
```

- [ ] **Step 4: Render the LEDs**

In `src/components/SkillCard.astro`, replace this line — the file's only `<a>` element:

```astro
      <a class="skill-card__score" data-field="score" href={withBase(`/${lang}/methodology/#score`)}>{skill.score}</a>
```

with:

```astro
      <ul class="leds" aria-label={L('skill.runtimes')}>
        {RUNTIME_ORDER.map((runtime) => (
          <li class:list={['led', skill.runtimes.includes(runtime) && 'led--on']} data-runtime={runtime}>
            <span class="led__dot" aria-hidden="true"></span>
            <span class="sr-only">{runtime}: {skill.runtimes.includes(runtime) ? L('skill.supported') : L('skill.unsupported')}</span>
          </li>
        ))}
      </ul>
      <a class="skill-card__score" data-field="score" href={withBase(`/${lang}/methodology/#score`)}>{skill.score}</a>
```

- [ ] **Step 5: Style them**

In `src/components/SkillCard.astro`, insert immediately after the line
`  .skill-card__rank { color: var(--color-n-11); }`:

```css
  .leds {
    display: flex;
    gap: 0.25rem;
    margin: 0 0 0 0.5rem;
    padding: 0;
    list-style: none;
  }
  .led__dot {
    display: block;
    width: 6px;
    height: 6px;
    background: var(--color-n-6);
  }
  .led--on .led__dot { background: var(--color-a-9); }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-runtimes.test.ts`

Expected: PASS — 5 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-runtimes.test.ts
git commit -m "feat(card): five runtime LEDs in RUNTIME_ORDER with an explicit unsupported state"
```

---

### Task B4.5: SafetyStrip — two states, no green

**Files:**
- Create: `src/components/SafetyStrip.astro`
- Modify: `src/components/SkillCard.astro` (import, and one line inside `<summary>`)
- Test: `tests/build/skill-card-safety.test.ts`

**Interfaces:**
- Consumes: `Lang`, `Safety` from `src/types.ts`; the default export of `src/lib/i18n/skill.ts`; `--color-hazard` from `src/styles/theme.css` (A2 — **B4 never defines or edits that token**)
- Produces: `src/components/SafetyStrip.astro` with `Props { safety: Safety; lang: Lang }`; the class contract `.safety-strip` / `.safety-row` / `.safety-row--hazard`; the `data-signal` hooks `executes`, `network`, `env`, `tools`

The strip has two states and only two: neutral and hazard. There is no green, no *safe*, no pass
state — with 36.8% of audited skills carrying a flaw (§4.3), a wrong green badge is a real
liability. The test enforces it structurally: the set of class tokens across every `data-signal`
element on the whole built site must be a subset of `{safety-row, safety-row--hazard}`.

`declaredTools` is never a hazard row. It reports what the author declared (`allowed-tools`, present
on 9% of skills) or *Not declared*; absence of a declaration is not evidence of danger, and the
three derived rows above it already carry the evidence.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-safety.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, distFiles, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';
import { readFileSync } from 'node:fs';

const SKILLS = loadSkills();
const SIGNALS = ['executes', 'network', 'env', 'tools'];

function row(card: string, signal: string): { classes: string[]; value: string } {
  const element = elementWith(card, `data-signal="${signal}"`);
  return {
    classes: classesOf(tagWith(card, `data-signal="${signal}"`)),
    value: text(elementWith(element, 'class="safety-row__value"')),
  };
}

describe('the safety strip', () => {
  it('renders the four derived signals on every card', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      for (const signal of SIGNALS) expect(card).toContain(`data-signal="${signal}"`);
    }
  });

  it('marks executing, networking and env-reading skills as hazard and nothing else', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const hazard = {
        executes: skill.safety.executesCode,
        network: skill.safety.network,
        env: skill.safety.readsEnv,
        tools: false,
      };
      for (const signal of SIGNALS) {
        const flagged = row(card, signal).classes.includes('safety-row--hazard');
        expect(flagged, `${skill.id} / ${signal}`).toBe(hazard[signal as keyof typeof hazard]);
      }
    }
  });

  it('reports the script count and languages, or says there are none', () => {
    const en = strings.en;
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const { scriptCount, languages, executesCode } = skill.safety;
      const word = scriptCount === 1 ? en['skill.script'] : en['skill.scripts'];
      const suffix = languages.length > 0 ? ` (${languages.join(', ')})` : '';
      const expected = executesCode ? `${scriptCount} ${word}${suffix}` : en['skill.noScripts'];
      expect(row(card, 'executes').value).toBe(expected);
    }
  });

  it('prints declared tools verbatim, or Not declared', () => {
    const en = strings.en;
    for (const skill of SKILLS) {
      const tools = skill.safety.declaredTools;
      const expected = tools && tools.length > 0 ? tools.join(', ') : en['skill.toolsNotDeclared'];
      expect(row(cardOf(pageFor('en', skill)), 'tools').value).toBe(expected);
    }
  });

  it('exposes only two safety states across every built page', () => {
    const seen = new Set<string>();
    for (const file of distFiles('.html')) {
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(/<[a-z]+[^>]*data-signal="[^"]*"[^>]*>/gi)) {
        for (const token of classesOf(match[0])) seen.add(token);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const token of seen) expect(['safety-row', 'safety-row--hazard']).toContain(token);
  });

  it('translates the signal labels on the pt route', () => {
    const card = cardOf(pageFor('pt', SKILLS[0]));
    expect(text(elementWith(card, 'data-signal="network"'))).toContain(strings.pt['skill.network']);
    expect(text(elementWith(card, 'data-signal="env"'))).toContain(strings.pt['skill.env']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-safety.test.ts`

Expected: FAIL — the card has no safety rows, so the first test fails with
`AssertionError: expected '<details class="skill-card" …' to contain 'data-signal="executes"'` and
every test that calls `row()` throws the helper's
`Error: no element with data-signal="executes" in the built card`.

- [ ] **Step 3: Write the component**

Create `src/components/SafetyStrip.astro`:

```astro
---
import type { Lang, Safety } from '../types.ts';
import strings, { type SkillKey } from '../lib/i18n/skill.ts';

interface Props {
  safety: Safety;
  lang: Lang;
}

const { safety, lang } = Astro.props;
const L = (key: SkillKey): string => strings[lang][key];

const scriptWord = safety.scriptCount === 1 ? L('skill.script') : L('skill.scripts');
const languages = safety.languages.length > 0 ? ` (${safety.languages.join(', ')})` : '';

const rows = [
  {
    key: 'executes',
    hazard: safety.executesCode,
    label: L('skill.executes'),
    value: safety.executesCode ? `${safety.scriptCount} ${scriptWord}${languages}` : L('skill.noScripts'),
  },
  {
    key: 'network',
    hazard: safety.network,
    label: L('skill.network'),
    value: safety.network ? L('skill.networkYes') : L('skill.networkNo'),
  },
  {
    key: 'env',
    hazard: safety.readsEnv,
    label: L('skill.env'),
    value: safety.readsEnv ? L('skill.envYes') : L('skill.envNo'),
  },
  {
    // Never a hazard: a missing declaration is not evidence, and the rows above carry the evidence.
    key: 'tools',
    hazard: false,
    label: L('skill.tools'),
    value: safety.declaredTools && safety.declaredTools.length > 0
      ? safety.declaredTools.join(', ')
      : L('skill.toolsNotDeclared'),
  },
];
---

<div class="safety-strip" role="list" aria-label={L('skill.safetyTitle')}>
  {rows.map((row) => (
    <div class:list={['safety-row', row.hazard && 'safety-row--hazard']} role="listitem" data-signal={row.key}>
      <span class="safety-row__label">{row.label}</span>
      <span class="safety-row__value">{row.value}</span>
    </div>
  ))}
</div>

<style>
  .safety-strip {
    margin: 0.6rem 0 0;
    padding: 0.4rem 0;
    border-top: 1px solid var(--color-n-6);
    border-bottom: 1px solid var(--color-n-6);
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  .safety-row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    color: var(--color-n-11);
  }
  .safety-row--hazard { color: var(--color-hazard); }
  .safety-row__value { text-align: right; }
</style>
```

- [ ] **Step 4: Render it inside the closed card**

In `src/components/SkillCard.astro`, insert immediately after the line
`import strings, { type SkillKey } from '../lib/i18n/skill.ts';`:

```ts
import SafetyStrip from './SafetyStrip.astro';
```

Then replace the line
`    <p class="skill-card__description" data-field="description">{shortDescription}</p>`
with:

```astro
    <p class="skill-card__description" data-field="description">{shortDescription}</p>
    <SafetyStrip safety={skill.safety} lang={lang} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-safety.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/SafetyStrip.astro src/components/SkillCard.astro tests/build/skill-card-safety.test.ts
git commit -m "feat(card): derive a two-state safety strip with no success colour"
```

---

### Task B4.6: Card metadata — source, stars, forks, picked and updated

**Files:**
- Modify: `src/components/SkillCard.astro` (imports, destructuring, frontmatter, `<summary>`, `<style>`)
- Test: `tests/build/skill-card-metadata.test.ts`

**Interfaces:**
- Consumes: `relativeDays(days: number, lang: Lang): string`, `compactNumber(n: number, lang: Lang): string` and `STALE_DAYS` from `src/lib/format.ts` (B1) — the card never hardcodes a day count; `Collection` from `src/types.ts`; `loadCollections()` from `src/lib/data.ts` (A6)
- Produces: the `data-field` hooks `repo`, `stars`, `forks`, `picked`, `updated`; the class `meta__updated--stale`

Stars and forks belong to the **repo**, not the skill, so they come from the `Collection` row in
`data/collections.json` and render an em-dash when there is no row — the card never invents a
number. `Picked` prints `skill.indexedAt` verbatim rather than an age: it is our own crawl date, a
fact a reader can check against `data/meta.json`, and rendering it as an absolute date keeps the
build output deterministic. `Updated` is the age of the **path**, and over 60 days it renders in
hazard (§9.2). The safety strip sits above all of it: the eye should land on *executes code* before
the star count (§10.3).

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-metadata.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadCollections, loadSkills } from '../../src/lib/data.ts';
import { STALE_DAYS, compactNumber, relativeDays } from '../../src/lib/format.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const BY_REPO = new Map(loadCollections().map((collection) => [collection.repo, collection]));

function field(card: string, name: string): string {
  return text(elementWith(card, `data-field="${name}"`));
}

describe('card metadata', () => {
  it('names the source repo', () => {
    for (const skill of SKILLS) {
      expect(field(cardOf(pageFor('en', skill)), 'repo')).toBe(skill.repo);
    }
  });

  it('shows compact stars and forks, or an em-dash when no collection row exists', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const row = BY_REPO.get(skill.repo);
      expect(field(card, 'stars')).toBe(row ? compactNumber(row.stars, 'en') : '—');
      expect(field(card, 'forks')).toBe(row ? compactNumber(row.forks, 'en') : '—');
    }
  });

  it('prints the crawl date verbatim, so it can be checked against meta.json', () => {
    for (const skill of SKILLS) {
      expect(field(cardOf(pageFor('en', skill)), 'picked')).toBe(skill.indexedAt);
    }
  });

  it('prints the per-path age through relativeDays in the page language', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of SKILLS) {
        expect(field(cardOf(pageFor(lang, skill)), 'updated')).toBe(relativeDays(skill.updatedDays, lang));
      }
    }
  });

  it('marks an age over 60 days stale and leaves fresher ones plain', () => {
    for (const skill of SKILLS) {
      const tag = tagWith(cardOf(pageFor('en', skill)), 'data-field="updated"');
      expect(classesOf(tag).includes('meta__updated--stale'), skill.id).toBe(skill.updatedDays > STALE_DAYS);
    }
  });

  it('puts the safety strip above the metadata so it is read first', () => {
    const card = cardOf(pageFor('en', SKILLS[0]));
    expect(card.indexOf('data-signal="executes"')).toBeLessThan(card.indexOf('data-field="repo"'));
  });

  it('translates the metadata labels on the pt route', () => {
    const card = cardOf(pageFor('pt', SKILLS[0]));
    expect(text(elementWith(card, 'data-field="meta"'))).toContain(strings.pt['skill.source']);
    expect(text(elementWith(card, 'data-field="meta"'))).toContain(strings.pt['skill.updated']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-metadata.test.ts`

Expected: FAIL — the card renders no metadata, so every test throws the helper's
`Error: no element with data-field="repo" in the built card` (and the corresponding message for
`stars`, `picked`, `updated` and `meta`).

- [ ] **Step 3: Import the formatters**

In `src/components/SkillCard.astro`, insert immediately after the line
`import SafetyStrip from './SafetyStrip.astro';`:

```ts
import { STALE_DAYS, compactNumber, relativeDays } from '../lib/format.ts';
```

- [ ] **Step 4: Take the collection prop and derive the values**

In `src/components/SkillCard.astro`, replace the line
`const { skill, lang, rank = null, expanded = false } = Astro.props;`
with:

```ts
const { skill, lang, rank = null, collection = null, expanded = false } = Astro.props;
```

Then insert immediately after the line
`const shortDescription = clip(lang === 'pt' && skill.descriptionPt ? skill.descriptionPt : skill.description);`:

```ts

const stale = skill.updatedDays > STALE_DAYS;
const stars = collection ? compactNumber(collection.stars, lang) : '—';
const forks = collection ? compactNumber(collection.forks, lang) : '—';
```

- [ ] **Step 5: Render the metadata**

In `src/components/SkillCard.astro`, replace the line
`    <SafetyStrip safety={skill.safety} lang={lang} />`
with:

```astro
    <SafetyStrip safety={skill.safety} lang={lang} />
    <div class="meta" data-field="meta">
      <div class="meta__row"><span class="meta__key">{L('skill.source')}</span><span class="meta__value meta__repo" data-field="repo">{skill.repo}</span></div>
      <div class="meta__row"><span class="meta__key">{L('skill.stars')}</span><span class="meta__value" data-field="stars">{stars}</span></div>
      <div class="meta__row"><span class="meta__key">{L('skill.forks')}</span><span class="meta__value" data-field="forks">{forks}</span></div>
      <div class="meta__row"><span class="meta__key">{L('skill.picked')}</span><span class="meta__value" data-field="picked">{skill.indexedAt}</span></div>
      <div class="meta__row"><span class="meta__key">{L('skill.updated')}</span><span class:list={['meta__value', 'meta__updated', stale && 'meta__updated--stale']} data-field="updated">{relativeDays(skill.updatedDays, lang)}</span></div>
    </div>
```

- [ ] **Step 6: Style it**

In `src/components/SkillCard.astro`, insert immediately after the line
`  .led--on .led__dot { background: var(--color-a-9); }`:

```css
  .meta {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-n-11);
  }
  .meta__row {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .meta__repo { color: var(--color-n-12); }
  .meta__updated--stale { color: var(--color-hazard); }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-metadata.test.ts`

Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-metadata.test.ts
git commit -m "feat(card): repo-level stars and forks, crawl date and hazard-coloured staleness"
```

---

### Task B4.7: Category chip, suppressed where it carries no information

**Files:**
- Modify: `src/components/SkillCard.astro` (destructuring, frontmatter, `<summary>`, `<style>`)
- Modify: `src/pages/[lang]/skills/[...slug].astro` (pass `filteredCategory`)
- Test: `tests/build/skill-card-category.test.ts`

**Interfaces:**
- Consumes: `nodeName(slug: string, lang: Lang): string` from `src/lib/taxonomy.ts` (A3); the `filteredCategory?: string | null` prop
- Produces: `data-field="category"` with `data-category={skill.primary}`, rendered only when `filteredCategory !== skill.primary`

The chip earns its place in an unfiltered grid and loses it the moment the reader is already inside
that category (§10.3). The per-skill page is exactly that case: its breadcrumb already names the
node, so the page passes `filteredCategory={skill.primary}` and the chip disappears — leaving the
category named **once** on the page.

**Coverage note, stated rather than faked:** this section's only surface is the per-skill page, which
always suppresses. The *shown* branch is exercised by B3's unfiltered catalog, which owns that
assertion. What B4 can and does prove here is that the suppressed branch renders nothing, that the
category is named exactly once, and that the chip's styling still ships — so the markup path exists
and is styled the moment B3 passes no `filteredCategory`.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-category.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { nodeName } from '../../src/lib/taxonomy.ts';
import { allCss, cardOf, mainOf, occurrences, pageFor, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('the category chip', () => {
  it('is suppressed on the skill page, where the breadcrumb already names the category', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      expect(card).not.toContain('data-field="category"');
      expect(card).not.toContain(`data-category="${skill.primary}"`);
    }
  });

  it('leaves the primary node named exactly once inside main', () => {
    for (const skill of SKILLS) {
      const label = nodeName(skill.primary, 'en');
      expect(occurrences(text(mainOf(pageFor('en', skill))), label), skill.id).toBe(1);
    }
  });

  it('uses the hand-written pt taxonomy label on the pt route', () => {
    for (const skill of SKILLS) {
      expect(text(mainOf(pageFor('pt', skill)))).toContain(nodeName(skill.primary, 'pt'));
    }
  });

  it('still ships the chip styling, so the unfiltered catalog renders a styled chip', () => {
    expect(allCss()).toContain('.skill-card__category');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-category.test.ts`

Expected: FAIL on the last test only — the chip does not exist yet, so
`AssertionError: expected '…shipped css…' to contain '.skill-card__category'`. The first three pass
vacuously today and must keep passing after the chip is added; that is what makes them a regression
guard rather than decoration.

- [ ] **Step 3: Render the chip**

In `src/components/SkillCard.astro`, insert immediately after the line
`import { STALE_DAYS, compactNumber, relativeDays } from '../lib/format.ts';`:

```ts
import { nodeName } from '../lib/taxonomy.ts';
```

Replace the line
`const { skill, lang, rank = null, collection = null, expanded = false } = Astro.props;`
with:

```ts
const {
  skill,
  lang,
  rank = null,
  collection = null,
  expanded = false,
  filteredCategory = null,
} = Astro.props;
```

Insert immediately after the line
`const forks = collection ? compactNumber(collection.forks, lang) : '—';`:

```ts
const showCategory = filteredCategory !== skill.primary;
```

Then insert immediately after the line
`    </div>`
that closes the `<div class="meta" data-field="meta">` block (the last line inside `<summary>`):

```astro
    {showCategory && (
      <p class="skill-card__category" data-field="category" data-category={skill.primary}>{nodeName(skill.primary, lang)}</p>
    )}
```

- [ ] **Step 4: Style it**

In `src/components/SkillCard.astro`, insert immediately after the line
`  .meta__updated--stale { color: var(--color-hazard); }`:

```css
  .skill-card__category {
    margin: 0.5rem 0 0;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--color-n-6);
    color: var(--color-n-11);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    justify-self: start;
  }
```

- [ ] **Step 5: Suppress it on the skill page**

In `src/pages/[lang]/skills/[...slug].astro`, replace the line
`    <SkillCard skill={skill} lang={lang} rank={rank} collection={collection} expanded={true} />`
with:

```astro
    <SkillCard
      skill={skill}
      lang={lang}
      rank={rank}
      collection={collection}
      expanded={true}
      filteredCategory={skill.primary}
    />
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-category.test.ts`

Expected: PASS — 4 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/SkillCard.astro "src/pages/[lang]/skills/[...slug].astro" \
        tests/build/skill-card-category.test.ts
git commit -m "feat(card): show the category chip only where it carries information"
```

---

### Task B4.8: Four score bars in the expanded panel

**Files:**
- Modify: `src/components/SkillCard.astro` (frontmatter, panel, `<style>`)
- Test: `tests/build/skill-card-score.test.ts`

**Interfaces:**
- Consumes: `ScoreBreakdown` from `src/types.ts` — `adoption` 0-25, `maintenance` 0-30, `provenance` 0-25, `completeness` 0-20
- Produces: `data-field="score-bars"`, four `.score-bar[data-part]` rows, `.score-bar__fill`, `data-field="total"`

The published formula is worthless if the card hides its terms (§5). Every bar shows the raw value
against **its own** maximum, and the fill is the value over that maximum — not over 100, which would
make a perfect `completeness` look like a fifth of a bar.

This task also plants the contract guard for RULE 2: the shipped corpus must satisfy
`score === breakdown.total` with every component inside its cap. A skill that fails it is a scoring
bug reaching the reader as a number that does not add up.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-score.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, elementWith, pageFor, panelOf, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const MAX = { adoption: 25, maintenance: 30, provenance: 25, completeness: 20 } as const;
const TERMS = Object.keys(MAX) as Array<keyof typeof MAX>;

function parts(panel: string): string[] {
  return [...panel.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1]);
}

describe('score bars', () => {
  it('renders exactly four bars, one per formula term', () => {
    for (const skill of SKILLS) {
      expect(parts(panelOf(cardOf(pageFor('en', skill))))).toHaveLength(4);
    }
  });

  it('keeps them in formula order', () => {
    const panel = panelOf(cardOf(pageFor('en', SKILLS[0])));
    expect(parts(panel)).toEqual(['adoption', 'maintenance', 'provenance', 'completeness']);
  });

  it('prints value over the term own maximum', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      for (const term of TERMS) {
        const bar = elementWith(panel, `data-part="${term}"`);
        expect(text(bar)).toContain(`${skill.breakdown[term]}/${MAX[term]}`);
      }
    }
  });

  it('fills each bar by its value over its own maximum', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      for (const term of TERMS) {
        const bar = elementWith(panel, `data-part="${term}"`);
        const expected = Math.round((skill.breakdown[term] / MAX[term]) * 100);
        expect(bar, `${skill.id} / ${term}`).toContain(`width:${expected}%`);
      }
    }
  });

  it('never ships a component over its cap', () => {
    for (const skill of SKILLS) {
      for (const term of TERMS) {
        expect(skill.breakdown[term], `${skill.id} / ${term}`).toBeLessThanOrEqual(MAX[term]);
        expect(skill.breakdown[term], `${skill.id} / ${term}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('shows a total that equals the chip score and the sum of the four terms', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const sum = TERMS.reduce((acc, term) => acc + skill.breakdown[term], 0);
      expect(skill.breakdown.total, skill.id).toBe(sum);
      expect(skill.score, skill.id).toBe(skill.breakdown.total);
      expect(text(elementWith(panelOf(card), 'data-field="total"'))).toBe(String(skill.breakdown.total));
    }
  });

  it('translates the term labels on the pt route', () => {
    const panel = panelOf(cardOf(pageFor('pt', SKILLS[0])));
    expect(text(elementWith(panel, 'data-part="adoption"'))).toContain(strings.pt['skill.adoption']);
    expect(text(elementWith(panel, 'data-part="maintenance"'))).toContain(strings.pt['skill.maintenance']);
  });

  it('hides the bar graphic from assistive technology, which reads the numbers instead', () => {
    const bar = elementWith(panelOf(cardOf(pageFor('en', SKILLS[0]))), 'data-part="adoption"');
    expect(bar).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-score.test.ts`

Expected: FAIL — the panel is empty, so `renders exactly four bars` fails with
`AssertionError: expected [] to have a length of 4 but got +0` and the tests that reach into a bar
throw the helper's `Error: no element with data-part="adoption" in the built card`. The two
data-contract tests (`never ships a component over its cap`, and the `total` equality half of the
next one) pass or fail on the shipped corpus alone.

- [ ] **Step 3: Build the bar model**

In `src/components/SkillCard.astro`, insert immediately after the line
`const showCategory = filteredCategory !== skill.primary;`:

```ts

/** §5: each term against its own maximum, never against 100. */
const bars = [
  { part: 'adoption', label: L('skill.adoption'), value: skill.breakdown.adoption, max: 25 },
  { part: 'maintenance', label: L('skill.maintenance'), value: skill.breakdown.maintenance, max: 30 },
  { part: 'provenance', label: L('skill.provenanceScore'), value: skill.breakdown.provenance, max: 25 },
  { part: 'completeness', label: L('skill.completeness'), value: skill.breakdown.completeness, max: 20 },
];
```

- [ ] **Step 4: Render the panel content**

In `src/components/SkillCard.astro`, replace these two lines

```astro
  <div class="skill-card__panel">
  </div>
```

with:

```astro
  <div class="skill-card__panel">
    <ul class="score-bars" data-field="score-bars" aria-label={L('skill.scoreBreakdown')}>
      {bars.map((bar) => (
        <li class="score-bar" data-part={bar.part}>
          <span class="score-bar__label">{bar.label}</span>
          <span class="score-bar__track" aria-hidden="true"><span class="score-bar__fill" style={`width:${Math.round((bar.value / bar.max) * 100)}%`}></span></span>
          <span class="score-bar__value">{bar.value}/{bar.max}</span>
        </li>
      ))}
    </ul>
    <p class="score-total"><span class="score-total__label">{L('skill.total')}</span><span class="score-total__value" data-field="total">{skill.breakdown.total}</span></p>
  </div>
```

- [ ] **Step 5: Style them**

In `src/components/SkillCard.astro`, insert immediately **before** the line
`  .skill-card__category {` — the file's only occurrence of that selector:

```css
  .score-bars {
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  .score-bar {
    display: grid;
    grid-template-columns: 7rem 1fr 3.5rem;
    align-items: center;
    gap: 0.5rem;
    color: var(--color-n-11);
  }
  .score-bar__track {
    display: block;
    height: 6px;
    background: var(--color-n-3);
  }
  .score-bar__fill {
    display: block;
    height: 100%;
    background: var(--color-a-9);
  }
  .score-bar__value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .score-total {
    display: flex;
    justify-content: space-between;
    margin: 0 0 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-n-12);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-score.test.ts`

Expected: PASS — 8 tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-score.test.ts
git commit -m "feat(card): open the four score terms, each against its own maximum"
```

---

### Task B4.9: Provenance, official file link and copyable install command

**Files:**
- Modify: `src/components/SkillCard.astro` (import, frontmatter, panel, `<style>`, new `<script>`)
- Test: `tests/build/skill-card-provenance.test.ts`

**Interfaces:**
- Consumes: `officialFileUrl(skill)` from `src/lib/slug.ts`; `skill.id` shaped `owner/repo@sha:path`
- Produces: `data-field` hooks `provenance`, `official`, `install`, `copy`; the `data-copy` contract the clipboard handler reads

The provenance line prints `skill.id` **verbatim** — the full 40-character sha, never a shortened
one. A truncated sha is a fact you cannot check against, and checkability is the whole claim (§1.1).

WCAG 2.2 **2.5.8**: the copy control is a real `<button>` with a ≥24×24 px target (§10.5).

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-provenance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { officialFileUrl } from '../../src/lib/slug.ts';
import { allCss, bundles, cardOf, elementWith, pageFor, panelOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('provenance and install', () => {
  it('prints the full owner/repo@sha:path identifier with the sha unshortened', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(text(elementWith(panel, 'data-field="provenance"'))).toBe(skill.id);
      expect(skill.id).toContain(skill.sha);
      expect(skill.sha).toHaveLength(40);
    }
  });

  it('links the official file at the exact indexed commit', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(tagWith(panel, 'data-field="official"')).toContain(`href="${officialFileUrl(skill)}"`);
    }
  });

  it('opens the official file safely in a new tab', () => {
    const tag = tagWith(panelOf(cardOf(pageFor('en', SKILLS[0]))), 'data-field="official"');
    expect(tag).toContain('rel="noopener noreferrer"');
    expect(tag).toContain('target="_blank"');
  });

  it('offers a copyable install command scoped to the source repo', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const command = `npx skills add ${skill.repo}`;
      expect(text(elementWith(panel, 'data-field="install"'))).toBe(command);
      expect(tagWith(panel, 'data-field="copy"')).toContain(`data-copy="${command}"`);
    }
  });

  it('gives the copy control a WCAG 2.5.8 hit area', () => {
    const css = allCss().replace(/\s+/g, '');
    expect(css).toContain('min-height:24px');
    expect(css).toContain('min-width:24px');
  });

  it('ships the clipboard handler', () => {
    const js = bundles().map((bundle) => bundle.js).join('\n');
    expect(js).toContain('data-copy');
    expect(js).toContain('clipboard');
  });

  it('translates the panel labels on the pt route', () => {
    const panel = panelOf(cardOf(pageFor('pt', SKILLS[0])));
    expect(text(panel)).toContain(strings.pt['skill.officialFile']);
    expect(text(elementWith(panel, 'data-field="copy"'))).toBe(strings.pt['skill.copy']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-provenance.test.ts`

Expected: FAIL — nothing in the panel carries these hooks, so every test throws the helper's
`Error: no element with data-field="provenance" in the built card` (and the matching message for
`official`, `install` and `copy`), except `ships the clipboard handler`, which fails with
`AssertionError: expected '…' to contain 'data-copy'` because no card script exists yet.

- [ ] **Step 3: Import the URL helper and build the command**

In `src/components/SkillCard.astro`, insert immediately after the line
`import { nodeName } from '../lib/taxonomy.ts';`:

```ts
import { officialFileUrl } from '../lib/slug.ts';
```

Insert immediately after the line
`const showCategory = filteredCategory !== skill.primary;`:

```ts
const installCommand = `npx skills add ${skill.repo}`;
```

- [ ] **Step 4: Render the provenance block**

In `src/components/SkillCard.astro`, insert immediately after the line
`    <p class="score-total"><span class="score-total__label">{L('skill.total')}</span><span class="score-total__value" data-field="total">{skill.breakdown.total}</span></p>`:

```astro
    <p class="provenance"><span class="provenance__label">{L('skill.provenance')}</span><code class="provenance__id" data-field="provenance">{skill.id}</code></p>
    <p class="official"><a class="official__link" data-field="official" href={officialFileUrl(skill)} rel="noopener noreferrer" target="_blank">{L('skill.officialFile')} &#8599;</a></p>
    <div class="install">
      <span class="install__label">{L('skill.install')}</span>
      <code class="install__command" data-field="install">{installCommand}</code>
      <button class="install__copy" type="button" data-field="copy" data-copy={installCommand} data-copied-label={L('skill.copied')}>{L('skill.copy')}</button>
    </div>
```

- [ ] **Step 5: Style it**

In `src/components/SkillCard.astro`, insert immediately before the line
`  .skill-card__category {`:

```css
  .provenance,
  .official,
  .install {
    margin: 0 0 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
  }
  .provenance__label,
  .install__label {
    display: block;
    color: var(--color-n-11);
  }
  .provenance__id {
    display: block;
    overflow-wrap: anywhere;
    color: var(--color-n-12);
  }
  .official__link { color: var(--color-a-9); }
  .install {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.25rem 0.5rem;
    align-items: center;
  }
  .install__label { grid-column: 1 / -1; }
  .install__command {
    overflow-wrap: anywhere;
    color: var(--color-n-12);
  }
  .install__copy {
    border: 1px solid var(--color-n-6);
    background: var(--color-n-3);
    color: var(--color-n-12);
    font: inherit;
    padding: 0.35rem 0.6rem;
    min-height: 24px;
    min-width: 24px;
    cursor: pointer;
  }
```

- [ ] **Step 6: Add the card script**

Append this to the very end of `src/components/SkillCard.astro`, after the closing `</style>`:

```astro
<script>
  document.addEventListener('click', (event) => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const button = origin.closest('.install__copy');
    if (!(button instanceof HTMLButtonElement)) return;
    const command = button.getAttribute('data-copy') ?? '';
    const original = button.textContent ?? '';
    const done = button.getAttribute('data-copied-label') ?? original;
    void navigator.clipboard.writeText(command).then(() => {
      button.textContent = done;
      window.setTimeout(() => {
        button.textContent = original;
      }, 1200);
    });
  });
</script>
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-provenance.test.ts`

Expected: PASS — 7 tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-provenance.test.ts
git commit -m "feat(card): full provenance, commit-pinned official link and copyable install"
```

---

### Task B4.10: Resolved license in the panel, never on the closed card

**Files:**
- Modify: `src/components/SkillCard.astro` (panel, `<style>`)
- Test: `tests/build/skill-card-license.test.ts`

**Interfaces:**
- Consumes: `skill.license: string | null`, `skill.licenseSource: 'frontmatter' | 'sibling' | 'repo' | null`
- Produces: `data-field="license"`, `data-field="license-source"`, the class `license__value--undeclared`

The closed card carries no license chip (§10.3). License resolves to unknown often enough that a
frequently-empty chip trains people to ignore chips, so it lives in the expanded panel only — and
*Not declared* renders in hazard rather than being quietly omitted, because "we do not know whether
you may use this" is a fact about risk, not an absence.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-license.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, panelOf, summaryOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('license display', () => {
  it('shows the resolved license, or Not declared, in the expanded panel', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const expected = skill.license ?? strings.en['skill.licenseNotDeclared'];
      expect(text(elementWith(panel, 'data-field="license"'))).toBe(expected);
    }
  });

  it('flags an unresolved license as hazard and a resolved one plain', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const classes = classesOf(tagWith(panel, 'data-field="license"'));
      expect(classes.includes('license__value--undeclared'), skill.id).toBe(skill.license === null);
    }
  });

  it('names the resolution source only when there is one', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      if (skill.licenseSource === null) {
        expect(panel).not.toContain('data-field="license-source"');
      } else {
        expect(text(elementWith(panel, 'data-field="license-source"'))).toBe(skill.licenseSource);
      }
    }
  });

  it('translates Not declared on the pt route', () => {
    for (const skill of SKILLS.filter((s) => s.license === null)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      expect(text(elementWith(panel, 'data-field="license"'))).toBe(strings.pt['skill.licenseNotDeclared']);
    }
  });

  it('keeps every license marker out of the closed card', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      expect(summary).not.toContain('license');
      expect(text(summary)).not.toContain(strings.en['skill.license']);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-license.test.ts`

Expected: FAIL — the panel has no license row, so the first two tests throw the helper's
`Error: no element with data-field="license" in the built card`. The `names the resolution source`,
`translates Not declared` and `keeps every license marker out of the closed card` tests pass
vacuously and must keep passing afterwards.

- [ ] **Step 3: Render the license row**

In `src/components/SkillCard.astro`, replace these two lines — the copy button and the `</div>` that
closes the `<div class="install">` block, quoted together because `    </div>` alone also closes the
metadata block:

```astro
      <button class="install__copy" type="button" data-field="copy" data-copy={installCommand} data-copied-label={L('skill.copied')}>{L('skill.copy')}</button>
    </div>
```

with:

```astro
      <button class="install__copy" type="button" data-field="copy" data-copy={installCommand} data-copied-label={L('skill.copied')}>{L('skill.copy')}</button>
    </div>
    <p class="license">
      <span class="license__label">{L('skill.license')}</span>
      <span class:list={['license__value', !skill.license && 'license__value--undeclared']} data-field="license">{skill.license ?? L('skill.licenseNotDeclared')}</span>
      {skill.licenseSource && <span class="license__source" data-field="license-source">{skill.licenseSource}</span>}
    </p>
```

- [ ] **Step 4: Style it**

In `src/components/SkillCard.astro`, insert immediately before the line
`  .skill-card__category {`:

```css
  .license {
    display: flex;
    gap: 0.5rem;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--color-n-11);
  }
  .license__value { color: var(--color-n-12); }
  .license__value--undeclared { color: var(--color-hazard); }
  .license__source {
    margin-left: auto;
    color: var(--color-n-11);
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-license.test.ts`

Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-license.test.ts
git commit -m "feat(card): resolve the license in the panel and keep it off the closed card"
```

---

### Task B4.11: One card open at a time, with the URL following the expansion

**Files:**
- Modify: `src/components/SkillCard.astro` (import, `<details>` tag, `<script>`)
- Test: `tests/build/skill-card-expand.test.ts`

**Interfaces:**
- Consumes: `skillHref(skill, lang)` from `src/lib/slug.ts`
- Produces: `<details class="skill-card" name="skill-expand" data-href="…">`; a capture-phase `toggle` listener calling `history.replaceState`

Exclusivity is native: `name="skill-expand"` makes the browser close the previously open card. The
script closes any straggler for engines without the exclusive-accordion behaviour, and rewrites the
address bar to the skill's own static path — so the URL in the address bar always resolves to the
page built in Task B4.3 (§10.4: expansion and a real URL are not alternatives, we ship both).

`replaceState`, never `pushState`: opening three cards must not put three entries between the reader
and the back button. `toggle` does not bubble, so the listener runs in the capture phase on
`document`.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-expand.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { skillHref } from '../../src/lib/slug.ts';
import { bundles, cardOf, pageFor, tagWith } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const JS = bundles().map((bundle) => bundle.js).join('\n');

describe('expand-in-place URL sync', () => {
  it('groups every card into one exclusive accordion', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('en', skill)), 'data-skill-id=')).toContain('name="skill-expand"');
    }
  });

  it('carries the base-aware static path on each card', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('en', skill)), 'data-skill-id='))
        .toContain(`data-href="${skillHref(skill, 'en')}"`);
    }
  });

  it('points the pt card at the pt static page', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('pt', skill)), 'data-skill-id='))
        .toContain(`data-href="${skillHref(skill, 'pt')}"`);
    }
  });

  it('ships a toggle listener that replaces history rather than pushing it', () => {
    expect(JS).toContain('toggle');
    expect(JS).toContain('replaceState');
    expect(JS).not.toContain('pushState');
  });

  it('closes any other open card', () => {
    expect(JS).toContain('.skill-card[open]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-expand.test.ts`

Expected: FAIL — the `<details>` tag has neither attribute, so the first test fails with
`AssertionError: expected '<details class="skill-card" data-skill-id="…" open>' to contain 'name="skill-expand"'`,
and the two script tests fail because the shipped bundle contains only the clipboard handler.

- [ ] **Step 3: Import the href helper**

In `src/components/SkillCard.astro`, replace the line
`import { officialFileUrl } from '../lib/slug.ts';`
with:

```ts
import { officialFileUrl, skillHref } from '../lib/slug.ts';
```

- [ ] **Step 4: Group and address the cards**

In `src/components/SkillCard.astro`, replace the line
`<details class="skill-card" data-skill-id={skill.id} open={expanded}>`
with:

```astro
<details class="skill-card" name="skill-expand" data-skill-id={skill.id} data-href={skillHref(skill, lang)} open={expanded}>
```

- [ ] **Step 5: Add the toggle listener**

In `src/components/SkillCard.astro`, insert immediately after the line
`<script>` at the end of the file:

```js
  const listUrl = window.location.pathname + window.location.search;

  document.addEventListener(
    'toggle',
    (event) => {
      const card = event.target;
      if (!(card instanceof HTMLElement) || !card.classList.contains('skill-card')) return;

      if (card.hasAttribute('open')) {
        for (const other of document.querySelectorAll('.skill-card[open]')) {
          if (other !== card) other.removeAttribute('open');
        }
        const href = card.getAttribute('data-href');
        if (href) window.history.replaceState(null, '', href);
        return;
      }

      if (!document.querySelector('.skill-card[open]')) {
        window.history.replaceState(null, '', listUrl);
      }
    },
    true,
  );
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-expand.test.ts tests/build/skill-card-provenance.test.ts`

Expected: PASS — 5 tests plus the 7 provenance tests, which prove the clipboard handler survived
the script edit.

- [ ] **Step 7: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-expand.test.ts
git commit -m "feat(card): expand one card at a time and sync the URL to its static page"
```

---

### Task B4.12: Full body fetched client-side on expand

**Files:**
- Modify: `src/components/SkillCard.astro` (import, frontmatter, panel, `<style>`, `<script>`)
- Test: `tests/build/skill-card-body.test.ts`

**Interfaces:**
- Consumes: `rawFileUrl(skill)`, `officialFileUrl(skill)` from `src/lib/slug.ts`; `skill.longPt`
- Produces: `data-field="body"` carrying `data-body-url` and `data-body-error`; a `loadBody()` handler wired to `toggle` and to cards that arrive already open

§6.1 is explicit: **frontmatter at build, full bodies fetched client-side on expand** — which is also
what keeps us from rehosting somebody else's prose (§7). The card ships the author's own short
description as the build-time fallback, so a reader with JavaScript off, or a fetch that fails, still
sees indexed text rather than a spinner or a hole.

Where a Portuguese long translation exists it is rendered **server-side**, labelled
*machine-translated*, with the English original one click away and canonical (§8) — there is nothing
to fetch, because the translated text is ours and the original is already linked.

The fetched document is untrusted third-party input, so it reaches the page through `textContent`
and never through `innerHTML`. Step 1 asserts that as a source-level rule about this file, which is
stronger than pattern-matching a shared bundle.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-card-body.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { officialFileUrl, rawFileUrl } from '../../src/lib/slug.ts';
import { ROOT, bundles, cardOf, elementWith, pageFor, panelOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const JS = bundles().map((bundle) => bundle.js).join('\n');
const SOURCE = readFileSync(join(ROOT, 'src/components/SkillCard.astro'), 'utf8');

describe('the full body', () => {
  it('points the panel at raw.githubusercontent.com at the indexed commit', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(tagWith(panel, 'data-field="body"')).toContain(`data-body-url="${rawFileUrl(skill)}"`);
    }
  });

  it('ships the indexed description as the no-JavaScript fallback', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      expect(text(elementWith(panel, 'data-field="body"'))).toContain(text(skill.description));
    }
  });

  it('renders a translated body server-side, labelled, with the original one click away', () => {
    for (const skill of SKILLS.filter((s) => s.longPt)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      const body = elementWith(panel, 'data-field="body"');
      expect(text(body)).toContain(text(skill.longPt!));
      expect(text(body)).toContain(strings.pt['skill.machineTranslated']);
      expect(body).toContain(`href="${officialFileUrl(skill)}"`);
    }
  });

  it('never fetches a body it has already translated', () => {
    for (const skill of SKILLS.filter((s) => s.longPt)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      expect(tagWith(panel, 'data-field="body"')).not.toContain('data-body-url');
    }
  });

  it('carries a localised failure message rather than failing silently', () => {
    for (const lang of ['en', 'pt'] as const) {
      const panel = panelOf(cardOf(pageFor(lang, SKILLS[0])));
      expect(tagWith(panel, 'data-field="body"'))
        .toContain(`data-body-error="${strings[lang]['skill.bodyUnavailable']}"`);
    }
  });

  it('ships the fetch handler and loads cards that arrive already open', () => {
    expect(JS).toContain('data-body-url');
    expect(JS).toContain('fetch(');
    expect(JS).toContain('.skill-card[open]');
  });

  it('renders the fetched document as text, never as HTML', () => {
    expect(SOURCE).toContain('textContent');
    expect(SOURCE).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-card-body.test.ts`

Expected: FAIL — the panel has no body block, so four tests throw the helper's
`Error: no element with data-field="body" in the built card`, and
`ships the fetch handler and loads cards that arrive already open` fails with
`AssertionError: expected '…' to contain 'data-body-url'`. `renders the fetched document as text`
fails on the first assertion, because the component source does not mention `textContent` yet.

- [ ] **Step 3: Import the raw URL helper and pick the body source**

In `src/components/SkillCard.astro`, replace the line
`import { officialFileUrl, skillHref } from '../lib/slug.ts';`
with:

```ts
import { officialFileUrl, rawFileUrl, skillHref } from '../lib/slug.ts';
```

Insert immediately after the line
`const installCommand = \`npx skills add ${skill.repo}\`;`:

```ts
/** §8: our translation is served from the build; the author's own body is fetched (§6.1). */
const translatedBody = lang === 'pt' ? skill.longPt : null;
```

- [ ] **Step 4: Render the body block**

In `src/components/SkillCard.astro`, insert immediately after the line
`  <div class="skill-card__panel">`:

```astro
    {translatedBody ? (
      <div class="skill-body skill-body--translated" data-field="body">
        <p class="skill-body__text">{translatedBody}</p>
        <p class="skill-body__mt">
          {L('skill.machineTranslated')}{' '}
          <a class="skill-body__original" href={officialFileUrl(skill)} rel="noopener noreferrer" target="_blank">{L('skill.seeOriginal')} &#8599;</a>
        </p>
      </div>
    ) : (
      <div class="skill-body" data-field="body" data-body-url={rawFileUrl(skill)} data-body-error={L('skill.bodyUnavailable')}>
        <p class="skill-body__text">{skill.description}</p>
        <p class="skill-body__note">{L('skill.bodySource')}</p>
      </div>
    )}
```

- [ ] **Step 5: Style it**

In `src/components/SkillCard.astro`, insert immediately before the line
`  .score-bars {`:

```css
  .skill-body {
    margin: 0 0 0.75rem;
    color: var(--color-n-12);
    font-size: 0.85rem;
  }
  .skill-body__text {
    margin: 0 0 0.4rem;
    white-space: pre-wrap;
  }
  .skill-body__mt,
  .skill-body__note {
    margin: 0;
    color: var(--color-n-11);
    font-family: var(--font-mono);
    font-size: 0.65rem;
  }
  .skill-body__original { color: var(--color-a-9); }
```

- [ ] **Step 6: Fetch the body on expand**

In `src/components/SkillCard.astro`, insert immediately after the line
`  const listUrl = window.location.pathname + window.location.search;`:

```js

  /** Untrusted third-party text: it reaches the DOM through textContent, never as HTML. */
  async function loadBody(card) {
    const holder = card.querySelector('.skill-body[data-body-url]');
    if (!(holder instanceof HTMLElement) || holder.dataset.bodyState) return;
    holder.dataset.bodyState = 'loading';
    const target = holder.querySelector('.skill-body__text');
    const note = holder.querySelector('.skill-body__note');
    try {
      const response = await fetch(holder.dataset.bodyUrl ?? '', { credentials: 'omit' });
      if (!response.ok) throw new Error(String(response.status));
      const raw = await response.text();
      const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
      if (target && body) target.textContent = body;
      holder.dataset.bodyState = 'loaded';
      if (note) note.remove();
    } catch {
      holder.dataset.bodyState = 'error';
      if (note) note.textContent = holder.dataset.bodyError ?? '';
    }
  }
```

Then insert immediately after the line
`      if (card.hasAttribute('open')) {`:

```js
        void loadBody(card);
```

Finally, append this at the very end of the `<script>` block, immediately before the closing
`</script>`:

```js

  // A per-skill page arrives with its card already open, so no toggle ever fires.
  for (const open of document.querySelectorAll('.skill-card[open]')) void loadBody(open);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-card-body.test.ts tests/build/skill-card-expand.test.ts`

Expected: PASS — 7 body tests plus the 5 expand tests.

- [ ] **Step 8: Commit**

```bash
git add src/components/SkillCard.astro tests/build/skill-card-body.test.ts
git commit -m "feat(card): fetch the author body on expand and render it as text"
```

---

### Task B4.13: The Pagefind index block on the per-skill page

**Files:**
- Modify: `src/pages/[lang]/skills/[...slug].astro` (frontmatter, one block before `</Layout>`)
- Test: `tests/build/skill-page-pagefind.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Skill` from `src/types.ts` (A1) — both already in scope on this route as `Astro.props`; `skill.listed` (§5.1)
- Produces: on every **listed** skill page, exactly one `data-pagefind-body` block carrying
  `data-pagefind-meta="id[<skill id>]"`, the five flat `data-pagefind-filter` keys
  `domain`, `subdomain`, `runtime`, `risk`, `license`, and the five zero-padded
  `data-pagefind-sort` keys `score`, `stars`, `forks`, `newest`, `updated` — and, on an unlisted
  page, no block at all

Pagefind's unit of indexing is a **page**, so the filter and sort attributes belong on the per-skill
page — this file, which B4 owns and which is built before B3 exists (RULE 4). B3 reads the built
index and never edits this route; B4 imports nothing from B3.

The vocabulary is flat and parallel, never nested: nesting is a UI concern, cheap to add now and
expensive once a thousand entries are tagged. B3's `src/lib/facets.ts` derives the same five keys for
the rail from the same rules, and B3's own `tests/catalog/pagefind-filters.test.ts` asserts the rail
vocabulary and *this* markup agree — so a divergence fails B3's suite rather than silently offering a
rail value the index does not carry.

Because at least one page carries `data-pagefind-body`, Pagefind indexes **only** skill pages: the
catalog, home and methodology routes drop out of the index for free. And only **listed** skill pages
carry it (§5.1). An evicted entry keeps its page but emits no block, so it leaves the search index
exactly as it leaves the listings and the facet counts, while Task B4.3's `noindex` keeps search
engines off that same page — those two conditions are the route's only branches on `listed`.

The block is clipped rather than `display: none`, because Pagefind reads the built HTML and must be
able to see the text, and it is `aria-hidden` so a screen reader does not hear the card's content
twice.

Every filter value is a slug or a raw runtime name, never a taxonomy **display** name, so Task B4.7's
"named exactly once inside main" assertion is untouched by this block.

- [ ] **Step 1: Write the failing test**

Create `tests/build/skill-page-pagefind.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadCollections, loadSkills } from '../../src/lib/data.ts';
import { pageFor } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const LISTED = SKILLS.filter((skill) => skill.listed);
const UNLISTED = SKILLS.filter((skill) => !skill.listed);
const BY_REPO = new Map(loadCollections().map((collection) => [collection.repo, collection]));
const FILTER_KEYS = ['domain', 'subdomain', 'runtime', 'risk', 'license'];
const SORT_KEYS = ['score', 'stars', 'forks', 'newest', 'updated'];

function pairs(html: string, attribute: string): Array<[string, string]> {
  const pattern = new RegExp(`data-pagefind-${attribute}="([a-z-]+)\\[([^\\]]*)\\]"`, 'g');
  return [...html.matchAll(pattern)].map((match) => [match[1], match[2]] as [string, string]);
}

describe('the Pagefind index block', () => {
  it('has a listed skill to index at all', () => {
    expect(LISTED.length).toBeGreaterThan(0);
  });

  it('marks exactly one indexable body per listed skill page, in both locales', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of LISTED) {
        expect((pageFor(lang, skill).match(/data-pagefind-body/g) ?? []).length, skill.id).toBe(1);
      }
    }
  });

  it('leaves an evicted skill out of the index while still building its page', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of UNLISTED) {
        expect(pageFor(lang, skill), skill.id).not.toContain('data-pagefind-body');
      }
    }
  });

  it('emits all five flat filter keys and nothing outside that vocabulary', () => {
    for (const skill of LISTED) {
      const keys = pairs(pageFor('en', skill), 'filter').map(([key]) => key);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(FILTER_KEYS).toContain(key);
      for (const key of FILTER_KEYS) expect(keys, `${skill.id} is missing ${key}`).toContain(key);
    }
  });

  it('derives domain, subdomain, runtime and license from the skill itself', () => {
    for (const skill of LISTED) {
      const found = pairs(pageFor('en', skill), 'filter');
      const values = (key: string): string[] => found.filter(([k]) => k === key).map(([, v]) => v);
      const nodes = [skill.primary, ...skill.also];
      expect(values('subdomain')).toEqual([...new Set(nodes)]);
      expect(values('domain')).toEqual([...new Set(nodes.map((node) => node.split('/')[0]))]);
      expect(values('runtime')).toEqual([...new Set(skill.runtimes)]);
      expect(values('license')).toEqual([skill.license ?? 'unspecified']);
    }
  });

  it('names an executing skill executes-code and a quiet one no-code-execution', () => {
    for (const skill of LISTED) {
      const risk = pairs(pageFor('en', skill), 'filter')
        .filter(([key]) => key === 'risk')
        .map(([, value]) => value);
      expect(risk[0], skill.id).toBe(skill.safety.executesCode ? 'executes-code' : 'no-code-execution');
      expect(risk.includes('network'), skill.id).toBe(skill.safety.network);
      expect(risk.includes('reads-env'), skill.id).toBe(skill.safety.readsEnv);
      expect(risk.includes('portable'), skill.id).toBe(skill.portable);
    }
  });

  it('zero-pads every sort value so Pagefind string order matches numeric order', () => {
    for (const skill of LISTED) {
      const sorts = new Map(pairs(pageFor('en', skill), 'sort'));
      expect([...sorts.keys()]).toEqual(SORT_KEYS);
      const collection = BY_REPO.get(skill.repo);
      expect(sorts.get('score')).toBe(String(skill.score).padStart(3, '0'));
      expect(sorts.get('stars')).toBe(String(collection?.stars ?? 0).padStart(9, '0'));
      expect(sorts.get('forks')).toBe(String(collection?.forks ?? 0).padStart(9, '0'));
      expect(sorts.get('newest')).toBe(skill.indexedAt.slice(0, 10).replace(/-/g, ''));
      expect(sorts.get('updated')).toBe(String(skill.updatedDays).padStart(6, '0'));
    }
  });

  it('carries the skill id as metadata, so a result maps back onto its card', () => {
    for (const skill of LISTED) {
      expect(pageFor('en', skill)).toContain(`data-pagefind-meta="id[${skill.id}]"`);
    }
  });

  it('indexes the text a reader would actually search for', () => {
    for (const skill of LISTED) {
      const html = pageFor('en', skill);
      expect(html).toContain(`${skill.repo} ${skill.path}`);
      expect(html).toContain(skill.name);
    }
  });

  it('keeps the block out of the visual and the accessibility tree', () => {
    const html = pageFor('en', LISTED[0]);
    const at = html.indexOf('<div data-pagefind-body');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, at + 400);
    expect(block).toContain('aria-hidden="true"');
    expect(block).toContain('clip-path:inset(50%)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/build/skill-page-pagefind.test.ts`

Expected: FAIL — 8 of the 10 tests. The route emits no index block, so the body count is zero
(`AssertionError: expected +0 to be 1`), every `pairs()` call returns an empty array
(`AssertionError: expected +0 to be greater than +0`, and
`AssertionError: expected [] to deeply equal [ 'score', 'stars', 'forks', 'newest', 'updated' ]`),
and `keeps the block out of the visual and the accessibility tree` fails with
`AssertionError: expected -1 to be greater than -1`.

The other two pass now and must keep passing: `has a listed skill to index at all` reads the corpus
rather than the build, and `leaves an evicted skill out of the index while still building its page`
is true before any block exists — it is a regression guard on Step 4's condition, and it goes
vacuous when the shipped corpus holds no evicted row, which is why the assertion above it pins the
listed side on every row.

- [ ] **Step 3: Derive the index values**

In `src/pages/[lang]/skills/[...slug].astro`, insert immediately after the line
`const showNode = skill.primary !== domainSlug;`:

```ts

/**
 * Pagefind indexes pages, so the index payload is built here. Flat parallel keys only; B3's rail
 * derives the same five keys from the same rules and asserts both sides agree.
 */
function pad(value: number, width: number): string {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return String(safe).padStart(width, '0');
}

const nodes = [skill.primary, ...skill.also].filter(Boolean);
const risk: string[] = [skill.safety.executesCode ? 'executes-code' : 'no-code-execution'];
if (skill.safety.network) risk.push('network');
if (skill.safety.readsEnv) risk.push('reads-env');
if (skill.safety.declaredTools && skill.safety.declaredTools.length > 0) risk.push('declared-tools');
if (skill.portable) risk.push('portable');

const pair = (key: string) => (value: string): [string, string] => [key, value];
const indexFilters: Array<[string, string]> = [
  ...[...new Set(nodes.map((node) => node.split('/')[0]))].map(pair('domain')),
  ...[...new Set(nodes)].map(pair('subdomain')),
  ...[...new Set(skill.runtimes)].map(pair('runtime')),
  ...risk.map(pair('risk')),
  ['license', skill.license ?? 'unspecified'],
];

const indexedDay = skill.indexedAt.slice(0, 10);
const indexSorts: Array<[string, string]> = [
  ['score', pad(skill.score, 3)],
  ['stars', pad(collection?.stars ?? 0, 9)],
  ['forks', pad(collection?.forks ?? 0, 9)],
  ['newest', /^\d{4}-\d{2}-\d{2}$/.test(indexedDay) ? indexedDay.replace(/-/g, '') : '00000000'],
  ['updated', pad(skill.updatedDays, 6)],
];

const indexText = [
  skill.name,
  skill.description,
  skill.descriptionPt ?? '',
  skill.longPt ?? '',
  skill.tags.join(' '),
  `${skill.repo} ${skill.path}`,
].filter((line) => line.trim().length > 0);
```

- [ ] **Step 4: Emit the block**

In `src/pages/[lang]/skills/[...slug].astro`, insert immediately before the line
`</Layout>` — the file's only occurrence of that closing tag:

```astro
  {skill.listed && (
    <div
      data-pagefind-body
      aria-hidden="true"
      style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap"
    >
      <span data-pagefind-meta={`id[${skill.id}]`}></span>
      {indexFilters.map(([key, value]) => <span data-pagefind-filter={`${key}[${value}]`}></span>)}
      {indexSorts.map(([key, value]) => <span data-pagefind-sort={`${key}[${value}]`}></span>)}
      {indexText.map((line) => <p>{line}</p>)}
    </div>
  )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/build/skill-page-pagefind.test.ts`

Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add "src/pages/[lang]/skills/[...slug].astro" tests/build/skill-page-pagefind.test.ts
git commit -m "feat(skills): index every listed skill page with flat parallel pagefind filters"
```

---

### Task B4.14: Site-wide guard on the hazard token

**Files:**
- Test: `tests/build/hazard-token.test.ts`

**Interfaces:**
- Consumes: the built `dist/` tree; `--color-hazard` from `src/styles/theme.css` (A2)
- Produces: the enforced allowlist `.safety-row--hazard`, `.meta__updated--stale`, `.license__value--undeclared`

Hazard orange is unmissable only while it means one thing (§9.2). This test walks every stylesheet
the site ships — inlined `<style>` blocks included — finds every rule that reads
`var(--color-hazard)`, and fails if the selector is not one of the three allowed to. **Any later
section that reaches for the token fails this test, which is the point.**

Two deliberate carve-outs, both narrow. A2's `/styleguide` route exists to render every token and
every component state (§9.1), so a hazard swatch there is its job, not a leak: the utility-class
check skips `dist/styleguide/`. And because Tailwind only emits a `*-hazard` utility rule when some
template uses that class, a utility selector in the bundled CSS is allowed — the HTML check already
proves no page **outside** the styleguide uses one.

`--color-hazard-surface`, which A2 also defines, is untouched by all of this: `var(--color-hazard)`
is matched as an exact string, and `var(--color-hazard-surface)` does not contain it.

- [ ] **Step 1: Write the failing test**

Create `tests/build/hazard-token.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, distFiles, sheets } from '../helpers/skill-card.ts';

const ALLOWED = ['.safety-row--hazard', '.meta__updated--stale', '.license__value--undeclared'];
const UTILITY = /^\.(?:text|bg|border|fill|stroke|ring|outline|decoration|shadow|from|via|to|accent|caret)-hazard\b/;
const SHEETS = sheets();

/** Selectors of every rule whose declarations read var(--color-hazard). */
function selectorsUsingHazard(css: string): string[] {
  const found: string[] = [];
  let at = css.indexOf('var(--color-hazard)');
  while (at !== -1) {
    const braceAt = css.lastIndexOf('{', at);
    const start = Math.max(css.lastIndexOf('}', braceAt), css.lastIndexOf('{', braceAt - 1)) + 1;
    for (const part of css.slice(start, braceAt).split(',')) {
      // Astro scopes a rule by appending [data-astro-cid-…]; strip it before comparing.
      const normalised = part.replace(/\[data-astro-cid-[^\]]*\]/g, '').trim();
      if (normalised) found.push(normalised);
    }
    at = css.indexOf('var(--color-hazard)', at + 1);
  }
  return found;
}

describe('the hazard token', () => {
  it('is defined, and only ever on a root selector in the theme', () => {
    const defining = SHEETS.filter(({ css }) => /--color-hazard\s*:/.test(css));
    expect(defining.length).toBeGreaterThan(0);
    for (const sheet of defining) {
      expect(sheet.css, `${sheet.from} defines --color-hazard outside :root`).toMatch(/:root|@theme/);
    }
  });

  it('is actually used somewhere', () => {
    expect(SHEETS.some(({ css }) => css.includes('var(--color-hazard)'))).toBe(true);
  });

  it('is read by the safety, staleness and undeclared-license selectors only', () => {
    for (const { from, css } of SHEETS) {
      for (const selector of selectorsUsingHazard(css)) {
        if (UTILITY.test(selector)) continue; // proven styleguide-only by the utility test below
        expect(ALLOWED, `${from} lets "${selector}" read --color-hazard`).toContain(selector);
      }
    }
  });

  it('reaches all three of its allowed selectors', () => {
    const used = new Set(SHEETS.flatMap(({ css }) => selectorsUsingHazard(css)));
    for (const selector of ALLOWED) {
      expect([...used], `nothing renders ${selector}`).toContain(selector);
    }
  });

  it('is never reached through a utility class outside the styleguide', () => {
    for (const file of distFiles('.html')) {
      const where = relative(ROOT, file);
      if (where.includes('styleguide')) continue;
      expect(readFileSync(file, 'utf8'), `${where} uses a hazard utility class`).not.toMatch(
        /class="[^"]*\b(?:text|bg|border|fill|stroke|ring|outline|decoration|shadow)-hazard\b/,
      );
    }
  });

  it('never colours a safety row green or any other success hue', () => {
    for (const { from, css } of SHEETS) {
      expect(css, `${from} defines a success state for a safety row`).not.toMatch(
        /\.safety-row--(?:ok|safe|pass|good|success)/,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails against a deliberate violation**

A guard nobody has seen fail is a guard nobody knows works. Temporarily make the breadcrumb home
link reach for the token — add this rule to the `<style>` block at the end of
`src/pages/[lang]/skills/[...slug].astro`, replacing the line
`  .crumbs__home { color: var(--color-a-9); }`:

```css
  .crumbs__home { color: var(--color-hazard); }
```

Run: `npx vitest run tests/build/hazard-token.test.ts`

Expected: FAIL — one test, `is read by the safety, staleness and undeclared-license selectors only`.
Vitest prints the assertion for the first built skill page it reaches; the message is that page's
`dist/` path followed by:
`lets ".crumbs__home" read --color-hazard: expected [ '.safety-row--hazard', '.meta__updated--stale', '.license__value--undeclared' ] to include '.crumbs__home'`
The other five pass.

- [ ] **Step 3: Remove the violation**

In `src/pages/[lang]/skills/[...slug].astro`, restore the rule by replacing the line
`  .crumbs__home { color: var(--color-hazard); }`
with:

```css
  .crumbs__home { color: var(--color-a-9); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/build/hazard-token.test.ts`

Expected: PASS — 6 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`

Expected: PASS — every test in `tests/`, this section's 14 files included. The build runs exactly
once, in `tests/global-setup.ts`.

- [ ] **Step 6: Commit**

```bash
git add tests/build/hazard-token.test.ts
git commit -m "test(theme): confine the hazard token to safety, staleness and undeclared license"
```

---

---

### Task B3.1: The catalog i18n namespace

RULE 3 splits i18n by owner. Facet chrome, sort-tab labels, risk and runtime labels, the empty state
and the catalog's own search-input copy are catalog strings, so they live here and nowhere else. Keys
are namespaced `catalog.` so they cannot collide with B1's core `nav.*` / `search.*` keys when
`src/lib/i18n/index.ts` merges the namespaces.

**Files:**
- Create: `src/lib/i18n/catalog.ts`
- Test: `tests/catalog/i18n-catalog.test.ts`

**Interfaces:**
- Consumes: `t(key: string, lang: Lang): string` from `src/lib/i18n/index.ts` (B1); `Lang` from `src/types.ts` (A1).
- Produces: default export `{ en: Record<string, string>; pt: Record<string, string> }` from
  `src/lib/i18n/catalog.ts`, every key prefixed `catalog.`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/i18n-catalog.test.ts
import { describe, expect, it } from 'vitest';
import catalogStrings from '../../src/lib/i18n/catalog.ts';
import { t } from '../../src/lib/i18n/index.ts';

const UNTRANSLATED = new Set([
  'catalog.runtime.claude',
  'catalog.runtime.openclaw',
  'catalog.runtime.codex',
  'catalog.runtime.cursor',
  'catalog.sort.forks',
]);

describe('catalog namespace shape', () => {
  it('namespaces every key under "catalog." so it cannot collide with core chrome', () => {
    for (const key of Object.keys(catalogStrings.en)) {
      expect(key.startsWith('catalog.'), `key "${key}" is not namespaced`).toBe(true);
    }
  });

  it('defines exactly the same keys in both locales', () => {
    expect(Object.keys(catalogStrings.pt).sort()).toEqual(Object.keys(catalogStrings.en).sort());
  });

  it('never ships an empty string', () => {
    for (const locale of [catalogStrings.en, catalogStrings.pt]) {
      for (const [key, value] of Object.entries(locale)) {
        expect(value.trim().length, `"${key}" is empty`).toBeGreaterThan(0);
      }
    }
  });
});

describe('catalog copy is hand-written in both locales', () => {
  it('translates the rail, the sort tabs and the empty state rather than echoing English', () => {
    expect(catalogStrings.en['catalog.facet.risk']).toBe('Risk & capability');
    expect(catalogStrings.pt['catalog.facet.risk']).toBe('Risco e capacidade');
    expect(catalogStrings.pt['catalog.risk.noCodeExecution']).toBe('Não executa código');
    expect(catalogStrings.pt['catalog.sort.score']).toBe('Pontuação');
    expect(catalogStrings.pt['catalog.empty.title']).toBe('Nenhuma skill corresponde a estes filtros');
  });

  it('leaves runtime product names alone, because they are names and not words', () => {
    for (const key of UNTRANSLATED) {
      expect(catalogStrings.pt[key]).toBe(catalogStrings.en[key]);
    }
  });

  it('translates everything that is not a product name', () => {
    for (const key of Object.keys(catalogStrings.en)) {
      if (UNTRANSLATED.has(key)) continue;
      expect(catalogStrings.pt[key], `"${key}" was left in English`).not.toBe(catalogStrings.en[key]);
    }
  });
});

describe('the namespace is merged into the shared lookup', () => {
  it('resolves through t() instead of falling back to the key', () => {
    expect(t('catalog.title', 'en')).toBe('Catalog');
    expect(t('catalog.title', 'pt')).toBe('Catálogo');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/i18n-catalog.test.ts`
Expected: FAIL — `src/lib/i18n/catalog.ts` does not exist, so Vitest cannot resolve the import and
reports `Error: Failed to load url ../../src/lib/i18n/catalog.ts`. No test executes.

- [ ] **Step 3: Create `src/lib/i18n/catalog.ts`**
```ts
// src/lib/i18n/catalog.ts
// Catalog chrome, hand-written in both locales (spec §8). Owned by B3; B1 merges this namespace
// into src/lib/i18n/index.ts and exports t(). Keys are prefixed "catalog." so the merge is flat
// and collision-free.

const en = {
  'catalog.title': 'Catalog',
  'catalog.intro': 'Every indexed skill, filterable by what it can actually do to your machine.',
  'catalog.railTitle': 'Filters',
  'catalog.facet.risk': 'Risk & capability',
  'catalog.facet.subdomain': 'Subdomain',
  'catalog.facet.runtime': 'Runtime',
  'catalog.facet.license': 'License',
  'catalog.anyOf': 'Matches any checked value',
  'catalog.clearAll': 'Clear all filters',
  'catalog.removeFilter': 'Remove filter',
  'catalog.results': 'results',
  'catalog.resultsHeading': 'Results',
  'catalog.activeFilters': 'Active filters',
  'catalog.sortBy': 'Sort by',
  'catalog.pagination': 'Pagination',
  'catalog.empty.title': 'No skills match these filters',
  'catalog.empty.body':
    'Every filter is a claim about the indexed data, not a guess. Remove one and the catalog will show you what is really there.',
  'catalog.empty.action': 'Clear all filters',
  'catalog.license.unspecified': 'Not declared',
  'catalog.sort.score': 'Score',
  'catalog.sort.stars': 'Stars',
  'catalog.sort.forks': 'Forks',
  'catalog.sort.newest': 'Newest',
  'catalog.sort.updated': 'Updated',
  'catalog.risk.noCodeExecution': 'Does not execute code',
  'catalog.risk.executesCode': 'Executes code',
  'catalog.risk.network': 'Reaches the network',
  'catalog.risk.readsEnv': 'Reads environment',
  'catalog.risk.declaredTools': 'Declares tool access',
  'catalog.risk.portable': 'Portable frontmatter',
  'catalog.runtime.claude': 'Claude Code',
  'catalog.runtime.openclaw': 'OpenClaw',
  'catalog.runtime.codex': 'Codex',
  'catalog.runtime.cursor': 'Cursor',
  'catalog.runtime.generic': 'Generic',
  'catalog.search.label': 'Filter these results by text',
  'catalog.search.placeholder': 'name, path, tag or repository',
  'catalog.search.submit': 'Apply text filter',
  'catalog.search.clear': 'Clear the text filter',
  'catalog.search.suggestions': 'Search suggestions',
};

const pt: Record<keyof typeof en, string> = {
  'catalog.title': 'Catálogo',
  'catalog.intro': 'Todas as skills indexadas, filtráveis pelo que de fato podem fazer na sua máquina.',
  'catalog.railTitle': 'Filtros',
  'catalog.facet.risk': 'Risco e capacidade',
  'catalog.facet.subdomain': 'Subdomínio',
  'catalog.facet.runtime': 'Runtime de agente',
  'catalog.facet.license': 'Licença',
  'catalog.anyOf': 'Corresponde a qualquer valor marcado',
  'catalog.clearAll': 'Limpar todos os filtros',
  'catalog.removeFilter': 'Remover filtro',
  'catalog.results': 'resultados',
  'catalog.resultsHeading': 'Resultados',
  'catalog.activeFilters': 'Filtros ativos',
  'catalog.sortBy': 'Ordenar por',
  'catalog.pagination': 'Paginação',
  'catalog.empty.title': 'Nenhuma skill corresponde a estes filtros',
  'catalog.empty.body':
    'Cada filtro é uma afirmação sobre os dados indexados, não um palpite. Remova um e o catálogo mostrará o que existe de fato.',
  'catalog.empty.action': 'Limpar todos os filtros',
  'catalog.license.unspecified': 'Não declarada',
  'catalog.sort.score': 'Pontuação',
  'catalog.sort.stars': 'Estrelas',
  'catalog.sort.forks': 'Forks',
  'catalog.sort.newest': 'Mais recentes',
  'catalog.sort.updated': 'Atualizadas',
  'catalog.risk.noCodeExecution': 'Não executa código',
  'catalog.risk.executesCode': 'Executa código',
  'catalog.risk.network': 'Acessa a rede',
  'catalog.risk.readsEnv': 'Lê variáveis de ambiente',
  'catalog.risk.declaredTools': 'Declara acesso a ferramentas',
  'catalog.risk.portable': 'Frontmatter portável',
  'catalog.runtime.claude': 'Claude Code',
  'catalog.runtime.openclaw': 'OpenClaw',
  'catalog.runtime.codex': 'Codex',
  'catalog.runtime.cursor': 'Cursor',
  'catalog.runtime.generic': 'Genérico',
  'catalog.search.label': 'Filtrar estes resultados por texto',
  'catalog.search.placeholder': 'nome, caminho, tag ou repositório',
  'catalog.search.submit': 'Aplicar filtro de texto',
  'catalog.search.clear': 'Limpar o filtro de texto',
  'catalog.search.suggestions': 'Sugestões de busca',
};

export default { en, pt };
```

`catalog.search.suggestions` names the `role="listbox"` the combobox in B3.10 points at; a listbox
with no accessible name is announced as an unlabelled group.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/i18n-catalog.test.ts`
Expected: PASS, 6 tests.

If the last test fails with `expected 'catalog.title' to be 'Catalog'`, `t()` echoed the key back:
the namespace was not picked up by B1's `src/lib/i18n/index.ts` merge. Register it there rather than
duplicating the strings.

- [ ] **Step 5: Commit**
```bash
git add src/lib/i18n/catalog.ts tests/catalog/i18n-catalog.test.ts
git commit -m "feat(i18n): hand-written catalog chrome in en and pt-BR"
```

---

### Task B3.2: Pagefind install and the two independent base-path configs

Astro's `base` and Pagefind's own `baseUrl` / bundle path are separate settings that never talk to
each other (spec §11.1). When they disagree the search bundle 404s with no console error and the
catalog renders zero results forever. This task asserts the agreement first, then installs the
integration and puts both Pagefind values in one exported place. `PAGEFIND_BUNDLE_PATH` is the only
derivation of that path in the repository — B5 imports it from here rather than calling `withBase`
again.

**Files:**
- Modify: `package.json` (A1) — through `npm install`, no hand edit
- Modify: `astro.config.mjs` (A1) — two exact anchors
- Create: `src/lib/facets.ts`
- Test: `tests/catalog/pagefind-base.test.ts`

**Interfaces:**
- Consumes: `astro.config.mjs` from A1.2 with `base: '/ai-tools-hub/'`.
- Produces: `SITE_BASE`, `PAGEFIND_BASE_URL`, `PAGEFIND_BUNDLE_PATH` from `src/lib/facets.ts`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/pagefind-base.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PAGEFIND_BASE_URL, PAGEFIND_BUNDLE_PATH, SITE_BASE } from '../../src/lib/facets.ts';

const root = resolve(__dirname, '../..');
const config = readFileSync(resolve(root, 'astro.config.mjs'), 'utf8');

describe('Astro base and Pagefind path config agree', () => {
  it('astro.config.mjs base matches SITE_BASE', () => {
    expect(config.match(/base:\s*['"]([^'"]+)['"]/)?.[1]).toBe(SITE_BASE);
  });

  it('astro.config.mjs registers the astro-pagefind integration', () => {
    expect(config).toContain("from 'astro-pagefind'");
    expect(config).toMatch(/integrations:\s*\[[^\]]*pagefind\(\)/s);
  });

  it('pins both search packages exactly, because a floating minor changes the bundle path', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.devDependencies, ...pkg.dependencies };
    expect(deps['astro-pagefind']).toBe('2.0.1');
    expect(deps.pagefind).toBe('1.5.2');
  });

  it('PAGEFIND_BASE_URL equals the site base', () => {
    expect(PAGEFIND_BASE_URL).toBe(SITE_BASE);
  });

  it('PAGEFIND_BUNDLE_PATH is the site base plus the bundle location', () => {
    expect(PAGEFIND_BUNDLE_PATH).toBe(`${SITE_BASE}pagefind/pagefind.js`);
  });

  it('the build actually emits the file that path points at', () => {
    const rel = PAGEFIND_BUNDLE_PATH.slice(SITE_BASE.length);
    expect(
      existsSync(resolve(root, 'dist', rel)),
      `dist/${rel} was not emitted; the Pagefind bundle path and Astro base disagree`,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/pagefind-base.test.ts`
Expected: FAIL — `src/lib/facets.ts` does not exist, so Vitest cannot resolve the import and reports
`Error: Failed to load url ../../src/lib/facets.ts`. No test executes.

- [ ] **Step 3: Install astro-pagefind and pagefind at the pinned versions**
```bash
npm install --save-exact astro-pagefind@2.0.1 pagefind@1.5.2
```

- [ ] **Step 4: Register the integration in `astro.config.mjs`**
Insert this line immediately below the existing line `import sitemap from '@astrojs/sitemap';`:
```js
import pagefind from 'astro-pagefind';
```
Then replace the existing line `  integrations: [sitemap()],` with:
```js
  integrations: [sitemap(), pagefind()],
```
Leave `site`, `base`, `output` and `trailingSlash` exactly as A1.2 left them. `base` must stay
`'/ai-tools-hub/'`.

- [ ] **Step 5: Create `src/lib/facets.ts`**
```ts
// src/lib/facets.ts
// Astro `base` and Pagefind's own path config are separate settings that never consult each other.
// Both live here so CI can assert they agree; a silent disagreement 404s the search bundle.
//
// This module is imported by the catalog's client script, so it must stay free of Node built-ins:
// no `node:fs`, and no import of src/lib/taxonomy.ts or src/lib/data.ts.

export const SITE_BASE = '/ai-tools-hub/';
export const PAGEFIND_BASE_URL = SITE_BASE;
export const PAGEFIND_BUNDLE_PATH = `${SITE_BASE}pagefind/pagefind.js`;
```

- [ ] **Step 6: Run test to verify it passes**
Run: `npx vitest run tests/catalog/pagefind-base.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**
```bash
git add package.json package-lock.json astro.config.mjs src/lib/facets.ts tests/catalog/pagefind-base.test.ts
git commit -m "feat(catalog): wire astro-pagefind and assert base paths agree"
```

---

### Task B3.3: Flat filter-value derivation shared by index and rail

The rail and the Pagefind index must derive facet values from one function, or a value is checkable
in the UI and absent from the index. Keys are flat and parallel (`domain`, `subdomain`, `runtime`,
`risk`, `license`) — nesting is a UI concern only, and nesting the index is cheap now and expensive
once a thousand entries are tagged.

`listedSkills` lands here too, beside the derivation it guards. §5.1 evicts an entry by setting
`listed` false rather than deleting the row: the skill stays in `data/skills.json`, keeps being
re-scored, and keeps its page (B4). Every catalog surface — the grid, the facet counts, the Pagefind
index — is built from the filtered array, so an evicted entry leaves all of them at once.

**Files:**
- Modify: `src/lib/facets.ts`
- Test: `tests/catalog/facets-index.test.ts`

**Interfaces:**
- Consumes: `Collection`, `Runtime`, `Safety`, `Skill` from `src/types.ts` (A1).
- Produces: `INDEX_FILTER_KEYS`, `IndexFilterKey`, `RAIL_FILTER_KEYS`, `RailFilterKey`,
  `RISK_VALUES`, `RiskValue`, `RUNTIME_ORDER`, `LICENSE_UNSPECIFIED`,
  `collectionFor(repo: string, collections: Collection[]): Collection | null`,
  `riskValues(safety: Safety, portable: boolean): RiskValue[]`,
  `indexValues(skill: Skill): Record<IndexFilterKey, string[]>`,
  `listedSkills(skills: Skill[]): Skill[]`,
  `countValues(skills: Skill[], key: IndexFilterKey): Map<string, number>`,
  `sortValues(skill: Skill, collection: Collection | null): SortValues`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/facets-index.test.ts
import { describe, expect, it } from 'vitest';
import type { Collection, Skill } from '../../src/types.ts';
import {
  INDEX_FILTER_KEYS,
  RAIL_FILTER_KEYS,
  RISK_VALUES,
  RUNTIME_ORDER,
  collectionFor,
  countValues,
  indexValues,
  listedSkills,
  riskValues,
  sortValues,
} from '../../src/lib/facets.ts';

export function skill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'acme/kit@abc123:skills/scan/SKILL.md',
    type: 'skill',
    name: 'Dependency scan',
    description: 'Scans a lockfile for known-malicious packages and prints a report.',
    descriptionPt: null,
    longPt: null,
    repo: 'acme/kit',
    path: 'skills/scan/SKILL.md',
    sha: 'abc123',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude', 'generic'],
    safety: {
      executesCode: true,
      scriptCount: 2,
      languages: ['python'],
      network: true,
      readsEnv: false,
      declaredTools: ['Bash'],
    },
    primary: 'security/supply-chain',
    also: ['devops-infra/general'],
    tags: ['sbom'],
    securityRelevant: true,
    // §5.1: false once the per-subdomain cap evicts it. The row survives, the listing does not.
    listed: true,
    // score === breakdown.total, every component inside its 25/30/25/20 cap.
    score: 91,
    breakdown: { adoption: 20, maintenance: 26, provenance: 25, completeness: 20, total: 91 },
    ...over,
  };
}

describe('filter key vocabulary', () => {
  it('indexes five flat parallel keys', () => {
    expect([...INDEX_FILTER_KEYS]).toEqual(['domain', 'subdomain', 'runtime', 'risk', 'license']);
  });

  it('orders the rail by decision frequency with risk first', () => {
    expect([...RAIL_FILTER_KEYS]).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('never uses a Pagefind reserved word as a key or a risk value', () => {
    const reserved = ['all', 'any', 'none', 'not'];
    for (const key of INDEX_FILTER_KEYS) expect(reserved).not.toContain(key);
    for (const value of RISK_VALUES) expect(reserved).not.toContain(value);
  });

  it('lists runtimes in LED order, never alphabetically', () => {
    expect([...RUNTIME_ORDER]).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
  });
});

describe('riskValues', () => {
  it('emits the positive "no-code-execution" value so hiding executors is one checkbox', () => {
    const safe = { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null };
    expect(riskValues(safe, false)).toEqual(['no-code-execution']);
  });

  it('emits every capability the safety surface actually found', () => {
    expect(riskValues(skill().safety, true)).toEqual(['executes-code', 'network', 'declared-tools', 'portable']);
  });

  it('treats an empty declaredTools array as not declared', () => {
    const s = { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: true, declaredTools: [] };
    expect(riskValues(s, false)).toEqual(['no-code-execution', 'reads-env']);
  });
});

describe('indexValues', () => {
  it('flattens primary and also into parallel domain and subdomain keys', () => {
    const v = indexValues(skill());
    expect(v.domain).toEqual(['security', 'devops-infra']);
    expect(v.subdomain).toEqual(['security/supply-chain', 'devops-infra/general']);
  });

  it('carries runtimes verbatim and risk from the safety surface', () => {
    const v = indexValues(skill());
    expect(v.runtime).toEqual(['claude', 'generic']);
    expect(v.risk).toEqual(['executes-code', 'network', 'declared-tools', 'portable']);
  });

  it('names the missing-license state rather than dropping it', () => {
    expect(indexValues(skill({ license: null })).license).toEqual(['unspecified']);
  });

  it('de-duplicates a domain shared by primary and also', () => {
    const v = indexValues(skill({ primary: 'security/supply-chain', also: ['security/cicd-pipeline'] }));
    expect(v.domain).toEqual(['security']);
  });
});

describe('listedSkills', () => {
  it('drops the entries the per-subdomain cap evicted', () => {
    const kept = skill();
    const evicted = skill({ id: 'acme/kit@abc123:skills/old/SKILL.md', listed: false });
    expect(listedSkills([kept, evicted])).toEqual([kept]);
  });

  it('keeps everything when nothing was evicted, without mutating the input', () => {
    const all = [skill(), skill({ id: 'acme/kit@abc123:skills/two/SKILL.md' })];
    expect(listedSkills(all)).toEqual(all);
    expect(all).toHaveLength(2);
  });
});

describe('countValues', () => {
  it('counts each skill once per distinct value', () => {
    const skills = [skill(), skill({ id: 'b', primary: 'security/cicd-pipeline', also: [] })];
    const counts = countValues(skills, 'subdomain');
    expect(counts.get('security/supply-chain')).toBe(1);
    expect(counts.get('security/cicd-pipeline')).toBe(1);
    expect(counts.get('devops-infra/general')).toBe(1);
  });
});

describe('sortValues', () => {
  const collection: Collection = {
    repo: 'acme/kit',
    stars: 6908,
    forks: 123,
    pushedAt: '2026-08-20T00:00:00.000Z',
    license: 'MIT',
    topics: ['agent-skills'],
    isOrg: true,
    curated: true,
  };

  it('zero-pads so Pagefind string sorting matches numeric order', () => {
    expect(sortValues(skill(), collection)).toEqual({
      score: '091',
      stars: '000006908',
      forks: '000000123',
      newest: '20260829',
      updated: '000012',
    });
  });

  it('falls back to zeroes when the repo has no collection record', () => {
    const v = sortValues(skill(), null);
    expect(v.stars).toBe('000000000');
    expect(v.forks).toBe('000000000');
  });

  it('refuses to invent a date from a malformed indexedAt', () => {
    expect(sortValues(skill({ indexedAt: 'not-a-date' }), null).newest).toBe('00000000');
  });
});

describe('collectionFor', () => {
  it('finds a collection by repo and returns null when absent', () => {
    const c: Collection = {
      repo: 'acme/kit', stars: 1, forks: 0, pushedAt: '2026-01-01T00:00:00.000Z',
      license: null, topics: [], isOrg: false, curated: false,
    };
    expect(collectionFor('acme/kit', [c])).toBe(c);
    expect(collectionFor('other/repo', [c])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/facets-index.test.ts`
Expected: FAIL — `src/lib/facets.ts` exists but exports only the three path constants, so Vite
reports `SyntaxError: The requested module '/src/lib/facets.ts' does not provide an export named 'INDEX_FILTER_KEYS'`.
No test executes.

- [ ] **Step 3: Append the implementation to `src/lib/facets.ts`**
```ts
import type { Collection, Runtime, Safety, Skill } from '../types.ts';

export const INDEX_FILTER_KEYS = ['domain', 'subdomain', 'runtime', 'risk', 'license'] as const;
export type IndexFilterKey = (typeof INDEX_FILTER_KEYS)[number];

/** Rail order is decision frequency: "hide anything that executes code" comes first (§10.2). */
export const RAIL_FILTER_KEYS = ['risk', 'subdomain', 'runtime', 'license'] as const;
export type RailFilterKey = (typeof RAIL_FILTER_KEYS)[number];

export const RISK_VALUES = [
  'no-code-execution',
  'executes-code',
  'network',
  'reads-env',
  'declared-tools',
  'portable',
] as const;
export type RiskValue = (typeof RISK_VALUES)[number];

/** LED order (§10.3). Never sort runtimes alphabetically. */
export const RUNTIME_ORDER: readonly Runtime[] = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

export const LICENSE_UNSPECIFIED = 'unspecified';

export function collectionFor(repo: string, collections: Collection[]): Collection | null {
  return collections.find((c) => c.repo === repo) ?? null;
}

export function riskValues(safety: Safety, portable: boolean): RiskValue[] {
  const out: RiskValue[] = [];
  out.push(safety.executesCode ? 'executes-code' : 'no-code-execution');
  if (safety.network) out.push('network');
  if (safety.readsEnv) out.push('reads-env');
  if (safety.declaredTools && safety.declaredTools.length > 0) out.push('declared-tools');
  if (portable) out.push('portable');
  return out;
}

export function indexValues(skill: Skill): Record<IndexFilterKey, string[]> {
  const slugs = [skill.primary, ...skill.also].filter(Boolean);
  return {
    domain: [...new Set(slugs.map((s) => s.split('/')[0]))],
    subdomain: [...new Set(slugs)],
    runtime: [...new Set(skill.runtimes)],
    risk: riskValues(skill.safety, skill.portable),
    license: [skill.license ?? LICENSE_UNSPECIFIED],
  };
}

/**
 * §5.1: eviction by the per-subdomain cap sets `listed` false and leaves the row in
 * data/skills.json — it keeps being re-scored and it keeps its page (B4). Every catalog surface
 * is built from this filtered array, so an evicted entry disappears from the grid, the facet
 * counts and the search index at once, and returns whole if its score recovers.
 */
export function listedSkills(skills: Skill[]): Skill[] {
  return skills.filter((skill) => skill.listed);
}

export function countValues(skills: Skill[], key: IndexFilterKey): Map<string, number> {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    for (const value of indexValues(skill)[key]) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

export interface SortValues {
  score: string;
  stars: string;
  forks: string;
  newest: string;
  updated: string;
}

function pad(n: number, width: number): string {
  const safe = Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  return String(safe).padStart(width, '0');
}

/** Pagefind sorts sort values as strings, so every numeric value is zero-padded to a fixed width. */
export function sortValues(skill: Skill, collection: Collection | null): SortValues {
  const iso = typeof skill.indexedAt === 'string' ? skill.indexedAt.slice(0, 10) : '';
  const newest = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.replace(/-/g, '') : '00000000';
  return {
    score: pad(skill.score, 3),
    stars: pad(collection?.stars ?? 0, 9),
    forks: pad(collection?.forks ?? 0, 9),
    newest,
    updated: pad(skill.updatedDays, 6),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/facets-index.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**
```bash
git add src/lib/facets.ts tests/catalog/facets-index.test.ts
git commit -m "feat(catalog): derive flat filter and sort values from one source"
```

---

### Task B3.4: The index payload contract, asserted against the built skill pages

Pagefind's unit of indexing is a page, so the per-skill static page carries the filter attributes.
That page is `src/pages/[lang]/skills/[...slug].astro`, owned by B4, which runs before B3 (RULE 4)
and emits the `data-pagefind-body` block itself. **B3 does not edit that file and B4 imports nothing
from B3.** What B3 owns is the vocabulary: `pagefindIndexAttrs` is the executable definition of the
payload a skill page must carry, built from the same `indexValues` the rail is built from, and the
tests here assert B4's built pages against it. A value checkable in the rail but missing from the
index turns this task red, which is the whole point.

§5.1 adds one more thing to assert. B4 generates a page for **every** skill, listed or not, but emits
the index block only for a listed one; an evicted skill's page instead carries
`<meta name="robots" content="noindex">`. The two must move together, so the invariant asserted here
is *body if and only if not noindex* — a page that is indexed by Pagefind but hidden from search
engines, or the reverse, is a bug in B4's route.

**Files:**
- Modify: `src/lib/facets.ts`
- Test: `tests/catalog/pagefind-filters.test.ts`

**Interfaces:**
- Consumes: `INDEX_FILTER_KEYS`, `indexValues`, `sortValues` from `src/lib/facets.ts`; the built
  output of `src/pages/[lang]/skills/[...slug].astro` (B4) under `dist/`.
- Produces: `PagefindPair`, `PagefindIndexAttrs`,
  `pagefindIndexAttrs(skill: Skill, collection: Collection | null): PagefindIndexAttrs`; the test
  helpers `skillPages()` and `indexedSkillPages()`, which B3.14 reuses.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/pagefind-filters.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { INDEX_FILTER_KEYS, pagefindIndexAttrs } from '../../src/lib/facets.ts';
import { skill } from './facets-index.test.ts';

const root = resolve(__dirname, '../..');

/** Every built skill page, listed or evicted — B4 generates one for each row (§5.1). */
export function skillPages(): string[] {
  const start = resolve(root, 'dist/en/skills');
  if (!existsSync(start)) throw new Error('dist/en/skills not found; A1 global setup did not build the site');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'index.html') out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(start);
  if (out.length === 0) throw new Error('no built skill page found under dist/en/skills');
  return out;
}

/** Only the pages Pagefind will actually index — an evicted skill's page carries no block. */
export function indexedSkillPages(): string[] {
  const indexed = skillPages().filter((page) => page.includes('data-pagefind-body'));
  if (indexed.length === 0) {
    throw new Error('no built skill page carries data-pagefind-body; the search index would be empty');
  }
  return indexed;
}

function isNoindex(page: string): boolean {
  return (page.match(/<meta[^>]*content="noindex"[^>]*>/)?.[0] ?? '').includes('name="robots"');
}

describe('pagefindIndexAttrs', () => {
  it('emits the five flat keys once each, in index order', () => {
    const attrs = pagefindIndexAttrs(skill(), null);
    expect([...new Set(attrs.filters.map((f) => f.key))]).toEqual([...INDEX_FILTER_KEYS]);
    expect(attrs.sorts.map((s) => s.key)).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(attrs.id).toBe('acme/kit@abc123:skills/scan/SKILL.md');
  });

  it('carries the text Pagefind should actually match on', () => {
    const attrs = pagefindIndexAttrs(skill(), null);
    expect(attrs.text).toContain('Dependency scan');
    expect(attrs.text).toContain('acme/kit skills/scan/SKILL.md');
    expect(attrs.text.join(' ')).toContain('sbom');
  });
});

describe('B4 skill pages carry the payload this vocabulary describes', () => {
  const pages = skillPages();
  const indexed = indexedSkillPages();
  const html = indexed[0];

  it('indexes a page if and only if search engines may index it too', () => {
    for (const page of pages) {
      expect(
        page.includes('data-pagefind-body'),
        'an evicted page must carry robots=noindex and no data-pagefind-body, and a listed page neither',
      ).toBe(!isNoindex(page));
    }
  });

  it('marks exactly one indexable body on every listed skill page', () => {
    for (const page of indexed) {
      expect((page.match(/data-pagefind-body/g) ?? []).length).toBe(1);
    }
  });

  it('emits every one of the five flat filter keys', () => {
    for (const key of INDEX_FILTER_KEYS) {
      expect(html).toMatch(new RegExp(`data-pagefind-filter="${key}\\[[^\\]]+\\]"`));
    }
  });

  it('never emits a filter key outside the flat vocabulary', () => {
    const keys = [...html.matchAll(/data-pagefind-filter="([a-z-]+)\[/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect([...INDEX_FILTER_KEYS]).toContain(key);
    }
  });

  it('emits all five sort keys, zero-padded', () => {
    for (const key of ['score', 'stars', 'forks', 'newest', 'updated']) {
      expect(html).toMatch(new RegExp(`data-pagefind-sort="${key}\\[0*\\d+\\]"`));
    }
  });

  it('emits the skill id as metadata, so a result maps back onto its card', () => {
    expect(html).toMatch(/data-pagefind-meta="id\[[^\]]+\]"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/pagefind-filters.test.ts`
Expected: FAIL — `does not provide an export named 'pagefindIndexAttrs'`. No test executes.

- [ ] **Step 3: Append the helper to `src/lib/facets.ts`**
```ts
export interface PagefindPair {
  key: string;
  value: string;
}

export interface PagefindIndexAttrs {
  id: string;
  filters: PagefindPair[];
  sorts: PagefindPair[];
  text: string[];
}

/**
 * The attribute payload one skill page's Pagefind index block must carry. Kept here, beside
 * indexValues and sortValues, so the rail can never offer a value the index does not carry. B4's
 * per-skill route emits the block — and emits it only for a listed skill, since an evicted row
 * keeps its page but leaves the index (§5.1). This is the definition its built output is
 * asserted against.
 */
export function pagefindIndexAttrs(skill: Skill, collection: Collection | null): PagefindIndexAttrs {
  const values = indexValues(skill);
  const sorts = sortValues(skill, collection);
  const filters: PagefindPair[] = [];
  for (const key of INDEX_FILTER_KEYS) {
    for (const value of values[key]) filters.push({ key, value });
  }
  const text = [
    skill.name,
    skill.description,
    skill.descriptionPt ?? '',
    skill.longPt ?? '',
    skill.tags.join(' '),
    `${skill.repo} ${skill.path}`,
  ].filter((line) => line.trim().length > 0);
  return {
    id: skill.id,
    filters,
    sorts: [
      { key: 'score', value: sorts.score },
      { key: 'stars', value: sorts.stars },
      { key: 'forks', value: sorts.forks },
      { key: 'newest', value: sorts.newest },
      { key: 'updated', value: sorts.updated },
    ],
    text,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/pagefind-filters.test.ts`
Expected: PASS, 8 tests.

If a `B4 skill pages carry the payload` assertion fails, the per-skill route is not emitting the full
index block, or it is emitting one on a page it also marked `noindex`. The fix belongs in B4's task
that owns `src/pages/[lang]/skills/[...slug].astro` — B3 must not edit that file, and duplicating the
block from the catalog side would index the page twice.

- [ ] **Step 5: Commit**
```bash
git add src/lib/facets.ts tests/catalog/pagefind-filters.test.ts
git commit -m "feat(catalog): define the flat pagefind payload and assert the built pages carry it"
```

---

### Task B3.5: Catalog query state — text, filters, sort and page in the URL

Sort tabs and pagination are distinct URLs (§10.2), and the catalog's text query is part of the same
address. This module makes that round-trip deterministic.

**Files:**
- Modify: `src/lib/facets.ts`
- Test: `tests/catalog/facets-query.test.ts`

**Interfaces:**
- Consumes: `INDEX_FILTER_KEYS`, `IndexFilterKey` from `src/lib/facets.ts`.
- Produces: `SORT_KEYS`, `SortKey`, `DEFAULT_SORT`, `PAGE_SIZE`, `FilterState`, `CatalogQuery`,
  `ActiveChip`, `isSortKey`, `parseQuery(search: string): CatalogQuery`,
  `serializeQuery(q: CatalogQuery): string`, `toggleFilter`, `removeFilter`, `activeChips`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/facets-query.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  PAGE_SIZE,
  SORT_KEYS,
  activeChips,
  isSortKey,
  parseQuery,
  removeFilter,
  serializeQuery,
  toggleFilter,
} from '../../src/lib/facets.ts';

const DEFAULT_QUERY = { filters: {}, q: '', sort: 'score' as const, page: 1 };

describe('sort vocabulary', () => {
  it('offers exactly five sorts with score as the default', () => {
    expect([...SORT_KEYS]).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(DEFAULT_SORT).toBe('score');
  });

  it('fits a 6-column grid four rows deep', () => {
    expect(PAGE_SIZE).toBe(24);
  });

  it('guards unknown sort strings', () => {
    expect(isSortKey('stars')).toBe(true);
    expect(isSortKey('relevance')).toBe(false);
  });
});

describe('parseQuery', () => {
  it('returns the default state for an empty search', () => {
    expect(parseQuery('')).toEqual(DEFAULT_QUERY);
  });

  it('splits comma-separated values and decodes slugs', () => {
    const q = parseQuery('?subdomain=security%2Fsupply-chain,security%2Fcicd-pipeline');
    expect(q.filters.subdomain).toEqual(['security/cicd-pipeline', 'security/supply-chain']);
  });

  it('accepts a search string without the leading question mark', () => {
    expect(parseQuery('risk=no-code-execution').filters.risk).toEqual(['no-code-execution']);
  });

  it('ignores unknown parameters', () => {
    expect(parseQuery('?colour=orange')).toEqual(DEFAULT_QUERY);
  });

  it('falls back to the default sort for an unknown sort', () => {
    expect(parseQuery('?sort=relevance').sort).toBe('score');
  });

  it('clamps a junk or non-positive page to 1', () => {
    expect(parseQuery('?page=0').page).toBe(1);
    expect(parseQuery('?page=abc').page).toBe(1);
    expect(parseQuery('?page=7').page).toBe(7);
  });

  it('de-duplicates repeated values', () => {
    expect(parseQuery('?runtime=claude,claude').filters.runtime).toEqual(['claude']);
  });

  it('decodes and trims the text term', () => {
    expect(parseQuery('?q=kube%20audit').q).toBe('kube audit');
    expect(parseQuery('?q=%20%20').q).toBe('');
  });
});

describe('serializeQuery', () => {
  it('emits nothing for the default state', () => {
    expect(serializeQuery(DEFAULT_QUERY)).toBe('');
  });

  it('omits the default sort and page 1', () => {
    expect(serializeQuery({ ...DEFAULT_QUERY, filters: { risk: ['network'] } })).toBe('?risk=network');
  });

  it('puts the text term first, because it is what the reader typed', () => {
    expect(serializeQuery({ ...DEFAULT_QUERY, q: 'kube audit', filters: { risk: ['network'] } }))
      .toBe('?q=kube%20audit&risk=network');
  });

  it('percent-encodes slugs but keeps the comma readable', () => {
    expect(
      serializeQuery({
        filters: { subdomain: ['security/supply-chain', 'devops-infra/general'] },
        q: '',
        sort: 'stars',
        page: 3,
      }),
    ).toBe('?subdomain=devops-infra%2Fgeneral,security%2Fsupply-chain&sort=stars&page=3');
  });

  it('orders keys canonically regardless of insertion order', () => {
    const a = serializeQuery({ ...DEFAULT_QUERY, filters: { license: ['MIT'], risk: ['network'] } });
    const b = serializeQuery({ ...DEFAULT_QUERY, filters: { risk: ['network'], license: ['MIT'] } });
    expect(a).toBe(b);
    expect(a).toBe('?risk=network&license=MIT');
  });

  it('round-trips through parseQuery', () => {
    const q = {
      filters: { subdomain: ['security/supply-chain'], runtime: ['claude'] },
      q: 'lockfile',
      sort: 'updated' as const,
      page: 4,
    };
    expect(parseQuery(serializeQuery(q))).toEqual(q);
  });
});

describe('toggleFilter and removeFilter', () => {
  it('adds a value without mutating the input', () => {
    const before = {};
    expect(toggleFilter(before, 'risk', 'network')).toEqual({ risk: ['network'] });
    expect(before).toEqual({});
  });

  it('removes a value that was already checked', () => {
    expect(toggleFilter({ risk: ['network', 'reads-env'] }, 'risk', 'network')).toEqual({ risk: ['reads-env'] });
  });

  it('drops the key entirely when its last value goes', () => {
    expect(toggleFilter({ risk: ['network'] }, 'risk', 'network')).toEqual({});
  });

  it('keeps values sorted so URLs are stable', () => {
    expect(toggleFilter({ runtime: ['generic'] }, 'runtime', 'claude').runtime).toEqual(['claude', 'generic']);
  });

  it('removeFilter is idempotent for an absent value', () => {
    expect(removeFilter({ risk: ['network'] }, 'risk', 'reads-env')).toEqual({ risk: ['network'] });
  });
});

describe('activeChips', () => {
  it('flattens the state in canonical key order, one chip per value', () => {
    expect(activeChips({ license: ['MIT'], risk: ['network', 'reads-env'] })).toEqual([
      { key: 'risk', value: 'network' },
      { key: 'risk', value: 'reads-env' },
      { key: 'license', value: 'MIT' },
    ]);
  });

  it('is empty for an empty state', () => {
    expect(activeChips({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/facets-query.test.ts`
Expected: FAIL — `does not provide an export named 'SORT_KEYS'`. No test executes.

- [ ] **Step 3: Append the implementation to `src/lib/facets.ts`**
```ts
export const SORT_KEYS = ['score', 'stars', 'forks', 'newest', 'updated'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const DEFAULT_SORT: SortKey = 'score';

/** 24 = four rows of the default 6-column grid (§10.2). */
export const PAGE_SIZE = 24;

export type FilterState = Partial<Record<IndexFilterKey, string[]>>;

export interface CatalogQuery {
  filters: FilterState;
  /** The catalog's own text term. Empty string means "browse", not "search for nothing". */
  q: string;
  sort: SortKey;
  page: number;
}

export interface ActiveChip {
  key: IndexFilterKey;
  value: string;
}

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/** Values are joined with "," — safe because every filter value is a slug or an SPDX id. */
export function parseQuery(search: string): CatalogQuery {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const filters: FilterState = {};
  for (const key of INDEX_FILTER_KEYS) {
    const rawValue = params.get(key);
    if (!rawValue) continue;
    const values = rawValue.split(',').map((v) => v.trim()).filter(Boolean);
    if (values.length > 0) filters[key] = [...new Set(values)].sort();
  }
  const sortParam = params.get('sort') ?? '';
  const pageParam = Number.parseInt(params.get('page') ?? '1', 10);
  return {
    filters,
    q: (params.get('q') ?? '').trim(),
    sort: isSortKey(sortParam) ? sortParam : DEFAULT_SORT,
    page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
  };
}

export function serializeQuery(query: CatalogQuery): string {
  const parts: string[] = [];
  if (query.q.trim().length > 0) parts.push(`q=${encodeURIComponent(query.q.trim())}`);
  for (const key of INDEX_FILTER_KEYS) {
    const values = query.filters[key];
    if (!values || values.length === 0) continue;
    parts.push(`${key}=${[...values].sort().map(encodeURIComponent).join(',')}`);
  }
  if (query.sort !== DEFAULT_SORT) parts.push(`sort=${query.sort}`);
  if (query.page > 1) parts.push(`page=${query.page}`);
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export function toggleFilter(filters: FilterState, key: IndexFilterKey, value: string): FilterState {
  const current = filters[key] ?? [];
  return current.includes(value)
    ? removeFilter(filters, key, value)
    : { ...filters, [key]: [...current, value].sort() };
}

export function removeFilter(filters: FilterState, key: IndexFilterKey, value: string): FilterState {
  const next: FilterState = { ...filters };
  const remaining = (next[key] ?? []).filter((v) => v !== value);
  if (remaining.length > 0) next[key] = remaining;
  else delete next[key];
  return next;
}

export function activeChips(filters: FilterState): ActiveChip[] {
  const chips: ActiveChip[] = [];
  for (const key of INDEX_FILTER_KEYS) {
    for (const value of filters[key] ?? []) chips.push({ key, value });
  }
  return chips;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/facets-query.test.ts`
Expected: PASS, 24 tests.

- [ ] **Step 5: Commit**
```bash
git add src/lib/facets.ts tests/catalog/facets-query.test.ts
git commit -m "feat(catalog): round-trip text, filters, sort and page through the URL"
```

---

### Task B3.6: Facet counts, page windows and result sorting

The count beside a facet value must answer *"what would I get if I added this?"* — that is Pagefind's
`filters` for a key with nothing checked, and `totalFilters` for a key that already has a selection,
because Pagefind ORs within a key and sibling values would otherwise self-zero.

**Files:**
- Modify: `src/lib/facets.ts`
- Test: `tests/catalog/facets-counts.test.ts`

**Interfaces:**
- Consumes: `FilterState`, `SortKey`, `PAGE_SIZE` from `src/lib/facets.ts`; `Skill`, `Collection` from `src/types.ts`.
- Produces: `FacetCounts`, `PageView`, `SortableCard`, `facetCount`, `pageView`, `pageNumbers`,
  `toSortableCard`, `sortCards`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/facets-counts.test.ts
import { describe, expect, it } from 'vitest';
import type { SortableCard } from '../../src/lib/facets.ts';
import { facetCount, pageNumbers, pageView, sortCards } from '../../src/lib/facets.ts';

const filters = { risk: { network: 3, 'reads-env': 1 }, runtime: { claude: 2 } };
const totalFilters = { risk: { network: 9, 'reads-env': 4 }, runtime: { claude: 7 } };

describe('facetCount', () => {
  it('uses the narrowed count for a key with nothing checked', () => {
    expect(facetCount('runtime', 'claude', { risk: ['network'] }, filters, totalFilters)).toBe(2);
  });

  it('uses the unfiltered count for a key that already has a selection, so OR siblings do not self-zero', () => {
    expect(facetCount('risk', 'reads-env', { risk: ['network'] }, filters, totalFilters)).toBe(4);
  });

  it('reports zero for a value that would return nothing', () => {
    expect(facetCount('runtime', 'cursor', {}, filters, totalFilters)).toBe(0);
  });

  it('reports zero for an entirely unknown key', () => {
    expect(facetCount('licence', 'MIT', {}, filters, totalFilters)).toBe(0);
  });
});

describe('pageView', () => {
  it('describes the first page of an exact fit', () => {
    expect(pageView(48, 1, 24)).toEqual({ page: 1, totalPages: 2, from: 0, to: 24, total: 48 });
  });

  it('clips the final partial page', () => {
    expect(pageView(30, 2, 24)).toEqual({ page: 2, totalPages: 2, from: 24, to: 30, total: 30 });
  });

  it('clamps a page past the end back to the last page', () => {
    expect(pageView(30, 9, 24).page).toBe(2);
  });

  it('always reports one page for an empty result set', () => {
    expect(pageView(0, 1, 24)).toEqual({ page: 1, totalPages: 1, from: 0, to: 0, total: 0 });
  });
});

describe('pageNumbers', () => {
  it('lists every page while they fit', () => {
    expect(pageNumbers(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('gaps to the end from the start', () => {
    expect(pageNumbers(1, 10)).toEqual([1, 2, 'gap', 10]);
  });

  it('windows around the middle', () => {
    expect(pageNumbers(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
  });

  it('gaps from the start at the end', () => {
    expect(pageNumbers(10, 10)).toEqual([1, 'gap', 9, 10]);
  });

  it('never replaces page 2 with a gap', () => {
    expect(pageNumbers(2, 10)).toEqual([1, 2, 3, 'gap', 10]);
  });

  it('returns an empty list when there are no pages', () => {
    expect(pageNumbers(1, 0)).toEqual([]);
  });
});

describe('sortCards', () => {
  const cards: SortableCard[] = [
    { id: 'b', score: 90, stars: 500, forks: 3, newest: 200, updated: 5 },
    { id: 'a', score: 90, stars: 900, forks: 1, newest: 100, updated: 40 },
    { id: 'c', score: 77, stars: 10, forks: 9, newest: 300, updated: 1 },
  ];

  it('sorts by score descending, breaking ties on id for determinism', () => {
    expect(sortCards(cards, 'score').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by stars descending', () => {
    expect(sortCards(cards, 'stars').map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by forks descending', () => {
    expect(sortCards(cards, 'forks').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts newest by indexing time descending', () => {
    expect(sortCards(cards, 'newest').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts updated by fewest days since the path changed', () => {
    expect(sortCards(cards, 'updated').map((c) => c.id)).toEqual(['c', 'b', 'a']);
  });

  it('does not mutate the input array', () => {
    const copy = [...cards];
    sortCards(cards, 'stars');
    expect(cards).toEqual(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/facets-counts.test.ts`
Expected: FAIL — `does not provide an export named 'facetCount'`. No test executes.

- [ ] **Step 3: Append the implementation to `src/lib/facets.ts`**
```ts
export type FacetCounts = Record<string, Record<string, number>>;

/**
 * Pagefind ORs within a key and ANDs across keys. `filters` is narrowed by the active selection, so
 * a sibling of an already-checked value reads 0; `totalFilters` ignores the selection and is the
 * closest available answer to "what would adding this return".
 */
export function facetCount(
  key: string,
  value: string,
  active: FilterState,
  filters: FacetCounts,
  totalFilters: FacetCounts,
): number {
  const keyIsActive = ((active as Record<string, string[] | undefined>)[key] ?? []).length > 0;
  const source = keyIsActive ? totalFilters : filters;
  return source?.[key]?.[value] ?? 0;
}

export interface PageView {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  total: number;
}

export function pageView(total: number, page: number, pageSize: number = PAGE_SIZE): PageView {
  const size = Math.max(1, Math.floor(pageSize));
  const count = Math.max(0, Math.floor(total));
  const totalPages = Math.max(1, Math.ceil(count / size));
  const requested = Math.floor(page);
  const current = Math.min(Math.max(1, Number.isFinite(requested) ? requested : 1), totalPages);
  const from = (current - 1) * size;
  return { page: current, totalPages, from, to: Math.min(from + size, count), total: count };
}

export function pageNumbers(current: number, total: number): (number | 'gap')[] {
  if (total <= 0) return [];
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const wanted = new Set<number>([1, total]);
  for (let p = current - 1; p <= current + 1; p += 1) {
    if (p >= 1 && p <= total) wanted.add(p);
  }
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) out.push('gap');
    out.push(page);
    previous = page;
  }
  return out;
}

export interface SortableCard {
  id: string;
  score: number;
  stars: number;
  forks: number;
  newest: number;
  updated: number;
}

export function toSortableCard(skill: Skill, collection: Collection | null): SortableCard {
  const parsed = Date.parse(skill.indexedAt);
  return {
    id: skill.id,
    score: skill.score,
    stars: collection?.stars ?? 0,
    forks: collection?.forks ?? 0,
    newest: Number.isNaN(parsed) ? 0 : parsed,
    updated: skill.updatedDays,
  };
}

export function sortCards(cards: SortableCard[], sort: SortKey): SortableCard[] {
  const direction: Record<SortKey, 1 | -1> = { score: -1, stars: -1, forks: -1, newest: -1, updated: 1 };
  const field: Record<SortKey, keyof Omit<SortableCard, 'id'>> = {
    score: 'score', stars: 'stars', forks: 'forks', newest: 'newest', updated: 'updated',
  };
  const key = field[sort];
  const sign = direction[sort];
  return [...cards].sort((a, b) => {
    if (a[key] !== b[key]) return (a[key] - b[key]) * sign;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/facets-counts.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**
```bash
git add src/lib/facets.ts tests/catalog/facets-counts.test.ts
git commit -m "feat(catalog): add facet counts, page windows and result sorting"
```

---

### Task B3.7: Facet group construction and the value→label map

`buildFacetGroups` is what makes the rail's checkable values identical to the values in the index —
it reads them from `indexValues`, the same function `pagefindIndexAttrs` uses. Display names come
from the `Taxonomy` object passed in, never from `src/lib/taxonomy.ts`: that module reads `node:fs`,
and `facets.ts` is bundled into the browser.

It also filters through `listedSkills` before counting anything. A count is a promise about what
clicking will return, and an entry evicted by the per-subdomain cap (§5.1) returns nothing — it is
absent from the Pagefind index, so a count that included it would be a lie the first time a reader
checked the box.

**Files:**
- Modify: `src/lib/facets.ts`
- Test: `tests/catalog/facets-groups.test.ts`

**Interfaces:**
- Consumes: `t(key: string, lang: Lang): string` from `src/lib/i18n/index.ts` (B1); `Lang`, `Skill`,
  `Taxonomy` from `src/types.ts`.
- Produces: `RISK_LABEL_KEYS`, `RUNTIME_LABEL_KEYS`, `FACET_LABEL_KEYS`, `SORT_LABEL_KEYS`,
  `sortLabel(key: SortKey, lang: Lang): string`, `FacetOption`, `FacetGroup`,
  `buildFacetGroups(skills: Skill[], taxonomy: Taxonomy, lang: Lang): FacetGroup[]`,
  `chipLabelMap(groups: FacetGroup[], taxonomy: Taxonomy, lang: Lang): Record<string, Record<string, string>>`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/facets-groups.test.ts
import { describe, expect, it } from 'vitest';
import type { Skill, Taxonomy } from '../../src/types.ts';
import { buildFacetGroups, chipLabelMap, sortLabel } from '../../src/lib/facets.ts';
import { skill as baseSkill } from './facets-index.test.ts';

function skill(over: Partial<Skill> = {}): Skill {
  return baseSkill({
    id: 'acme/kit@abc:skills/a/SKILL.md',
    name: 'A',
    runtimes: ['claude'],
    safety: { executesCode: false, scriptCount: 0, languages: [], network: false, readsEnv: false, declaredTools: null },
    also: [],
    tags: [],
    // score === breakdown.total, every component inside its cap.
    score: 94,
    breakdown: { adoption: 20, maintenance: 29, provenance: 25, completeness: 20, total: 94 },
    ...over,
  });
}

const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        { slug: 'security/supply-chain', name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' } },
        { slug: 'security/general', name: { en: 'General / Other', pt: 'Geral / Outros' } },
      ],
    },
  ],
  protected: [],
  aliases: {},
  minimumMass: 5,
};

describe('bilingual rail labels', () => {
  const groups = buildFacetGroups([skill()], taxonomy, 'en');
  const groupsPt = buildFacetGroups([skill()], taxonomy, 'pt');

  it('names each rail group from the catalog namespace', () => {
    expect(groups.map((g) => g.label)).toEqual(['Risk & capability', 'Subdomain', 'Runtime', 'License']);
  });

  it('translates the rail into pt-BR', () => {
    expect(groupsPt[0].label).toBe('Risco e capacidade');
    expect(groupsPt[0].options[0].label).toBe('Não executa código');
  });

  it('states the OR semantics of a multi-select group', () => {
    expect(groups[0].hint).toBe('Matches any checked value');
    expect(groupsPt[0].hint).toBe('Corresponde a qualquer valor marcado');
  });

  it('labels every sort tab in both locales', () => {
    expect(sortLabel('score', 'en')).toBe('Score');
    expect(sortLabel('score', 'pt')).toBe('Pontuação');
    expect(sortLabel('updated', 'pt')).toBe('Atualizadas');
  });
});

describe('buildFacetGroups', () => {
  const groups = buildFacetGroups([skill(), skill({ id: 'x', license: null, runtimes: ['codex'] })], taxonomy, 'en');

  it('orders the rail Risk, Subdomain, Runtime, License', () => {
    expect(groups.map((g) => g.key)).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('always shows all six risk values, including those at zero', () => {
    expect(groups[0].options.map((o) => o.value)).toEqual([
      'no-code-execution', 'executes-code', 'network', 'reads-env', 'declared-tools', 'portable',
    ]);
    expect(groups[0].options[0].count).toBe(2);
    expect(groups[0].options[1].count).toBe(0);
  });

  it('shows only subdomains that hold at least one entry, labelled from the taxonomy', () => {
    expect(groups[1].options.map((o) => o.value)).toEqual(['security/supply-chain']);
    expect(groups[1].options[0].label).toBe('Supply Chain & Dependencies');
  });

  it('nests subdomains under their domain in the UI, never in the index', () => {
    expect(groups[1].options[0].group).toBe('Security');
    expect(groups[1].key).toBe('subdomain');
  });

  it('shows every runtime in LED order with real counts', () => {
    expect(groups[2].options.map((o) => o.value)).toEqual(['claude', 'openclaw', 'codex', 'cursor', 'generic']);
    expect(groups[2].options.find((o) => o.value === 'codex')?.count).toBe(1);
  });

  it('sorts licenses by count and always names the undeclared state last', () => {
    expect(groups[3].options.map((o) => o.value)).toEqual(['MIT', 'unspecified']);
    expect(groups[3].options[1].label).toBe('Not declared');
  });

  it('localises the undeclared license label', () => {
    const pt = buildFacetGroups([skill({ license: null })], taxonomy, 'pt');
    expect(pt[3].options[0].label).toBe('Não declarada');
  });

  it('counts only listed entries, so no count promises a row the cap evicted', () => {
    const evicted = skill({ id: 'evicted', listed: false, license: null, runtimes: ['codex'] });
    const withEvicted = buildFacetGroups([skill(), evicted], taxonomy, 'en');
    expect(withEvicted[0].options[0].count).toBe(1);
    expect(withEvicted[1].options[0].count).toBe(1);
    expect(withEvicted[2].options.find((o) => o.value === 'codex')?.count).toBe(0);
    expect(withEvicted[3].options.map((o) => o.value)).toEqual(['MIT']);
  });

  it('reads taxonomy names from the argument, so nothing here touches the filesystem', () => {
    const renamed: Taxonomy = {
      ...taxonomy,
      domains: [{ ...taxonomy.domains[0], name: { en: 'Sec', pt: 'Seg' }, children: taxonomy.domains[0].children }],
    };
    expect(buildFacetGroups([skill()], renamed, 'en')[1].options[0].group).toBe('Sec');
  });
});

describe('chipLabelMap', () => {
  const groups = buildFacetGroups([skill({ license: null })], taxonomy, 'en');
  const map = chipLabelMap(groups, taxonomy, 'en');

  it('gives the client a label for every checkable value without shipping i18n tables', () => {
    expect(map.risk['no-code-execution']).toBe('Does not execute code');
    expect(map.subdomain['security/supply-chain']).toBe('Supply Chain & Dependencies');
    expect(map.license.unspecified).toBe('Not declared');
  });

  it('covers domain too, because the home page links into the catalog by domain', () => {
    expect(map.domain.security).toBe('Security');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/facets-groups.test.ts`
Expected: FAIL — `does not provide an export named 'buildFacetGroups'`. No test executes.

- [ ] **Step 3: Append the implementation to `src/lib/facets.ts`**
```ts
import type { Lang, Taxonomy, TaxonomyNode } from '../types.ts';
import { t } from './i18n/index.ts';

export const FACET_LABEL_KEYS: Record<RailFilterKey, string> = {
  risk: 'catalog.facet.risk',
  subdomain: 'catalog.facet.subdomain',
  runtime: 'catalog.facet.runtime',
  license: 'catalog.facet.license',
};

export const RISK_LABEL_KEYS: Record<RiskValue, string> = {
  'no-code-execution': 'catalog.risk.noCodeExecution',
  'executes-code': 'catalog.risk.executesCode',
  network: 'catalog.risk.network',
  'reads-env': 'catalog.risk.readsEnv',
  'declared-tools': 'catalog.risk.declaredTools',
  portable: 'catalog.risk.portable',
};

export const RUNTIME_LABEL_KEYS: Record<Runtime, string> = {
  claude: 'catalog.runtime.claude',
  openclaw: 'catalog.runtime.openclaw',
  codex: 'catalog.runtime.codex',
  cursor: 'catalog.runtime.cursor',
  generic: 'catalog.runtime.generic',
};

export const SORT_LABEL_KEYS: Record<SortKey, string> = {
  score: 'catalog.sort.score',
  stars: 'catalog.sort.stars',
  forks: 'catalog.sort.forks',
  newest: 'catalog.sort.newest',
  updated: 'catalog.sort.updated',
};

export function sortLabel(key: SortKey, lang: Lang): string {
  return t(SORT_LABEL_KEYS[key], lang);
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
  /** Domain heading the UI nests this option under. The index stays flat. */
  group: string | null;
}

export interface FacetGroup {
  key: RailFilterKey;
  label: string;
  hint: string;
  options: FacetOption[];
}

function nameOf(node: TaxonomyNode, lang: Lang): string {
  return node.name[lang];
}

function subdomainOptions(skills: Skill[], taxonomy: Taxonomy, lang: Lang): FacetOption[] {
  const counts = countValues(skills, 'subdomain');
  const options: FacetOption[] = [];
  for (const domain of taxonomy.domains) {
    for (const child of domain.children ?? []) {
      const count = counts.get(child.slug) ?? 0;
      if (count === 0) continue;
      options.push({ value: child.slug, label: nameOf(child, lang), count, group: nameOf(domain, lang) });
    }
  }
  return options;
}

function licenseOptions(skills: Skill[], lang: Lang): FacetOption[] {
  const counts = countValues(skills, 'license');
  const named = [...counts.entries()]
    .filter(([value]) => value !== LICENSE_UNSPECIFIED)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: value, count, group: null }));
  const undeclared = counts.get(LICENSE_UNSPECIFIED) ?? 0;
  if (undeclared > 0) {
    named.push({
      value: LICENSE_UNSPECIFIED,
      label: t('catalog.license.unspecified', lang),
      count: undeclared,
      group: null,
    });
  }
  return named;
}

export function buildFacetGroups(skills: Skill[], taxonomy: Taxonomy, lang: Lang): FacetGroup[] {
  // A count is a promise about what checking the box returns, and an evicted entry is absent from
  // the Pagefind index (§5.1) — so it contributes to nothing here, whatever the caller passed.
  const listed = listedSkills(skills);
  const riskCounts = countValues(listed, 'risk');
  const runtimeCounts = countValues(listed, 'runtime');
  const hint = t('catalog.anyOf', lang);
  return [
    {
      key: 'risk',
      label: t(FACET_LABEL_KEYS.risk, lang),
      hint,
      options: RISK_VALUES.map((value) => ({
        value,
        label: t(RISK_LABEL_KEYS[value], lang),
        count: riskCounts.get(value) ?? 0,
        group: null,
      })),
    },
    { key: 'subdomain', label: t(FACET_LABEL_KEYS.subdomain, lang), hint, options: subdomainOptions(listed, taxonomy, lang) },
    {
      key: 'runtime',
      label: t(FACET_LABEL_KEYS.runtime, lang),
      hint,
      options: RUNTIME_ORDER.map((value) => ({
        value,
        label: t(RUNTIME_LABEL_KEYS[value], lang),
        count: runtimeCounts.get(value) ?? 0,
        group: null,
      })),
    },
    { key: 'license', label: t(FACET_LABEL_KEYS.license, lang), hint, options: licenseOptions(listed, lang) },
  ];
}

/**
 * Value -> label for every key the reader can filter on, serialized into the page so the client
 * script can label a chip without importing an i18n table or the fs-backed taxonomy loader.
 */
export function chipLabelMap(
  groups: FacetGroup[],
  taxonomy: Taxonomy,
  lang: Lang,
): Record<string, Record<string, string>> {
  const map: Record<string, Record<string, string>> = { domain: {} };
  for (const domain of taxonomy.domains) map.domain[domain.slug] = nameOf(domain, lang);
  for (const group of groups) {
    map[group.key] = Object.fromEntries(group.options.map((o) => [o.value, o.label]));
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/facets-groups.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**
```bash
git add src/lib/facets.ts tests/catalog/facets-groups.test.ts
git commit -m "feat(catalog): build bilingual facet groups from taxonomy and index values"
```

---

### Task B3.8: FacetRail with 24×24 hit areas, and the catalog route

Risk leads the rail because *"hide anything that executes code"* is the query no other catalog can
answer. WCAG 2.2 SC 2.5.8 requires every facet row to be at least 24 × 24 CSS px and SC 2.4.11
requires a focused row to clear the sticky header — both are asserted here rather than eyeballed.
The route also ships the Pagefind config and the chip labels to the browser as one JSON block.

The route reads `listedSkills(loadSkills())`. The filter happens once, at the source, so nothing
downstream has to remember it: `data/skills.json` still carries every evicted row with its current
score and dates (§5.1), and B4 still builds a page for each, but the catalog is a listing and an
evicted entry is not listed.

The page content sits inside B1's `Layout`, whose `<main id="results">` is the skip-link target, so
the catalog's own column is a `<div class="catalog-main">` and never a second `<main>`.

**Files:**
- Create: `src/components/FacetRail.astro`
- Create: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/facet-rail.test.ts`

**Interfaces:**
- Consumes: `Layout.astro` from `src/components/Layout.astro` (B1) with props
  `{ lang: Lang; title: string; description?: string; path?: string }` — `description` is optional,
  so the catalog passes `lang`, `title` and `path` only; `loadSkills()` and `loadCollections()` from
  `src/lib/data.ts` (A6); `loadTaxonomy()` from `src/lib/taxonomy.ts` (A3); `withBase` from
  `src/lib/link.ts` (A1); `t` from `src/lib/i18n/index.ts` (B1); `listedSkills` from
  `src/lib/facets.ts` (B3.3).
- Produces: `src/components/FacetRail.astro` with props `{ lang: Lang; groups: FacetGroup[] }`,
  rendering `label[data-facet-key][data-facet-value]` containing `input[data-facet-check]` and
  `span[data-facet-count]`; the route `/{lang}/catalog/` emitting
  `<script type="application/json" id="catalog-config">`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/facet-rail.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../..');

export function builtCatalog(lang: string): string {
  const candidates = [
    resolve(root, `dist/${lang}/catalog/index.html`),
    resolve(root, `dist/${lang}/catalog.html`),
  ];
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error(`built catalog page for "${lang}" not found under dist/${lang}/`);
  return hit ? readFileSync(hit, 'utf8') : '';
}

export function allBuiltCss(): string {
  const dir = resolve(root, 'dist/_astro');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(resolve(dir, f), 'utf8'))
    : [];
  return [builtCatalog('en'), ...files].join('\n').replace(/\s+/g, '');
}

export function ruleFor(css: string, selector: string): string {
  const index = css.indexOf(`${selector}{`);
  expect(index, `rule ${selector} not found in built CSS`).toBeGreaterThan(-1);
  const open = css.indexOf('{', index);
  return css.slice(open, css.indexOf('}', open));
}

describe('FacetRail', () => {
  const html = builtCatalog('en');

  it('renders the four rail groups in decision-frequency order, risk first', () => {
    const order = [...html.matchAll(/data-facet-group="([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(['risk', 'subdomain', 'runtime', 'license']);
  });

  it('renders multi-select checkboxes named for their filter key', () => {
    expect(html).toMatch(/<input[^>]*data-facet-check[^>]*type="checkbox"[^>]*name="risk"[^>]*value="no-code-execution"/);
  });

  it('carries a count element on every facet row', () => {
    const rows = (html.match(/data-facet-value="/g) ?? []).length;
    const counts = (html.match(/data-facet-count/g) ?? []).length;
    expect(rows).toBeGreaterThan(0);
    expect(counts).toBe(rows);
  });

  it('counts only listed entries, so an evicted row cannot inflate the rail', () => {
    const rows = JSON.parse(readFileSync(resolve(root, 'data/skills.json'), 'utf8')) as { listed: boolean }[];
    const listed = rows.filter((row) => row.listed).length;
    const countOf = (value: string): number =>
      Number(html.match(new RegExp(`data-facet-value="${value}"[\\s\\S]*?data-facet-count>(\\d+)<`))?.[1] ?? -1);
    // Every skill emits exactly one of these two mutually exclusive risk values (§4.3), so their
    // sum is the size of the listing and nothing else.
    expect(countOf('no-code-execution') + countOf('executes-code')).toBe(listed);
  });

  it('tags each row with the key and value the controller needs', () => {
    expect(html).toMatch(/data-facet-key="risk"[^>]*data-facet-value="executes-code"/);
  });

  it('gives the rail an accessible name', () => {
    expect(html).toMatch(/<aside[^>]*data-facet-rail[^>]*aria-label="Filters"/);
  });

  it('translates the rail into pt-BR', () => {
    expect(builtCatalog('pt')).toContain('Risco e capacidade');
  });
});

describe('WCAG 2.5.8 target size and 2.4.11 focus clearance', () => {
  const css = allBuiltCss();

  it('gives .facet-row at least a 24x24 CSS px hit area', () => {
    expect(ruleFor(css, '.facet-row')).toContain('min-height:24px');
    expect(ruleFor(css, '.facet-row')).toContain('min-width:24px');
  });

  it('gives the checkbox itself a 24x24 box', () => {
    expect(ruleFor(css, '.facet-check')).toContain('min-height:24px');
    expect(ruleFor(css, '.facet-check')).toContain('min-width:24px');
  });

  it('keeps a focused row clear of the sticky header', () => {
    expect(ruleFor(css, '.facet-row')).toContain('scroll-margin-top:var(--header-h,3.5rem)');
  });
});

describe('the two Pagefind path values reach the browser', () => {
  it('ships baseUrl, bundlePath and the route path on every locale', () => {
    for (const lang of ['en', 'pt']) {
      const match = builtCatalog(lang).match(
        /<script type="application\/json" id="catalog-config">([\s\S]*?)<\/script>/,
      );
      expect(match, `catalog-config missing on /${lang}/catalog/`).toBeTruthy();
      const config = JSON.parse(match![1]);
      expect(config.baseUrl).toBe('/ai-tools-hub/');
      expect(config.bundlePath).toBe('/ai-tools-hub/pagefind/pagefind.js');
      expect(config.catalogPath).toBe(`/ai-tools-hub/${lang}/catalog/`);
    }
  });

  it('ships a chip label for every checkable value, so the client needs no i18n table', () => {
    const config = JSON.parse(
      builtCatalog('en').match(/<script type="application\/json" id="catalog-config">([\s\S]*?)<\/script>/)![1],
    );
    expect(config.labels.risk['no-code-execution']).toBe('Does not execute code');
    expect(Object.keys(config.labels).sort()).toEqual(['domain', 'license', 'risk', 'runtime', 'subdomain']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/facet-rail.test.ts`
Expected: FAIL — `src/pages/[lang]/catalog.astro` does not exist, so nothing is emitted under
`dist/en/catalog/` and `builtCatalog('en')` throws
`Error: built catalog page for "en" not found under dist/en/`. All 12 tests fail with that error.

- [ ] **Step 3: Create `src/components/FacetRail.astro`**
```astro
---
// src/components/FacetRail.astro
import type { Lang } from '../types.ts';
import type { FacetGroup } from '../lib/facets.ts';
import { t } from '../lib/i18n/index.ts';

interface Props {
  lang: Lang;
  groups: FacetGroup[];
}

const { lang, groups } = Astro.props;
---
<aside class="facet-rail" data-facet-rail aria-label={t('catalog.railTitle', lang)}>
  {groups.map((group) => (
    <section class="facet-group" data-facet-group={group.key}>
      <h2 class="facet-group-title">{group.label}</h2>
      <p class="facet-group-hint">{group.hint}</p>
      <ul class="facet-list">
        {group.options.map((option, i) => (
          <>
            {option.group && option.group !== group.options[i - 1]?.group && (
              <li class="facet-subhead" aria-hidden="true">{option.group}</li>
            )}
            <li>
              <label class="facet-row" data-facet-key={group.key} data-facet-value={option.value}>
                <input class="facet-check" data-facet-check type="checkbox" name={group.key} value={option.value} />
                <span class="facet-text">{option.label}</span>
                <span class="facet-count" data-facet-count>{option.count}</span>
              </label>
            </li>
          </>
        ))}
      </ul>
    </section>
  ))}
</aside>
<style is:global>
  .facet-rail {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1rem;
    border-right: 1px solid var(--border, #333);
  }
  .facet-group-title { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 0.25rem; }
  .facet-group-hint { font-size: 0.75rem; color: var(--muted-foreground, #888); margin: 0 0 0.5rem; }
  .facet-list { list-style: none; margin: 0; padding: 0; }
  .facet-subhead {
    font-size: 0.6875rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted-foreground, #888);
    margin: 0.75rem 0 0.25rem;
  }
  .facet-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 24px;
    min-width: 24px;
    padding: 0.375rem 0.5rem;
    cursor: pointer;
    scroll-margin-top: var(--header-h, 3.5rem);
  }
  .facet-row:hover { background: var(--muted, rgba(127, 127, 127, 0.12)); }
  .facet-row:focus-within { outline: 2px solid var(--ring, currentColor); outline-offset: -2px; }
  .facet-check {
    min-height: 24px;
    min-width: 24px;
    height: 24px;
    width: 24px;
    margin: 0;
    flex: none;
    accent-color: var(--ring, currentColor);
  }
  .facet-text { flex: 1 1 auto; font-size: 0.875rem; }
  .facet-count {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--muted-foreground, #888);
    font-variant-numeric: tabular-nums;
  }
</style>
```

- [ ] **Step 4: Create `src/pages/[lang]/catalog.astro`**
```astro
---
// src/pages/[lang]/catalog.astro
import type { Lang } from '../../types.ts';
import Layout from '../../components/Layout.astro';
import FacetRail from '../../components/FacetRail.astro';
import { PAGEFIND_BASE_URL, PAGEFIND_BUNDLE_PATH, PAGE_SIZE, buildFacetGroups, chipLabelMap, listedSkills } from '../../lib/facets.ts';
import { loadSkills } from '../../lib/data.ts';
import { loadTaxonomy } from '../../lib/taxonomy.ts';
import { withBase } from '../../lib/link.ts';
import { t } from '../../lib/i18n/index.ts';

export function getStaticPaths() {
  return [{ params: { lang: 'en' } }, { params: { lang: 'pt' } }];
}

const lang = Astro.params.lang as Lang;
// §5.1: an entry evicted by the per-subdomain cap keeps its row in data/skills.json and keeps its
// page, but it is not listed — so it leaves the grid, the facet counts and the search index. Filter
// once, here, and nothing downstream has to remember.
const skills = listedSkills(loadSkills());
const taxonomy = loadTaxonomy();
const groups = buildFacetGroups(skills, taxonomy, lang);
const catalogPath = withBase(`/${lang}/catalog/`);
const config = {
  baseUrl: PAGEFIND_BASE_URL,
  bundlePath: PAGEFIND_BUNDLE_PATH,
  catalogPath,
  lang,
  pageSize: PAGE_SIZE,
  labels: chipLabelMap(groups, taxonomy, lang),
};
---
<Layout lang={lang} title={t('catalog.title', lang)} path="/catalog/">
  <div data-pagefind-ignore>
    <script type="application/json" id="catalog-config" set:html={JSON.stringify(config)}></script>
    <h1>{t('catalog.title', lang)}</h1>
    <p>{t('catalog.intro', lang)}</p>
    <div class="catalog-body">
      <FacetRail lang={lang} groups={groups} />
      <div class="catalog-main"></div>
    </div>
  </div>
</Layout>
<style is:global>
  .catalog-body { display: grid; grid-template-columns: 17rem minmax(0, 1fr); align-items: start; }
  .catalog-main { padding: 1rem; min-width: 0; }
  @media (max-width: 899px) { .catalog-body { grid-template-columns: minmax(0, 1fr); } }
</style>
```

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/catalog/facet-rail.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**
```bash
git add src/components/FacetRail.astro "src/pages/[lang]/catalog.astro" tests/catalog/facet-rail.test.ts
git commit -m "feat(catalog): add facet rail with risk first and 24px hit areas"
```

---

### Task B3.9: Catalog grid, sort tabs and the results region

Sort is tabs, not a dropdown — five real links, five distinct URLs (§10.2). Every card is
server-rendered so the page is crawlable and works with JavaScript off; the controller added later
only shows, hides, reorders and renumbers what is already in the HTML. Rank lives on the card
(§10.3), so the wrapper carries `data-rank` for ordering and the controller rewrites the card's own
rank element.

One wrapper is rendered per **listed** skill. An evicted entry has no wrapper at all, which is what
makes the client side simple: the DOM and the Pagefind index hold exactly the same set, so a result
always resolves onto a card and a card is never left orphaned.

`id="results"` belongs to B1's `<main>` — it is the skip-link target and appears exactly once in the
document. The catalog's own heading is `id="results-heading"`, which is what the controller focuses
after a clear-all and what B5's focus assertions look for.

**Files:**
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-page.test.ts`

**Interfaces:**
- Consumes: `SkillCard.astro` from `src/components/SkillCard.astro` (B4.3) with props
  `{ skill: Skill; rank: number; lang: Lang; collection: Collection | null }`, rendering its rank
  inside an element that carries both `data-field="rank"` and `data-rank` — B3 uses the `data-rank`
  hook and never touches `data-field`; `loadCollections()` from `src/lib/data.ts` (A6);
  `listedSkills` from `src/lib/facets.ts` (B3.3).
- Produces: `li[data-catalog-item][data-skill-id][data-rank]` wrappers, the
  `a[data-sort-tab]` tab strip, the `#results-heading` heading and `p[data-count]`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-page.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { allBuiltCss, builtCatalog } from './facet-rail.test.ts';

const root = resolve(__dirname, '../..');

describe('catalog sort tabs', () => {
  const html = builtCatalog('en');

  it('renders five sort tabs as links, not a select', () => {
    const tabs = [...html.matchAll(/data-sort-tab="([a-z]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(html).not.toMatch(/<select[^>]*data-sort/);
  });

  it('gives each sort a distinct URL, with score as the bare default', () => {
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/"[^>]*data-sort-tab="score"/);
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/\?sort=stars"[^>]*data-sort-tab="stars"/);
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/\?sort=updated"[^>]*data-sort-tab="updated"/);
  });

  it('marks the default tab as current', () => {
    expect(html).toMatch(/data-sort-tab="score"[^>]*aria-current="page"/);
  });
});

describe('catalog results region', () => {
  const html = builtCatalog('en');

  it('gives the results heading its own focusable id, distinct from the layout skip target', () => {
    expect(html).toMatch(/<h2[^>]*id="results-heading"[^>]*tabindex="-1"/);
    expect(
      (html.match(/id="results"/g) ?? []).length,
      'id="results" belongs to the Layout <main> and must appear exactly once',
    ).toBe(1);
  });

  it('announces the result count politely, not per keystroke', () => {
    expect(html).toMatch(/data-count[^>]*aria-live="polite"/);
    expect(html).toMatch(/data-count[^>]*aria-atomic="true"/);
  });

  it('keeps the catalog page itself out of the search index', () => {
    expect(html).toContain('data-pagefind-ignore');
    expect(html).not.toContain('data-pagefind-body');
  });
});

describe('catalog card grid', () => {
  const html = builtCatalog('en');
  const css = allBuiltCss();
  const items = [...html.matchAll(/<li[^>]*data-catalog-item[^>]*>/g)].map((m) => m[0]);

  it('renders one wrapper per skill, keyed by the id Pagefind also indexes', () => {
    expect(items.length).toBeGreaterThan(0);
    const ids = items.map((tag) => tag.match(/data-skill-id="([^"]+)"/)?.[1]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists only the entries that survived the per-subdomain cap', () => {
    const rows = JSON.parse(readFileSync(resolve(root, 'data/skills.json'), 'utf8')) as {
      id: string;
      listed: boolean;
    }[];
    const evicted = new Set(rows.filter((row) => !row.listed).map((row) => row.id));
    for (const tag of items) {
      const id = tag.match(/data-skill-id="([^"]+)"/)?.[1] ?? '';
      expect(evicted.has(id), `evicted skill "${id}" is still on the catalog`).toBe(false);
    }
    expect(items.length).toBe(rows.length - evicted.size);
  });

  it('orders every wrapper explicitly and hides only what falls past the first page', () => {
    items.forEach((tag, i) => {
      expect(tag).toContain(`style="order:${i}"`);
      expect(tag.includes(' hidden')).toBe(i >= 24);
    });
  });

  it('exposes a renumberable rank on the wrapper and inside the card', () => {
    for (const [i, tag] of items.entries()) expect(tag).toContain(`data-rank="${i + 1}"`);
    expect(
      (html.match(/data-rank/g) ?? []).length,
      "B4's SkillCard must render its rank inside an element carrying data-rank",
    ).toBeGreaterThanOrEqual(items.length * 2);
  });

  it('degrades 6 columns to 5 below 1500px and 4 below 1280px', () => {
    expect(css).toMatch(/\.catalog-grid\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    expect(css).toMatch(/@media\(max-width:1499px\)\{\.catalog-grid\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}\}/);
    expect(css).toMatch(/@media\(max-width:1279px\)\{\.catalog-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\}\}/);
  });

  it('shows every card when JavaScript is off, since pagination would be a lie', () => {
    expect(html).toMatch(/<noscript><style>\[data-catalog-item\]\[hidden\]\{display:flex!important\}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-page.test.ts`
Expected: FAIL — the catalog page has no sort tabs and no cards yet, so the first test fails with
`AssertionError: expected [] to deeply equal [ 'score', 'stars', 'forks', 'newest', 'updated' ]`,
and `renders one wrapper per skill` fails with `expected 0 to be greater than 0`.

- [ ] **Step 3: Replace `src/pages/[lang]/catalog.astro` with the full grid version**
```astro
---
// src/pages/[lang]/catalog.astro
import type { Lang } from '../../types.ts';
import Layout from '../../components/Layout.astro';
import FacetRail from '../../components/FacetRail.astro';
import SkillCard from '../../components/SkillCard.astro';
import {
  DEFAULT_SORT,
  PAGEFIND_BASE_URL,
  PAGEFIND_BUNDLE_PATH,
  PAGE_SIZE,
  SORT_KEYS,
  buildFacetGroups,
  chipLabelMap,
  collectionFor,
  listedSkills,
  serializeQuery,
  sortCards,
  sortLabel,
  toSortableCard,
} from '../../lib/facets.ts';
import { loadCollections, loadSkills } from '../../lib/data.ts';
import { loadTaxonomy } from '../../lib/taxonomy.ts';
import { withBase } from '../../lib/link.ts';
import { t } from '../../lib/i18n/index.ts';

export function getStaticPaths() {
  return [{ params: { lang: 'en' } }, { params: { lang: 'pt' } }];
}

const lang = Astro.params.lang as Lang;
// §5.1: an entry evicted by the per-subdomain cap keeps its row in data/skills.json and keeps its
// page, but it is not listed — so it leaves the grid, the facet counts and the search index. Filter
// once, here, and nothing downstream has to remember.
const skills = listedSkills(loadSkills());
const collections = loadCollections();
const taxonomy = loadTaxonomy();
const groups = buildFacetGroups(skills, taxonomy, lang);
const byId = new Map(skills.map((s) => [s.id, s]));
const ordered = sortCards(
  skills.map((s) => toSortableCard(s, collectionFor(s.repo, collections))),
  DEFAULT_SORT,
);
const catalogPath = withBase(`/${lang}/catalog/`);
const blank = { filters: {}, q: '', sort: DEFAULT_SORT, page: 1 };
const config = {
  baseUrl: PAGEFIND_BASE_URL,
  bundlePath: PAGEFIND_BUNDLE_PATH,
  catalogPath,
  lang,
  pageSize: PAGE_SIZE,
  labels: chipLabelMap(groups, taxonomy, lang),
};
---
<Layout lang={lang} title={t('catalog.title', lang)} path="/catalog/">
  <div data-pagefind-ignore>
    <script type="application/json" id="catalog-config" set:html={JSON.stringify(config)}></script>
    <h1>{t('catalog.title', lang)}</h1>
    <p>{t('catalog.intro', lang)}</p>
    <nav class="catalog-sorts" aria-label={t('catalog.sortBy', lang)}>
      {SORT_KEYS.map((key) => (
        <a
          class="catalog-sort"
          href={`${catalogPath}${serializeQuery({ ...blank, sort: key })}`}
          data-sort-tab={key}
          aria-current={key === DEFAULT_SORT ? 'page' : undefined}
        >{sortLabel(key, lang)}</a>
      ))}
    </nav>
    <div class="catalog-body">
      <FacetRail lang={lang} groups={groups} />
      <div class="catalog-main">
        <h2 class="catalog-results-heading" id="results-heading" tabindex="-1">{t('catalog.resultsHeading', lang)}</h2>
        <p class="catalog-count" data-count aria-live="polite" aria-atomic="true">
          {ordered.length} {t('catalog.results', lang)}
        </p>
        <ul class="catalog-grid" data-grid>
          {ordered.map((card, i) => (
            <li
              class="catalog-item"
              data-catalog-item
              data-skill-id={card.id}
              data-rank={i + 1}
              style={`order:${i}`}
              hidden={i >= PAGE_SIZE}
            >
              <SkillCard
                skill={byId.get(card.id)!}
                rank={i + 1}
                lang={lang}
                collection={collectionFor(byId.get(card.id)!.repo, collections)}
              />
            </li>
          ))}
        </ul>
      </div>
    </div>
  </div>
</Layout>
<noscript><style>[data-catalog-item][hidden]{display:flex!important}[data-pagination]{display:none}</style></noscript>
<style is:global>
  .catalog-sorts { display: flex; gap: 1px; margin: 1rem 0; }
  .catalog-sort {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    min-width: 24px;
    padding: 0 0.875rem;
    border: 1px solid var(--border, #333);
    text-decoration: none;
    font-size: 0.875rem;
    scroll-margin-top: var(--header-h, 3.5rem);
  }
  .catalog-sort[aria-current="page"] { background: var(--muted, rgba(127, 127, 127, 0.16)); font-weight: 600; }
  .catalog-body { display: grid; grid-template-columns: 17rem minmax(0, 1fr); align-items: start; }
  .catalog-main { padding: 1rem; min-width: 0; }
  .catalog-results-heading {
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin: 0;
    scroll-margin-top: var(--header-h, 3.5rem);
  }
  .catalog-count {
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--muted-foreground, #888);
    margin: 0.25rem 0 1rem;
  }
  .catalog-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    gap: 1px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .catalog-item { display: flex; flex-direction: column; position: relative; min-width: 0; }
  .catalog-item[hidden] { display: none !important; }
  @media (max-width: 1499px) { .catalog-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }
  @media (max-width: 1279px) { .catalog-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
  @media (max-width: 899px) {
    .catalog-body { grid-template-columns: minmax(0, 1fr); }
    .catalog-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 599px) { .catalog-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-page.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**
```bash
git add "src/pages/[lang]/catalog.astro" tests/catalog/catalog-page.test.ts
git commit -m "feat(catalog): render sort tabs, results region and the 6/5/4 card grid"
```

---

### Task B3.10: SearchBox — the site's one text input, mounted on the catalog

Spec §10.2 puts search on the catalog, not on a separate surface: facets narrow by what a skill *is*,
text narrows by what it is *called*, and needing two pages to combine them is the failure. There is
exactly **one** `[data-search-input]` in the whole site and B3 owns it: a second control would steal
the controller's document-scoped listeners and write an empty term into `?q=`.

The component therefore ships the combobox contract up front — `role="combobox"`,
`aria-expanded="false"`, `aria-controls="catalog-suggestions"`, `aria-autocomplete="list"` and the
empty `<ul id="catalog-suggestions" role="listbox">`. B5 attaches the keyboard behaviour, the rescue
index and the aria-live announcements to this markup; it creates no input and no listbox of its own.
The form is a real `<form method="get">` whose term round-trips as `?q=`, so it degrades to a page
load; B3.13 hands the term to Pagefind instead.

**Files:**
- Create: `src/components/SearchBox.astro`
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-search.test.ts`

**Interfaces:**
- Consumes: `t` from `src/lib/i18n/index.ts`; the `catalog.search.*` keys created in B3.1; `Lang`
  from `src/types.ts`.
- Produces: `src/components/SearchBox.astro` with props `{ lang: Lang; action: string }`, rendering
  `form[data-catalog-search]` containing the single `input[data-search-input][type=search]#catalog-q`
  with the combobox attribute set, `button[data-search-clear]`, and
  `ul#catalog-suggestions[role=listbox]` for B5 to populate.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-search.test.ts
import { describe, expect, it } from 'vitest';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('the catalog carries its own text filter', () => {
  const html = builtCatalog('en');

  it('renders a real search form on the catalog page itself', () => {
    expect(html).toMatch(/<form[^>]*data-catalog-search[^>]*method="get"/);
    expect(html).toMatch(/<input[^>]*data-search-input[^>]*type="search"[^>]*name="q"/);
  });

  it('renders exactly one search input, so nothing can steal the controller hook', () => {
    expect((html.match(/<input[^>]*data-search-input/g) ?? []).length).toBe(1);
    expect((builtCatalog('pt').match(/<input[^>]*data-search-input/g) ?? []).length).toBe(1);
  });

  it('ships the full combobox attribute set on that one input', () => {
    const input = html.match(/<input[^>]*data-search-input[^>]*>/)?.[0] ?? '';
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-controls="catalog-suggestions"');
    expect(input).toContain('aria-autocomplete="list"');
  });

  it('ships the empty listbox the combobox points at', () => {
    expect(html).toMatch(/<ul[^>]*id="catalog-suggestions"[^>]*role="listbox"[^>]*><\/ul>/);
  });

  it('labels the input visibly and ties the label to it', () => {
    expect(html).toMatch(/<label[^>]*for="catalog-q"[^>]*>Filter these results by text<\/label>/);
    expect(html).toMatch(/<input[^>]*id="catalog-q"/);
  });

  it('offers a clear control with an accessible name', () => {
    expect(html).toMatch(/<button[^>]*data-search-clear[^>]*aria-label="Clear the text filter"/);
  });

  it('translates the search chrome into pt-BR', () => {
    const pt = builtCatalog('pt');
    expect(pt).toContain('Filtrar estes resultados por texto');
    expect(pt).toMatch(/<input[^>]*placeholder="nome, caminho, tag ou repositório"/);
  });

  it('hides the control when JavaScript is off, because nothing could apply it', () => {
    expect(html).toMatch(/<noscript><style>[^<]*\[data-catalog-search\]\{display:none\}/);
  });

  it('gives the input and its clear button 24px hit areas', () => {
    const css = allBuiltCss();
    expect(ruleFor(css, '.catalog-search__input')).toContain('min-height:40px');
    expect(ruleFor(css, '.catalog-search__clear')).toContain('min-height:24px');
    expect(ruleFor(css, '.catalog-search__clear')).toContain('min-width:24px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-search.test.ts`
Expected: FAIL — the built catalog page carries no `data-catalog-search` element, so the first test
fails with
`AssertionError: expected the built catalog HTML to match /<form[^>]*data-catalog-search[^>]*method="get"/`.
The other eight fail the same way, and `gives the input and its clear button 24px hit areas` fails
first inside `ruleFor` with `rule .catalog-search__input not found in built CSS: expected -1 to be greater than -1`.

- [ ] **Step 3: Create `src/components/SearchBox.astro`**
```astro
---
// src/components/SearchBox.astro
// The site's only text input. It ships the combobox contract already wired: B5 attaches keyboard
// behaviour, the rescue index and the announcements to this markup and creates no second input,
// because the catalog controller's listeners are document-scoped and a duplicate would steal them.
import type { Lang } from '../types.ts';
import { t } from '../lib/i18n/index.ts';

interface Props {
  lang: Lang;
  /** Where the form posts with JavaScript off — the catalog route for this locale. */
  action: string;
}

const { lang, action } = Astro.props;
---
<form class="catalog-search" data-catalog-search method="get" action={action} role="search">
  <label class="catalog-search__label" for="catalog-q">{t('catalog.search.label', lang)}</label>
  <div class="catalog-search__row">
    <input
      class="catalog-search__input"
      data-search-input
      id="catalog-q"
      type="search"
      name="q"
      value=""
      autocomplete="off"
      placeholder={t('catalog.search.placeholder', lang)}
      role="combobox"
      aria-expanded="false"
      aria-controls="catalog-suggestions"
      aria-autocomplete="list"
    />
    <button class="catalog-search__clear" data-search-clear type="button" aria-label={t('catalog.search.clear', lang)}>&#215;</button>
    <button class="catalog-search__submit" type="submit">{t('catalog.search.submit', lang)}</button>
  </div>
  <ul class="catalog-search__suggestions" id="catalog-suggestions" role="listbox" aria-label={t('catalog.search.suggestions', lang)}></ul>
</form>
<style is:global>
  .catalog-search { display: flex; flex-direction: column; gap: 0.25rem; margin: 1rem 0 0; }
  .catalog-search__label { font-size: 0.75rem; letter-spacing: 0.08em; text-transform: uppercase; }
  .catalog-search__row { display: flex; gap: 1px; max-width: 34rem; }
  .catalog-search__input {
    flex: 1 1 auto;
    min-height: 40px;
    min-width: 24px;
    padding: 0 0.75rem;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: inherit;
    font: inherit;
  }
  .catalog-search__clear {
    min-height: 24px;
    min-width: 24px;
    padding: 0 0.75rem;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .catalog-search__submit {
    min-height: 40px;
    min-width: 24px;
    padding: 0 1rem;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .catalog-search__suggestions {
    list-style: none;
    margin: 0.25rem 0 0;
    padding: 0;
    max-width: 34rem;
    border: 1px solid var(--border, #333);
  }
  /* No suggestions yet is not an empty box: B5 fills this list, and until then it has no chrome. */
  .catalog-search__suggestions:empty { display: none; border: 0; }
</style>
```

- [ ] **Step 4: Mount it on `src/pages/[lang]/catalog.astro`**
Replace the single line:
```astro
import FacetRail from '../../components/FacetRail.astro';
```
with:
```astro
import FacetRail from '../../components/FacetRail.astro';
import SearchBox from '../../components/SearchBox.astro';
```

Then replace the single line:
```astro
    <nav class="catalog-sorts" aria-label={t('catalog.sortBy', lang)}>
```
with:
```astro
    <SearchBox lang={lang} action={catalogPath} />
    <nav class="catalog-sorts" aria-label={t('catalog.sortBy', lang)}>
```

Then replace the single line:
```astro
<noscript><style>[data-catalog-item][hidden]{display:flex!important}[data-pagination]{display:none}</style></noscript>
```
with:
```astro
<noscript><style>[data-catalog-search]{display:none}[data-catalog-item][hidden]{display:flex!important}[data-pagination]{display:none}</style></noscript>
```
The search CSS lives in the component, not here, so the page's `<style is:global>` block is untouched.

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-search.test.ts`
Expected: PASS, 9 tests.

If `renders exactly one search input` fails with `expected 2 to be 1`, a second control was mounted
somewhere — most likely a header search in a layout. Delete it: this component is the only input, and
B5 attaches to it rather than adding another.

- [ ] **Step 6: Commit**
```bash
git add src/components/SearchBox.astro "src/pages/[lang]/catalog.astro" tests/catalog/catalog-search.test.ts
git commit -m "feat(catalog): one search input, combobox-ready, on the catalog itself"
```

---

### Task B3.11: Numbered pagination and the designed empty state

Numbered pagination, never infinite scroll — each page is a real link with its own URL (§10.2). The
empty state is designed rather than blank: an empty result set is information about the data, and the
way out is one control away.

**Files:**
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-pagination.test.ts`

**Interfaces:**
- Consumes: `pageNumbers`, `pageView`, `serializeQuery`, `DEFAULT_SORT`, `PAGE_SIZE` from `src/lib/facets.ts`.
- Produces: `nav[data-pagination]` containing `ul[data-page-list]` of `a.page-link[data-page]`;
  `div[data-empty]` containing `button[data-clear-all]`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-pagination.test.ts
import { describe, expect, it } from 'vitest';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('numbered pagination', () => {
  const html = builtCatalog('en');

  it('renders a labelled pagination landmark', () => {
    expect(html).toMatch(/<nav[^>]*data-pagination[^>]*aria-label="Pagination"/);
  });

  it('renders page 1 as a real link to a distinct URL and marks it current', () => {
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/"[^>]*data-page="1"[^>]*aria-current="page"/);
  });

  it('never uses an infinite-scroll sentinel', () => {
    expect(html).not.toContain('data-infinite-scroll');
    expect(html).not.toContain('IntersectionObserver');
  });

  it('gives page links a 24px hit area', () => {
    expect(ruleFor(allBuiltCss(), '.page-link')).toContain('min-height:24px');
    expect(ruleFor(allBuiltCss(), '.page-link')).toContain('min-width:24px');
  });
});

describe('designed empty state', () => {
  const html = builtCatalog('en');

  it('ships an empty state that starts hidden', () => {
    expect(html).toMatch(/<div[^>]*data-empty[^>]*hidden>/);
  });

  it('says what an empty result actually means', () => {
    expect(html).toContain('No skills match these filters');
    expect(html).toContain('Every filter is a claim about the indexed data');
  });

  it('offers the way out inside the empty state', () => {
    const empty = html.slice(html.indexOf('data-empty'));
    expect(empty.slice(0, 800)).toMatch(/<button[^>]*data-clear-all[^>]*>Clear all filters<\/button>/);
  });

  it('translates the empty state into pt-BR', () => {
    expect(builtCatalog('pt')).toContain('Nenhuma skill corresponde a estes filtros');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-pagination.test.ts`
Expected: FAIL — the catalog page has neither a `data-pagination` landmark nor a `data-empty` block,
so `renders a labelled pagination landmark` fails with
`AssertionError: expected the built catalog HTML to match /<nav[^>]*data-pagination[^>]*aria-label="Pagination"/`.

- [ ] **Step 3: Add pagination and the empty state to `src/pages/[lang]/catalog.astro`**
Replace the single frontmatter line:
```ts
import {
```
with:
```ts
import {
  pageNumbers,
  pageView,
```
so `pageNumbers` and `pageView` join the existing named import from `'../../lib/facets.ts'`.

Then replace the single frontmatter line:
```ts
const catalogPath = withBase(`/${lang}/catalog/`);
```
with:
```ts
const catalogPath = withBase(`/${lang}/catalog/`);
const initialView = pageView(ordered.length, 1, PAGE_SIZE);
```

Then replace the single two-line block that closes the grid and the catalog column:
```astro
        </ul>
      </div>
```
with:
```astro
        </ul>
        <div class="catalog-empty" data-empty hidden>
          <h3 class="catalog-empty-title">{t('catalog.empty.title', lang)}</h3>
          <p class="catalog-empty-body">{t('catalog.empty.body', lang)}</p>
          <button type="button" class="catalog-clear" data-clear-all>{t('catalog.empty.action', lang)}</button>
        </div>
        <nav class="catalog-pagination" data-pagination aria-label={t('catalog.pagination', lang)}>
          <ul class="page-list" data-page-list>
            {pageNumbers(initialView.page, initialView.totalPages).map((entry) => (
              <li>
                {entry === 'gap' ? (
                  <span class="page-gap" aria-hidden="true">&#8230;</span>
                ) : (
                  <a
                    class="page-link"
                    href={`${catalogPath}${serializeQuery({ ...blank, page: entry })}`}
                    data-page={entry}
                    aria-current={entry === initialView.page ? 'page' : undefined}
                  >{entry}</a>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </div>
```

Finally append these rules to the page's `<style is:global>` block, immediately above the closing
`</style>` tag:
```css
  .catalog-empty { border: 1px solid var(--border, #333); padding: 2rem; max-width: 44rem; }
  .catalog-empty-title { margin: 0 0 0.5rem; font-size: 1rem; }
  .catalog-empty-body { margin: 0 0 1rem; color: var(--muted-foreground, #888); }
  .catalog-clear {
    min-height: 40px;
    min-width: 24px;
    padding: 0 1rem;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .catalog-pagination { margin: 1.5rem 0; }
  .page-list { display: flex; gap: 1px; list-style: none; margin: 0; padding: 0; }
  .page-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    min-width: 24px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border, #333);
    text-decoration: none;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
    scroll-margin-top: var(--header-h, 3.5rem);
  }
  .page-link[aria-current="page"] { background: var(--muted, rgba(127, 127, 127, 0.16)); font-weight: 600; }
  .page-gap {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    min-width: 24px;
    padding: 0.5rem 0.25rem;
    color: var(--muted-foreground, #888);
  }
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-pagination.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**
```bash
git add "src/pages/[lang]/catalog.astro" tests/catalog/catalog-pagination.test.ts
git commit -m "feat(catalog): add numbered pagination and a designed empty state"
```

---

### Task B3.12: Active-filter chips with individual remove and clear-all

A chip is only useful if it can be removed on its own; a rail with six things checked and no chip
strip forces the reader to hunt. Chips are cloned from a `<template>`, so the markup lives in one
place and the same 24 × 24 rule applies to the remove button.

**Files:**
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-chips.test.ts`

**Interfaces:**
- Consumes: `t` from `src/lib/i18n/index.ts`.
- Produces: `div[data-chips]` containing `ul[data-chip-list]`; `template#chip-template` holding one
  `li.filter-chip` with `span[data-chip-label]` and `button[data-chip-remove]`; a second
  `button[data-clear-all]`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-chips.test.ts
import { describe, expect, it } from 'vitest';
import { allBuiltCss, builtCatalog, ruleFor } from './facet-rail.test.ts';

describe('active filter chips', () => {
  const html = builtCatalog('en');

  it('ships a labelled chip region that starts hidden', () => {
    expect(html).toMatch(/<div[^>]*data-chips[^>]*hidden[^>]*aria-label="Active filters"/);
  });

  it('ships a chip template with a label slot and an individual remove button', () => {
    expect(html).toContain('<template id="chip-template">');
    const template = html.slice(html.indexOf('<template id="chip-template">'));
    expect(template.slice(0, 600)).toContain('data-chip-label');
    expect(template.slice(0, 600)).toMatch(/<button[^>]*data-chip-remove/);
  });

  it('offers a clear-all control beside the chips', () => {
    const region = html.slice(html.indexOf('data-chips'));
    expect(region.slice(0, 900)).toMatch(/<button[^>]*data-clear-all[^>]*>Clear all filters<\/button>/);
  });

  it('gives the remove button an accessible name in both locales', () => {
    expect(html).toMatch(/data-chip-remove[^>]*aria-label="Remove filter"/);
    expect(builtCatalog('pt')).toMatch(/data-chip-remove[^>]*aria-label="Remover filtro"/);
  });

  it('gives chips and their remove buttons 24x24 hit areas', () => {
    const css = allBuiltCss();
    expect(ruleFor(css, '.filter-chip')).toContain('min-height:24px');
    expect(ruleFor(css, '.filter-chip')).toContain('min-width:24px');
    expect(ruleFor(css, '.chip-remove')).toContain('min-height:24px');
    expect(ruleFor(css, '.chip-remove')).toContain('min-width:24px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-chips.test.ts`
Expected: FAIL — there is no `data-chips` element in the built HTML, so the first test fails with
`AssertionError: expected the built catalog HTML to match /<div[^>]*data-chips[^>]*hidden[^>]*aria-label="Active filters"/`.

- [ ] **Step 3: Add the chip region to `src/pages/[lang]/catalog.astro`**
Replace the single line:
```astro
        <h2 class="catalog-results-heading" id="results-heading" tabindex="-1">{t('catalog.resultsHeading', lang)}</h2>
```
with:
```astro
        <div class="catalog-chips" data-chips hidden aria-label={t('catalog.activeFilters', lang)}>
          <ul class="chip-list" data-chip-list></ul>
          <button type="button" class="catalog-clear" data-clear-all>{t('catalog.clearAll', lang)}</button>
        </div>
        <template id="chip-template">
          <li class="filter-chip">
            <span class="chip-label" data-chip-label></span>
            <button type="button" class="chip-remove" data-chip-remove aria-label={t('catalog.removeFilter', lang)}>&#215;</button>
          </li>
        </template>
        <h2 class="catalog-results-heading" id="results-heading" tabindex="-1">{t('catalog.resultsHeading', lang)}</h2>
```
Then append these rules to the page's `<style is:global>` block, immediately above the closing
`</style>` tag:
```css
  .catalog-chips { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin: 0 0 1rem; }
  .chip-list { display: flex; flex-wrap: wrap; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
  .filter-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    min-height: 24px;
    min-width: 24px;
    padding: 0.25rem 0.25rem 0.25rem 0.625rem;
    border: 1px solid var(--border, #333);
    font-size: 0.8125rem;
    scroll-margin-top: var(--header-h, 3.5rem);
  }
  .chip-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 24px;
    min-width: 24px;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    line-height: 1;
  }
  .chip-remove:hover { background: var(--muted, rgba(127, 127, 127, 0.16)); }
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-chips.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**
```bash
git add "src/pages/[lang]/catalog.astro" tests/catalog/catalog-chips.test.ts
git commit -m "feat(catalog): add removable active-filter chips and clear-all"
```

---

### Task B3.13: Client controller — Pagefind text, filtering, sorting and pagination

Pagefind is the single authority for which skills match, in what order, and how many there are. The
controller never re-renders a card: it maps each Pagefind result back onto the server-rendered
wrapper by `data-skill-id`, then shows, orders and renumbers.

It needs no notion of `listed`. An entry evicted by the per-subdomain cap is absent from both sides
at once — B3.9 rendered no wrapper for it and B4 emitted no index block on its page — so the two sets
agree by construction and the controller has nothing to filter.

**Files:**
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-controller.test.ts`

**Interfaces:**
- Consumes: `parseQuery`, `serializeQuery`, `toggleFilter`, `removeFilter`, `pageView`,
  `pageNumbers`, `DEFAULT_SORT`, `INDEX_FILTER_KEYS` from `src/lib/facets.ts`; the `#catalog-config`
  JSON block; `data-pagefind-meta="id[…]"` emitted by B4's per-skill route; the single
  `input[data-search-input]` from `SearchBox.astro` (B3.10); `#results-heading` from B3.9.
- Produces: the catalog's inline module script, bundled by Astro into `dist/_astro/*.js`, and a
  `catalog:rendered` CustomEvent carrying `{ query, response, view }`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-controller.test.ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { builtCatalog } from './facet-rail.test.ts';

const root = resolve(__dirname, '../..');

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
    expect(js ?? '').toMatch(/score:\s*["']desc["']/);
    expect(js ?? '').toMatch(/updated:\s*["']asc["']/);
  });

  it('resolves each result back onto its server-rendered card by skill id', () => {
    expect(js ?? '').toContain('data-skill-id');
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
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-controller.test.ts`
Expected: FAIL — the catalog page has no `<script>` yet, so no client bundle exists and the first
test fails with `AssertionError: no built bundle under dist/_astro references catalog-config: expected null not to be null`.
The remaining seven fail against the empty string, for example
`AssertionError: expected '' to contain 'pushState'`.

- [ ] **Step 3: Append the controller to `src/pages/[lang]/catalog.astro`**
Append this block at the very end of the file, after the closing `</style>` tag:
```astro
<script>
  import {
    DEFAULT_SORT,
    INDEX_FILTER_KEYS,
    pageNumbers,
    pageView,
    parseQuery,
    removeFilter,
    serializeQuery,
    toggleFilter,
  } from '../../lib/facets.ts';
  import type { CatalogQuery, IndexFilterKey } from '../../lib/facets.ts';

  interface CatalogConfig {
    baseUrl: string;
    bundlePath: string;
    catalogPath: string;
    lang: string;
    pageSize: number;
    labels: Record<string, Record<string, string>>;
  }

  interface PagefindResult {
    data: () => Promise<{ meta?: Record<string, string> }>;
  }

  interface PagefindSearch {
    results: PagefindResult[];
    filters: Record<string, Record<string, number>>;
    totalFilters: Record<string, Record<string, number>>;
  }

  interface PagefindApi {
    options: (o: Record<string, unknown>) => Promise<void>;
    init: () => Promise<void>;
    search: (term: string | null, opts: Record<string, unknown>) => Promise<PagefindSearch>;
  }

  const PF_SORT: Record<string, Record<string, 'asc' | 'desc'>> = {
    score: { score: 'desc' },
    stars: { stars: 'desc' },
    forks: { forks: 'desc' },
    newest: { newest: 'desc' },
    updated: { updated: 'asc' },
  };

  const configEl = document.getElementById('catalog-config');
  const grid = document.querySelector<HTMLElement>('[data-grid]');
  const emptyEl = document.querySelector<HTMLElement>('[data-empty]');
  const pageList = document.querySelector<HTMLElement>('[data-page-list]');

  if (configEl && grid && emptyEl && pageList) {
    const config = JSON.parse(configEl.textContent || '{}') as CatalogConfig;
    const searchInput = document.querySelector<HTMLInputElement>('[data-search-input]');
    const cards = new Map<string, HTMLElement>();
    for (const el of grid.querySelectorAll<HTMLElement>('[data-skill-id]')) {
      cards.set(el.dataset.skillId ?? '', el);
    }

    let pagefind: PagefindApi | null = null;
    let typingTimer = 0;

    async function getPagefind(): Promise<PagefindApi> {
      if (!pagefind) {
        const mod = (await import(/* @vite-ignore */ config.bundlePath)) as unknown as PagefindApi;
        await mod.options({ baseUrl: config.baseUrl });
        await mod.init();
        pagefind = mod;
      }
      return pagefind;
    }

    function go(query: CatalogQuery): void {
      history.pushState({}, '', `${config.catalogPath}${serializeQuery(query)}`);
      void render();
    }

    function renderPagination(query: CatalogQuery, view: ReturnType<typeof pageView>): void {
      pageList!.textContent = '';
      for (const entry of pageNumbers(view.page, view.totalPages)) {
        const li = document.createElement('li');
        if (entry === 'gap') {
          const span = document.createElement('span');
          span.className = 'page-gap';
          span.setAttribute('aria-hidden', 'true');
          span.textContent = '…';
          li.append(span);
        } else {
          const a = document.createElement('a');
          a.className = 'page-link';
          a.dataset.page = String(entry);
          a.href = `${config.catalogPath}${serializeQuery({ ...query, page: entry })}`;
          a.textContent = String(entry);
          if (entry === view.page) a.setAttribute('aria-current', 'page');
          li.append(a);
        }
        pageList!.append(li);
      }
    }

    function renderSortTabs(query: CatalogQuery): void {
      for (const tab of document.querySelectorAll<HTMLAnchorElement>('[data-sort-tab]')) {
        const key = tab.dataset.sortTab ?? DEFAULT_SORT;
        tab.href = `${config.catalogPath}${serializeQuery({ ...query, sort: key as CatalogQuery['sort'], page: 1 })}`;
        if (key === query.sort) tab.setAttribute('aria-current', 'page');
        else tab.removeAttribute('aria-current');
      }
    }

    function syncControls(query: CatalogQuery): void {
      for (const box of document.querySelectorAll<HTMLInputElement>('[data-facet-check]')) {
        const key = box.name as IndexFilterKey;
        box.checked = (query.filters[key] ?? []).includes(box.value);
      }
      if (searchInput && searchInput.value !== query.q) searchInput.value = query.q;
    }

    async function render(): Promise<void> {
      const query = parseQuery(location.search);
      const pf = await getPagefind();
      const response = await pf.search(query.q.trim() || null, {
        filters: query.filters,
        sort: PF_SORT[query.sort] ?? PF_SORT[DEFAULT_SORT],
      });
      const view = pageView(response.results.length, query.page, config.pageSize);
      const payloads = await Promise.all(response.results.slice(view.from, view.to).map((r) => r.data()));

      for (const el of cards.values()) el.hidden = true;
      payloads.forEach((payload, i) => {
        const el = cards.get(String(payload.meta?.id ?? ''));
        if (!el) return;
        const rank = view.from + i + 1;
        el.hidden = false;
        el.style.order = String(view.from + i);
        el.dataset.rank = String(rank);
        for (const slot of el.querySelectorAll<HTMLElement>('[data-rank]')) {
          slot.dataset.rank = String(rank);
          slot.textContent = `#${rank}`;
        }
      });

      grid!.hidden = view.total === 0;
      emptyEl!.hidden = view.total !== 0;
      renderPagination(query, view);
      renderSortTabs(query);
      syncControls(query);
      document.dispatchEvent(new CustomEvent('catalog:rendered', { detail: { query, response, view } }));
    }

    document.addEventListener('change', (event) => {
      const box = (event.target as HTMLElement | null)?.closest<HTMLInputElement>('[data-facet-check]');
      if (!box) return;
      const query = parseQuery(location.search);
      const key = box.name as IndexFilterKey;
      if (!(INDEX_FILTER_KEYS as readonly string[]).includes(key)) return;
      go({ ...query, filters: toggleFilter(query.filters, key, box.value), page: 1 });
    });

    document.addEventListener('submit', (event) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-catalog-search]')) return;
      event.preventDefault();
      go({ ...parseQuery(location.search), q: searchInput?.value ?? '', page: 1 });
    });

    document.addEventListener('input', (event) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-search-input]')) return;
      window.clearTimeout(typingTimer);
      typingTimer = window.setTimeout(() => {
        go({ ...parseQuery(location.search), q: searchInput?.value ?? '', page: 1 });
      }, 300);
    });

    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      if (target.closest('[data-search-clear]')) {
        event.preventDefault();
        go({ ...parseQuery(location.search), q: '', page: 1 });
        return;
      }

      const chipRemove = target.closest<HTMLElement>('[data-chip-remove]');
      if (chipRemove) {
        event.preventDefault();
        const chip = chipRemove.closest<HTMLElement>('[data-chip-key]');
        if (!chip) return;
        const query = parseQuery(location.search);
        const key = (chip.dataset.chipKey ?? '') as IndexFilterKey;
        go({ ...query, filters: removeFilter(query.filters, key, chip.dataset.chipValue ?? ''), page: 1 });
        return;
      }

      if (target.closest('[data-clear-all]')) {
        event.preventDefault();
        go({ filters: {}, q: '', sort: parseQuery(location.search).sort, page: 1 });
        const heading = document.getElementById('results-heading');
        if (heading instanceof HTMLElement) heading.focus();
        return;
      }

      const link = target.closest<HTMLAnchorElement>('.page-link, .catalog-sort');
      if (link && link.href) {
        event.preventDefault();
        history.pushState({}, '', link.href);
        void render();
      }
    });

    window.addEventListener('popstate', () => void render());
    void render();
  }
</script>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-controller.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**
```bash
git add "src/pages/[lang]/catalog.astro" tests/catalog/catalog-controller.test.ts
git commit -m "feat(catalog): drive text, filtering, sorting and paging from pagefind"
```

---

### Task B3.14: Live facet counts, chip rendering and the polite count announcement

The count beside a value is the whole point of the rail: it says what that option *would* return if
added to the current selection. This task feeds Pagefind's `filters` and `totalFilters` back into the
rail, renders the chip strip from live state, and announces the total on a 300 ms debounce rather
than on every interaction (§10.5).

**Files:**
- Modify: `src/pages/[lang]/catalog.astro`
- Test: `tests/catalog/catalog-a11y.test.ts`

**Interfaces:**
- Consumes: the `catalog:rendered` CustomEvent from B3.13; `activeChips`, `facetCount` from
  `src/lib/facets.ts`; `config.labels` from the `#catalog-config` block; `indexedSkillPages()` from
  `tests/catalog/pagefind-filters.test.ts` (B3.4).
- Produces: `li.filter-chip[data-chip-key][data-chip-value]` instances; live text in
  `[data-facet-count]` and `[data-count]`.

- [ ] **Step 1: Write the failing test**
```ts
// tests/catalog/catalog-a11y.test.ts
import { describe, expect, it } from 'vitest';
import { builtCatalog } from './facet-rail.test.ts';
import { bundleFor } from './catalog-controller.test.ts';
import { indexedSkillPages } from './pagefind-filters.test.ts';

describe('live facet counts', () => {
  const js = bundleFor('catalog-config') ?? '';

  it('reads both Pagefind count objects, not just the narrowed one', () => {
    expect(js).toContain('totalFilters');
    expect(js).toContain('filters');
  });

  it('writes counts back into every rail row', () => {
    expect(js).toContain('data-facet-count');
    expect(js).toContain('data-facet-value');
  });

  it('renders chips from the chip template with key and value attached', () => {
    expect(js).toContain('chip-template');
    expect(js).toContain('chipKey');
    expect(js).toContain('chipValue');
  });

  it('labels a chip from the serialized map rather than importing an i18n table', () => {
    expect(js).toContain('labels');
    expect(js).not.toContain('nodeName');
  });
});

describe('polite result announcement', () => {
  const js = bundleFor('catalog-config') ?? '';

  it('debounces the announcement rather than firing on every interaction', () => {
    expect(js).toMatch(/setTimeout\([^,]+,\s*300\)/);
    expect(js).toContain('clearTimeout');
  });

  it('moves focus to the results heading after clearing filters', () => {
    expect(js).toContain('results-heading');
    expect(js).toContain('focus()');
  });
});

describe('page-level accessibility contract', () => {
  it('declares the route language on the document so Pagefind picks the right index', () => {
    expect(builtCatalog('en')).toMatch(/<html[^>]*lang="en"/);
    expect(builtCatalog('pt')).toMatch(/<html[^>]*lang="pt-BR"/);
  });

  it('keeps the results heading focusable and distinct from the layout skip target', () => {
    expect(builtCatalog('en')).toMatch(/id="results-heading"[^>]*tabindex="-1"/);
  });

  it('keeps every one of the five flat filter keys live in the built index markup', () => {
    // Only the listed pages carry an index block (§5.1) — an evicted page has none to inspect.
    const pages = indexedSkillPages();
    for (const key of ['domain', 'subdomain', 'runtime', 'risk', 'license']) {
      expect(pages[0]).toContain(`data-pagefind-filter="${key}[`);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/catalog/catalog-a11y.test.ts`
Expected: FAIL — the controller bundle contains no occurrence of `totalFilters`, so
`live facet counts > reads both Pagefind count objects` fails on that assertion; `renders chips from
the chip template` and `debounces the announcement` fail for the same reason. The three
`page-level accessibility contract` tests pass already.

- [ ] **Step 3: Extend the controller in `src/pages/[lang]/catalog.astro`**
Replace the single line:
```ts
  import {
    DEFAULT_SORT,
```
with:
```ts
  import {
    DEFAULT_SORT,
    activeChips,
    facetCount,
```
so `activeChips` and `facetCount` join the existing named import from `'../../lib/facets.ts'` inside
the `<script>` block.

Then replace these exact three lines, which currently close the controller's `if` body:
```ts
    window.addEventListener('popstate', () => void render());
    void render();
  }
```
with:
```ts
    const countEl = document.querySelector<HTMLElement>('[data-count]');
    const chipsEl = document.querySelector<HTMLElement>('[data-chips]');
    const chipList = document.querySelector<HTMLElement>('[data-chip-list]');
    const chipTemplate = document.getElementById('chip-template') as HTMLTemplateElement | null;
    const resultsWord = countEl?.textContent?.trim().split(/\s+/).slice(1).join(' ') ?? '';
    let announceTimer = 0;

    function chipLabel(key: string, value: string): string {
      return config.labels?.[key]?.[value] ?? value;
    }

    function paintCounts(detail: {
      query: { filters: Record<string, string[] | undefined> };
      response: {
        filters: Record<string, Record<string, number>>;
        totalFilters: Record<string, Record<string, number>>;
      };
    }): void {
      for (const row of document.querySelectorAll<HTMLElement>('[data-facet-value]')) {
        const slot = row.querySelector('[data-facet-count]');
        if (!slot) continue;
        slot.textContent = String(
          facetCount(
            row.dataset.facetKey ?? '',
            row.dataset.facetValue ?? '',
            detail.query.filters,
            detail.response.filters,
            detail.response.totalFilters,
          ),
        );
      }
    }

    function paintChips(filters: Record<string, string[] | undefined>): void {
      if (!chipsEl || !chipList || !chipTemplate) return;
      const chips = activeChips(filters);
      chipList.textContent = '';
      for (const chip of chips) {
        const node = chipTemplate.content.firstElementChild?.cloneNode(true);
        if (!(node instanceof HTMLElement)) continue;
        node.dataset.chipKey = chip.key;
        node.dataset.chipValue = chip.value;
        const label = node.querySelector('[data-chip-label]');
        if (label) label.textContent = chipLabel(chip.key, chip.value);
        chipList.append(node);
      }
      chipsEl.hidden = chips.length === 0;
    }

    function announce(total: number): void {
      if (!countEl) return;
      window.clearTimeout(announceTimer);
      announceTimer = window.setTimeout(() => {
        countEl.textContent = `${total} ${resultsWord}`;
      }, 300);
    }

    document.addEventListener('catalog:rendered', (event) => {
      const detail = (event as CustomEvent).detail;
      paintCounts(detail);
      paintChips(detail.query.filters);
      announce(detail.view.total);
    });

    window.addEventListener('popstate', () => void render());
    void render();
  }
```
`resultsWord` is read out of the server-rendered count line rather than looked up, so the announcement
stays in the page's own locale without shipping an i18n table to the browser.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/catalog/catalog-a11y.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole catalog suite as a regression check**
Run: `npx vitest run tests/catalog`
Expected: PASS, 160 tests across 14 files.

- [ ] **Step 6: Commit**
```bash
git add "src/pages/[lang]/catalog.astro" tests/catalog/catalog-a11y.test.ts
git commit -m "feat(catalog): paint live facet counts, chips and a polite result count"
```

---

---

### Task B5.1: i18n namespace for search chrome and the pipeline status footer

Rule 3: `src/lib/i18n/search.ts` default-exports `{ en, pt }` with identical key sets, and B1's `src/lib/i18n/index.ts` merges every namespace module behind `t(key, lang)`. Per seam S1 this namespace **owns** `search.label` and `search.placeholder` — B3's SearchBox consumes them and never defines them. `resultsHeading` and `clearAll` belong to B3's catalog namespace, and `nav.methodology` belongs to B1's core table; none of the three is restated here.

**Files:**
- Create: `src/lib/i18n/search.ts`
- Test: `tests/lib/i18n-search.test.ts`

**Interfaces:**
- Consumes: `Lang` from `src/types.ts`; `t(key: string, lang: Lang): string` from `src/lib/i18n/index.ts` (B1), which merges every module in `src/lib/i18n/`
- Produces: default export `Record<Lang, Record<string, string>>` carrying `search.label`, `search.placeholder`, `search.suggestions`, `search.didYouMean`, `search.noResults`, `search.resultOne`, `search.resultMany`, `status.heading`, `status.crawled`, `status.classified`, `status.lag`, `status.neverRun`, `status.unknown`, `status.queued`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/i18n-search.test.ts
import { describe, it, expect } from 'vitest';
import search from '../../src/lib/i18n/search.ts';
import { t } from '../../src/lib/i18n/index.ts';

const KEYS = [
  'search.suggestions', 'search.didYouMean', 'search.noResults',
  'search.resultOne', 'search.resultMany',
  'status.heading', 'status.crawled', 'status.classified',
  'status.lag', 'status.neverRun', 'status.unknown', 'status.queued',
];

describe('search namespace', () => {
  it('carries exactly the documented keys', () => {
    expect(Object.keys(search.en).sort()).toEqual([...KEYS].sort());
  });

  it('has identical key sets in both locales', () => {
    expect(Object.keys(search.pt).sort()).toEqual(Object.keys(search.en).sort());
  });

  it('never ships an empty string', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const [key, value] of Object.entries(search[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('never restates a string another section owns', () => {
    for (const owned of ['search.resultsHeading', 'search.clearAll', 'nav.methodology']) {
      expect(Object.keys(search.en), owned).not.toContain(owned);
    }
  });

  it('hand-writes pt-BR rather than echoing English', () => {
    expect(search.pt['search.didYouMean']).toBe('Você quis dizer');
    expect(search.pt['status.neverRun']).toBe('nunca executada');
  });
});

describe('the namespace reaches t()', () => {
  it('resolves through the merged index', () => {
    for (const key of KEYS) {
      expect(
        t(key, 'en'),
        `t("${key}", "en") returned the key itself: src/lib/i18n/index.ts is not merging src/lib/i18n/search.ts`,
      ).not.toBe(key);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/i18n-search.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/i18n/search.ts (resolved id: ../../src/lib/i18n/search.ts). Does the file exist?`

- [ ] **Step 3: Write the namespace**
```ts
// src/lib/i18n/search.ts
import type { Lang } from '../../types.ts';

/**
 * Search-box chrome and the pipeline status footer. Hand-written in both locales (spec §8).
 * This module owns search.label and search.placeholder; B3's SearchBox only calls t().
 */
const en = {
  'search.suggestions': 'Suggestions',
  'search.didYouMean': 'Did you mean',
  'search.noResults': 'No results',
  'search.resultOne': 'result',
  'search.resultMany': 'results',
  'status.heading': 'Pipeline status',
  'status.crawled': 'Crawled',
  'status.classified': 'Classified',
  'status.lag': 'Classification lag',
  'status.neverRun': 'never run',
  'status.unknown': 'unknown',
  'status.queued': 'entries queued unclassified',
} as const;

const pt: Record<keyof typeof en, string> = {
  'search.suggestions': 'Sugestões',
  'search.didYouMean': 'Você quis dizer',
  'search.noResults': 'Nenhum resultado',
  'search.resultOne': 'resultado',
  'search.resultMany': 'resultados',
  'status.heading': 'Estado do pipeline',
  'status.crawled': 'Coleta',
  'status.classified': 'Classificação',
  'status.lag': 'Atraso da classificação',
  'status.neverRun': 'nunca executada',
  'status.unknown': 'desconhecido',
  'status.queued': 'entradas aguardando classificação',
};

const search: Record<Lang, Record<string, string>> = { en, pt };
export default search;
```

The `Record<keyof typeof en, string>` annotation makes a missing or extra Portuguese key a compile error, so a silent English leak cannot reach the page.

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/i18n-search.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/i18n/search.ts tests/lib/i18n-search.test.ts
git commit -m "feat(i18n): hand-written EN and pt-BR strings for search and pipeline status"
```

---

### Task B5.2: Rescue index documents — names and aliases only

The MiniSearch rescue index exists because Pagefind 1.5.2 has **zero typo tolerance** (spec §11): `kubernets`, `terrafrom` and `clude code` return nothing. The index carries only entry **names** and **aliases** — never descriptions or bodies — so it stays in the tens of KB and can be fetched on the first keystroke. It also carries only **listed** entries (spec §5.1): an entry evicted by the per-subdomain cap keeps its row in `data/skills.json` and keeps its page, but leaves every search surface.

Each document stores a **base-relative site path**, not a finished href. `withBase` reads `import.meta.env.BASE_URL`, which does not exist under plain Node, and `scripts/build-rescue-index.ts` (Task B5.6) runs under Node. Taxonomy nodes point at the catalog with a `?subdomain=` query, never at a per-node route: Rule 4 makes the catalog the only list surface, so `/{lang}/{slug}/` would 404.

**Files:**
- Create: `src/lib/rescue.ts`
- Test: `tests/lib/rescue.test.ts`

**Interfaces:**
- Consumes: `Lang`, `Skill`, `Taxonomy`, `TaxonomyNode` from `src/types.ts` — including the required `Skill.listed` flag (§5.1, A1 owns the field); `skillSlug(skill: Skill): string` from `src/lib/slug.ts` (B4) — the single slug function (Rule 4)
- Produces: `interface RescueDoc { id: string; kind: 'skill' | 'node'; name: string; aliases: string; path: string }`; `buildRescueDocs(skills: Skill[], taxonomy: Taxonomy, lang: Lang): RescueDoc[]`

- [ ] **Step 1: Install MiniSearch at the pinned version**
```bash
npm install --save-exact minisearch@7.2.0
```

- [ ] **Step 2: Write the failing test**
```ts
// tests/lib/rescue.test.ts
import { describe, it, expect } from 'vitest';
import { buildRescueDocs, type RescueDoc } from '../../src/lib/rescue.ts';
import { skillSlug } from '../../src/lib/slug.ts';
import type { Skill, Taxonomy } from '../../src/types.ts';

/** Every fixture satisfies score === breakdown.total, each part inside 25/30/25/20. */
export function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'acme/tools@abc1234:kit/SKILL.md',
    type: 'skill',
    name: 'Terraform Drift Detector',
    description: 'Detects drift between Terraform state and deployed cloud resources.',
    descriptionPt: null,
    longPt: null,
    repo: 'acme/tools',
    path: 'kit/SKILL.md',
    sha: 'abc1234',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false, scriptCount: 0, languages: [],
      network: false, readsEnv: false, declaredTools: null,
    },
    primary: 'security/iac-config',
    also: [],
    tags: ['terraform'],
    securityRelevant: true,
    score: 71,
    breakdown: { adoption: 12, maintenance: 26, provenance: 13, completeness: 20, total: 71 },
    listed: true,
    ...over,
  };
}

export const taxonomy: Taxonomy = {
  domains: [
    {
      slug: 'security',
      name: { en: 'Security', pt: 'Segurança' },
      children: [
        { slug: 'security/containers-kubernetes', name: { en: 'Containers & Kubernetes', pt: 'Contêineres e Kubernetes' } },
        { slug: 'security/compliance-grc', name: { en: 'Compliance, Risk & Audit', pt: 'Conformidade, Risco e Auditoria' } },
      ],
    },
  ],
  protected: ['Kubernetes'],
  aliases: { k8s: 'containers-kubernetes', grc: 'compliance-grc' },
  minimumMass: 5,
};

describe('fixture integrity', () => {
  it('keeps score equal to breakdown.total, every part inside its cap', () => {
    const s = makeSkill();
    expect(s.score).toBe(s.breakdown.total);
    expect(s.breakdown.adoption).toBeLessThanOrEqual(25);
    expect(s.breakdown.maintenance).toBeLessThanOrEqual(30);
    expect(s.breakdown.provenance).toBeLessThanOrEqual(25);
    expect(s.breakdown.completeness).toBeLessThanOrEqual(20);
  });
});

describe('buildRescueDocs', () => {
  const skills = [makeSkill()];

  it('emits one doc per skill and one per taxonomy node', () => {
    const docs = buildRescueDocs(skills, taxonomy, 'en');
    expect(docs.filter((d) => d.kind === 'skill')).toHaveLength(1);
    expect(docs.filter((d) => d.kind === 'node')).toHaveLength(3);
  });

  it('never carries description or body text', () => {
    const blob = JSON.stringify(buildRescueDocs(skills, taxonomy, 'en'));
    expect(blob).not.toContain('Detects drift between Terraform state');
  });

  it('attaches alias terms to the node they resolve to', () => {
    const docs = buildRescueDocs(skills, taxonomy, 'en');
    const node = docs.find((d: RescueDoc) => d.id === 'node:security/containers-kubernetes');
    expect(node?.aliases.split(' ')).toContain('k8s');
    const grc = docs.find((d: RescueDoc) => d.id === 'node:security/compliance-grc');
    expect(grc?.aliases.split(' ')).toContain('grc');
  });

  it('uses the requested locale for node names', () => {
    const pt = buildRescueDocs(skills, taxonomy, 'pt');
    expect(pt.find((d) => d.id === 'node:security/containers-kubernetes')?.name)
      .toBe('Contêineres e Kubernetes');
  });

  it('routes skills through the one slug function, and stores a base-relative path', () => {
    const skill = makeSkill({ repo: 'anthropics/skills', path: 'document-skills/pdf/SKILL.md' });
    const doc = buildRescueDocs([skill], taxonomy, 'en').find((d) => d.kind === 'skill');
    expect(doc?.path).toBe(`/en/skills/${skillSlug(skill)}/`);
  });

  it('sends nodes to the catalog, the only list surface this plan builds', () => {
    const pt = buildRescueDocs(skills, taxonomy, 'pt');
    expect(pt.find((d) => d.id === 'node:security')?.path).toBe('/pt/catalog/?subdomain=security');
    const en = buildRescueDocs(skills, taxonomy, 'en');
    expect(en.find((d) => d.id === 'node:security/containers-kubernetes')?.path)
      .toBe('/en/catalog/?subdomain=security/containers-kubernetes');
    for (const doc of en) {
      expect(doc.path, `${doc.id} points at a route nobody builds`).not.toMatch(/^\/en\/security/);
    }
  });

  it('indexes only listed entries — an evicted skill keeps its page, not its search presence', () => {
    const evicted = makeSkill({ id: 'gone/here@ddd4444:z/SKILL.md', name: 'Evicted Drift Tool', listed: false });
    const docs = buildRescueDocs([makeSkill(), evicted], taxonomy, 'en');
    expect(docs.filter((d) => d.kind === 'skill')).toHaveLength(1);
    expect(docs.map((d) => d.name)).not.toContain('Evicted Drift Tool');
    expect(docs.filter((d) => d.kind === 'node')).toHaveLength(3);
  });

  it('keys skill docs by the skill id so the index dedupes on re-crawl', () => {
    expect(buildRescueDocs(skills, taxonomy, 'en').find((d) => d.kind === 'skill')?.id)
      .toBe('acme/tools@abc1234:kit/SKILL.md');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/rescue.ts (resolved id: ../../src/lib/rescue.ts). Does the file exist?`

- [ ] **Step 4: Write minimal implementation**
```ts
// src/lib/rescue.ts
import type { Lang, Skill, Taxonomy, TaxonomyNode } from '../types.ts';
import { skillSlug } from './slug.ts';

/**
 * One searchable entry in the typo-rescue index. Names and aliases only — never descriptions.
 * `path` is base-relative; the client applies withBase() at navigation time so the artifact can
 * be generated by a plain Node script and stays correct under any deployment base.
 */
export interface RescueDoc {
  id: string;
  kind: 'skill' | 'node';
  name: string;
  aliases: string;
  path: string;
}

function aliasIndex(taxonomy: Taxonomy): Map<string, string[]> {
  const byTarget = new Map<string, string[]>();
  for (const [alias, target] of Object.entries(taxonomy.aliases)) {
    const list = byTarget.get(target) ?? [];
    list.push(alias);
    byTarget.set(target, list);
  }
  return byTarget;
}

function aliasTermsFor(slug: string, byTarget: Map<string, string[]>): string[] {
  const tail = slug.includes('/') ? slug.slice(slug.lastIndexOf('/') + 1) : slug;
  return Array.from(new Set([
    ...(byTarget.get(slug) ?? []),
    ...(byTarget.get(tail) ?? []),
    ...slug.split(/[/-]+/).filter((part) => part.length > 1),
  ]));
}

function flattenNodes(nodes: TaxonomyNode[]): TaxonomyNode[] {
  const out: TaxonomyNode[] = [];
  for (const node of nodes) {
    out.push(node);
    if (node.children) out.push(...flattenNodes(node.children));
  }
  return out;
}

export function buildRescueDocs(skills: Skill[], taxonomy: Taxonomy, lang: Lang): RescueDoc[] {
  const byTarget = aliasIndex(taxonomy);
  const docs: RescueDoc[] = [];

  for (const node of flattenNodes(taxonomy.domains)) {
    docs.push({
      id: `node:${node.slug}`,
      kind: 'node',
      name: node.name[lang],
      aliases: aliasTermsFor(node.slug, byTarget).join(' '),
      // Rule 4: the catalog is the only list surface, so a node suggestion is a filtered catalog.
      path: `/${lang}/catalog/?subdomain=${node.slug}`,
    });
  }

  // §5.1: an entry evicted by the per-subdomain cap keeps its page but leaves every search surface.
  for (const skill of skills.filter((entry) => entry.listed)) {
    docs.push({
      id: skill.id,
      kind: 'skill',
      name: skill.name,
      aliases: skill.repo.split(/[/\-_.]+/).filter((part) => part.length > 1).join(' '),
      path: `/${lang}/skills/${skillSlug(skill)}/`,
    });
  }

  return docs;
}
```

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 6: Commit**
```bash
git add src/lib/rescue.ts tests/lib/rescue.test.ts package.json package-lock.json
git commit -m "feat(search): rescue index documents over names and aliases only"
```

---

### Task B5.3: MiniSearch typo rescue — the three misspellings that must work

**Files:**
- Modify: `src/lib/rescue.ts` (one import at the top, plus an append to the end of the file)
- Modify: `tests/lib/rescue.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `buildRescueDocs`, `RescueDoc` from `src/lib/rescue.ts`
- Produces: `RESCUE_OPTIONS`, `RESCUE_SEARCH_OPTIONS`; `interface RescueSuggestion { id: string; kind: 'skill' | 'node'; name: string; path: string }`; `createRescueIndex(docs: RescueDoc[]): MiniSearch<RescueDoc>`; `suggestRescue(index: MiniSearch<RescueDoc>, query: string, limit?: number): RescueSuggestion[]`

- [ ] **Step 1: Write the failing test**
Append to `tests/lib/rescue.test.ts`:
```ts
import { createRescueIndex, suggestRescue } from '../../src/lib/rescue.ts';

describe('suggestRescue — Pagefind has zero typo tolerance, this is the rescue', () => {
  const corpus = [
    makeSkill({ id: 'a/one@aaa1111:x/SKILL.md', repo: 'a/one', name: 'Terraform Drift Detector' }),
    makeSkill({ id: 'b/two@bbb2222:y/SKILL.md', repo: 'b/two', name: 'Claude Code Reviewer' }),
    makeSkill({ id: 'c/three@ccc3333:z/SKILL.md', repo: 'c/three', name: 'Secret Rotation Playbook' }),
  ];
  const richTaxonomy: Taxonomy = {
    ...taxonomy,
    domains: [
      {
        slug: 'security',
        name: { en: 'Security', pt: 'Segurança' },
        children: [
          { slug: 'security/containers-kubernetes', name: { en: 'Containers & Kubernetes', pt: 'Contêineres e Kubernetes' } },
          { slug: 'security/code-application', name: { en: 'Code & Application', pt: 'Código e Aplicação' } },
          { slug: 'security/supply-chain', name: { en: 'Supply Chain & Dependencies', pt: 'Supply Chain e Dependências' } },
        ],
      },
    ],
  };
  const index = createRescueIndex(buildRescueDocs(corpus, richTaxonomy, 'en'));

  it('rescues "kubernets"', () => {
    expect(suggestRescue(index, 'kubernets').map((s) => s.name)[0]).toBe('Containers & Kubernetes');
  });

  it('rescues "terrafrom"', () => {
    expect(suggestRescue(index, 'terrafrom').map((s) => s.name)[0]).toBe('Terraform Drift Detector');
  });

  it('rescues "clude code"', () => {
    expect(suggestRescue(index, 'clude code').map((s) => s.name).slice(0, 3))
      .toContain('Claude Code Reviewer');
  });

  it('finds a node through an alias nobody puts in a label', () => {
    expect(suggestRescue(index, 'k8s').map((s) => s.name)).toContain('Containers & Kubernetes');
  });

  it('returns nothing for a query shorter than two characters', () => {
    expect(suggestRescue(index, 'k')).toEqual([]);
    expect(suggestRescue(index, '  ')).toEqual([]);
  });

  it('honours the limit and returns base-relative paths for navigation', () => {
    const hits = suggestRescue(index, 'se', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const hit of hits) expect(hit.path.startsWith('/en/')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/src/lib/rescue.ts' does not provide an export named 'createRescueIndex'`

- [ ] **Step 3: Write minimal implementation**
Add this as the first line of `src/lib/rescue.ts`:
```ts
import MiniSearch, { type Options, type SearchOptions } from 'minisearch';
```
Then append to the end of `src/lib/rescue.ts`:
```ts
/** Index shape. `aliases` is searchable but not stored, keeping the payload small. */
export const RESCUE_OPTIONS: Options<RescueDoc> = {
  idField: 'id',
  fields: ['name', 'aliases'],
  storeFields: ['kind', 'name', 'path'],
};

/**
 * fuzzy 0.2 gives maxDistance = round(term.length * 0.2):
 * "kubernets" -> 2 (needs 1), "terrafrom" -> 2 (needs 2), "clude" -> 1 (needs 1).
 */
export const RESCUE_SEARCH_OPTIONS: SearchOptions = {
  prefix: true,
  fuzzy: 0.2,
  combineWith: 'OR',
  boost: { name: 2 },
};

export interface RescueSuggestion {
  id: string;
  kind: 'skill' | 'node';
  name: string;
  /** Base-relative. Apply withBase() before navigating. */
  path: string;
}

export function createRescueIndex(docs: RescueDoc[]): MiniSearch<RescueDoc> {
  const index = new MiniSearch<RescueDoc>(RESCUE_OPTIONS);
  index.addAll(docs);
  return index;
}

export function suggestRescue(
  index: MiniSearch<RescueDoc>,
  query: string,
  limit = 7,
): RescueSuggestion[] {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return index
    .search(trimmed, RESCUE_SEARCH_OPTIONS)
    .slice(0, limit)
    .map((hit) => ({
      id: String(hit.id),
      kind: hit.kind as 'skill' | 'node',
      name: hit.name as string,
      path: hit.path as string,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/rescue.ts tests/lib/rescue.test.ts
git commit -m "feat(search): MiniSearch typo rescue for kubernets, terrafrom and clude code"
```

---

### Task B5.4: Serialise the rescue index for the wire

The index is built once and shipped as JSON. Fuzzy matching must still work after a round trip, which is why the round trip is what gets tested rather than plain `JSON.parse`.

**Files:**
- Modify: `src/lib/rescue.ts` (append to the end of the file)
- Modify: `tests/lib/rescue.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `createRescueIndex`, `RESCUE_OPTIONS`, `RescueDoc` from `src/lib/rescue.ts`
- Produces: `serializeRescueIndex(index: MiniSearch<RescueDoc>): string`; `loadRescueIndex(json: string): MiniSearch<RescueDoc>`

- [ ] **Step 1: Write the failing test**
Append to `tests/lib/rescue.test.ts`:
```ts
import { serializeRescueIndex, loadRescueIndex } from '../../src/lib/rescue.ts';

describe('rescue index wire format', () => {
  const docs = buildRescueDocs([makeSkill()], taxonomy, 'en');

  it('round-trips through JSON and still tolerates a typo', () => {
    const reloaded = loadRescueIndex(serializeRescueIndex(createRescueIndex(docs)));
    expect(reloaded.documentCount).toBe(docs.length);
    expect(suggestRescue(reloaded, 'terrafrom')[0]?.name).toBe('Terraform Drift Detector');
  });

  it('produces parseable JSON that carries no description text', () => {
    const json = serializeRescueIndex(createRescueIndex(docs));
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toContain('Detects drift between Terraform state');
  });

  it('is deterministic, so a committed artifact can be diffed', () => {
    const a = serializeRescueIndex(createRescueIndex(buildRescueDocs([makeSkill()], taxonomy, 'en')));
    const b = serializeRescueIndex(createRescueIndex(buildRescueDocs([makeSkill()], taxonomy, 'en')));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/src/lib/rescue.ts' does not provide an export named 'serializeRescueIndex'`

- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/rescue.ts`:
```ts
export function serializeRescueIndex(index: MiniSearch<RescueDoc>): string {
  return JSON.stringify(index);
}

export function loadRescueIndex(json: string): MiniSearch<RescueDoc> {
  return MiniSearch.loadJSON<RescueDoc>(json, RESCUE_OPTIONS);
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: PASS — 18 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/rescue.ts tests/lib/rescue.test.ts
git commit -m "feat(search): serialise and reload the rescue index"
```

---

### Task B5.5: The "did you mean" rule

Pagefind returning zero results is the trigger. When it returns anything at all the rescue stays hidden — a suggestion shown next to real results is noise.

**Files:**
- Modify: `src/lib/rescue.ts` (append to the end of the file)
- Modify: `tests/lib/rescue.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `RescueSuggestion` from `src/lib/rescue.ts`
- Produces: `interface RescueDecision { show: boolean; top: RescueSuggestion | null; alternatives: RescueSuggestion[] }`; `rescueDecision(resultCount: number, suggestions: RescueSuggestion[]): RescueDecision`

- [ ] **Step 1: Write the failing test**
Append to `tests/lib/rescue.test.ts`:
```ts
import { rescueDecision, type RescueSuggestion } from '../../src/lib/rescue.ts';

describe('rescueDecision', () => {
  const hits: RescueSuggestion[] = [
    { id: 'node:security/containers-kubernetes', kind: 'node', name: 'Containers & Kubernetes', path: '/en/catalog/?subdomain=security/containers-kubernetes' },
    { id: 'node:security/iac-config', kind: 'node', name: 'Infrastructure as Code', path: '/en/catalog/?subdomain=security/iac-config' },
    { id: 'x/y@zzz1111:p/SKILL.md', kind: 'skill', name: 'Kube Bench Runner', path: '/en/skills/kube-bench-runner/' },
    { id: 'q/r@sss2222:p/SKILL.md', kind: 'skill', name: 'Kyverno Policy Author', path: '/en/skills/kyverno-policy-author/' },
    { id: 'm/n@ooo3333:p/SKILL.md', kind: 'skill', name: 'Helm Chart Linter', path: '/en/skills/helm-chart-linter/' },
  ];

  it('shows the rescue only when Pagefind returned nothing', () => {
    expect(rescueDecision(0, hits).show).toBe(true);
    expect(rescueDecision(1, hits).show).toBe(false);
    expect(rescueDecision(42, hits).show).toBe(false);
  });

  it('stays hidden when there is nothing to suggest', () => {
    expect(rescueDecision(0, [])).toEqual({ show: false, top: null, alternatives: [] });
  });

  it('promotes the best match and caps alternatives at three', () => {
    const decision = rescueDecision(0, hits);
    expect(decision.top?.name).toBe('Containers & Kubernetes');
    expect(decision.alternatives).toHaveLength(3);
    expect(decision.alternatives.map((s) => s.name)).not.toContain('Containers & Kubernetes');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/src/lib/rescue.ts' does not provide an export named 'rescueDecision'`

- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/rescue.ts`:
```ts
export interface RescueDecision {
  show: boolean;
  top: RescueSuggestion | null;
  alternatives: RescueSuggestion[];
}

/** Pagefind found nothing and MiniSearch found something: that is the only rescue case. */
export function rescueDecision(
  resultCount: number,
  suggestions: RescueSuggestion[],
): RescueDecision {
  if (resultCount > 0 || suggestions.length === 0) {
    return { show: false, top: null, alternatives: [] };
  }
  return { show: true, top: suggestions[0], alternatives: suggestions.slice(1, 4) };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/rescue.test.ts`
Expected: PASS — 21 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/rescue.ts tests/lib/rescue.test.ts
git commit -m "feat(search): show did-you-mean only when Pagefind returns zero results"
```

---

### Task B5.6: `scripts/build-rescue-index.ts` — a committed, per-locale artifact

The artifact is generated by a Node script, written into `public/rescue-index/`, and **committed**, exactly like `data/skills.json`. Astro copies `public/` verbatim, so `npx astro build` alone puts the file where the client expects it. **Both** harvest schedules regenerate it in the same commit that refreshes the catalog — the local systemd run every 4 h, which spec §6.1 now makes the primary, and the weekly `crawl.yml` fallback — and a drift test fails loudly if artifact and catalog ever separate.

**Files:**
- Create: `scripts/build-rescue-index.ts`
- Create: `public/rescue-index/en.json`, `public/rescue-index/pt.json` (generated by Step 3)
- Modify: `.github/workflows/crawl.yml` (A6) — one added step and one changed `git add`
- Reads (never writes): `scripts/harvest/run.ts` and `ops/` (A6) — asserted on, so the primary local schedule cannot drift
- Test: `tests/build/rescue-index.test.ts`

**Interfaces:**
- Consumes: `loadSkills(): Skill[]` from `src/lib/data.ts` (A6); `loadTaxonomy(): Taxonomy` from `src/lib/taxonomy.ts` (A3); `buildRescueDocs`, `createRescueIndex`, `serializeRescueIndex`, `loadRescueIndex` from `src/lib/rescue.ts`; `Lang` from `src/types.ts`
- Produces: `RESCUE_LANGS: readonly Lang[]`, `RESCUE_OUT_DIR: string`, `rescueIndexJson(lang: Lang): string`, `writeRescueIndexes(outDir?: string): string[]`; the committed assets `public/rescue-index/{en,pt}.json`, copied by Astro to `dist/rescue-index/{en,pt}.json`

- [ ] **Step 1: Write the failing test**
```ts
// tests/build/rescue-index.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadRescueIndex } from '../../src/lib/rescue.ts';
import { RESCUE_LANGS, rescueIndexJson } from '../../scripts/build-rescue-index.ts';

const MAX_BYTES = 512 * 1024;

function read(file: string): string {
  if (!existsSync(file)) {
    throw new Error(`Missing ${file} — run "npx tsx scripts/build-rescue-index.ts" and commit the result`);
  }
  return readFileSync(file, 'utf8');
}

describe('the committed rescue index', () => {
  for (const lang of RESCUE_LANGS) {
    it(`ships public/rescue-index/${lang}.json`, () => {
      const raw = read(`public/rescue-index/${lang}.json`);
      expect(() => JSON.parse(raw)).not.toThrow();
      const bytes = Buffer.byteLength(raw, 'utf8');
      expect(bytes, `public/rescue-index/${lang}.json is ${bytes} bytes — it must stay small`)
        .toBeLessThan(MAX_BYTES);
      expect(loadRescueIndex(raw).documentCount).toBeGreaterThan(0);
    });

    it(`is in sync with the harvested catalog for ${lang}`, () => {
      expect(
        JSON.parse(read(`public/rescue-index/${lang}.json`)),
        `public/rescue-index/${lang}.json is stale — regenerate with "npx tsx scripts/build-rescue-index.ts"`,
      ).toEqual(JSON.parse(rescueIndexJson(lang)));
    });

    it(`is copied into dist/rescue-index/${lang}.json by the build`, () => {
      expect(existsSync(`dist/rescue-index/${lang}.json`)).toBe(true);
    });
  }

  it('carries no description text into the shipped payload', () => {
    for (const lang of RESCUE_LANGS) {
      expect(read(`public/rescue-index/${lang}.json`)).not.toContain('"description"');
    }
  });
});

describe('the weekly fallback crawl regenerates it', () => {
  const yml = readFileSync('.github/workflows/crawl.yml', 'utf8');

  it('rebuilds the rescue index before committing', () => {
    expect(yml).toContain('scripts/build-rescue-index.ts');
  });

  it('commits the regenerated artifact alongside the catalog data', () => {
    expect(yml).toContain('git add data/skills.json data/meta.json public/rescue-index');
  });
});

describe('the primary local schedule regenerates it too', () => {
  const localChain = ['scripts/harvest/run.ts', 'ops/ai-tools-hub-harvest.service', 'ops/install-schedule.sh']
    .filter((file) => existsSync(file))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');

  it('rebuilds the artifact on the local run, not only in the weekly Action', () => {
    expect(
      localChain,
      'the local systemd run is the primary schedule (§6.1): if it commits data/skills.json without rebuilding public/rescue-index, the sync test above fails every 4 hours. Reconcile with A6, which owns scripts/harvest/run.ts and ops/ — do not weaken this test',
    ).toContain('build-rescue-index');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/rescue-index.test.ts`
Expected: FAIL — `Error: Failed to load url ../../scripts/build-rescue-index.ts (resolved id: ../../scripts/build-rescue-index.ts). Does the file exist?`

- [ ] **Step 3: Write the script and generate the artifact**
```ts
// scripts/build-rescue-index.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv } from 'node:process';
import { loadSkills } from '../src/lib/data.ts';
import { loadTaxonomy } from '../src/lib/taxonomy.ts';
import { buildRescueDocs, createRescueIndex, serializeRescueIndex } from '../src/lib/rescue.ts';
import type { Lang } from '../src/types.ts';

export const RESCUE_LANGS: readonly Lang[] = ['en', 'pt'];

/** Astro copies public/ verbatim, so the artifact needs no build-order relationship. */
export const RESCUE_OUT_DIR = 'public/rescue-index';

export function rescueIndexJson(lang: Lang): string {
  return serializeRescueIndex(createRescueIndex(buildRescueDocs(loadSkills(), loadTaxonomy(), lang)));
}

export function writeRescueIndexes(outDir: string = RESCUE_OUT_DIR): string[] {
  const dir = resolve(process.cwd(), outDir);
  mkdirSync(dir, { recursive: true });
  return RESCUE_LANGS.map((lang) => {
    const file = resolve(dir, `${lang}.json`);
    writeFileSync(file, `${rescueIndexJson(lang)}\n`, 'utf8');
    return file;
  });
}

if (argv[1] && argv[1].endsWith('build-rescue-index.ts')) {
  for (const file of writeRescueIndexes()) console.log(`wrote ${file}`);
}
```
Then generate it:
```bash
npx tsx /home/kyo/projects/ai-tools-hub/scripts/build-rescue-index.ts
```
Expected: two `wrote ` lines, one per locale.

- [ ] **Step 4: Wire the regeneration into the weekly fallback crawl**
A6 rewrote this workflow's schedule to weekly in the same plan, so confirm both anchors survived before editing:
```bash
cd /home/kyo/projects/ai-tools-hub
grep -c '      - name: Commit the refreshed catalog' .github/workflows/crawl.yml
grep -c '          git add data/skills.json data/meta.json' .github/workflows/crawl.yml
```
Expected: `1` and `1`. If either differs, stop and reconcile with A6 rather than guessing a new anchor.

In `.github/workflows/crawl.yml`, replace this exact line:
```yaml
      - name: Commit the refreshed catalog
```
with:
```yaml
      - name: Rebuild the rescue index from the refreshed catalog
        run: npx tsx scripts/build-rescue-index.ts

      - name: Commit the refreshed catalog
```
and replace this exact line:
```yaml
          git add data/skills.json data/meta.json
```
with:
```yaml
          git add data/skills.json data/meta.json public/rescue-index
```

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/build/rescue-index.test.ts`
Expected: PASS — 10 tests

- [ ] **Step 6: Commit**
```bash
git add scripts/build-rescue-index.ts public/rescue-index tests/build/rescue-index.test.ts .github/workflows/crawl.yml
git commit -m "feat(search): generate and commit the per-locale rescue index"
```

---

### Task B5.7: Combobox keyboard state machine

Spec §10.5 requires a real ARIA combobox. B3 owns the markup (`src/components/SearchBox.astro`); B5 owns the behaviour. The keyboard semantics live in a pure reducer so they are unit-testable without a DOM.

**Files:**
- Create: `src/lib/combobox.ts`
- Test: `tests/lib/combobox.test.ts`

**Interfaces:**
- Produces: `interface ComboboxState { open: boolean; activeIndex: number; optionCount: number }`; `type ComboboxAction = 'none' | 'submit' | 'activate' | 'dismiss'`; `interface ComboboxTransition { state: ComboboxState; action: ComboboxAction; index: number }`; `type ComboboxEvent`; `INITIAL_COMBOBOX_STATE`; `comboboxReducer(state, event): ComboboxTransition`; `activeDescendantId(listboxId: string, state: ComboboxState): string | null`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/combobox.test.ts
import { describe, it, expect } from 'vitest';
import {
  INITIAL_COMBOBOX_STATE, activeDescendantId, comboboxReducer, type ComboboxState,
} from '../../src/lib/combobox.ts';

const withOptions = (count: number): ComboboxState =>
  comboboxReducer(INITIAL_COMBOBOX_STATE, { type: 'results', optionCount: count }).state;

describe('comboboxReducer', () => {
  it('opens when results arrive and closes when they do not', () => {
    expect(withOptions(3)).toEqual({ open: true, activeIndex: -1, optionCount: 3 });
    expect(withOptions(0)).toEqual({ open: false, activeIndex: -1, optionCount: 0 });
  });

  it('ArrowDown walks forward and wraps to the first option', () => {
    let state = withOptions(3);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(0);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(2);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(0);
  });

  it('ArrowUp from nothing selected picks the last option', () => {
    expect(comboboxReducer(withOptions(4), { type: 'key', key: 'ArrowUp' }).state.activeIndex).toBe(3);
  });

  it('ArrowUp walks backward and wraps', () => {
    let state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    state = comboboxReducer(state, { type: 'key', key: 'ArrowUp' }).state;
    expect(state.activeIndex).toBe(2);
  });

  it('reopens a closed listbox on ArrowDown when options exist', () => {
    const closed: ComboboxState = { open: false, activeIndex: -1, optionCount: 5 };
    const next = comboboxReducer(closed, { type: 'key', key: 'ArrowDown' });
    expect(next.state.open).toBe(true);
    expect(next.state.activeIndex).toBe(0);
  });

  it('does nothing on arrows when there are no options', () => {
    const empty = withOptions(0);
    expect(comboboxReducer(empty, { type: 'key', key: 'ArrowDown' }).state).toEqual(empty);
    expect(comboboxReducer(empty, { type: 'key', key: 'ArrowUp' }).state).toEqual(empty);
  });

  it('Enter on an active option activates it and reports the index', () => {
    const state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    const next = comboboxReducer(state, { type: 'key', key: 'Enter' });
    expect(next.action).toBe('activate');
    expect(next.index).toBe(0);
    expect(next.state.open).toBe(false);
  });

  it('Enter with nothing active submits the raw query', () => {
    const next = comboboxReducer(withOptions(3), { type: 'key', key: 'Enter' });
    expect(next.action).toBe('submit');
    expect(next.index).toBe(-1);
  });

  it('Escape closes an open listbox, then dismisses', () => {
    const first = comboboxReducer(withOptions(3), { type: 'key', key: 'Escape' });
    expect(first.action).toBe('none');
    expect(first.state.open).toBe(false);
    expect(comboboxReducer(first.state, { type: 'key', key: 'Escape' }).action).toBe('dismiss');
  });

  it('select activates the clicked index', () => {
    const next = comboboxReducer(withOptions(3), { type: 'select', index: 2 });
    expect(next.action).toBe('activate');
    expect(next.index).toBe(2);
    expect(next.state.open).toBe(false);
  });

  it('blur closes without acting', () => {
    const next = comboboxReducer(withOptions(3), { type: 'blur' });
    expect(next.action).toBe('none');
    expect(next.state.open).toBe(false);
  });

  it('ignores keys it does not own', () => {
    const state = withOptions(3);
    expect(comboboxReducer(state, { type: 'key', key: 'a' }).state).toEqual(state);
  });
});

describe('activeDescendantId', () => {
  it('is null when nothing is active', () => {
    expect(activeDescendantId('sug', INITIAL_COMBOBOX_STATE)).toBeNull();
  });

  it('names the active option element', () => {
    const state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    expect(activeDescendantId('sug', state)).toBe('sug-opt-0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/combobox.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/combobox.ts (resolved id: ../../src/lib/combobox.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/combobox.ts

export interface ComboboxState {
  open: boolean;
  /** -1 means no option is active. */
  activeIndex: number;
  optionCount: number;
}

export type ComboboxAction = 'none' | 'submit' | 'activate' | 'dismiss';

export interface ComboboxTransition {
  state: ComboboxState;
  action: ComboboxAction;
  /** Option index for 'activate'; -1 otherwise. */
  index: number;
}

export type ComboboxEvent =
  | { type: 'results'; optionCount: number }
  | { type: 'key'; key: string }
  | { type: 'select'; index: number }
  | { type: 'blur' };

export const INITIAL_COMBOBOX_STATE: ComboboxState = Object.freeze({
  open: false, activeIndex: -1, optionCount: 0,
});

const closed = (state: ComboboxState): ComboboxState => ({ ...state, open: false, activeIndex: -1 });

export function comboboxReducer(state: ComboboxState, event: ComboboxEvent): ComboboxTransition {
  switch (event.type) {
    case 'results': {
      const optionCount = Math.max(0, event.optionCount);
      return {
        state: { open: optionCount > 0, activeIndex: -1, optionCount },
        action: 'none',
        index: -1,
      };
    }

    case 'select':
      return { state: closed(state), action: 'activate', index: event.index };

    case 'blur':
      return { state: closed(state), action: 'none', index: -1 };

    case 'key': {
      if (event.key === 'ArrowDown') {
        if (state.optionCount === 0) return { state, action: 'none', index: -1 };
        if (!state.open) {
          return { state: { ...state, open: true, activeIndex: 0 }, action: 'none', index: -1 };
        }
        const next = (state.activeIndex + 1) % state.optionCount;
        return { state: { ...state, activeIndex: next }, action: 'none', index: -1 };
      }

      if (event.key === 'ArrowUp') {
        if (state.optionCount === 0) return { state, action: 'none', index: -1 };
        if (!state.open) {
          return {
            state: { ...state, open: true, activeIndex: state.optionCount - 1 },
            action: 'none',
            index: -1,
          };
        }
        const next = state.activeIndex <= 0 ? state.optionCount - 1 : state.activeIndex - 1;
        return { state: { ...state, activeIndex: next }, action: 'none', index: -1 };
      }

      if (event.key === 'Enter') {
        if (state.open && state.activeIndex >= 0) {
          return { state: closed(state), action: 'activate', index: state.activeIndex };
        }
        return { state: closed(state), action: 'submit', index: -1 };
      }

      if (event.key === 'Escape') {
        if (state.open) return { state: closed(state), action: 'none', index: -1 };
        return { state: closed(state), action: 'dismiss', index: -1 };
      }

      return { state, action: 'none', index: -1 };
    }
  }
}

export function activeDescendantId(listboxId: string, state: ComboboxState): string | null {
  if (!state.open || state.activeIndex < 0) return null;
  return `${listboxId}-opt-${state.activeIndex}`;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/combobox.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/combobox.ts tests/lib/combobox.test.ts
git commit -m "feat(a11y): pure ARIA combobox keyboard state machine"
```

---

### Task B5.8: Debounced live-region announcer

Spec §10.5: result counts go into `aria-live="polite"` on a ~300 ms debounce, **not per keystroke**. Announcing on every keystroke floods a screen reader and the count is stale before it finishes speaking.

**Files:**
- Create: `src/lib/announce.ts`
- Test: `tests/lib/announce.test.ts`

**Interfaces:**
- Produces: `interface DebouncedAnnouncer { announce(message: string): void; cancel(): void; flush(): void }`; `createDebouncedAnnouncer(setText: (message: string) => void, delayMs?: number): DebouncedAnnouncer`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/announce.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedAnnouncer } from '../../src/lib/announce.ts';

describe('createDebouncedAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says nothing before the debounce window elapses', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText, 300).announce('1 result');
    vi.advanceTimersByTime(299);
    expect(setText).not.toHaveBeenCalled();
  });

  it('collapses a burst of keystrokes into one announcement of the last value', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    for (const message of ['9 results', '4 results', '2 results', '1 result', 'No results']) {
      announcer.announce(message);
      vi.advanceTimersByTime(50);
    }
    expect(setText).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setText).toHaveBeenCalledTimes(1);
    expect(setText).toHaveBeenCalledWith('No results');
  });

  it('announces again after a new quiet period', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    vi.advanceTimersByTime(300);
    announcer.announce('7 results');
    vi.advanceTimersByTime(300);
    expect(setText.mock.calls).toEqual([['3 results'], ['7 results']]);
  });

  it('cancel drops the pending announcement', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    announcer.cancel();
    vi.advanceTimersByTime(1000);
    expect(setText).not.toHaveBeenCalled();
  });

  it('flush announces immediately and only once', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    announcer.flush();
    expect(setText).toHaveBeenCalledWith('3 results');
    vi.advanceTimersByTime(1000);
    expect(setText).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending is a no-op', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText, 300).flush();
    expect(setText).not.toHaveBeenCalled();
  });

  it('defaults to a 300 ms window', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText).announce('3 results');
    vi.advanceTimersByTime(299);
    expect(setText).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setText).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/announce.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/announce.ts (resolved id: ../../src/lib/announce.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/announce.ts

export interface DebouncedAnnouncer {
  announce(message: string): void;
  cancel(): void;
  flush(): void;
}

/**
 * Writes result counts into an aria-live region on a quiet-period debounce
 * so a screen reader hears one settled number, not one per keystroke.
 */
export function createDebouncedAnnouncer(
  setText: (message: string) => void,
  delayMs = 300,
): DebouncedAnnouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;

  const emit = (): void => {
    timer = null;
    if (pending === null) return;
    const message = pending;
    pending = null;
    setText(message);
  };

  return {
    announce(message: string): void {
      pending = message;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(emit, delayMs);
    },
    cancel(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
    flush(): void {
      if (timer !== null) clearTimeout(timer);
      emit();
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/announce.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/announce.ts tests/lib/announce.test.ts
git commit -m "feat(a11y): debounce aria-live result counts at 300ms"
```

---

### Task B5.9: SearchBehavior — autocomplete, keyboard and did-you-mean over B3's combobox

Seam S5: there is **one** search input on the site and B3 owns it. `src/components/SearchBox.astro` (B3) renders `input[data-search-input]#catalog-q` already carrying `role="combobox"`, `aria-expanded="false"`, `aria-controls="catalog-suggestions"` and `aria-autocomplete="list"`, plus the empty `<ul id="catalog-suggestions" role="listbox">`, and B3 mounts it on the catalog. This task adds the behaviour over that existing markup and **creates no input and no listbox**. It finds the listbox through the input's own `aria-controls`, so no id is hard-coded here.

Seam S11: the Pagefind bundle path comes from `PAGEFIND_BUNDLE_PATH` in `src/lib/facets.ts` (B3) — this file never derives a second one.

The component renders no markup; the two regions the announcer and the rescue line need are created at runtime next to the listbox, so B3's markup stays a plain combobox. It is mounted once by `Layout.astro` in Task B5.18 and is inert on any page with no `[data-search-input]`.

**Files:**
- Create: `src/components/SearchBehavior.astro`
- Test: `tests/components/search-behavior.test.ts`

**Interfaces:**
- Consumes: `loadRescueIndex`, `suggestRescue`, `rescueDecision`, `RescueSuggestion` from `src/lib/rescue.ts`; `comboboxReducer`, `activeDescendantId`, `INITIAL_COMBOBOX_STATE`, `ComboboxState` from `src/lib/combobox.ts`; `createDebouncedAnnouncer` from `src/lib/announce.ts`; `PAGEFIND_BUNDLE_PATH` from `src/lib/facets.ts` (B3); `withBase` from `src/lib/link.ts` (A1); `t` from `src/lib/i18n/index.ts` (B1); B3's `[data-search-input]` and the listbox it names in `aria-controls`
- Produces: `src/components/SearchBehavior.astro` (no props); the runtime regions `[data-search-status]` and `[data-search-rescue]`; `aria-activedescendant` / `aria-expanded` wiring on B3's input

- [ ] **Step 1: Write the failing test**
```ts
// tests/components/search-behavior.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/components/search-behavior.test.ts`
Expected: FAIL — `Error: Missing src/components/SearchBehavior.astro`

- [ ] **Step 3: Write the component**
```astro
---
// src/components/SearchBehavior.astro
// Behaviour only. The input and the listbox belong to B3's src/components/SearchBox.astro;
// this file never renders either one, and never a second search field (seam S5).
---

<style is:global>
  [data-search-status],
  [data-search-rescue] {
    margin: 0.25rem 0 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.75rem;
    color: var(--color-n-11);
  }
  [data-search-rescue][hidden] { display: none; }
</style>

<script>
  import {
    loadRescueIndex, rescueDecision, suggestRescue, type RescueSuggestion,
  } from '../lib/rescue.ts';
  import {
    activeDescendantId, comboboxReducer, INITIAL_COMBOBOX_STATE, type ComboboxState,
  } from '../lib/combobox.ts';
  import { createDebouncedAnnouncer } from '../lib/announce.ts';
  import { PAGEFIND_BUNDLE_PATH } from '../lib/facets.ts';
  import { withBase } from '../lib/link.ts';
  import { t } from '../lib/i18n/index.ts';
  import type { Lang } from '../types.ts';

  interface PagefindModule {
    debouncedSearch(term: string, wait: number): Promise<{ results: unknown[] } | null>;
  }

  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const listboxId = input?.getAttribute('aria-controls') ?? '';
  const listbox = listboxId ? document.getElementById(listboxId) : null;

  if (input && listbox) {
    const lang: Lang = document.documentElement.lang.startsWith('pt') ? 'pt' : 'en';

    // Two regions nothing else renders. Created here so B3's markup stays a plain combobox.
    const status = document.createElement('p');
    status.id = `${listboxId}-status`;
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    status.setAttribute('data-search-status', '');

    const rescueBox = document.createElement('p');
    rescueBox.id = `${listboxId}-rescue`;
    rescueBox.hidden = true;
    rescueBox.setAttribute('data-search-rescue', '');

    listbox.insertAdjacentElement('afterend', rescueBox);
    listbox.insertAdjacentElement('afterend', status);
    input.setAttribute('aria-describedby', status.id);
    listbox.hidden = true;

    let state: ComboboxState = INITIAL_COMBOBOX_STATE;
    let suggestions: RescueSuggestion[] = [];

    const announcer = createDebouncedAnnouncer((message) => {
      status.textContent = message;
    }, 300);

    let rescuePromise: Promise<ReturnType<typeof loadRescueIndex> | null> | null = null;
    function ensureRescue() {
      if (!rescuePromise) {
        rescuePromise = fetch(withBase(`/rescue-index/${lang}.json`))
          .then((response) => (response.ok ? response.text() : null))
          .then((text) => (text ? loadRescueIndex(text) : null))
          .catch(() => null);
      }
      return rescuePromise;
    }

    let pagefindPromise: Promise<PagefindModule | null> | null = null;
    function ensurePagefind(): Promise<PagefindModule | null> {
      if (!pagefindPromise) {
        pagefindPromise = import(/* @vite-ignore */ PAGEFIND_BUNDLE_PATH)
          .then((mod) => mod as PagefindModule)
          .catch(() => null);
      }
      return pagefindPromise;
    }

    function countMessage(count: number): string {
      if (count === 0) return t('search.noResults', lang);
      const noun = count === 1 ? t('search.resultOne', lang) : t('search.resultMany', lang);
      return `${count} ${noun}`;
    }

    function syncAria(): void {
      listbox.hidden = !state.open;
      input.setAttribute('aria-expanded', String(state.open));
      const active = activeDescendantId(listboxId, state);
      if (active) input.setAttribute('aria-activedescendant', active);
      else input.removeAttribute('aria-activedescendant');
      Array.from(listbox.children).forEach((child, i) => {
        child.setAttribute('aria-selected', String(i === state.activeIndex));
        if (i === state.activeIndex) child.scrollIntoView({ block: 'nearest' });
      });
    }

    function activate(index: number): void {
      const target = suggestions[index];
      if (target) window.location.href = withBase(target.path);
    }

    function renderOptions(): void {
      listbox.replaceChildren();
      suggestions.forEach((suggestion, i) => {
        const option = document.createElement('li');
        option.id = `${listboxId}-opt-${i}`;
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.textContent = suggestion.name;
        option.addEventListener('mousedown', (event) => {
          event.preventDefault();
          const transition = comboboxReducer(state, { type: 'select', index: i });
          state = transition.state;
          syncAria();
          activate(transition.index);
        });
        listbox.append(option);
      });
      syncAria();
    }

    function renderRescue(count: number): void {
      const decision = rescueDecision(count, suggestions);
      rescueBox.replaceChildren();
      rescueBox.hidden = !decision.show;
      if (!decision.show || !decision.top) return;
      rescueBox.append(document.createTextNode(`${t('search.didYouMean', lang)} `));
      const link = document.createElement('a');
      link.href = withBase(decision.top.path);
      link.textContent = decision.top.name;
      rescueBox.append(link);
    }

    async function runSearch(query: string): Promise<void> {
      if (query.trim().length < 2) {
        announcer.cancel();
        status.textContent = '';
        rescueBox.hidden = true;
        return;
      }
      const pagefind = await ensurePagefind();
      if (!pagefind) {
        renderRescue(0);
        return;
      }
      const outcome = await pagefind.debouncedSearch(query, 300);
      if (outcome === null) return;
      const count = outcome.results.length;
      announcer.announce(countMessage(count));
      renderRescue(count);
    }

    input.addEventListener('input', async () => {
      const query = input.value;
      const index = await ensureRescue();
      suggestions = index ? suggestRescue(index, query, 7) : [];
      state = comboboxReducer(state, { type: 'results', optionCount: suggestions.length }).state;
      renderOptions();
      await runSearch(query);
    });

    input.addEventListener('keydown', (event) => {
      const key = event.key;
      if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Enter' && key !== 'Escape') return;
      if (key === 'ArrowDown' || key === 'ArrowUp') event.preventDefault();

      const transition = comboboxReducer(state, { type: 'key', key });
      state = transition.state;
      syncAria();

      // 'submit' is deliberately not handled here: B3's catalog script owns the raw query.
      if (transition.action === 'activate') {
        event.preventDefault();
        activate(transition.index);
      }
      if (transition.action === 'dismiss') {
        input.value = '';
        suggestions = [];
        renderOptions();
        announcer.cancel();
        status.textContent = '';
        rescueBox.hidden = true;
      }
    });

    input.addEventListener('blur', () => {
      state = comboboxReducer(state, { type: 'blur' }).state;
      syncAria();
    });
  }
</script>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/components/search-behavior.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**
```bash
git add src/components/SearchBehavior.astro tests/components/search-behavior.test.ts
git commit -m "feat(search): autocomplete, keyboard nav and did-you-mean over B3's combobox"
```

---

### Task B5.10: Move focus to the results heading

Spec §10.5: after "clear all filters", focus moves to the results heading. Otherwise focus sits on a button whose surrounding context just changed entirely, and a screen-reader user has no idea the list was rebuilt. Seam S4: that heading is B3's `#results-heading`; `id="results"` is the `<main>` skip-link target in B1's layout.

**Files:**
- Create: `src/lib/focus.ts`
- Test: `tests/lib/focus.test.ts`

**Interfaces:**
- Produces: `interface FocusableTarget { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void; focus(): void }`; `moveFocusToResults(target: FocusableTarget | null): boolean`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/focus.test.ts
import { describe, it, expect, vi } from 'vitest';
import { moveFocusToResults, type FocusableTarget } from '../../src/lib/focus.ts';

function stub(initialTabindex: string | null = null) {
  const attrs = new Map<string, string>();
  if (initialTabindex !== null) attrs.set('tabindex', initialTabindex);
  const focus = vi.fn();
  const target: FocusableTarget = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    focus,
  };
  return { target, attrs, focus };
}

describe('moveFocusToResults', () => {
  it('makes a plain heading programmatically focusable and focuses it', () => {
    const { target, attrs, focus } = stub();
    expect(moveFocusToResults(target)).toBe(true);
    expect(attrs.get('tabindex')).toBe('-1');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('never overwrites an author-supplied tabindex', () => {
    const { target, attrs, focus } = stub('0');
    moveFocusToResults(target);
    expect(attrs.get('tabindex')).toBe('0');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('reports failure instead of throwing when the heading is missing', () => {
    expect(moveFocusToResults(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/focus.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/focus.ts (resolved id: ../../src/lib/focus.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/focus.ts

/** The slice of Element this module needs, so the logic is testable without a DOM. */
export interface FocusableTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  focus(): void;
}

/**
 * Moves focus to the results heading after a destructive filter change.
 * Returns false when the heading is absent so the caller can fail loudly.
 */
export function moveFocusToResults(target: FocusableTarget | null): boolean {
  if (!target) return false;
  if (target.getAttribute('tabindex') === null) target.setAttribute('tabindex', '-1');
  target.focus();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/focus.test.ts`
Expected: PASS — 3 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/focus.ts tests/lib/focus.test.ts
git commit -m "feat(a11y): move focus to the results heading after clear-all"
```

---

### Task B5.11: Sticky header offset value

WCAG 2.2 **2.4.11 Focus Not Obscured**. The `scroll-margin-top` must equal the header's real height, and that height changes with the viewport and with the header's contents — so it is measured at runtime and published as `--header-h`, the custom property B3's catalog already consumes as `var(--header-h, 3.5rem)`.

**Files:**
- Create: `src/lib/stickyOffset.ts`
- Test: `tests/lib/stickyOffset.test.ts`

**Interfaces:**
- Produces: `HEADER_OFFSET_PROPERTY = '--header-h'`; `syncHeaderOffset(headerHeight: number, setProperty: (name: string, value: string) => void, minPx?: number): number`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/stickyOffset.test.ts
import { describe, it, expect, vi } from 'vitest';
import { HEADER_OFFSET_PROPERTY, syncHeaderOffset } from '../../src/lib/stickyOffset.ts';

describe('syncHeaderOffset', () => {
  it('publishes the measured header height in pixels', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(96.4, setProperty)).toBe(96);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '96px');
  });

  it('uses the property name the catalog already reads', () => {
    expect(HEADER_OFFSET_PROPERTY).toBe('--header-h');
  });

  it('never publishes an offset below the floor', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(0, setProperty)).toBe(48);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '48px');
  });

  it('falls back to the floor for an unmeasurable header', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(Number.NaN, setProperty)).toBe(48);
    expect(syncHeaderOffset(Number.POSITIVE_INFINITY, setProperty)).toBe(48);
  });

  it('honours a custom floor', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(10, setProperty, 72)).toBe(72);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '72px');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/stickyOffset.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/stickyOffset.ts (resolved id: ../../src/lib/stickyOffset.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/stickyOffset.ts

/** WCAG 2.2 2.4.11: scroll targets clear the sticky header by exactly this much. */
export const HEADER_OFFSET_PROPERTY = '--header-h';

export function syncHeaderOffset(
  headerHeight: number,
  setProperty: (name: string, value: string) => void,
  minPx = 48,
): number {
  const measured = Number.isFinite(headerHeight) ? Math.round(headerHeight) : 0;
  const value = Math.max(minPx, measured);
  setProperty(HEADER_OFFSET_PROPERTY, `${value}px`);
  return value;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/stickyOffset.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/stickyOffset.ts tests/lib/stickyOffset.test.ts
git commit -m "feat(a11y): publish measured sticky header height as --header-h"
```

---

### Task B5.12: A11yBehavior — clear-all focus, header measurement, scroll offset

One behaviour component, included once by the layout (Task B5.18). It listens for `[data-clear-all]` by event delegation, so B3's facet rail needs no change. Its `<style is:global>` block carries the pre-JS `--header-h` fallback and the `scroll-margin-top` rule, so **`src/styles/theme.css` (A2) is never touched**. `:where([id])` has zero specificity, so it reaches every anchorable element without ever beating a rule that needs to win. The header is located as `body > header`, which B1's layout renders, and the focus target is B3's results heading `#results-heading` (seam S4 — `id="results"` is the `<main>` skip-link target and must not be stolen).

**Files:**
- Create: `src/components/A11yBehavior.astro`
- Test: `tests/components/a11y-behavior.test.ts`

**Interfaces:**
- Consumes: `moveFocusToResults` from `src/lib/focus.ts`; `syncHeaderOffset` from `src/lib/stickyOffset.ts`; the `[data-clear-all]` control B3's facet rail renders; the `id="results-heading"` heading B3's catalog renders
- Produces: `src/components/A11yBehavior.astro` (no props); the global `--header-h` fallback, the sticky `body > header` rule and the `scroll-margin-top` rule

- [ ] **Step 1: Write the failing test**
```ts
// tests/components/a11y-behavior.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const FILE = 'src/components/A11yBehavior.astro';

function source(): string {
  if (!existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  return readFileSync(FILE, 'utf8');
}

describe('A11yBehavior', () => {
  it('imports both helpers with explicit .ts extensions', () => {
    const text = source();
    expect(text).toContain("from '../lib/focus.ts'");
    expect(text).toContain("from '../lib/stickyOffset.ts'");
  });

  it('delegates on the clear-all control and targets B3 results heading', () => {
    const text = source();
    expect(text).toContain('[data-clear-all]');
    expect(text).toContain('#results-heading');
  });

  it('never steals the skip-link target the layout owns', () => {
    expect(source(), '#results is B1 main element').not.toMatch(/['"]#results['"]/);
  });

  it('measures the site header without requiring a new hook on the layout', () => {
    expect(source()).toContain("querySelector<HTMLElement>('body > header')");
  });

  it('ships the pre-JS --header-h fallback and the scroll offset rule globally', () => {
    const text = source();
    expect(text).toContain('is:global');
    expect(text).toContain('--header-h: 56px');
    expect(text).toMatch(/:where\(\[id\]\)\s*\{\s*scroll-margin-top:\s*calc\(var\(--header-h\)/);
    expect(text).toMatch(/body\s*>\s*header\s*\{[^}]*position:\s*sticky/);
  });

  it('never reaches for the hazard token, which the safety module owns alone', () => {
    expect(source()).not.toContain('--color-hazard');
  });

  it('renders no visible markup of its own', () => {
    expect(source()).not.toMatch(/<div|<section|<nav|<p /);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/components/a11y-behavior.test.ts`
Expected: FAIL — `Error: Missing src/components/A11yBehavior.astro`

- [ ] **Step 3: Write the component**
```astro
---
// src/components/A11yBehavior.astro
// Behaviour and global scroll offset only: no visible markup. Included once by Layout.astro.
---

<style is:global>
  /* --- WCAG 2.2 2.4.11 Focus Not Obscured ----------------------------------
     The script below overwrites --header-h with the header's measured height.
     The literal here is the pre-JS fallback, never the source of truth.      */
  :root { --header-h: 56px; }

  body > header { position: sticky; top: 0; z-index: 50; }

  :where([id]) { scroll-margin-top: calc(var(--header-h) + 0.5rem); }
</style>

<script>
  import { moveFocusToResults } from '../lib/focus.ts';
  import { syncHeaderOffset } from '../lib/stickyOffset.ts';

  const header = document.querySelector<HTMLElement>('body > header');

  function applyHeaderOffset(): void {
    if (!header) return;
    syncHeaderOffset(header.getBoundingClientRect().height, (name, value) => {
      document.documentElement.style.setProperty(name, value);
    });
  }

  applyHeaderOffset();

  if (header && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(applyHeaderOffset).observe(header);
  }
  window.addEventListener('resize', applyHeaderOffset);

  document.addEventListener('click', (event) => {
    const origin = event.target;
    if (!(origin instanceof Element) || !origin.closest('[data-clear-all]')) return;
    const heading = document.querySelector<HTMLElement>('#results-heading');
    if (!moveFocusToResults(heading)) {
      console.warn('[a11y] no #results-heading element: focus was not moved after clear-all');
    }
  });
</script>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/components/a11y-behavior.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**
```bash
git add src/components/A11yBehavior.astro tests/components/a11y-behavior.test.ts
git commit -m "feat(a11y): clear-all focus, live header measurement and scroll offset"
```

---

### Task B5.13: Staleness evaluation — crawl date and classification lag, separately

Spec §6.1 and §13: harvest runs on a schedule that needs nobody watching — a local systemd timer every 4 h, backed by a weekly `crawl.yml` fallback so the machine being off for days cannot silence it — while classification runs on the maintainer's scheduled Claude session. They rot independently, so a single "last updated" number would be a lie. This module never combines them.

Seam S12: there is exactly one staleness line on the site — `STALE_DAYS` in `src/lib/format.ts` (B1) — and both rows are graded against it. Nothing here hardcodes a day count.

**Files:**
- Create: `src/lib/staleness.ts`
- Test: `tests/lib/staleness.test.ts`

**Interfaces:**
- Consumes: the shape of `data/meta.json` — `{ crawledAt: string; classifiedAt: string | null; skillCount: number; sourceCount: number }`; `STALE_DAYS` from `src/lib/format.ts` (B1)
- Produces: `interface SiteMeta`; `type FreshnessState = 'fresh' | 'warn' | 'stale' | 'unknown'`; `interface FreshnessRow { state: FreshnessState; days: number | null; iso: string | null }`; `interface StalenessReport { crawl: FreshnessRow; classification: FreshnessRow; lagDays: number | null; skillCount: number; sourceCount: number }`; `CRAWL_WARN_DAYS`, `CRAWL_STALE_DAYS`, `CLASSIFICATION_WARN_DAYS`, `CLASSIFICATION_STALE_DAYS`; `parseMeta(raw: unknown): SiteMeta | null`; `evaluateStaleness(meta: SiteMeta | null, now: Date): StalenessReport`

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/staleness.test.ts
import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION_STALE_DAYS, CLASSIFICATION_WARN_DAYS,
  CRAWL_STALE_DAYS, CRAWL_WARN_DAYS,
  evaluateStaleness, parseMeta, type SiteMeta,
} from '../../src/lib/staleness.ts';
import { STALE_DAYS } from '../../src/lib/format.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function meta(over: Partial<SiteMeta> = {}): SiteMeta {
  return { crawledAt: daysAgo(1), classifiedAt: daysAgo(2), skillCount: 812, sourceCount: 74, ...over };
}

describe('thresholds', () => {
  it('grades both rows against the one staleness line B1 publishes', () => {
    expect(CRAWL_STALE_DAYS, 'the site has one staleness line: STALE_DAYS').toBe(STALE_DAYS);
    expect(CLASSIFICATION_STALE_DAYS).toBe(STALE_DAYS);
    expect(CRAWL_WARN_DAYS).toBe(Math.floor(STALE_DAYS / 2));
    expect(CLASSIFICATION_WARN_DAYS).toBe(Math.floor(STALE_DAYS / 2));
  });
});

describe('parseMeta', () => {
  it('accepts the documented shape, including a null classifiedAt', () => {
    expect(parseMeta(meta())).not.toBeNull();
    expect(parseMeta(meta({ classifiedAt: null }))?.classifiedAt).toBeNull();
  });

  it('rejects anything it cannot trust', () => {
    expect(parseMeta(null)).toBeNull();
    expect(parseMeta('2026-08-29')).toBeNull();
    expect(parseMeta({})).toBeNull();
    expect(parseMeta({ ...meta(), crawledAt: 'not a date' })).toBeNull();
    expect(parseMeta({ ...meta(), skillCount: 'many' })).toBeNull();
    expect(parseMeta({ ...meta(), classifiedAt: 42 })).toBeNull();
  });
});

describe('evaluateStaleness', () => {
  it('reports the crawl and the classification as two independent rows', () => {
    const rotted = CLASSIFICATION_STALE_DAYS + 5;
    const report = evaluateStaleness(meta({ crawledAt: daysAgo(1), classifiedAt: daysAgo(rotted) }), NOW);
    expect(report.crawl.state).toBe('fresh');
    expect(report.crawl.days).toBe(1);
    expect(report.classification.state).toBe('stale');
    expect(report.classification.days).toBe(rotted);
  });

  it('grades the crawl on its own date', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_WARN_DAYS - 1) }), NOW).crawl.state).toBe('fresh');
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_WARN_DAYS + 1) }), NOW).crawl.state).toBe('warn');
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_STALE_DAYS + 1) }), NOW).crawl.state).toBe('stale');
  });

  it('grades the classification on its own date', () => {
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(1) }), NOW).classification.state).toBe('fresh');
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(CLASSIFICATION_WARN_DAYS + 1) }), NOW).classification.state).toBe('warn');
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(CLASSIFICATION_STALE_DAYS + 1) }), NOW).classification.state).toBe('stale');
  });

  it('computes the lag as how far classification trails the crawl', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(1), classifiedAt: daysAgo(22) }), NOW).lagDays).toBe(21);
  });

  it('never reports a negative lag when classification ran after the crawl', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(5), classifiedAt: daysAgo(1) }), NOW).lagDays).toBe(0);
  });

  it('says "never run" rather than pretending, when classification has not happened', () => {
    const report = evaluateStaleness(meta({ classifiedAt: null }), NOW);
    expect(report.classification.state).toBe('unknown');
    expect(report.classification.days).toBeNull();
    expect(report.classification.iso).toBeNull();
    expect(report.lagDays).toBeNull();
  });

  it('degrades to unknown on both rows when meta is unreadable', () => {
    const report = evaluateStaleness(null, NOW);
    expect(report.crawl.state).toBe('unknown');
    expect(report.classification.state).toBe('unknown');
    expect(report.lagDays).toBeNull();
    expect(report.skillCount).toBe(0);
  });

  it('carries the counts through for the stats strip', () => {
    const report = evaluateStaleness(meta(), NOW);
    expect(report.skillCount).toBe(812);
    expect(report.sourceCount).toBe(74);
  });

  it('clamps a future crawl date to zero days rather than going negative', () => {
    const future = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    expect(evaluateStaleness(meta({ crawledAt: future }), NOW).crawl.days).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/staleness.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/staleness.ts (resolved id: ../../src/lib/staleness.ts). Does the file exist?`

- [ ] **Step 3: Write minimal implementation**
```ts
// src/lib/staleness.ts
import { STALE_DAYS } from './format.ts';

/** Shape of data/meta.json. Written by the harvest run and by the classification PR. */
export interface SiteMeta {
  crawledAt: string;
  classifiedAt: string | null;
  skillCount: number;
  sourceCount: number;
}

export type FreshnessState = 'fresh' | 'warn' | 'stale' | 'unknown';

export interface FreshnessRow {
  state: FreshnessState;
  days: number | null;
  iso: string | null;
}

export interface StalenessReport {
  crawl: FreshnessRow;
  classification: FreshnessRow;
  /** How many days classification trails the crawl. Null when it never ran. */
  lagDays: number | null;
  skillCount: number;
  sourceCount: number;
}

/**
 * The site publishes exactly one staleness line — STALE_DAYS in src/lib/format.ts (B1) — and both
 * rows are graded against it, each on its own date. The rows still rot independently and are never
 * merged into a single "last updated" figure.
 */
export const CRAWL_STALE_DAYS = STALE_DAYS;
export const CLASSIFICATION_STALE_DAYS = STALE_DAYS;

/** Warn at half the published line. */
export const CRAWL_WARN_DAYS = Math.floor(STALE_DAYS / 2);
export const CLASSIFICATION_WARN_DAYS = Math.floor(STALE_DAYS / 2);

const DAY_MS = 86_400_000;
const UNKNOWN: FreshnessRow = { state: 'unknown', days: null, iso: null };

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function parseMeta(raw: unknown): SiteMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isIsoDate(record.crawledAt)) return null;
  if (record.classifiedAt !== null && !isIsoDate(record.classifiedAt)) return null;
  if (!Number.isFinite(record.skillCount) || !Number.isFinite(record.sourceCount)) return null;
  return {
    crawledAt: record.crawledAt,
    classifiedAt: (record.classifiedAt as string | null) ?? null,
    skillCount: record.skillCount as number,
    sourceCount: record.sourceCount as number,
  };
}

function wholeDaysBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / DAY_MS));
}

function grade(days: number, warnAt: number, staleAt: number): FreshnessState {
  if (days >= staleAt) return 'stale';
  if (days >= warnAt) return 'warn';
  return 'fresh';
}

/**
 * Crawl date and classification lag are reported separately and never merged.
 * Harvest keeps running on the weekly Action even when the maintainer's machine is off;
 * classification does not (§6.1, §13).
 */
export function evaluateStaleness(meta: SiteMeta | null, now: Date): StalenessReport {
  if (!meta) {
    return { crawl: UNKNOWN, classification: UNKNOWN, lagDays: null, skillCount: 0, sourceCount: 0 };
  }

  const nowMs = now.getTime();
  const crawledMs = Date.parse(meta.crawledAt);
  const crawlDays = wholeDaysBetween(nowMs, crawledMs);
  const crawl: FreshnessRow = {
    state: grade(crawlDays, CRAWL_WARN_DAYS, CRAWL_STALE_DAYS),
    days: crawlDays,
    iso: meta.crawledAt,
  };

  if (meta.classifiedAt === null) {
    return {
      crawl,
      classification: UNKNOWN,
      lagDays: null,
      skillCount: meta.skillCount,
      sourceCount: meta.sourceCount,
    };
  }

  const classifiedMs = Date.parse(meta.classifiedAt);
  const classifiedDays = wholeDaysBetween(nowMs, classifiedMs);

  return {
    crawl,
    classification: {
      state: grade(classifiedDays, CLASSIFICATION_WARN_DAYS, CLASSIFICATION_STALE_DAYS),
      days: classifiedDays,
      iso: meta.classifiedAt,
    },
    lagDays: wholeDaysBetween(crawledMs, classifiedMs),
    skillCount: meta.skillCount,
    sourceCount: meta.sourceCount,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/staleness.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/staleness.ts tests/lib/staleness.test.ts
git commit -m "feat(staleness): grade crawl date and classification lag on one published line"
```

---

### Task B5.14: Count the entries queued unclassified

Spec §13: if the maintainer stops, harvest keeps running and new entries queue unclassified, landing in the domain's `general` leaf. The banner has to say how many, or the correct failure mode is invisible. `data/assignments.json` is a flat `Record<skillId, Assignment>` — never an array, never a versioned envelope — so the assigned ids are simply its keys.

**Files:**
- Modify: `src/lib/staleness.ts` (append to the end of the file)
- Modify: `tests/lib/staleness.test.ts` (append a new `describe` block)

**Interfaces:**
- Consumes: `Assignments` — `Record<string, { primary: string; also: string[]; tags: string[] }>` — as returned by `loadAssignments()` in `src/lib/data.ts` (A6)
- Produces: `assignedIdsFrom(assignments: unknown): string[]`; `countUnclassified(skillIds: string[], assignedIds: Iterable<string>): number`

- [ ] **Step 1: Write the failing test**
Append to `tests/lib/staleness.test.ts`:
```ts
import { assignedIdsFrom, countUnclassified } from '../../src/lib/staleness.ts';

describe('assignedIdsFrom', () => {
  it('reads the flat record the classification PR writes', () => {
    const ids = assignedIdsFrom({
      'a/b@sha1234:p/SKILL.md': { primary: 'security/general', also: [], tags: [] },
    });
    expect(ids).toEqual(['a/b@sha1234:p/SKILL.md']);
  });

  it('preserves every key', () => {
    const ids = assignedIdsFrom({
      'a/b@sha1234:p/SKILL.md': { primary: 'security/general', also: [], tags: [] },
      'c/d@sha5678:q/SKILL.md': { primary: 'devops-infra/general', also: [], tags: [] },
    });
    expect(ids.sort()).toEqual(['a/b@sha1234:p/SKILL.md', 'c/d@sha5678:q/SKILL.md']);
  });

  it('returns nothing for unusable input', () => {
    expect(assignedIdsFrom(null)).toEqual([]);
    expect(assignedIdsFrom('assignments')).toEqual([]);
    expect(assignedIdsFrom([1, 2, 3])).toEqual([]);
    expect(assignedIdsFrom({})).toEqual([]);
  });
});

describe('countUnclassified', () => {
  const skillIds = ['one', 'two', 'three', 'four'];

  it('counts harvested skills the classification session has not reached', () => {
    expect(countUnclassified(skillIds, ['one', 'three'])).toBe(2);
  });

  it('is zero when everything is classified', () => {
    expect(countUnclassified(skillIds, skillIds)).toBe(0);
  });

  it('counts everything when classification has never run', () => {
    expect(countUnclassified(skillIds, [])).toBe(4);
  });

  it('ignores assignments for skills that no longer exist', () => {
    expect(countUnclassified(['one'], ['one', 'gone', 'also-gone'])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/staleness.test.ts`
Expected: FAIL — `SyntaxError: The requested module '/src/lib/staleness.ts' does not provide an export named 'assignedIdsFrom'`

- [ ] **Step 3: Write minimal implementation**
Append to `src/lib/staleness.ts`:
```ts
/**
 * Skill ids the classification PR has assigned. data/assignments.json is a flat
 * Record<skillId, Assignment>, so the keys are the ids and nothing else.
 */
export function assignedIdsFrom(assignments: unknown): string[] {
  if (!assignments || typeof assignments !== 'object' || Array.isArray(assignments)) return [];
  return Object.keys(assignments as Record<string, unknown>);
}

/** Harvested skills the scheduled session has not reached; they render in `<domain>/general`. */
export function countUnclassified(skillIds: string[], assignedIds: Iterable<string>): number {
  const assigned = new Set(assignedIds);
  let unclassified = 0;
  for (const id of skillIds) {
    if (!assigned.has(id)) unclassified += 1;
  }
  return unclassified;
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/staleness.test.ts`
Expected: PASS — 19 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/staleness.ts tests/lib/staleness.test.ts
git commit -m "feat(staleness): count entries queued unclassified"
```

---

### Task B5.15: StalenessBanner — two rows that rot independently

Data comes through A6's loaders in `src/lib/data.ts`; this component never parses a data file itself. Hazard orange is **not** used here: Rule 5 reserves `--color-hazard` for the safety strip, stale skill dates and the undeclared-license value. A rotting pipeline is signalled with neutral emphasis, so the hazard colour keeps meaning exactly one thing.

The banner's copy rules are pure and are tested directly; the rendered markup is asserted in Task B5.18, where the layout actually mounts it, so no test depends on whatever `data/meta.json` the last crawl happened to commit.

**Files:**
- Create: `src/components/StalenessBanner.astro`
- Test: `tests/components/staleness-banner.test.ts`

**Interfaces:**
- Consumes: `loadMeta()`, `loadSkills()`, `loadAssignments()` from `src/lib/data.ts` (A6); `parseMeta`, `evaluateStaleness`, `assignedIdsFrom`, `countUnclassified` from `src/lib/staleness.ts`; `relativeDays(days: number, lang: Lang): string` from `src/lib/format.ts` (B1); `t` from `src/lib/i18n/index.ts` (B1); `Lang` from `src/types.ts`
- Produces: `src/components/StalenessBanner.astro` with `Props { lang: Lang; now?: Date }`; hooks `[data-staleness-banner]`, `[data-crawl-state]`, `[data-classification-state]`, `[data-classification-lag]`, `[data-unclassified]`

- [ ] **Step 1: Write the failing test**
```ts
// tests/components/staleness-banner.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateStaleness, parseMeta } from '../../src/lib/staleness.ts';
import { t } from '../../src/lib/i18n/index.ts';

const FILE = 'src/components/StalenessBanner.astro';

function source(): string {
  if (!existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  return readFileSync(FILE, 'utf8');
}

describe('StalenessBanner source', () => {
  it('reads its data through the A6 loaders, never with its own JSON.parse', () => {
    const text = source();
    expect(text).toContain("from '../lib/data.ts'");
    expect(text).not.toContain('JSON.parse');
    expect(text).not.toContain('data/meta.json');
  });

  it('never reaches for the hazard token, which the safety module owns alone', () => {
    expect(source()).not.toContain('--color-hazard');
  });

  it('renders the two rows and the lag in separate elements', () => {
    const text = source();
    expect(text).toContain('data-crawl-state');
    expect(text).toContain('data-classification-state');
    expect(text).toContain('data-classification-lag');
    expect(text).toContain('data-unclassified');
  });
});

describe('the copy the banner shows', () => {
  const NOW = new Date('2026-08-29T12:00:00.000Z');

  it('resolves to "never run" when classification has not happened', () => {
    const report = evaluateStaleness(
      parseMeta({ crawledAt: '2026-08-28T00:00:00.000Z', classifiedAt: null, skillCount: 3, sourceCount: 1 }),
      NOW,
    );
    expect(report.classification.days).toBeNull();
    expect(t('status.neverRun', 'en')).toBe('never run');
    expect(t('status.neverRun', 'pt')).toBe('nunca executada');
  });

  it('labels the lag row in both locales', () => {
    expect(t('status.lag', 'en')).toBe('Classification lag');
    expect(t('status.lag', 'pt')).toBe('Atraso da classificação');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/components/staleness-banner.test.ts`
Expected: FAIL — `Error: Missing src/components/StalenessBanner.astro`

- [ ] **Step 3: Write the component**
```astro
---
// src/components/StalenessBanner.astro
import { loadAssignments, loadMeta, loadSkills } from '../lib/data.ts';
import { assignedIdsFrom, countUnclassified, evaluateStaleness, parseMeta } from '../lib/staleness.ts';
import { relativeDays } from '../lib/format.ts';
import { t } from '../lib/i18n/index.ts';
import type { Lang } from '../types.ts';

interface Props {
  lang: Lang;
  now?: Date;
}

const { lang, now = new Date() } = Astro.props;

const report = evaluateStaleness(parseMeta(loadMeta()), now);
const unclassified = countUnclassified(
  loadSkills().map((skill) => skill.id),
  assignedIdsFrom(loadAssignments()),
);

const crawlText =
  report.crawl.days === null ? t('status.unknown', lang) : relativeDays(report.crawl.days, lang);
const classificationText =
  report.classification.days === null
    ? t('status.neverRun', lang)
    : relativeDays(report.classification.days, lang);
const lagText =
  report.lagDays === null ? t('status.unknown', lang) : relativeDays(report.lagDays, lang);
---

<div class="status" data-staleness-banner aria-label={t('status.heading', lang)}>
  <p class="status__row" data-crawl-state={report.crawl.state}>
    <span class="status__label">{t('status.crawled', lang)}</span>
    <time datetime={report.crawl.iso ?? ''}>{crawlText}</time>
  </p>

  <p class="status__row" data-classification-state={report.classification.state}>
    <span class="status__label">{t('status.classified', lang)}</span>
    <time datetime={report.classification.iso ?? ''}>{classificationText}</time>
    <span data-classification-lag>{t('status.lag', lang)}: {lagText}</span>
  </p>

  {unclassified > 0 && (
    <p class="status__row" data-unclassified={String(unclassified)}>
      {unclassified} {t('status.queued', lang)}
    </p>
  )}
</div>

<style>
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.25rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }
  .status__row { margin: 0; display: flex; gap: 0.5rem; color: var(--color-n-11); }
  .status__label { color: var(--color-n-11); }
  /* Neutral emphasis, never hazard orange: the hazard token means "this touches your
     machine" and nothing else (spec §9.2, Rule 5). */
  [data-crawl-state='warn'] time,
  [data-classification-state='warn'] time,
  [data-crawl-state='unknown'] time,
  [data-classification-state='unknown'] time {
    color: var(--color-n-12);
  }
  [data-crawl-state='stale'] time,
  [data-classification-state='stale'] time {
    color: var(--color-n-12);
    font-weight: 600;
    text-decoration: underline;
    text-underline-offset: 0.2em;
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/components/staleness-banner.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**
```bash
git add src/components/StalenessBanner.astro tests/components/staleness-banner.test.ts
git commit -m "feat(staleness): banner reporting crawl date and classification lag separately"
```

---

### Task B5.16: i18n namespace for the methodology page

Spec §10.6 and §8: the methodology page is our own editorial text, hand-written in both locales and never machine-translated. It lives in its own namespace so no other section can collide with it.

**Files:**
- Create: `src/lib/i18n/methodology.ts`
- Test: `tests/lib/i18n-methodology.test.ts`

**Interfaces:**
- Consumes: `Lang` from `src/types.ts`; `t` from `src/lib/i18n/index.ts` (B1)
- Produces: default export `Record<Lang, Record<string, string>>` covering the six §10.6 sections

- [ ] **Step 1: Write the failing test**
```ts
// tests/lib/i18n-methodology.test.ts
import { describe, it, expect } from 'vitest';
import methodology from '../../src/lib/i18n/methodology.ts';
import { t } from '../../src/lib/i18n/index.ts';

const SECTIONS = ['score', 'inclusion', 'safety', 'counting', 'taxonomy', 'provenance'];

describe('methodology namespace', () => {
  it('has identical key sets in both locales', () => {
    expect(Object.keys(methodology.pt).sort()).toEqual(Object.keys(methodology.en).sort());
  });

  it('carries a heading for each of the six sections spec §10.6 requires', () => {
    for (const section of SECTIONS) {
      expect(methodology.en[`methodology.${section}.heading`], section).toBeTruthy();
      expect(methodology.pt[`methodology.${section}.heading`], section).toBeTruthy();
    }
  });

  it('never ships an empty string', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const [key, value] of Object.entries(methodology[lang])) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('');
      }
    }
  });

  it('is hand-written, not an English echo', () => {
    let identical = 0;
    for (const key of Object.keys(methodology.en)) {
      if (methodology.pt[key] === methodology.en[key]) identical += 1;
    }
    expect(identical, 'too many pt-BR values are byte-identical to English').toBeLessThan(3);
  });

  it('reaches t() through the merged index', () => {
    expect(
      t('methodology.score.heading', 'pt'),
      'src/lib/i18n/index.ts is not merging src/lib/i18n/methodology.ts',
    ).not.toBe('methodology.score.heading');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/lib/i18n-methodology.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/i18n/methodology.ts (resolved id: ../../src/lib/i18n/methodology.ts). Does the file exist?`

- [ ] **Step 3: Write the namespace**
```ts
// src/lib/i18n/methodology.ts
import type { Lang } from '../../types.ts';

/** Spec §10.6. Our own editorial text, hand-written in both locales — never machine-translated. */
const en = {
  'methodology.title': 'Methodology',
  'methodology.intro':
    'Every rule this catalog applies is written down here. The order is reproducible: run the formula yourself and you get the same ranking.',

  'methodology.score.heading': 'Score',
  'methodology.score.formulaLabel': 'The formula',
  'methodology.score.adoption':
    'Adoption, 25 points. log10 of the repository star count, normalised. This is a repo-level signal and is labelled as such wherever it appears.',
  'methodology.score.maintenance':
    'Maintenance, 30 points. Exponential decay on days since the last commit that touched this skill path, with a 90-day half-life. Per skill, not per repo.',
  'methodology.score.provenance':
    'Provenance, 25 points. Listed in a curated marketplace adds 12, an organisation account adds 8, a declared license adds 5.',
  'methodology.score.completeness':
    'Completeness, 20 points. Spec-conformant frontmatter adds 9, a resolvable license adds 6, a real description adds 5.',
  'methodology.score.balance':
    'Per-skill signals outweigh repo-level ones, 55 to 45. Ranking by stars alone would put every entry from one large repository in the top twenty with identical scores — a ranking of repositories wearing a skill name.',
  'methodology.score.noSafety':
    'Safety is deliberately not an input. Executing code is a fact, not a fault, and scoring it would hide a judgment inside a number. Safety stays descriptive and filterable.',
  'methodology.score.noOverride':
    'There is no editorial override: no manual pinning, no burying. When the ranking is wrong we fix the formula, not the result.',

  'methodology.inclusion.heading': 'Inclusion filter',
  'methodology.inclusion.body':
    'Recall is easy and worthless; precision is the hard part. The filter answers one question: is this meant to be reused by strangers?',
  'methodology.inclusion.r1':
    'It lives in a skills-dedicated repository, or is referenced by a .claude-plugin/marketplace.json.',
  'methodology.inclusion.r2': 'The repository has a README.',
  'methodology.inclusion.r3': 'The description is non-trivial and not specific to its own repository.',
  'methodology.inclusion.r4':
    'It is not under .claude/skills/ — that path is a project-local convention, not a published artifact.',
  'methodology.inclusion.r5': 'It has at least 10 stars, or it belongs to an organisation account.',
  'methodology.inclusion.r6':
    'One entry per publisher per concept, so a single monorepo with hundreds of paths cannot swamp a category.',

  'methodology.safety.heading': 'Safety surface',
  'methodology.safety.body':
    'Every safety fact is derived from the repository contents, never read from a self-declaration in frontmatter. An author who says "no network" and ships a curl call is described accurately here.',
  'methodology.safety.executes':
    'Executes code: the skill directory contains executable script files. We report how many and in which languages.',
  'methodology.safety.network':
    'Network: a script reaches an outbound host. Detected in the script text, not declared.',
  'methodology.safety.env':
    'Reads environment: a script reads process environment variables, which is where credentials usually live.',
  'methodology.safety.noGreen':
    'There is never a green "safe" badge. With a large share of audited skills carrying real flaws, a wrong green badge is a liability. Rows are descriptive, and this ruleset is published.',

  'methodology.counting.heading': 'Counting',
  'methodology.counting.symlinks': 'Symlinks are skipped, so one file linked from five places is counted once.',
  'methodology.counting.dedupe':
    'Entries are deduplicated by git blob SHA, so identical content vendored into several repositories is counted once.',
  'methodology.counting.excluded':
    'Anything under .claude/skills/ is excluded from the count as well as from the catalog.',
  'methodology.counting.dated':
    'Headline counts are always shown with the crawl date that produced them. A number without a date is not reproducible.',

  'methodology.taxonomy.heading': 'Taxonomy',
  'methodology.taxonomy.namingRule':
    'Node names translate the language, never the technical term. A term practitioners say in English in both locales stays in English.',
  'methodology.taxonomy.protectedLabel': 'Protected terms',
  'methodology.taxonomy.protectedNote':
    'These are identical in both locales, and parity is enforced in CI rather than trusted to a translator.',
  'methodology.taxonomy.aliasesLabel': 'Aliases',
  'methodology.taxonomy.aliasesNote':
    'Short forms nobody puts in a label, mapped to the node they resolve to, so search finds them.',
  'methodology.taxonomy.minimumMassLabel': 'Minimum mass',
  'methodology.taxonomy.minimumMassNote':
    'A category with fewer entries than this is shown dimmed and is not clickable. Clicking into an empty dead end is what every awesome-list feels like from the inside.',

  'methodology.provenance.heading': 'Provenance and freshness',
  'methodology.provenance.id':
    'the repository, the exact commit the content was read at, and the file path inside it. Nothing is quoted from a branch name.',
  'methodology.provenance.sourcesLabel': 'Indexed corpus',
  'methodology.provenance.freshnessLabel': 'Freshness',
  'methodology.provenance.freshnessNote':
    'The crawl and the classification pass run on separate schedules and rot independently, so they are always reported as two numbers. A single "last updated" figure would be a lie.',
  'methodology.provenance.skillsLabel': 'Skills indexed',
  'methodology.provenance.sourceCountLabel': 'Source repositories',
  'methodology.provenance.crawledLabel': 'Last crawl',
  'methodology.provenance.classifiedLabel': 'Last classification',
  'methodology.provenance.never': 'never run',
} as const;

const pt: Record<keyof typeof en, string> = {
  'methodology.title': 'Metodologia',
  'methodology.intro':
    'Toda regra que este catálogo aplica está escrita aqui. A ordem é reproduzível: rode a fórmula você mesmo e obtém a mesma classificação.',

  'methodology.score.heading': 'Pontuação',
  'methodology.score.formulaLabel': 'A fórmula',
  'methodology.score.adoption':
    'Adoção, 25 pontos. log10 do número de estrelas do repositório, normalizado. É um sinal de repositório, e aparece rotulado como tal em todo lugar.',
  'methodology.score.maintenance':
    'Manutenção, 30 pontos. Decaimento exponencial sobre os dias desde o último commit que tocou o caminho desta skill, com meia-vida de 90 dias. Por skill, não por repositório.',
  'methodology.score.provenance':
    'Procedência, 25 pontos. Estar em um marketplace curado soma 12, conta de organização soma 8, licença declarada soma 5.',
  'methodology.score.completeness':
    'Completude, 20 pontos. Frontmatter conforme a especificação soma 9, licença resolvível soma 6, descrição real soma 5.',
  'methodology.score.balance':
    'Sinais por skill pesam mais que sinais de repositório, 55 contra 45. Ordenar só por estrelas colocaria todas as entradas de um repositório grande nas vinte primeiras posições com pontuação idêntica — uma lista de repositórios usando o nome de uma skill.',
  'methodology.score.noSafety':
    'Segurança de execução não entra na pontuação, de propósito. Executar código é um fato, não um defeito, e pontuá-lo esconderia um julgamento dentro de um número. Isso continua descritivo e filtrável.',
  'methodology.score.noOverride':
    'Não existe override editorial: nada é fixado nem enterrado à mão. Quando a ordem está errada, corrigimos a fórmula, não o resultado.',

  'methodology.inclusion.heading': 'Filtro de inclusão',
  'methodology.inclusion.body':
    'Abrangência é fácil e não vale nada; precisão é a parte difícil. O filtro responde a uma pergunta: isto foi feito para ser reaproveitado por desconhecidos?',
  'methodology.inclusion.r1':
    'Está em um repositório dedicado a skills, ou é referenciado por um .claude-plugin/marketplace.json.',
  'methodology.inclusion.r2': 'O repositório tem README.',
  'methodology.inclusion.r3': 'A descrição não é trivial nem específica do próprio repositório.',
  'methodology.inclusion.r4':
    'Não está sob .claude/skills/ — esse caminho é convenção local de projeto, não artefato publicado.',
  'methodology.inclusion.r5': 'Tem pelo menos 10 estrelas, ou pertence a uma conta de organização.',
  'methodology.inclusion.r6':
    'Uma entrada por publicador por conceito, para que um único monorepo com centenas de caminhos não domine uma categoria.',

  'methodology.safety.heading': 'Superfície de risco',
  'methodology.safety.body':
    'Todo fato de risco é derivado do conteúdo do repositório, nunca lido de uma autodeclaração no frontmatter. Quem escreve "sem rede" e entrega uma chamada curl aparece descrito com precisão aqui.',
  'methodology.safety.executes':
    'Executa código: o diretório da skill contém arquivos de script executáveis. Informamos quantos e em quais linguagens.',
  'methodology.safety.network':
    'Rede: algum script alcança um host externo. Detectado no texto do script, não declarado.',
  'methodology.safety.env':
    'Lê o ambiente: algum script lê variáveis de ambiente, que é onde credenciais costumam estar.',
  'methodology.safety.noGreen':
    'Nunca existe selo verde de "seguro". Com boa parte das skills auditadas carregando falhas reais, um selo verde errado é responsabilidade nossa. As linhas são descritivas, e este conjunto de regras é público.',

  'methodology.counting.heading': 'Contagem',
  'methodology.counting.symlinks': 'Symlinks são ignorados, então um arquivo apontado de cinco lugares conta uma vez.',
  'methodology.counting.dedupe':
    'Entradas são deduplicadas pelo SHA do blob git, então conteúdo idêntico copiado para vários repositórios conta uma vez.',
  'methodology.counting.excluded': 'Tudo sob .claude/skills/ fica de fora da contagem e do catálogo.',
  'methodology.counting.dated':
    'Números de destaque aparecem sempre com a data da coleta que os produziu. Número sem data não é reproduzível.',

  'methodology.taxonomy.heading': 'Taxonomia',
  'methodology.taxonomy.namingRule':
    'Os nomes dos nós traduzem o idioma, nunca o termo técnico. Termo que a prática fala em inglês nos dois idiomas permanece em inglês.',
  'methodology.taxonomy.protectedLabel': 'Termos protegidos',
  'methodology.taxonomy.protectedNote':
    'São idênticos nos dois idiomas, e a paridade é verificada na CI em vez de confiada a quem traduz.',
  'methodology.taxonomy.aliasesLabel': 'Apelidos',
  'methodology.taxonomy.aliasesNote':
    'Formas curtas que ninguém coloca em um rótulo, mapeadas para o nó que resolvem, para que a busca as encontre.',
  'methodology.taxonomy.minimumMassLabel': 'Massa mínima',
  'methodology.taxonomy.minimumMassNote':
    'Categoria com menos entradas que isso aparece esmaecida e não é clicável. Cair em um beco vazio é exatamente a sensação de usar uma awesome-list por dentro.',

  'methodology.provenance.heading': 'Procedência e atualidade',
  'methodology.provenance.id':
    'o repositório, o commit exato em que o conteúdo foi lido e o caminho do arquivo. Nada é citado a partir de um nome de branch.',
  'methodology.provenance.sourcesLabel': 'Corpus indexado',
  'methodology.provenance.freshnessLabel': 'Atualidade',
  'methodology.provenance.freshnessNote':
    'A coleta e a classificação rodam em agendas separadas e envelhecem de forma independente, por isso são sempre reportadas como dois números. Um único "atualizado em" seria mentira.',
  'methodology.provenance.skillsLabel': 'Skills indexadas',
  'methodology.provenance.sourceCountLabel': 'Repositórios de origem',
  'methodology.provenance.crawledLabel': 'Última coleta',
  'methodology.provenance.classifiedLabel': 'Última classificação',
  'methodology.provenance.never': 'nunca executada',
};

const methodology: Record<Lang, Record<string, string>> = { en, pt };
export default methodology;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/lib/i18n-methodology.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**
```bash
git add src/lib/i18n/methodology.ts tests/lib/i18n-methodology.test.ts
git commit -m "feat(i18n): hand-written EN and pt-BR methodology copy"
```

---

### Task B5.17: `/[lang]/methodology/` — the published ruleset

Spec §10.6. The spec promises to "publish" a rule in five separate places; one page discharges all five. The taxonomy facts (protected terms, aliases, minimum mass) and the freshness facts are rendered from live data, not retyped — a methodology page that can drift from the pipeline is worse than none.

This page also supplies the `#score` anchor that B4's score chip already links to (seam S7: B4 renders `<a class="skill-card__score" data-field="score" href=…/methodology/#score>` itself, and notes that the link 404s until this task lands). The last two assertions below close that loop; nothing here modifies B4's card.

**Files:**
- Create: `src/pages/[lang]/methodology.astro`
- Test: `tests/build/methodology.test.ts`

**Interfaces:**
- Consumes: `Layout.astro` from `src/components/Layout.astro` (B1) with props `{ lang: Lang; title: string; description?: string; path?: string }`; `loadTaxonomy(): Taxonomy` from `src/lib/taxonomy.ts` (A3); `loadMeta()` from `src/lib/data.ts` (A6); `parseMeta`, `evaluateStaleness` from `src/lib/staleness.ts`; `t` from `src/lib/i18n/index.ts` (B1); `Lang` from `src/types.ts`; B4's `[data-field="score"]` anchor on the catalog
- Produces: the routes `/en/methodology/` and `/pt/methodology/`, with the section anchors `#score`, `#inclusion`, `#safety`, `#counting`, `#taxonomy`, `#provenance`

- [ ] **Step 1: Write the failing build test**
```ts
// tests/build/methodology.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

function page(lang: 'en' | 'pt'): string {
  const file = `dist/${lang}/methodology/index.html`;
  if (!existsSync(file)) {
    throw new Error(`Missing ${file} — the methodology route does not exist yet`);
  }
  return readFileSync(file, 'utf8');
}

function catalog(lang: 'en' | 'pt'): string {
  const file = `dist/${lang}/catalog/index.html`;
  if (!existsSync(file)) throw new Error(`Missing ${file} — the catalog route did not build`);
  return readFileSync(file, 'utf8');
}

describe('the methodology page discharges spec §10.6', () => {
  it('renders all six sections as linkable anchors', () => {
    const html = page('en');
    for (const id of ['score', 'inclusion', 'safety', 'counting', 'taxonomy', 'provenance']) {
      expect(html, `missing anchor #${id}`).toContain(`id="${id}"`);
    }
  });

  it('publishes the formula with all four weights', () => {
    const html = page('en');
    expect(html).toContain('Adoption 25');
    expect(html).toContain('Maintenance 30');
    expect(html).toContain('Provenance 25');
    expect(html).toContain('Completeness 20');
  });

  it('says why safety is not an input', () => {
    expect(page('en')).toContain('Safety is deliberately not an input');
  });

  it('publishes the inclusion filter as an explicit rule list', () => {
    const html = page('en');
    expect(html).toContain('.claude/skills/');
    expect(html).toContain('at least 10 stars');
    expect(html).toContain('One entry per publisher per concept');
  });

  it('publishes the counting rules', () => {
    const html = page('en');
    expect(html).toContain('Symlinks are skipped');
    expect(html).toContain('blob SHA');
  });

  it('publishes the taxonomy naming rule with the live PROTECTED list and aliases', () => {
    const html = page('en');
    expect(html).toContain('Protected terms');
    expect(html).toContain('Supply Chain');
    expect(html).toContain('CI/CD');
    expect(html).toContain('Aliases');
    expect(html).toMatch(/data-minimum-mass="\d+"/);
  });

  it('publishes provenance and both freshness dates as separate figures', () => {
    const html = page('en');
    expect(html).toContain('owner/repo@commit:path');
    expect(html).toMatch(/data-crawled-at="[^"]*"/);
    expect(html).toMatch(/data-classified-at="[^"]*"/);
  });

  it('is hand-written in pt-BR, with no English prose leaking through', () => {
    const pt = page('pt');
    expect(pt).toContain('Metodologia');
    expect(pt).toContain('Filtro de inclusão');
    expect(pt).toContain('Superfície de risco');
    expect(pt).not.toContain('Safety is deliberately not an input');
  });

  it('keeps the pt-BR page on the protected technical terms', () => {
    const pt = page('pt');
    expect(pt).toContain('Supply Chain');
    expect(pt).not.toContain('cadeia de suprimentos');
  });

  it('resolves the score chip link B4 already renders on every card', () => {
    const chip = catalog('en').match(/<a[^>]*data-field="score"[^>]*>/);
    expect(chip, 'B4 renders no [data-field="score"] anchor on the catalog').not.toBeNull();
    expect(chip![0]).toContain('href="/ai-tools-hub/en/methodology/#score"');
    expect(page('en')).toContain('id="score"');
  });

  it('keeps the pt-BR chip inside its own locale', () => {
    const chip = catalog('pt').match(/<a[^>]*data-field="score"[^>]*>/);
    expect(chip).not.toBeNull();
    expect(chip![0]).toContain('href="/ai-tools-hub/pt/methodology/#score"');
    expect(page('pt')).toContain('id="score"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/build/methodology.test.ts`
Expected: FAIL — `Error: Missing dist/en/methodology/index.html — the methodology route does not exist yet`

- [ ] **Step 3: Write the page**
```astro
---
// src/pages/[lang]/methodology.astro
import Layout from '../../components/Layout.astro';
import { loadMeta } from '../../lib/data.ts';
import { loadTaxonomy } from '../../lib/taxonomy.ts';
import { evaluateStaleness, parseMeta } from '../../lib/staleness.ts';
import { t } from '../../lib/i18n/index.ts';
import type { Lang } from '../../types.ts';

export function getStaticPaths() {
  return [{ params: { lang: 'en' } }, { params: { lang: 'pt' } }];
}

const lang: Lang = Astro.params.lang === 'pt' ? 'pt' : 'en';

/** Spec §5, printed verbatim so page and ranking cannot drift apart in prose. */
const FORMULA = 'SCORE = Adoption 25 + Maintenance 30 + Provenance 25 + Completeness 20';

const taxonomy = loadTaxonomy();
const report = evaluateStaleness(parseMeta(loadMeta()), new Date());
const aliasPairs = Object.entries(taxonomy.aliases);
---

<Layout lang={lang} title={t('methodology.title', lang)} description={t('methodology.intro', lang)}>
  <article class="methodology">
    <h1>{t('methodology.title', lang)}</h1>
    <p class="methodology__intro">{t('methodology.intro', lang)}</p>

    <section aria-labelledby="score">
      <h2 id="score">{t('methodology.score.heading', lang)}</h2>
      <p class="methodology__label">{t('methodology.score.formulaLabel', lang)}</p>
      <pre class="methodology__formula"><code>{FORMULA}</code></pre>
      <ul>
        <li>{t('methodology.score.adoption', lang)}</li>
        <li>{t('methodology.score.maintenance', lang)}</li>
        <li>{t('methodology.score.provenance', lang)}</li>
        <li>{t('methodology.score.completeness', lang)}</li>
      </ul>
      <p>{t('methodology.score.balance', lang)}</p>
      <p class="methodology__emphasis">{t('methodology.score.noSafety', lang)}</p>
      <p>{t('methodology.score.noOverride', lang)}</p>
    </section>

    <section aria-labelledby="inclusion">
      <h2 id="inclusion">{t('methodology.inclusion.heading', lang)}</h2>
      <p>{t('methodology.inclusion.body', lang)}</p>
      <ol>
        <li>{t('methodology.inclusion.r1', lang)}</li>
        <li>{t('methodology.inclusion.r2', lang)}</li>
        <li>{t('methodology.inclusion.r3', lang)}</li>
        <li>{t('methodology.inclusion.r4', lang)}</li>
        <li>{t('methodology.inclusion.r5', lang)}</li>
        <li>{t('methodology.inclusion.r6', lang)}</li>
      </ol>
    </section>

    <section aria-labelledby="safety">
      <h2 id="safety">{t('methodology.safety.heading', lang)}</h2>
      <p>{t('methodology.safety.body', lang)}</p>
      <ul>
        <li>{t('methodology.safety.executes', lang)}</li>
        <li>{t('methodology.safety.network', lang)}</li>
        <li>{t('methodology.safety.env', lang)}</li>
      </ul>
      <p class="methodology__emphasis">{t('methodology.safety.noGreen', lang)}</p>
    </section>

    <section aria-labelledby="counting">
      <h2 id="counting">{t('methodology.counting.heading', lang)}</h2>
      <ul>
        <li>{t('methodology.counting.symlinks', lang)}</li>
        <li>{t('methodology.counting.dedupe', lang)}</li>
        <li>{t('methodology.counting.excluded', lang)}</li>
        <li>{t('methodology.counting.dated', lang)}</li>
      </ul>
    </section>

    <section aria-labelledby="taxonomy">
      <h2 id="taxonomy">{t('methodology.taxonomy.heading', lang)}</h2>
      <p>{t('methodology.taxonomy.namingRule', lang)}</p>

      <h3>{t('methodology.taxonomy.protectedLabel', lang)}</h3>
      <ul class="methodology__terms" data-protected-terms>
        {taxonomy.protected.map((term) => <li><code>{term}</code></li>)}
      </ul>
      <p>{t('methodology.taxonomy.protectedNote', lang)}</p>

      <h3>{t('methodology.taxonomy.aliasesLabel', lang)}</h3>
      <ul class="methodology__terms" data-aliases>
        {aliasPairs.map(([alias, target]) => (
          <li><code>{alias}</code> → <code>{target}</code></li>
        ))}
      </ul>
      <p>{t('methodology.taxonomy.aliasesNote', lang)}</p>

      <h3>{t('methodology.taxonomy.minimumMassLabel', lang)}</h3>
      <p data-minimum-mass={String(taxonomy.minimumMass)}>
        {taxonomy.minimumMass} — {t('methodology.taxonomy.minimumMassNote', lang)}
      </p>
    </section>

    <section aria-labelledby="provenance">
      <h2 id="provenance">{t('methodology.provenance.heading', lang)}</h2>
      <p><code>owner/repo@commit:path</code> — {t('methodology.provenance.id', lang)}</p>

      <h3>{t('methodology.provenance.sourcesLabel', lang)}</h3>
      <dl class="methodology__facts">
        <dt>{t('methodology.provenance.skillsLabel', lang)}</dt>
        <dd data-skill-count={String(report.skillCount)}>{report.skillCount}</dd>
        <dt>{t('methodology.provenance.sourceCountLabel', lang)}</dt>
        <dd data-source-count={String(report.sourceCount)}>{report.sourceCount}</dd>
      </dl>

      <h3>{t('methodology.provenance.freshnessLabel', lang)}</h3>
      <dl class="methodology__facts">
        <dt>{t('methodology.provenance.crawledLabel', lang)}</dt>
        <dd data-crawled-at={report.crawl.iso ?? ''}>
          {report.crawl.iso ?? t('methodology.provenance.never', lang)}
        </dd>
        <dt>{t('methodology.provenance.classifiedLabel', lang)}</dt>
        <dd data-classified-at={report.classification.iso ?? ''}>
          {report.classification.iso ?? t('methodology.provenance.never', lang)}
        </dd>
      </dl>
      <p>{t('methodology.provenance.freshnessNote', lang)}</p>
    </section>
  </article>
</Layout>

<style>
  .methodology { max-width: 68ch; padding: 1rem; line-height: 1.6; }
  .methodology h2 {
    margin-top: 2.5rem;
    font-size: 1rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border-top: 1px solid var(--color-n-6);
    padding-top: 0.75rem;
  }
  .methodology h3 {
    margin-top: 1.5rem;
    font-size: 0.8125rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--color-n-11);
  }
  .methodology__formula {
    font-family: var(--font-mono, ui-monospace, monospace);
    border: 1px solid var(--color-n-6);
    background: var(--color-n-2);
    padding: 0.75rem;
    overflow-x: auto;
  }
  .methodology__label {
    font-size: 0.75rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-n-11);
    margin-bottom: 0.25rem;
  }
  .methodology__emphasis {
    border-inline-start: 2px solid var(--color-a-9);
    padding-inline-start: 0.75rem;
  }
  .methodology__terms {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    list-style: none;
    padding: 0;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }
  .methodology__facts {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.25rem 1rem;
    font-family: var(--font-mono, ui-monospace, monospace);
    font-size: 0.8125rem;
  }
  .methodology__facts dt { color: var(--color-n-11); }
  .methodology__facts dd { margin: 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/build/methodology.test.ts`
Expected: PASS — 11 tests

If the `Supply Chain` or `CI/CD` assertions fail, the `protected` list in `data/taxonomy.json` (A3) is missing those terms; fix the data, not the test. If the score-chip assertions fail, B4's `src/components/SkillCard.astro` is not emitting the anchor seam S7 assigns to it — reconcile with B4 rather than editing the card here.

- [ ] **Step 5: Commit**
```bash
git add "src/pages/[lang]/methodology.astro" tests/build/methodology.test.ts
git commit -m "feat(methodology): publish the score, inclusion, safety, counting and taxonomy rules"
```

---

### Task B5.18: Mount the status banner and the two behaviour components

`src/components/Layout.astro` belongs to B1, so this task only *modifies* it, against anchors that appear verbatim in B1's layout, and it adds **no footer and no `withBase` import**: seam S8 gives the persistent methodology footer link to B1, which renders it beside the catalog link as `<a data-footer-link href={withBase(`/${lang}/methodology/`)}>`. This task asserts that B1 link now resolves to the route Task B5.17 built, and mounts the three things B5 owns: the staleness banner inside the sticky header, and `A11yBehavior` + `SearchBehavior` after `</main>`.

**Files:**
- Modify: `src/components/Layout.astro` (B1) — one import block, one mounted banner, two behaviour includes
- Test: `tests/build/site-chrome.test.ts`

**Interfaces:**
- Consumes: `Layout.astro` (B1) and the `[data-footer-link]` anchors its footer already renders; `StalenessBanner.astro` (Task B5.15), `A11yBehavior.astro` (Task B5.12), `SearchBehavior.astro` (Task B5.9)
- Produces: `StalenessBanner` inside the sticky header and both behaviour components on every page the layout wraps

- [ ] **Step 1: Verify all three anchors exist exactly once in B1's layout**
```bash
cd /home/kyo/projects/ai-tools-hub
grep -c "import type { Lang } from '../types.ts';" src/components/Layout.astro
grep -c '</header>' src/components/Layout.astro
grep -c '</main>' src/components/Layout.astro
grep -c 'data-footer-link' src/components/Layout.astro
```
Expected: `1`, `1`, `1`, and `2` (B1's catalog link plus its methodology link). If any count differs, stop and reconcile with B1 before editing — do not guess a replacement anchor, and never add a second footer here.

- [ ] **Step 2: Write the failing build test**
```ts
// tests/build/site-chrome.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function page(file: string): string {
  if (!existsSync(file)) throw new Error(`Missing ${file} — the route did not build`);
  return readFileSync(file, 'utf8');
}

function assets(extension: string): string {
  const dir = 'dist/_astro';
  if (!existsSync(dir)) throw new Error(`Missing ${dir} — the build produced no assets`);
  return readdirSync(dir)
    .filter((file) => file.endsWith(extension))
    .map((file) => readFileSync(join(dir, file), 'utf8'))
    .join('\n');
}

const PAGES = ['dist/en/catalog/index.html', 'dist/en/methodology/index.html'];

describe('persistent site chrome', () => {
  it('reaches methodology from the footer of every page', () => {
    for (const file of PAGES) {
      const links = page(file).match(/<a[^>]*data-footer-link[^>]*>/g) ?? [];
      expect(
        links.some((link) => link.includes('href="/ai-tools-hub/en/methodology/"')),
        `no footer link to /en/methodology/ in ${file}`,
      ).toBe(true);
    }
  });

  it('keeps the footer after the main region', () => {
    const html = page(PAGES[0]);
    expect(html.indexOf('</main>')).toBeLessThan(html.lastIndexOf('data-footer-link'));
  });

  it('renders exactly one footer', () => {
    expect((page(PAGES[0]).match(/<footer/g) ?? []).length).toBe(1);
  });

  it('renders the staleness banner inside the sticky header', () => {
    const header = page(PAGES[0]).split('<header')[1]?.split('</header>')[0] ?? '';
    expect(header).toContain('data-staleness-banner');
  });

  it('reports the crawl and the classification in two separate elements', () => {
    const html = page(PAGES[0]);
    expect(html.match(/<p[^>]*data-crawl-state="(fresh|warn|stale|unknown)"[^>]*>/),
      'no [data-crawl-state] row found').not.toBeNull();
    expect(html.match(/<p[^>]*data-classification-state="(fresh|warn|stale|unknown)"[^>]*>/),
      'no [data-classification-state] row found').not.toBeNull();
    expect(html.indexOf('data-crawl-state')).not.toBe(html.indexOf('data-classification-state'));
  });

  it('never collapses the two rows into a single updated_at figure', () => {
    expect(page(PAGES[0])).toContain('data-classification-lag');
  });

  it('ships the a11y behaviour on every page the layout wraps', () => {
    const js = assets('.js');
    expect(js).toContain('data-clear-all');
    expect(js).toContain('--header-h');
  });

  it('ships the search behaviour over B3 combobox', () => {
    const js = assets('.js');
    expect(js).toContain('data-search-input');
    expect(js).toContain('aria-activedescendant');
    expect(js).toContain('rescue-index/');
  });

  it('keeps exactly one search input on the catalog', () => {
    expect((page(PAGES[0]).match(/data-search-input/g) ?? []).length).toBe(1);
  });

  it('ships the WCAG 2.4.11 scroll offset with a pre-JS fallback', () => {
    const css = assets('.css');
    expect(css).toContain('--header-h');
    expect(css).toMatch(/scroll-margin-top:\s*calc\(\s*var\(--header-h\)/);
    expect(css).toMatch(/body\s*>\s*header[^{]*\{[^}]*position:\s*sticky/);
  });

  it('translates the chrome on the pt-BR routes', () => {
    const pt = page('dist/pt/methodology/index.html');
    expect(pt).toContain('Atraso da classificação');
    const links = pt.match(/<a[^>]*data-footer-link[^>]*>/g) ?? [];
    expect(links.some((link) => link.includes('href="/ai-tools-hub/pt/methodology/"'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `npx vitest run tests/build/site-chrome.test.ts`
Expected: FAIL — `AssertionError: no [data-staleness-banner] inside the header: expected 'dist/en/catalog/index.html' header to contain 'data-staleness-banner'`

- [ ] **Step 4: Modify `src/components/Layout.astro`**
Replace this exact line:
```astro
import type { Lang } from '../types.ts';
```
with:
```astro
import type { Lang } from '../types.ts';
import StalenessBanner from './StalenessBanner.astro';
import A11yBehavior from './A11yBehavior.astro';
import SearchBehavior from './SearchBehavior.astro';
```
Replace this exact line:
```astro
    </header>
```
with:
```astro
      <StalenessBanner lang={lang} />
    </header>
```
Replace this exact line:
```astro
    </main>
```
with:
```astro
    </main>
    <A11yBehavior />
    <SearchBehavior />
```
Add nothing else. The footer and its `withBase` import are B1's and already exist; a second copy of either is a build error.

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/build/site-chrome.test.ts`
Expected: PASS — 11 tests

- [ ] **Step 6: Verify the three misspellings in a real browser**
Run: `npx astro preview --port 4321`
Open `http://localhost:4321/ai-tools-hub/en/catalog/` and type `kubernets`, then `terrafrom`, then `clude code`. Each must show suggestions in B3's listbox, arrow keys must move the highlight, and the "Did you mean" line must appear whenever Pagefind reports no results. Stop the preview with Ctrl-C.

- [ ] **Step 7: Commit**
```bash
git add src/components/Layout.astro tests/build/site-chrome.test.ts
git commit -m "feat(chrome): mount the status banner and the a11y and search behaviours"
```

---

### Task B5.19: Operator runbook for the scheduled classification and translation session

Spec §6.1 and §8: this step runs on the maintainer's Claude Code subscription, not a metered API key, and reaches the repo as a PR a human merges. It is the one part of the pipeline that is not a workflow file, so it needs a written procedure or it does not exist.

**Files:**
- Create: `docs/operations/classification-session.md`
- Test: `tests/docs/runbook.test.ts`

**Interfaces:**
- Consumes: `data/skills.json`, `data/taxonomy.json`, `data/assignments.json`, `data/meta.json`; `scripts/validate-taxonomy.ts` (A3); `scripts/build-rescue-index.ts` (Task B5.6)
- Produces: `docs/operations/classification-session.md`

- [ ] **Step 1: Write the failing test**
```ts
// tests/docs/runbook.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const RUNBOOK = 'docs/operations/classification-session.md';

function doc(): string {
  if (!existsSync(RUNBOOK)) throw new Error(`Missing ${RUNBOOK}`);
  return readFileSync(RUNBOOK, 'utf8');
}

describe('classification session runbook', () => {
  it('has every required section', () => {
    const text = doc();
    for (const heading of [
      '## When it runs', '## Inputs', '## What the session produces',
      '## Procedure', '## Usage limits', '## Failure mode',
    ]) {
      expect(text, `missing heading: ${heading}`).toContain(heading);
    }
  });

  it('states that the session runs on the subscription, not an API key', () => {
    expect(doc()).toContain('subscription');
    expect(doc()).toContain('not a metered API key');
  });

  it('states that a human merges the PR', () => {
    const text = doc();
    expect(text).toContain('gh pr create');
    expect(text).toContain('A human merges');
  });

  it('warns that the first full pass may exceed usage limits and must be split', () => {
    const text = doc();
    expect(text).toContain('may exceed');
    expect(text).toContain('split it across several runs');
    expect(text).toContain('tens of entries');
  });

  it('documents the unclassified fallback', () => {
    expect(doc()).toContain('general');
    expect(doc()).toContain('stale-but-honest');
  });

  it('names the exact files the session reads and writes', () => {
    const text = doc();
    for (const file of ['data/skills.json', 'data/taxonomy.json', 'data/assignments.json', 'data/meta.json']) {
      expect(text, `missing file reference: ${file}`).toContain(file);
    }
  });

  it('documents assignments as a flat record keyed by skill id, never an envelope', () => {
    const text = doc();
    expect(text).toContain('Record<skillId, Assignment>');
    expect(text).not.toContain('"version": 1');
  });

  it('shows an assignment carrying exactly primary, also and tags', () => {
    const text = doc();
    expect(text).not.toContain('"securityRelevant"');
    expect(text).not.toContain('"descriptionPt"');
    expect(text).not.toContain('"longPt"');
  });

  it('requires classifiedAt to be bumped in the same PR', () => {
    expect(doc()).toContain('classifiedAt');
  });

  it('carries the PROTECTED list into the translation prompt', () => {
    const text = doc();
    expect(text).toContain('PROTECTED');
    expect(text).toContain('Supply Chain');
    expect(text).toContain('CI/CD');
  });

  it('requires the taxonomy validator to pass before the PR opens', () => {
    expect(doc()).toContain('scripts/validate-taxonomy.ts');
  });

  it('requires the rescue index to be regenerated when names change', () => {
    expect(doc()).toContain('scripts/build-rescue-index.ts');
  });

  it('forbids hand-editing the listing flag the harvest computes', () => {
    const text = doc();
    expect(text).toContain('**never** hand-edited');
    expect(text).toContain('per-subdomain cap');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run tests/docs/runbook.test.ts`
Expected: FAIL — `Error: Missing docs/operations/classification-session.md`

- [ ] **Step 3: Write the runbook**
```bash
mkdir -p /home/kyo/projects/ai-tools-hub/docs/operations
cat > /home/kyo/projects/ai-tools-hub/docs/operations/classification-session.md <<'MARKDOWN'
# Runbook — scheduled classification and translation session

Harvest runs whether or not anyone is watching: a systemd user timer on the maintainer's machine
every 4 hours, backed by a weekly public GitHub Action so days with the machine off cannot silence
it. Classification and
pt-BR translation are not like that: they need judgment, so they run as a **scheduled Claude Code session on
the maintainer's subscription** — deliberately **not a metered API key**, and never inside the Pages
build, which has a hard 10-minute deploy timeout.

Both halves reach `main` as a reviewable diff. This document is the procedure for the half a
workflow file cannot express.

## When it runs

- Weekly, on the maintainer's machine or a scheduled cloud session.
- After any large harvest, when the status banner shows a growing classification lag.
- On demand, whenever the banner reports entries queued unclassified.

The harvest runs every 4 hours locally and weekly in Actions, and is unaffected by this schedule. The two rot independently, and the banner
reports them as two separate rows for exactly that reason.

## Inputs

| File | Role |
|---|---|
| `data/skills.json` | a bare `Skill[]` of every harvested skill, written by the harvest (`scripts/harvest/run.ts` locally, `crawl.yml` weekly) |
| `data/taxonomy.json` | the closed vocabulary: 13 domains, the 15 security leaves, `protected`, `aliases`, `minimumMass` |
| `data/assignments.json` | what previous sessions already decided; the cache |
| `data/meta.json` | `crawledAt`, `classifiedAt`, `skillCount`, `sourceCount` |

Skill ids embed the commit the content was read at — `owner/repo@sha:path` — so a re-crawl of an
active repository produces new ids for unchanged skills. Carry a previous decision forward by
matching on `repo` + `path`, and re-judge only when the skill's name or description text actually
changed. That is what keeps a weekly run cheap.

## What the session produces

A write to `data/assignments.json`, which is a flat `Record<skillId, Assignment>` — never an
array, never a versioned envelope — and whose entries carry exactly three fields:

```jsonc
{
  "owner/repo@sha:path/SKILL.md": {
    "primary": "security/supply-chain",
    "also": ["devops-infra/cicd"],
    "tags": ["sbom", "slsa"]
  }
}
```

Rules the session must hold to:

- `primary` is exactly one slug and must resolve in `data/taxonomy.json`.
- `also` holds at most 2 slugs.
- `tags` holds at most 10 free terms. Tags never drive navigation.
- Nothing else belongs in an assignment. Facts about the skill itself — including whether it is
  security-relevant, and its translated description — live on the skill record, not here.
- A skill with no entry here is not lost: it renders in its domain's named `general` leaf and is
  counted in the banner's "queued unclassified" row.
- `Skill.listed` is **never** hand-edited. The harvest recomputes it from the per-subdomain cap on
  every run (§5.1). An entry evicted from its listing still needs a classification, still keeps its
  page, and still counts in the queued-unclassified row.

### Translation rules

- Translate only skill descriptions, written onto the skill record's `descriptionPt` and `longPt`
  fields in `data/skills.json` — never into `data/assignments.json`. UI chrome, taxonomy display
  names, the methodology page and our editorial notes are hand-written in both locales and are never
  machine-translated.
- English stays canonical. Every translated block is labelled machine-translated in the UI and keeps
  a "see original" control.
- The `PROTECTED` list goes into the translation prompt verbatim:
  `CI/CD`, `Kubernetes`, `Supply Chain`, `IaC`, `SBOM`, `SLSA`, `OWASP`, `MCP`, `DAST`, `SAST`, `IAM`.
  These are said the same way in both languages. `Supply Chain` in particular stays `Supply Chain` —
  the logistics translation is not security language.
- Protected-term parity is enforced in CI, not trusted to the model.

## Procedure

1. Pull `main` and create a branch:
   ```bash
   git switch -c "classify/$(date +%Y-%m-%d)"
   ```
2. Run the session over the unassigned or changed skills only, in batches (see **Usage limits**).
3. Write the results into `data/assignments.json`, and any new translations onto the matching
   records in `data/skills.json`.
4. Set `classifiedAt` in `data/meta.json` to the ISO timestamp of this run. The banner's
   classification lag is computed from it, so a PR that forgets this step lies to the reader.
5. If any skill *name* changed, regenerate the typo-rescue index so search still finds it:
   ```bash
   npx tsx scripts/build-rescue-index.ts
   ```
6. Validate before opening anything:
   ```bash
   npx tsx scripts/validate-taxonomy.ts
   npx vitest run
   npx astro build
   ```
   `scripts/validate-taxonomy.ts` runs the governance checks, including referential integrity for
   every `primary` and `also` and protected-term parity. It exits non-zero on failure.
7. Open the PR:
   ```bash
   git add data/assignments.json data/skills.json data/meta.json public/rescue-index
   git commit -m "chore(classify): assignments and pt-BR translations"
   git push -u origin HEAD
   gh pr create --fill --title "Classification pass $(date +%Y-%m-%d)"
   ```
8. **A human merges the diff.** The session never pushes to `main` and never enables auto-merge.
   Reviewing the taxonomy assignments is the product; automating the merge would remove it.

## Usage limits

The first full pass over the harvest backlog **may exceed** the subscription's usage limits. Do not
attempt it in one sitting: **split it across several runs**, one batch of roughly 50 entries per
run, committing after each batch so no work is repeated after an interruption.

Steady state is **tens of entries** per run and fits comfortably inside a single session.

## Failure mode

If the maintainer stops running this session, harvest keeps running and the site's data stays fresh.
New entries simply queue unclassified: they land in their domain's named `general` leaf rather than
disappearing, and the status banner reports the classification lag as its own row, separate from the
crawl date.

That is the intended behaviour — **stale-but-honest, never silently wrong**. A frozen catalog that
still claims to be current is the failure this project exists to avoid.
MARKDOWN
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run tests/docs/runbook.test.ts`
Expected: PASS — 13 tests

- [ ] **Step 5: Run the full suite and a clean build**
Run: `npx astro build && npx vitest run`
Expected: PASS — the whole suite, with `tests/global-setup.ts` performing the single build.

- [ ] **Step 6: Commit**
```bash
git add docs/operations/classification-session.md tests/docs/runbook.test.ts
git commit -m "docs(ops): runbook for the scheduled classification and translation session"
```

---

### Task B5.20: Drop entries evicted by the per-subdomain cap from the sitemap

Spec §5.1: an evicted entry disappears from listings, facet counts, the search index **and the
sitemap**, and its page carries `noindex`. B4 keeps generating that page — the row is still in
`data/skills.json` with a current score and dates — and emits the `noindex` meta itself; B3 keeps it
out of Pagefind; Task B5.2 keeps it out of the rescue index. The sitemap is the one surface none of
them can reach, because `@astrojs/sitemap` enumerates every route the build produced. So B5 supplies
the `filter`.

The matcher is deliberately base-agnostic: it recognises a per-skill route by its trailing
`/{lang}/skills/{slug}/` shape rather than by a full path, so it keeps working under
`/ai-tools-hub/`, under a custom domain with no base, and in the unit test with neither.

**Files:**
- Create: `src/lib/sitemap.ts`
- Modify: `astro.config.mjs` (A1) — one import line and the `sitemap()` call
- Test: `tests/lib/sitemap.test.ts`, `tests/build/sitemap.test.ts`

**Interfaces:**
- Consumes: `Skill` from `src/types.ts` — the required `Skill.listed` flag (§5.1); `skillSlug(skill: Skill): string` from `src/lib/slug.ts` (B4) — the single slug function (Rule 4); `loadSkills(): Skill[]` from `src/lib/data.ts` (A6)
- Produces: `SKILL_URL_PATTERN: RegExp`; `unlistedSkillSlugs(skills: Skill[]): string[]`; `makeSitemapFilter(unlistedSlugs: Iterable<string>): (url: string) => boolean`

- [ ] **Step 1: Verify both anchors exist exactly once in A1's config**
```bash
cd /home/kyo/projects/ai-tools-hub
grep -c "import sitemap from '@astrojs/sitemap';" astro.config.mjs
grep -c 'sitemap()' astro.config.mjs
```
Expected: `1` and `1`. If either count differs, stop and reconcile with A1 before editing — do not guess a replacement anchor, and never add a second `sitemap()` integration.

- [ ] **Step 2: Write the failing unit test**
```ts
// tests/lib/sitemap.test.ts
import { describe, it, expect } from 'vitest';
import { SKILL_URL_PATTERN, makeSitemapFilter, unlistedSkillSlugs } from '../../src/lib/sitemap.ts';
import { skillSlug } from '../../src/lib/slug.ts';
import type { Skill } from '../../src/types.ts';

/** Local fixture: importing a *.test.ts would re-register that file's suites inside this one. */
function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: 'acme/tools@abc1234:kit/SKILL.md',
    type: 'skill',
    name: 'Terraform Drift Detector',
    description: 'Detects drift between Terraform state and deployed cloud resources.',
    descriptionPt: null,
    longPt: null,
    repo: 'acme/tools',
    path: 'kit/SKILL.md',
    sha: 'abc1234',
    updatedDays: 12,
    indexedAt: '2026-08-29',
    license: 'MIT',
    licenseSource: 'repo',
    portable: true,
    runtimes: ['claude'],
    safety: {
      executesCode: false, scriptCount: 0, languages: [],
      network: false, readsEnv: false, declaredTools: null,
    },
    primary: 'security/iac-config',
    also: [],
    tags: ['terraform'],
    securityRelevant: true,
    score: 71,
    breakdown: { adoption: 12, maintenance: 26, provenance: 13, completeness: 20, total: 71 },
    listed: true,
    ...over,
  };
}

describe('unlistedSkillSlugs', () => {
  it('returns the slug of every evicted entry and nothing else', () => {
    const listed = makeSkill({ repo: 'acme/tools', path: 'kit/SKILL.md' });
    const evicted = makeSkill({ repo: 'acme/tools', path: 'old/SKILL.md', listed: false });
    expect(unlistedSkillSlugs([listed, evicted])).toEqual([skillSlug(evicted)]);
  });

  it('is empty when every entry is listed', () => {
    expect(unlistedSkillSlugs([makeSkill()])).toEqual([]);
  });
});

describe('makeSitemapFilter', () => {
  const filter = makeSitemapFilter(['evicted-drift-tool']);

  it('drops an unlisted skill URL in either locale', () => {
    expect(filter('https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/')).toBe(false);
    expect(filter('https://example.com/ai-tools-hub/pt/skills/evicted-drift-tool/')).toBe(false);
  });

  it('keeps a listed skill URL', () => {
    expect(filter('https://example.com/ai-tools-hub/en/skills/terraform-drift-detector/')).toBe(true);
  });

  it('works under any deployment base, including none', () => {
    expect(filter('https://example.com/en/skills/evicted-drift-tool/')).toBe(false);
    expect(filter('https://example.com/deep/nested/base/en/skills/evicted-drift-tool/')).toBe(false);
  });

  it('never touches a URL that is not a per-skill page', () => {
    for (const url of [
      'https://example.com/ai-tools-hub/en/catalog/',
      'https://example.com/ai-tools-hub/en/methodology/',
      'https://example.com/ai-tools-hub/pt/',
      'https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/extra/',
    ]) {
      expect(filter(url), url).toBe(true);
    }
  });

  it('keeps everything when nothing has been evicted', () => {
    const permissive = makeSitemapFilter([]);
    expect(permissive('https://example.com/ai-tools-hub/en/skills/evicted-drift-tool/')).toBe(true);
  });

  it('exposes the route pattern it matches on', () => {
    // Multi-segment: skillSlug() emits `owner/repo/dir/name`, so a one-segment
    // pattern silently matches nothing real and no evicted entry ever leaves the sitemap.
    expect(SKILL_URL_PATTERN.exec('/ai-tools-hub/en/skills/anthropics/skills/document-skills/pdf/')?.[2])
      .toBe('anthropics/skills/document-skills/pdf');
    expect(SKILL_URL_PATTERN.exec('/ai-tools-hub/en/skills/kube-bench-runner/')?.[2])
      .toBe('kube-bench-runner');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**
Run: `npx vitest run tests/lib/sitemap.test.ts`
Expected: FAIL — `Error: Failed to load url ../../src/lib/sitemap.ts (resolved id: ../../src/lib/sitemap.ts). Does the file exist?`

- [ ] **Step 4: Write minimal implementation**
```ts
// src/lib/sitemap.ts
import type { Skill } from '../types.ts';
import { skillSlug } from './slug.ts';

/**
 * A built per-skill route, recognised by its tail rather than by a full path so the same regex
 * works under /ai-tools-hub/, under a custom domain with no base, and in tests with neither.
 * No `g` flag: exec() must stay stateless across calls.
 */
export const SKILL_URL_PATTERN = /\/(en|pt)\/skills\/(.+?)\/?$/;

/** Slugs of entries evicted by the per-subdomain cap (§5.1). Their pages still build. */
export function unlistedSkillSlugs(skills: Skill[]): string[] {
  return skills.filter((skill) => !skill.listed).map((skill) => skillSlug(skill));
}

/**
 * @astrojs/sitemap filter: return false to drop a URL. An evicted entry keeps its page and the
 * noindex meta B4 puts on it, but the catalog must not advertise an entry it does not list.
 */
export function makeSitemapFilter(unlistedSlugs: Iterable<string>): (url: string) => boolean {
  const unlisted = new Set(unlistedSlugs);
  return (url: string): boolean => {
    let pathname: string;
    try {
      pathname = new URL(url).pathname;
    } catch {
      pathname = url;
    }
    const match = SKILL_URL_PATTERN.exec(pathname);
    if (!match) return true;
    return !unlisted.has(match[2]);
  };
}
```

- [ ] **Step 5: Run test to verify it passes**
Run: `npx vitest run tests/lib/sitemap.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 6: Write the failing build test**
```ts
// tests/build/sitemap.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills } from '../../src/lib/data.ts';
import { skillSlug } from '../../src/lib/slug.ts';

function sitemapXml(): string {
  const files = existsSync('dist')
    ? readdirSync('dist').filter((file) => file.startsWith('sitemap') && file.endsWith('.xml'))
    : [];
  if (files.length === 0) {
    throw new Error('No dist/sitemap*.xml — @astrojs/sitemap did not run, or the site was not built');
  }
  return files.map((file) => readFileSync(join('dist', file), 'utf8')).join('\n');
}

describe('the sitemap advertises only listed entries', () => {
  const skills = loadSkills();

  it('wires the filter through astro.config.mjs, reading data only through the A6 loader', () => {
    const config = readFileSync('astro.config.mjs', 'utf8');
    expect(
      config.includes("from './src/lib/sitemap.ts'"),
      'astro.config.mjs does not import src/lib/sitemap.ts: the sitemap still advertises unlisted entries',
    ).toBe(true);
    expect(config).toContain("import { loadSkills } from './src/lib/data.ts';");
    expect(config).toContain('filter: makeSitemapFilter(unlistedSkillSlugs(loadSkills()))');
  });

  it('lists every listed skill page', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => entry.listed)) {
      expect(xml, `${skill.id} is listed but missing from the sitemap`)
        .toContain(`/en/skills/${skillSlug(skill)}/`);
    }
  });

  it('advertises no entry evicted by the per-subdomain cap', () => {
    const xml = sitemapXml();
    for (const skill of skills.filter((entry) => !entry.listed)) {
      expect(xml, `${skill.id} is unlisted but still in the sitemap`)
        .not.toContain(`/en/skills/${skillSlug(skill)}/`);
    }
  });

  it('still builds the page for an evicted entry', () => {
    for (const skill of skills.filter((entry) => !entry.listed)) {
      expect(
        existsSync(`dist/en/skills/${skillSlug(skill)}/index.html`),
        `${skill.id} lost its page: §5.1 drops the listing, never the page`,
      ).toBe(true);
    }
  });
});
```

- [ ] **Step 7: Run test to verify it fails**
Run: `npx astro build && npx vitest run tests/build/sitemap.test.ts`
Expected: FAIL — `AssertionError: astro.config.mjs does not import src/lib/sitemap.ts: the sitemap still advertises unlisted entries: expected false to be true`

- [ ] **Step 8: Modify `astro.config.mjs`**
Astro loads its config through Vite, so a relative TypeScript import resolves there exactly as it does inside `src/` — and carries the `.ts` extension for the same reason every other relative import in this plan does.

Replace this exact line:
```js
import sitemap from '@astrojs/sitemap';
```
with:
```js
import sitemap from '@astrojs/sitemap';
import { loadSkills } from './src/lib/data.ts';
import { makeSitemapFilter, unlistedSkillSlugs } from './src/lib/sitemap.ts';
```
Replace this exact text:
```js
sitemap()
```
with:
```js
sitemap({ filter: makeSitemapFilter(unlistedSkillSlugs(loadSkills())) })
```
Add nothing else. `site`, `base` and every other integration are A1's.

- [ ] **Step 9: Rebuild and run test to verify it passes**
Run: `npx astro build && npx vitest run tests/build/sitemap.test.ts`
Expected: PASS — 4 tests

- [ ] **Step 10: Commit**
```bash
git add src/lib/sitemap.ts tests/lib/sitemap.test.ts tests/build/sitemap.test.ts astro.config.mjs
git commit -m "feat(sitemap): drop entries evicted by the per-subdomain cap"
```

---

---
