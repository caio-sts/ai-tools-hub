import { describe, expect, it } from 'vitest';
import { MIN_STARS, passesRepoGate } from '../../src/lib/inclusion.ts';

describe('passesRepoGate', () => {
  it('publishes the star floor as a single constant', () => {
    expect(MIN_STARS).toBe(10);
  });

  it('admits a personal account at or above the star floor', () => {
    expect(passesRepoGate({ stars: 10, isOrg: false })).toBe(true);
    expect(passesRepoGate({ stars: 6908, isOrg: false })).toBe(true);
  });

  it('rejects a personal account below the star floor', () => {
    expect(passesRepoGate({ stars: 9, isOrg: false })).toBe(false);
    expect(passesRepoGate({ stars: 0, isOrg: false })).toBe(false);
  });

  it('admits an organisation account regardless of stars', () => {
    expect(passesRepoGate({ stars: 0, isOrg: true })).toBe(true);
    expect(passesRepoGate({ stars: 3, isOrg: true })).toBe(true);
  });
});
