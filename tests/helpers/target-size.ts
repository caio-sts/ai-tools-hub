import { expect } from 'vitest';

/**
 * WCAG 2.5.8 sets a 24x24 CSS px *floor* on a pointer target, not a size. Asserting the literal
 * string `min-height:24px` made every comfortable control read as a regression the moment it grew,
 * so these read the declared value and compare it against the floor instead.
 */
export const MIN_TARGET_PX = 24;

function declared(rule: string, property: 'min-height' | 'min-width'): number {
  const match = new RegExp(`${property}:(\\d+)px`).exec(rule);
  expect(match, `${property} is not declared at all in: ${rule}`).toBeTruthy();
  return Number(match![1]);
}

/** Asserts the rule clears the 24x24 floor on both axes. */
export function expectTargetSize(rule: string, label: string): void {
  expect(declared(rule, 'min-height'), `${label}: min-height below the 2.5.8 floor`)
    .toBeGreaterThanOrEqual(MIN_TARGET_PX);
  expect(declared(rule, 'min-width'), `${label}: min-width below the 2.5.8 floor`)
    .toBeGreaterThanOrEqual(MIN_TARGET_PX);
}
