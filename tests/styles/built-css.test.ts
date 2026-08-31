import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stripCssComments,
  collectFiles,
  readBuiltCss,
  splitMediaRegions,
  collectCustomProps,
  SEMANTIC_TOKENS,
} from './built-css.ts';

let root: string;

// A synthetic dist/ in a temp dir — this file never reads the real dist/.
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'built-css-'));
  mkdirSync(join(root, '_astro'), { recursive: true });
  mkdirSync(join(root, 'styleguide'), { recursive: true });
  writeFileSync(
    join(root, '_astro', 'site.css'),
    ':root{--a:1;--b:2}/* a comment */@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--b:3;--c:4}}',
    'utf8',
  );
  writeFileSync(
    join(root, 'styleguide', 'index.html'),
    '<html><head><style>:root{--d:5}</style></head><body>hi</body></html>',
    'utf8',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('stripCssComments', () => {
  it('removes block comments', () => {
    expect(stripCssComments('a{}/* x */b{}')).toBe('a{}b{}');
  });
});

describe('collectFiles', () => {
  it('walks nested directories and filters by extension', () => {
    expect(collectFiles(root, '.css')).toEqual([join(root, '_astro', 'site.css')]);
    expect(collectFiles(root, '.html')).toEqual([join(root, 'styleguide', 'index.html')]);
  });
});

describe('readBuiltCss', () => {
  it('concatenates linked stylesheets and inline <style> blocks, comments stripped', () => {
    const css = readBuiltCss(root);
    expect(css).toContain('--a:1');
    expect(css).toContain('--d:5');
    expect(css).not.toContain('a comment');
  });
});

describe('splitMediaRegions', () => {
  it('separates declarations inside @media from declarations outside it', () => {
    const { outside, inside } = splitMediaRegions(readBuiltCss(root));
    expect(collectCustomProps(outside)).toEqual(new Set(['--a', '--b', '--d']));
    expect(collectCustomProps(inside)).toEqual(new Set(['--b', '--c']));
  });

  it('handles nested braces inside a media block', () => {
    const { inside } = splitMediaRegions('@media (x){@supports (y){:root{--z:1}}}:root{--q:2}');
    expect(collectCustomProps(inside)).toEqual(new Set(['--z']));
  });
});

describe('collectCustomProps', () => {
  it('collects declared names only, never var() references', () => {
    expect(collectCustomProps(':root{--x:var(--y)}')).toEqual(new Set(['--x']));
  });
});

describe('SEMANTIC_TOKENS', () => {
  it('lists the 19 shadcn colour aliases', () => {
    expect(SEMANTIC_TOKENS).toHaveLength(19);
    expect(SEMANTIC_TOKENS).toContain('--background');
    expect(SEMANTIC_TOKENS).toContain('--ring');
    expect(SEMANTIC_TOKENS).not.toContain('--radius');
  });
});
