import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readBuiltCss } from './built-css.ts';

describe('tailwind v4 wiring', () => {
  it('builds the /styleguide route', () => {
    expect(existsSync('dist/styleguide/index.html')).toBe(true);
  });

  it('ships Tailwind preflight', () => {
    expect(readBuiltCss('dist')).toMatch(/box-sizing:\s*border-box/);
  });

  it('wipes the default palette so bg-red-500 and bg-indigo-500 cannot exist', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.bg-red-500');
    expect(css).not.toContain('.bg-indigo-500');
    expect(css).not.toMatch(/--color-(red|indigo|slate|zinc|sky)-\d00\s*:/);
  });
});
