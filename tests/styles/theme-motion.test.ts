import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const TOKENS = ['--motion-state', '--motion-enter', '--motion-overlay', '--motion-ease'];

describe('motion tokens', () => {
  it('defines every motion token outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const token of TOKENS) expect(props.has(token)).toBe(true);
  });

  it('uses 90ms state, 150ms enter, 220ms overlay', () => {
    const css = readBuiltCss('dist');
    // Built CSS is minified: Lightning CSS rewrites 150ms as .15s — same duration.
    expect(css).toMatch(/--motion-state\s*:\s*(90ms|0?\.09s)/);
    expect(css).toMatch(/--motion-enter\s*:\s*(150ms|0?\.15s)/);
    expect(css).toMatch(/--motion-overlay\s*:\s*(220ms|0?\.22s)/);
  });

  it('declares exactly one easing curve in the whole system', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source.match(/cubic-bezier\(/g)).toHaveLength(1);
  });

  it('ships a prefers-reduced-motion kill switch', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    const css = readBuiltCss('dist');
    expect(css).toMatch(/animation-duration:\s*1ms\s*!important/);
    expect(css).toMatch(/transition-duration:\s*1ms\s*!important/);
  });
});
