import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const STEPS = Array.from({ length: 12 }, (_, i) => `--color-n-${i + 1}`);

describe('neutral ramp', () => {
  it('emits all 12 steps outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const step of STEPS) expect(props.has(step)).toBe(true);
  });

  it('declares every step in oklch()', () => {
    const css = readBuiltCss('dist');
    for (const step of STEPS) {
      expect(css).toMatch(new RegExp(`${step}\\s*:\\s*oklch\\(`));
    }
  });

  it('keeps the default palette wiped', () => {
    expect(readBuiltCss('dist')).not.toContain('.bg-red-500');
  });
});
