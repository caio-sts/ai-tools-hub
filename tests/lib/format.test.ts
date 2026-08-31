import { describe, expect, it } from 'vitest';
import { STALE_DAYS, compactNumber, relativeDays } from '../../src/lib/format.ts';

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
