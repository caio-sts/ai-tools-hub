import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const FILE = 'src/components/A11yBehavior.astro';

function source(): string {
  if (!existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  return readFileSync(FILE, 'utf8');
}

describe('A11yBehavior', () => {
  it('imports both helpers with explicit .ts extensions', () => {
    const text = source();
    expect(text).toContain("from '../lib/focus.ts'");
    expect(text).toContain("from '../lib/stickyOffset.ts'");
  });

  it('delegates on the clear-all control and targets B3 results heading', () => {
    const text = source();
    expect(text).toContain('[data-clear-all]');
    expect(text).toContain('#results-heading');
  });

  it('never steals the skip-link target the layout owns', () => {
    expect(source(), '#results is B1 main element').not.toMatch(/['"]#results['"]/);
  });

  it('measures the site header without requiring a new hook on the layout', () => {
    expect(source()).toContain("querySelector<HTMLElement>('body > header')");
  });

  it('ships the pre-JS --header-h fallback and the scroll offset rule globally', () => {
    const text = source();
    expect(text).toContain('is:global');
    expect(text).toContain('--header-h: 56px');
    expect(text).toMatch(/:where\(\[id\]\)\s*\{\s*scroll-margin-top:\s*calc\(var\(--header-h\)/);
    expect(text).toMatch(/body\s*>\s*header\s*\{[^}]*position:\s*sticky/);
  });

  it('never reaches for the hazard token, which the safety module owns alone', () => {
    expect(source()).not.toContain('--color-hazard');
  });

  it('renders no visible markup of its own', () => {
    expect(source()).not.toMatch(/<div|<section|<nav|<p /);
  });
});
