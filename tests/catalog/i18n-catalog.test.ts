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
