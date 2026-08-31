import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allBuiltCss, builtCatalog } from './facet-rail.test.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

describe('catalog sort tabs', () => {
  const html = builtCatalog('en');

  it('renders five sort tabs as links, not a select', () => {
    const tabs = [...html.matchAll(/data-sort-tab="([a-z]+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(html).not.toMatch(/<select[^>]*data-sort/);
  });

  it('gives each sort a distinct URL, with score as the bare default', () => {
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/"[^>]*data-sort-tab="score"/);
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/\?sort=stars"[^>]*data-sort-tab="stars"/);
    expect(html).toMatch(/href="\/ai-tools-hub\/en\/catalog\/\?sort=updated"[^>]*data-sort-tab="updated"/);
  });

  it('marks the default tab as current', () => {
    expect(html).toMatch(/data-sort-tab="score"[^>]*aria-current="page"/);
  });
});

describe('catalog results region', () => {
  const html = builtCatalog('en');

  it('gives the results heading its own focusable id, distinct from the layout skip target', () => {
    expect(html).toMatch(/<h2[^>]*id="results-heading"[^>]*tabindex="-1"/);
    expect(
      (html.match(/id="results"/g) ?? []).length,
      'id="results" belongs to the Layout <main> and must appear exactly once',
    ).toBe(1);
  });

  it('announces the result count politely, not per keystroke', () => {
    expect(html).toMatch(/data-count[^>]*aria-live="polite"/);
    expect(html).toMatch(/data-count[^>]*aria-atomic="true"/);
  });

  it('keeps the catalog page itself out of the search index', () => {
    expect(html).toContain('data-pagefind-ignore');
    expect(html).not.toContain('data-pagefind-body');
  });
});

describe('catalog card grid', () => {
  const html = builtCatalog('en');
  const css = allBuiltCss();
  const items = [...html.matchAll(/<li[^>]*data-catalog-item[^>]*>/g)].map((m) => m[0]);

  it('renders one wrapper per skill, keyed by the id Pagefind also indexes', () => {
    expect(items.length).toBeGreaterThan(0);
    const ids = items.map((tag) => tag.match(/data-skill-id="([^"]+)"/)?.[1]);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists only the entries that survived the per-subdomain cap', () => {
    const rows = JSON.parse(readFileSync(resolve(root, 'data/skills.json'), 'utf8')) as {
      id: string;
      listed: boolean;
    }[];
    const evicted = new Set(rows.filter((row) => !row.listed).map((row) => row.id));
    for (const tag of items) {
      const id = tag.match(/data-skill-id="([^"]+)"/)?.[1] ?? '';
      expect(evicted.has(id), `evicted skill "${id}" is still on the catalog`).toBe(false);
    }
    expect(items.length).toBe(rows.length - evicted.size);
  });

  it('orders every wrapper explicitly and hides only what falls past the first page', () => {
    items.forEach((tag, i) => {
      expect(tag).toContain(`style="order:${i}"`);
      expect(tag.includes(' hidden')).toBe(i >= 24);
    });
  });

  it('exposes a renumberable rank on the wrapper and inside the card', () => {
    for (const [i, tag] of items.entries()) expect(tag).toContain(`data-rank="${i + 1}"`);
    expect(
      (html.match(/data-rank/g) ?? []).length,
      "B4's SkillCard must render its rank inside an element carrying data-rank",
    ).toBeGreaterThanOrEqual(items.length * 2);
  });

  it('degrades 6 columns to 5 below 1500px and 4 below 1280px', () => {
    // Lightning CSS rewrites `@media (max-width: 1499px)` into the modern range syntax
    // `@media (width<=1499px)`, so accept either spelling of the same breakpoint.
    const atMost = (px: number): string => `(?:\\(max-width:${px}px\\)|\\(width<=${px}px\\))`;
    expect(css).toMatch(/\.catalog-grid\{[^}]*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    expect(css).toMatch(
      new RegExp(`@media${atMost(1499)}\\{\\.catalog-grid\\{grid-template-columns:repeat\\(5,minmax\\(0,1fr\\)\\)\\}`),
    );
    expect(css).toMatch(
      new RegExp(`@media${atMost(1279)}\\{\\.catalog-grid\\{grid-template-columns:repeat\\(4,minmax\\(0,1fr\\)\\)\\}`),
    );
  });

  it('shows every card when JavaScript is off, since pagination would be a lie', () => {
    // Not positional: B3.10 prepends a rule of its own to this same block, and the rule that
    // matters is that hidden cards are forced visible, not that it comes first.
    const noscript = html.match(/<noscript><style>([\s\S]*?)<\/style><\/noscript>/)?.[1] ?? '';
    expect(noscript).toContain('[data-catalog-item][hidden]{display:flex!important}');
  });
});
