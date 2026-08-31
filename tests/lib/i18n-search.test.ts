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
