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
