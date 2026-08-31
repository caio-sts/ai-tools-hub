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
