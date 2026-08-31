import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STALE_DAYS } from '../../src/lib/format.ts';
import { t } from '../../src/lib/i18n/index.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(ROOT, 'dist');

function built(page: string): string {
  const file = join(DIST, page);
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Astro may inline a small stylesheet or emit it as a file; look in both. */
function allStyles(): string {
  const files = walk(DIST);
  const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(f, 'utf8'));
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    for (const match of readFileSync(file, 'utf8').matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
      css.push(match[1]);
    }
  }
  return css.join('\n');
}

function refreshCell(html: string): string {
  const match = html.match(/<dd[^>]*data-stat="refresh"[\s\S]*?<\/dd>/);
  if (match === null) throw new Error('the built page has no <dd data-stat="refresh"> cell');
  return match[0];
}

function refreshDays(html: string): number {
  const match = refreshCell(html).match(/data-days="(\d+)"/);
  if (match === null) throw new Error('the refresh cell carries no data-days attribute');
  return Number(match[1]);
}

const pages = [
  { lang: 'en' as const, html: built('en/index.html') },
  { lang: 'pt' as const, html: built('pt/index.html') },
];
const styles = allStyles();

describe('the last-refresh cell', () => {
  it('states plainly whether the crawl is stale', () => {
    for (const { lang, html } of pages) {
      const declared = /data-stale="(true|false)"/.test(refreshCell(html));
      expect(declared, `${lang}: the refresh cell does not say whether the crawl is stale`).toBe(
        true,
      );
    }
  });

  it('flags exactly the crawls past the one shared STALE_DAYS threshold', () => {
    for (const { lang, html } of pages) {
      const days = refreshDays(html);
      const stale = /data-stale="true"/.test(refreshCell(html));
      expect(
        stale,
        `${lang}: data-stale disagrees with data-days="${days}" at STALE_DAYS=${STALE_DAYS}`,
      ).toBe(days > STALE_DAYS);
    }
  });

  it('says it in words as well as in colour, per WCAG 1.4.1', () => {
    for (const { lang, html } of pages) {
      const cell = refreshCell(html);
      const stale = /data-stale="true"/.test(cell);
      expect(cell.includes(t('home.staleNote', lang)), `${lang}: stale note out of step`).toBe(
        stale,
      );
    }
  });

  it('carries the hazard class only while it is stale', () => {
    for (const { lang, html } of pages) {
      const cell = refreshCell(html);
      const stale = /data-stale="true"/.test(cell);
      expect(cell.includes('meta__updated--stale'), `${lang}: hazard class out of step`).toBe(stale);
    }
  });

  it('reads hazard orange from the stale-date selector', () => {
    const found = /\.meta__updated--stale[^{}]*\{[^}]*var\(--color-hazard\)/.test(styles);
    expect(found, 'no .meta__updated--stale rule reads var(--color-hazard)').toBe(true);
  });

  it('spells the token exactly, with no variant and no fallback', () => {
    expect(styles.includes('--color-hazard-9'), 'there is no --color-hazard-9').toBe(false);
    expect(styles.includes('var(--hazard'), 'there is no --hazard token').toBe(false);
    expect(
      styles.includes('var(--color-hazard,'),
      'a fallback would hide the token from the site-wide guard',
    ).toBe(false);
  });
});
