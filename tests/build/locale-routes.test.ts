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
