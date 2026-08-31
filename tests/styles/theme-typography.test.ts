import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions, collectCustomProps } from './built-css.ts';

const SCALE = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];

describe('typography tokens', () => {
  it('names Archivo for prose and JetBrains Mono for identifiers', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/--font-sans\s*:[^;]*Archivo/);
    expect(css).toMatch(/--font-mono\s*:[^;]*JetBrains Mono/);
  });

  it('loads both webfont families', () => {
    const css = readBuiltCss('dist');
    expect(css).toContain('fonts.googleapis.com');
    expect(css).toContain('Archivo');
    expect(css).toContain('JetBrains+Mono');
  });

  it('defines a spacing base unit', () => {
    // The built CSS is minified: Lightning CSS drops the leading zero from 0.25rem.
    expect(readBuiltCss('dist')).toMatch(/--spacing\s*:\s*0?\.25rem/);
  });

  it('defines exactly nine text steps, each with a line height', () => {
    const { outside } = splitMediaRegions(readBuiltCss('dist'));
    const props = collectCustomProps(outside);
    for (const step of SCALE) {
      expect(props.has(`--text-${step}`)).toBe(true);
      expect(props.has(`--text-${step}--line-height`)).toBe(true);
    }
    const sizes = [...props].filter((p) => /^--text-[^-]+$/.test(p));
    expect(sizes.sort()).toEqual(SCALE.map((s) => `--text-${s}`).sort());
  });

  it('drops the serif family', () => {
    expect(readBuiltCss('dist')).not.toMatch(/--font-serif\s*:\s*ui-serif/);
  });
});
