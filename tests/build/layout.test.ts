import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIST = resolve(process.cwd(), 'dist');

/** Reads a page the vitest globalSetup build emitted. No test here ever runs a build. */
function built(relativePath: string): string {
  const file = resolve(DIST, relativePath);
  if (!existsSync(file)) {
    throw new Error(`dist/${relativePath} was not emitted by the globalSetup astro build`);
  }
  return readFileSync(file, 'utf8');
}

/**
 * Assertions read DOM hooks, never class attributes: Astro 7 rewrites the class list of any
 * element in a component with scoped styles by appending data-astro-cid-*.
 */
describe('Layout chrome', () => {
  it('renders the header, the results landmark and the footer', () => {
    const page = built('index.html');
    expect(page.includes('data-site-header'), 'dist/index.html has no data-site-header').toBe(true);
    expect(page.includes('id="results"'), 'dist/index.html has no id="results"').toBe(true);
    expect(page.includes('data-site-footer'), 'dist/index.html has no data-site-footer').toBe(true);
  });

  it('puts the skip link first in the body, per WCAG 2.4.1', () => {
    const body = built('index.html').split('<body')[1] ?? '';
    const firstAnchor = body.match(/<a[^>]*>/);
    expect(firstAnchor !== null, 'no anchor at all in the body').toBe(true);
    expect(
      (firstAnchor?.[0] ?? '').includes('data-skip-link'),
      'the first anchor in the body is not the skip link',
    ).toBe(true);
    expect(
      (firstAnchor?.[0] ?? '').includes('href="#results"'),
      'the skip link does not target #results',
    ).toBe(true);
  });

  it('reaches the catalog and the methodology page from the footer', () => {
    const page = built('index.html');
    expect(
      page.includes('href="/ai-tools-hub/en/catalog/"'),
      'no base-prefixed catalog link',
    ).toBe(true);
    const footer = page.split('data-site-footer')[1] ?? '';
    expect(footer.includes('data-footer-link'), 'the footer has no navigation link').toBe(true);
    expect(
      footer.includes('href="/ai-tools-hub/en/catalog/"'),
      'the footer does not reach the catalog',
    ).toBe(true);
    expect(
      footer.includes('href="/ai-tools-hub/en/methodology/"'),
      'the footer does not reach the methodology page (spec §10.6)',
    ).toBe(true);
  });

  it('declares a canonical URL and both hreflang alternates', () => {
    const page = built('index.html');
    expect(
      page.includes('rel="canonical" href="/ai-tools-hub/en/"'),
      'no canonical link to the default locale',
    ).toBe(true);
    expect(
      page.includes('rel="alternate" hreflang="en" href="/ai-tools-hub/en/"'),
      'no en alternate',
    ).toBe(true);
    expect(
      page.includes('rel="alternate" hreflang="pt-BR" href="/ai-tools-hub/pt/"'),
      'no pt-BR alternate',
    ).toBe(true);
  });

  it('composes the document title from the page title and the site name', () => {
    expect(
      built('index.html').includes('<title>Choose your language · AI Tools Hub</title>'),
      'the composed <title> is missing',
    ).toBe(true);
  });
});

describe('language gateway at the site root', () => {
  it('sends a visitor without JavaScript to the default locale', () => {
    const page = built('index.html');
    expect(page.includes('http-equiv="refresh"'), 'no meta refresh').toBe(true);
    expect(
      page.includes('content="0; url=/ai-tools-hub/en/"'),
      'the meta refresh does not target the base-prefixed default locale',
    ).toBe(true);
  });

  it('offers both locales as real, base-prefixed links', () => {
    const page = built('index.html');
    expect(page.includes('href="/ai-tools-hub/en/"'), 'no link to /en/').toBe(true);
    expect(page.includes('href="/ai-tools-hub/pt/"'), 'no link to /pt/').toBe(true);
  });

  it('labels each locale in its own language', () => {
    const page = built('index.html');
    expect(page.includes('English'), 'the English option is unlabelled').toBe(true);
    expect(page.includes('Português (Brasil)'), 'the Portuguese option is not in Portuguese').toBe(
      true,
    );
  });

  it('declares the document language', () => {
    expect(built('index.html').includes('<html lang="en"'), 'no lang on <html>').toBe(true);
  });
});
