import { describe, expect, it } from 'vitest';
import { readBuiltCss } from './built-css.ts';

describe('Industrial Console constraints', () => {
  it('makes rounded-*, shadow-* and hazard utilities impossible', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.rounded-lg');
    expect(css).not.toContain('.shadow-lg');
    expect(css).not.toContain('.bg-red-500');
    expect(css).not.toContain('.bg-indigo-500');
    expect(css).not.toContain('.bg-hazard');
  });

  it('defaults borders to 1px-capable, --border coloured, solid', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/border-color:\s*var\(--border\)/);
    expect(css).toMatch(/border-style:\s*solid/);
  });

  it('paints the page from the semantic aliases', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/background-color:\s*var\(--background\)/);
    expect(css).toMatch(/color:\s*var\(--foreground\)/);
    expect(css).toMatch(/font-family:\s*var\(--font-sans\)/);
  });

  it('gives identifiers the mono face and focus a visible ring', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/font-family:\s*var\(--font-mono\)/);
    expect(css).toMatch(/outline:\s*2px\s+solid\s+var\(--ring\)/);
  });

  it('declares color-scheme for all three theme states', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/color-scheme:\s*light\s+dark/);
    expect(css).toMatch(/color-scheme:\s*dark/);
    expect(css).toMatch(/color-scheme:\s*light[;}]/);
  });
});
