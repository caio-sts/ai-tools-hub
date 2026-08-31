import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  readBuiltCss,
  splitMediaRegions,
  collectCustomProps,
  stripCssComments,
  SEMANTIC_TOKENS,
} from './built-css.ts';

function declarationsOf(body: string): string[] {
  return body
    .split(';')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .sort();
}

describe('three-state theming', () => {
  it('never uses CSS light-dark()', () => {
    // Comments are stripped: the file documents in prose why light-dark() is avoided.
    const css = stripCssComments(readFileSync('src/styles/theme.css', 'utf8'));
    expect(css).not.toContain('light-dark(');
  });

  it('guards the media override so an explicit light choice wins', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    expect(source).toContain('@media (prefers-color-scheme: dark)');
    expect(source).toContain(':root:not([data-theme="light"])');
    expect(source).toContain(':root[data-theme="dark"]');
  });

  it('keeps the two dark blocks declaring identical values', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    const media = /:root:not\(\[data-theme="light"\]\)\s*\{([^}]*)\}/.exec(source);
    const attribute = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(source);
    expect(media).not.toBeNull();
    expect(attribute).not.toBeNull();
    expect(declarationsOf(media![1])).toEqual(declarationsOf(attribute![1]));
  });

  it('defines no colour ONLY inside a media query', () => {
    const { outside, inside } = splitMediaRegions(readBuiltCss('dist'));
    const declaredOutside = collectCustomProps(outside);
    const colourish = [...collectCustomProps(inside)].filter(
      (prop) => prop.startsWith('--color-') || (SEMANTIC_TOKENS as readonly string[]).includes(prop),
    );
    expect(colourish.length).toBeGreaterThan(0);
    const orphans = colourish.filter((prop) => !declaredOutside.has(prop)).sort();
    expect(orphans).toEqual([]);
  });

  it('re-points the ramps rather than the aliases, so aliases stay single-sourced', () => {
    const source = readFileSync('src/styles/theme.css', 'utf8');
    const attribute = /:root\[data-theme="dark"\]\s*\{([^}]*)\}/.exec(source)![1];
    expect(attribute).toContain('--color-n-1');
    expect(attribute).toContain('--color-a-9');
    expect(attribute).toContain('--color-hazard');
    expect(attribute).toContain('--destructive');
    expect(attribute).not.toContain('--background');
    expect(attribute).not.toContain('--muted-foreground');
  });
});
