import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** Tag-stripped page text, so a formula split across elements still reads as one line. */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function page(lang: 'en' | 'pt'): string {
  const file = `dist/${lang}/methodology/index.html`;
  if (!existsSync(file)) {
    throw new Error(`Missing ${file} — the methodology route does not exist yet`);
  }
  return readFileSync(file, 'utf8');
}

function catalog(lang: 'en' | 'pt'): string {
  const file = `dist/${lang}/catalog/index.html`;
  if (!existsSync(file)) throw new Error(`Missing ${file} — the catalog route did not build`);
  return readFileSync(file, 'utf8');
}

describe('the methodology page discharges spec §10.6', () => {
  it('renders all six sections as linkable anchors', () => {
    const html = page('en');
    for (const id of ['score', 'inclusion', 'safety', 'counting', 'taxonomy', 'provenance']) {
      expect(html, `missing anchor #${id}`).toContain(`id="${id}"`);
    }
  });

  it('publishes the formula with all four weights', () => {
    const html = page('en');
    expect(html).toContain('Adoption 25');
    expect(html).toContain('Maintenance 30');
    expect(html).toContain('Provenance 25');
    expect(html).toContain('Completeness 20');
  });

  // The page states the formula so a reader can reproduce the ranking. Nothing compared it to the
  // spec that defines it, so the two could have drifted silently — which is the whole failure the
  // page exists to prevent.
  it('states the formula exactly as the spec defines it', () => {
    const spec = readFileSync(resolve(ROOT, 'docs/specs/2026-08-29-ai-tools-hub-design.md'), 'utf8');
    const line = spec.match(/^SCORE = .+$/m)?.[0] ?? '';
    expect(line, 'no SCORE line found in the spec').not.toBe('');
    const formula = line.replace(/\s*\(max 100\)\s*$/, '').trim();
    for (const lang of ['en', 'pt'] as const) {
      expect(text(page(lang))).toContain(formula);
    }
  });

  it('renders each score term as its own row, with its weight', () => {
    const html = page('en');
    for (const [term, weight] of [['Adoption', 25], ['Maintenance', 30], ['Provenance', 25], ['Completeness', 20]]) {
      expect(html).toMatch(new RegExp(`data-term="${String(term).toLowerCase()}"`));
      expect(html).toContain(`>${weight}</span>`);
    }
  });

  it('says why safety is not an input', () => {
    expect(page('en')).toContain('Safety is deliberately not an input');
  });

  it('publishes the inclusion filter as an explicit rule list', () => {
    const html = page('en');
    expect(html).toContain('.claude/skills/');
    expect(html).toContain('at least 10 stars');
    expect(html).toContain('One entry per publisher per concept');
  });

  it('publishes the counting rules', () => {
    const html = page('en');
    expect(html).toContain('Symlinks are skipped');
    expect(html).toContain('blob SHA');
  });

  it('publishes the taxonomy naming rule with the live PROTECTED list and aliases', () => {
    const html = page('en');
    expect(html).toContain('Protected terms');
    expect(html).toContain('Supply Chain');
    expect(html).toContain('CI/CD');
    expect(html).toContain('Aliases');
    expect(html).toMatch(/data-minimum-mass="\d+"/);
  });

  it('publishes provenance and both freshness dates as separate figures', () => {
    const html = page('en');
    expect(html).toContain('owner/repo@commit:path');
    // Astro renders an empty-string attribute bare, and classifiedAt is genuinely null until the
    // classification session has run — so accept both forms rather than fabricate a placeholder.
    expect(html).toMatch(/data-crawled-at(="[^"]*")?[\s>]/);
    expect(html).toMatch(/data-classified-at(="[^"]*")?[\s>]/);
  });

  it('is hand-written in pt-BR, with no English prose leaking through', () => {
    const pt = page('pt');
    expect(pt).toContain('Metodologia');
    expect(pt).toContain('Filtro de inclusão');
    expect(pt).toContain('Superfície de risco');
    expect(pt).not.toContain('Safety is deliberately not an input');
  });

  it('keeps the pt-BR page on the protected technical terms', () => {
    const pt = page('pt');
    expect(pt).toContain('Supply Chain');
    expect(pt).not.toContain('cadeia de suprimentos');
  });

  it('resolves the score chip link B4 already renders on every card', () => {
    const chip = catalog('en').match(/<a[^>]*data-field="score"[^>]*>/);
    expect(chip, 'B4 renders no [data-field="score"] anchor on the catalog').not.toBeNull();
    expect(chip![0]).toContain('href="/ai-tools-hub/en/methodology/#score"');
    expect(page('en')).toContain('id="score"');
  });

  it('keeps the pt-BR chip inside its own locale', () => {
    const chip = catalog('pt').match(/<a[^>]*data-field="score"[^>]*>/);
    expect(chip).not.toBeNull();
    expect(chip![0]).toContain('href="/ai-tools-hub/pt/methodology/#score"');
    expect(page('pt')).toContain('id="score"');
  });
});
