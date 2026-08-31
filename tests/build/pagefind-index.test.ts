import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSkills } from '../../src/lib/data.ts';
import { INDEX_FILTER_KEYS } from '../../src/lib/facets.ts';

// Every other Pagefind test reads the HTML we emit. That proves what we wrote, not what Pagefind
// made of it — and the two diverged silently: `data-pagefind-meta="id[<id>]"` looks correct in the
// markup, but Pagefind splits a literal on its first `:`, and a skill id is `owner/repo@sha:path`.
// It indexed the key `id[owner/repo@sha`, every card stayed hidden, and the catalog rendered empty
// with the whole suite green. These assertions read the built index itself.
const PREFIX = 'pagefind_dcd';

interface Fragment {
  url: string;
  meta: Record<string, string>;
  filters: Record<string, string[]>;
}

function fragments(lang: 'en' | 'pt-br'): Fragment[] {
  const dir = join('dist', 'pagefind', 'fragment');
  if (!existsSync(dir)) throw new Error(`No ${dir} — Pagefind did not run, or the site was not built`);
  return readdirSync(dir)
    .filter((file) => file.startsWith(`${lang}_`) && file.endsWith('.pf_fragment'))
    .map((file) => {
      const raw = gunzipSync(readFileSync(join(dir, file))).toString('utf8');
      return JSON.parse(raw.startsWith(PREFIX) ? raw.slice(PREFIX.length) : raw) as Fragment;
    });
}

describe('the built Pagefind index, not the markup that produced it', () => {
  const listed = loadSkills().filter((skill) => skill.listed);
  const en = fragments('en');

  it('indexes exactly the listed entries', () => {
    expect(en.length).toBe(listed.length);
  });

  it('carries the whole skill id under the key `id`, colon and all', () => {
    const ids = new Set(listed.map((skill) => skill.id));
    for (const fragment of en) {
      expect(Object.keys(fragment.meta), `mangled meta keys on ${fragment.url}`)
        .toEqual(expect.arrayContaining(['id']));
      expect(ids, `${fragment.meta.id} is indexed but is not a listed skill id`)
        .toContain(fragment.meta.id);
    }
  });

  it('maps every indexed id back onto a card the catalog renders', () => {
    // The exact lookup the controller performs: cards are keyed by data-skill-id.
    const catalog = readFileSync(join('dist', 'en', 'catalog', 'index.html'), 'utf8');
    for (const fragment of en) {
      expect(catalog, `no card for ${fragment.meta.id}: the grid would render it hidden`)
        .toContain(`data-skill-id="${fragment.meta.id}"`);
    }
  });

  it('gives every filter key a real value rather than an empty string', () => {
    for (const fragment of en) {
      for (const key of INDEX_FILTER_KEYS) {
        const values = fragment.filters[key] ?? [];
        expect(values.length, `${key} is absent on ${fragment.url}`).toBeGreaterThan(0);
        for (const value of values) {
          expect(value, `${key} indexed an empty value on ${fragment.url}`).not.toBe('');
        }
      }
    }
  });

  it('builds the filter chunks the rail reads its counts from', () => {
    const dir = join('dist', 'pagefind', 'filter');
    expect(existsSync(dir), 'no dist/pagefind/filter: every facet count would paint 0').toBe(true);
    const chunks = readdirSync(dir).filter((file) => file.startsWith('en_'));
    expect(chunks.length).toBe(INDEX_FILTER_KEYS.length);
  });

  it('indexes pt-br separately, under the same ids', () => {
    const pt = fragments('pt-br');
    expect(pt.length).toBe(listed.length);
    expect(new Set(pt.map((f) => f.meta.id))).toEqual(new Set(en.map((f) => f.meta.id)));
  });
});
