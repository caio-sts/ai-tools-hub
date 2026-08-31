import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT, distFiles, sheets } from '../helpers/skill-card.ts';

const ALLOWED = ['.safety-row--hazard', '.meta__updated--stale', '.license__value--undeclared'];
const UTILITY = /^\.(?:text|bg|border|fill|stroke|ring|outline|decoration|shadow|from|via|to|accent|caret)-hazard\b/;
const SHEETS = sheets();

/** Selectors of every rule whose declarations read var(--color-hazard). */
function selectorsUsingHazard(css: string): string[] {
  const found: string[] = [];
  let at = css.indexOf('var(--color-hazard)');
  while (at !== -1) {
    const braceAt = css.lastIndexOf('{', at);
    const start = Math.max(css.lastIndexOf('}', braceAt), css.lastIndexOf('{', braceAt - 1)) + 1;
    for (const part of css.slice(start, braceAt).split(',')) {
      // Astro scopes a rule by appending [data-astro-cid-…]; strip it before comparing.
      const normalised = part.replace(/\[data-astro-cid-[^\]]*\]/g, '').trim();
      if (normalised) found.push(normalised);
    }
    at = css.indexOf('var(--color-hazard)', at + 1);
  }
  return found;
}

describe('the hazard token', () => {
  it('is defined, and only ever on a root selector in the theme', () => {
    const defining = SHEETS.filter(({ css }) => /--color-hazard\s*:/.test(css));
    expect(defining.length).toBeGreaterThan(0);
    for (const sheet of defining) {
      expect(sheet.css, `${sheet.from} defines --color-hazard outside :root`).toMatch(/:root|@theme/);
    }
  });

  it('is actually used somewhere', () => {
    expect(SHEETS.some(({ css }) => css.includes('var(--color-hazard)'))).toBe(true);
  });

  it('is read by the safety, staleness and undeclared-license selectors only', () => {
    for (const { from, css } of SHEETS) {
      // Same carve-out the utility check below already makes: /styleguide exists to render every
      // token and every component state (§9.1), so its hazard specimens are its job, not a leak.
      if (from.includes('styleguide')) continue;
      for (const selector of selectorsUsingHazard(css)) {
        if (UTILITY.test(selector)) continue; // proven styleguide-only by the utility test below
        expect(ALLOWED, `${from} lets "${selector}" read --color-hazard`).toContain(selector);
      }
    }
  });

  it('reaches all three of its allowed selectors', () => {
    const used = new Set(SHEETS.flatMap(({ css }) => selectorsUsingHazard(css)));
    for (const selector of ALLOWED) {
      expect([...used], `nothing renders ${selector}`).toContain(selector);
    }
  });

  it('is never reached through a utility class outside the styleguide', () => {
    for (const file of distFiles('.html')) {
      const where = relative(ROOT, file);
      if (where.includes('styleguide')) continue;
      expect(readFileSync(file, 'utf8'), `${where} uses a hazard utility class`).not.toMatch(
        /class="[^"]*\b(?:text|bg|border|fill|stroke|ring|outline|decoration|shadow)-hazard\b/,
      );
    }
  });

  it('never colours a safety row green or any other success hue', () => {
    for (const { from, css } of SHEETS) {
      expect(css, `${from} defines a success state for a safety row`).not.toMatch(
        /\.safety-row--(?:ok|safe|pass|good|success)/,
      );
    }
  });
});
