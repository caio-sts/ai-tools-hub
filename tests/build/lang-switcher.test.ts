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

describe('language switcher', () => {
  it('offers both locales on the page', () => {
    const page = built('index.html');
    expect(page.includes('data-lang-switcher'), 'no switcher in dist/index.html').toBe(true);
    expect(page.includes('data-lang="en"'), 'no en option').toBe(true);
    expect(page.includes('data-lang="pt"'), 'no pt option').toBe(true);
  });

  it('labels the options in the page language', () => {
    const page = built('index.html');
    expect(page.includes('Portuguese (Brazil)'), 'the pt option is not labelled in English').toBe(
      true,
    );
  });

  it('marks the active locale for assistive tech, and only that one', () => {
    const page = built('index.html');
    expect(/data-lang="en"[^>]*aria-current="page"/.test(page), 'en is not current').toBe(true);
    expect(/data-lang="pt"[^>]*aria-current="page"/.test(page), 'pt is wrongly current').toBe(
      false,
    );
  });

  it('persists the choice behind a guarded localStorage write', () => {
    const page = built('index.html');
    expect(page.includes('aith:lang'), 'the storage key never reaches the page').toBe(true);
    expect(page.includes('localStorage.setItem'), 'nothing writes the choice').toBe(true);
    expect(/catch\s*[({]/.test(page), 'the storage write is unguarded').toBe(true);
  });

  it('prefers a remembered choice at the site root, behind a guarded read', () => {
    const page = built('index.html');
    expect(page.includes('localStorage.getItem'), 'the root never reads the choice').toBe(true);
    expect(page.includes('location.replace'), 'the root never acts on the choice').toBe(true);
  });
});
