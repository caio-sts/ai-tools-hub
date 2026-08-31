import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

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
