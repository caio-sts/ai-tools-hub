import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMeta } from '../../src/lib/data.ts';
import { compactNumber, relativeDays } from '../../src/lib/format.ts';
import { t } from '../../src/lib/i18n/index.ts';
import { loadTaxonomy } from '../../src/lib/taxonomy.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** vitest.config.ts builds once in globalSetup (RULE 6); no test here builds anything. */
function built(page: string): string {
  const file = `${ROOT}dist/${page}`;
  if (!existsSync(file)) {
    throw new Error(`dist/${page} was not built — read the globalSetup "astro build" output`);
  }
  return readFileSync(file, 'utf8');
}

function statTag(html: string, key: string): string {
  const match = html.match(new RegExp(`<dd[^>]*data-stat="${key}"[^>]*>`));
  if (match === null) throw new Error(`the built page has no <dd data-stat="${key}"> cell`);
  return match[0];
}

function statValue(html: string, key: string): string {
  const match = html.match(new RegExp(`<dd[^>]*data-stat="${key}"[^>]*>([^<]*)`));
  if (match === null) throw new Error(`the built page has no <dd data-stat="${key}"> cell`);
  return match[1].trim();
}

function refreshDays(html: string): number {
  const match = statTag(html, 'refresh').match(/data-days="(\d+)"/);
  if (match === null) throw new Error('the refresh cell carries no data-days attribute');
  return Number(match[1]);
}

const en = built('en/index.html');
const pt = built('pt/index.html');
const meta = loadMeta();
const taxonomy = loadTaxonomy();

describe('home page shell', () => {
  it('renders one page per routed locale, each in its own document language', () => {
    expect(en.includes('<html lang="en"'), 'the en route is not lang="en"').toBe(true);
    expect(pt.includes('<html lang="pt-BR"'), 'the pt route is not lang="pt-BR"').toBe(true);
  });

  it('opens with the thesis and one supporting sentence, from core.ts', () => {
    expect(en.includes(t('site.thesis', 'en')), 'no en thesis').toBe(true);
    expect(en.includes(t('site.support', 'en')), 'no en supporting sentence').toBe(true);
    expect(pt.includes(t('site.thesis', 'pt')), 'no pt thesis').toBe(true);
    expect(pt.includes(t('site.support', 'pt')), 'no pt supporting sentence').toBe(true);
  });

  it('never leaks the English thesis into the Portuguese page', () => {
    expect(pt.includes(t('site.thesis', 'en')), 'English thesis on the pt route').toBe(false);
  });

  it('shows the skill and source counts meta.json actually holds', () => {
    expect(statValue(en, 'skills')).toBe(compactNumber(meta.skillCount, 'en'));
    expect(statValue(en, 'sources')).toBe(compactNumber(meta.sourceCount, 'en'));
    expect(statValue(pt, 'skills')).toBe(compactNumber(meta.skillCount, 'pt'));
  });

  it('reads the domain count off the taxonomy rather than hard-coding 13', () => {
    expect(statValue(en, 'domains')).toBe(compactNumber(taxonomy.domains.length, 'en'));
  });

  it('exposes the crawl age as a machine-readable whole number of days', () => {
    const days = refreshDays(en);
    expect(Number.isInteger(days) && days >= 0, `data-days="${days}" is not a day count`).toBe(true);
  });

  it('prints that same day count as the locale-aware label', () => {
    expect(statValue(en, 'refresh')).toBe(relativeDays(refreshDays(en), 'en'));
    expect(statValue(pt, 'refresh')).toBe(relativeDays(refreshDays(pt), 'pt'));
  });

  it('agrees with meta.json about how old the crawl is', () => {
    const expected = Math.max(
      0,
      Math.floor((Date.now() - Date.parse(meta.crawledAt)) / 86_400_000),
    );
    const drift = Math.abs(refreshDays(en) - expected);
    expect(drift <= 1, `rendered crawl age is ${drift} days away from meta.json`).toBe(true);
  });

  it('labels the strip in both locales, from the keys this section owns', () => {
    expect(en.includes(t('stats.lastRefresh', 'en')), 'no en refresh label').toBe(true);
    expect(pt.includes(t('stats.lastRefresh', 'pt')), 'no pt refresh label').toBe(true);
    expect(pt.includes(t('stats.domains', 'pt')), 'no pt domains label').toBe(true);
  });

  it('links into the catalog through the configured base path', () => {
    expect(en).toMatch(/<a[^>]+href="\/ai-tools-hub\/en\/catalog\/"/);
    expect(pt).toMatch(/<a[^>]+href="\/ai-tools-hub\/pt\/catalog\/"/);
  });
});
