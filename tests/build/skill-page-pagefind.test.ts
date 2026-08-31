import { describe, expect, it } from 'vitest';
import { sortValues } from '../../src/lib/facets.ts';
import { loadCollections, loadSkills } from '../../src/lib/data.ts';
import { pageFor } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const LISTED = SKILLS.filter((skill) => skill.listed);
const UNLISTED = SKILLS.filter((skill) => !skill.listed);
const BY_REPO = new Map(loadCollections().map((collection) => [collection.repo, collection]));
const FILTER_KEYS = ['domain', 'subdomain', 'runtime', 'risk', 'license'];
const SORT_KEYS = ['score', 'stars', 'forks', 'newest', 'updated'];

/**
 * Resolves the one indirection Pagefind's attribute form introduces: the tag reads
 * `key[data-value]`, and the value itself lives in the `data-value` attribute beside it. Reading
 * the bracket contents as the value would assert the literal string "data-value" forever.
 */
function pairs(html: string, attribute: string): Array<[string, string]> {
  const pattern = new RegExp(
    `data-value="([^"]*)" data-pagefind-${attribute}="([a-z-]+)\\[data-value\\]"`,
    'g',
  );
  return [...html.matchAll(pattern)].map((match) => [match[2], match[1]] as [string, string]);
}

describe('the Pagefind index block', () => {
  it('has a listed skill to index at all', () => {
    expect(LISTED.length).toBeGreaterThan(0);
  });

  it('marks exactly one indexable body per listed skill page, in both locales', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of LISTED) {
        expect((pageFor(lang, skill).match(/data-pagefind-body/g) ?? []).length, skill.id).toBe(1);
      }
    }
  });

  it('leaves an evicted skill out of the index while still building its page', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of UNLISTED) {
        expect(pageFor(lang, skill), skill.id).not.toContain('data-pagefind-body');
      }
    }
  });

  it('emits all five flat filter keys and nothing outside that vocabulary', () => {
    for (const skill of LISTED) {
      const keys = pairs(pageFor('en', skill), 'filter').map(([key]) => key);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) expect(FILTER_KEYS).toContain(key);
      for (const key of FILTER_KEYS) expect(keys, `${skill.id} is missing ${key}`).toContain(key);
    }
  });

  it('derives domain, subdomain, runtime and license from the skill itself', () => {
    for (const skill of LISTED) {
      const found = pairs(pageFor('en', skill), 'filter');
      const values = (key: string): string[] => found.filter(([k]) => k === key).map(([, v]) => v);
      const nodes = [skill.primary, ...skill.also];
      expect(values('subdomain')).toEqual([...new Set(nodes)]);
      expect(values('domain')).toEqual([...new Set(nodes.map((node) => node.split('/')[0]))]);
      expect(values('runtime')).toEqual([...new Set(skill.runtimes)]);
      expect(values('license')).toEqual([skill.license ?? 'unspecified']);
    }
  });

  it('names an executing skill executes-code and a quiet one no-code-execution', () => {
    for (const skill of LISTED) {
      const risk = pairs(pageFor('en', skill), 'filter')
        .filter(([key]) => key === 'risk')
        .map(([, value]) => value);
      expect(risk[0], skill.id).toBe(skill.safety.executesCode ? 'executes-code' : 'no-code-execution');
      expect(risk.includes('network'), skill.id).toBe(skill.safety.network);
      expect(risk.includes('reads-env'), skill.id).toBe(skill.safety.readsEnv);
      expect(risk.includes('portable'), skill.id).toBe(skill.portable);
    }
  });

  // Restating the padding rules here made this the THIRD copy of them — the page had its own, the
  // library had its own, and they drifted silently. Compare against the one definition instead, so
  // this fails the moment the emitted block stops matching it.
  it('emits exactly the sort values sortValues() defines', () => {
    for (const skill of LISTED) {
      const sorts = new Map(pairs(pageFor('en', skill), 'sort'));
      expect([...sorts.keys()]).toEqual(SORT_KEYS);
      const expected = sortValues(skill, BY_REPO.get(skill.repo) ?? null);
      for (const key of SORT_KEYS) {
        expect(sorts.get(key), `${skill.name}: ${key}`).toBe(expected[key as keyof typeof expected]);
      }
    }
  });

  it('carries the skill id as metadata, so a result maps back onto its card', () => {
    for (const skill of LISTED) {
      // Attribute form. Inlining the id as `id[<id>]` made Pagefind split it on the `:` inside
      // `owner/repo@sha:path` and index a mangled key, leaving every card unmatched.
      expect(pageFor('en', skill)).toContain(
        `data-skill-id="${skill.id}" data-pagefind-meta="id[data-skill-id]"`,
      );
    }
  });

  it('indexes the text a reader would actually search for', () => {
    for (const skill of LISTED) {
      const html = pageFor('en', skill);
      expect(html).toContain(`${skill.repo} ${skill.path}`);
      expect(html).toContain(skill.name);
    }
  });

  it('keeps the block out of the visual and the accessibility tree', () => {
    const html = pageFor('en', LISTED[0]);
    const at = html.indexOf('<div data-pagefind-body');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, at + 400);
    expect(block).toContain('aria-hidden="true"');
    expect(block).toContain('clip-path:inset(50%)');
  });
});
