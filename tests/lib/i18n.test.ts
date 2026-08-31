import { describe, expect, it } from 'vitest';
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
