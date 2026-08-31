import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(process.cwd(), 'dist');

function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

describe('theme control', () => {
  it('offers all three states, labelled', () => {
    const page = built('index.html');
    expect(page.includes('data-theme-control'), 'no theme control').toBe(true);
    for (const mode of ['system', 'light', 'dark']) {
      expect(page.includes(`data-theme-option="${mode}"`), `no ${mode} option`).toBe(true);
    }
    expect(page.includes('>System<'), 'the system option is unlabelled').toBe(true);
  });

  it('exposes the pressed state to assistive tech', () => {
    expect(built('index.html').includes('aria-pressed'), 'no aria-pressed on the options').toBe(
      true,
    );
  });

  it('resolves the stored theme in the head, before the first paint', () => {
    const head = built('index.html').split('</head>')[0] ?? '';
    expect(head.includes('aith:theme'), 'the theme key is not read in the head').toBe(true);
    expect(head.includes('data-theme'), 'the head script never sets data-theme').toBe(true);
    expect(/catch\s*[({]/.test(head), 'the storage read is unguarded').toBe(true);
  });
});
