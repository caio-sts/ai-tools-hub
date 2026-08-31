import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps, SEMANTIC_TOKENS } from './built-css.ts';

describe('shadcn semantic aliases', () => {
  it('defines all 19 colour aliases outside any media query', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const token of SEMANTIC_TOKENS) expect(props.has(token)).toBe(true);
  });

  it('defines --radius as zero (Industrial Console has no radius)', () => {
    expect(readBuiltCss('dist')).toMatch(/--radius\s*:\s*0(px)?\s*[;}]/);
  });

  it('generates shadcn-compatible utilities that follow the theme at runtime', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/\.bg-background\s*\{\s*background-color:\s*var\(--background\)/);
    expect(css).toMatch(/\.text-foreground\s*\{\s*color:\s*var\(--foreground\)/);
  });

  it('never routes a semantic alias to the hazard token', () => {
    const css = readBuiltCss('dist');
    for (const token of SEMANTIC_TOKENS) {
      const declaration = new RegExp(`${token}\\s*:\\s*var\\(--color-hazard\\)`);
      expect(css).not.toMatch(declaration);
    }
  });
});
