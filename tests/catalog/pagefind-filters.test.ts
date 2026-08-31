import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INDEX_FILTER_KEYS, pagefindIndexAttrs } from '../../src/lib/facets.ts';
import { skill } from './facets-index.test.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** Every built skill page, listed or evicted — B4 generates one for each row (§5.1). */
export function skillPages(): string[] {
  const start = resolve(root, 'dist/en/skills');
  if (!existsSync(start)) throw new Error('dist/en/skills not found; A1 global setup did not build the site');
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'index.html') out.push(readFileSync(full, 'utf8'));
    }
  };
  walk(start);
  if (out.length === 0) throw new Error('no built skill page found under dist/en/skills');
  return out;
}

/** Only the pages Pagefind will actually index — an evicted skill's page carries no block. */
export function indexedSkillPages(): string[] {
  const indexed = skillPages().filter((page) => page.includes('data-pagefind-body'));
  if (indexed.length === 0) {
    throw new Error('no built skill page carries data-pagefind-body; the search index would be empty');
  }
  return indexed;
}

function isNoindex(page: string): boolean {
  return (page.match(/<meta[^>]*content="noindex"[^>]*>/)?.[0] ?? '').includes('name="robots"');
}

describe('pagefindIndexAttrs', () => {
  it('emits the five flat keys once each, in index order', () => {
    const attrs = pagefindIndexAttrs(skill(), null);
    expect([...new Set(attrs.filters.map((f) => f.key))]).toEqual([...INDEX_FILTER_KEYS]);
    expect(attrs.sorts.map((s) => s.key)).toEqual(['score', 'stars', 'forks', 'newest', 'updated']);
    expect(attrs.id).toBe('acme/kit@abc123:skills/scan/SKILL.md');
  });

  it('carries the text Pagefind should actually match on', () => {
    const attrs = pagefindIndexAttrs(skill(), null);
    expect(attrs.text).toContain('Dependency scan');
    expect(attrs.text).toContain('acme/kit skills/scan/SKILL.md');
    expect(attrs.text.join(' ')).toContain('sbom');
  });
});

describe('B4 skill pages carry the payload this vocabulary describes', () => {
  const pages = skillPages();
  const indexed = indexedSkillPages();
  const html = indexed[0];

  it('indexes a page if and only if search engines may index it too', () => {
    for (const page of pages) {
      expect(
        page.includes('data-pagefind-body'),
        'an evicted page must carry robots=noindex and no data-pagefind-body, and a listed page neither',
      ).toBe(!isNoindex(page));
    }
  });

  it('marks exactly one indexable body on every listed skill page', () => {
    for (const page of indexed) {
      expect((page.match(/data-pagefind-body/g) ?? []).length).toBe(1);
    }
  });

  it('emits every one of the five flat filter keys', () => {
    for (const key of INDEX_FILTER_KEYS) {
      expect(html).toMatch(new RegExp(`data-pagefind-filter="${key}\\[[^\\]]+\\]"`));
    }
  });

  it('never emits a filter key outside the flat vocabulary', () => {
    const keys = [...html.matchAll(/data-pagefind-filter="([a-z-]+)\[/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect([...INDEX_FILTER_KEYS]).toContain(key);
    }
  });

  it('emits all five sort keys, zero-padded', () => {
    for (const key of ['score', 'stars', 'forks', 'newest', 'updated']) {
      expect(html).toMatch(new RegExp(`data-pagefind-sort="${key}\\[0*\\d+\\]"`));
    }
  });

  it('emits the skill id as metadata, so a result maps back onto its card', () => {
    expect(html).toMatch(/data-pagefind-meta="id\[[^\]]+\]"/);
  });
});
