import { describe, expect, it } from 'vitest';
import home from '../../src/lib/i18n/home.ts';
import { t } from '../../src/lib/i18n/index.ts';

const KEYS = [
  'home.description',
  'home.filterClear',
  'home.filterCount',
  'home.filterEmpty',
  'home.filterLabel',
  'home.filterPlaceholder',
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
