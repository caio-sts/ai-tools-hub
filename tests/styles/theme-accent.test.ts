import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { readBuiltCss, splitMediaRegions, collectCustomProps, SEMANTIC_TOKENS } from './built-css.ts';

const STEPS = Array.from({ length: 12 }, (_, i) => `--color-a-${i + 1}`);

describe('accent ramp', () => {
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
});

describe('hazard token', () => {
  it('emits exactly one hazard token, named --color-hazard', () => {
    const css = readBuiltCss('dist');
    expect(css).toMatch(/--color-hazard\s*:\s*oklch\(/);
    const named = [...collectCustomProps(css)].filter((prop) => prop.includes('hazard')).sort();
    expect(named).toEqual(['--color-hazard']);
  });

  it('generates no hazard utility, so nobody can write bg-hazard', () => {
    const css = readBuiltCss('dist');
    expect(css).not.toContain('.bg-hazard');
    expect(css).not.toContain('.text-hazard');
    expect(css).not.toContain('.border-hazard');
  });

  it('is never reachable through a shadcn semantic alias (§9.2 reservation)', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    for (const token of SEMANTIC_TOKENS) {
      const declarations = source.match(new RegExp(`${token}\\s*:[^;]*;`, 'g')) ?? [];
      for (const declaration of declarations) {
        expect(declaration).not.toContain('hazard');
      }
    }
  });
});
