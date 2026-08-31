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
