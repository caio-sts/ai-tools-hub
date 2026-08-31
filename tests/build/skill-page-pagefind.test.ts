import { describe, expect, it } from 'vitest';
import { loadCollections, loadSkills } from '../../src/lib/data.ts';
import { pageFor } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const LISTED = SKILLS.filter((skill) => skill.listed);
const UNLISTED = SKILLS.filter((skill) => !skill.listed);
const BY_REPO = new Map(loadCollections().map((collection) => [collection.repo, collection]));
const FILTER_KEYS = ['domain', 'subdomain', 'runtime', 'risk', 'license'];
const SORT_KEYS = ['score', 'stars', 'forks', 'newest', 'updated'];

function pairs(html: string, attribute: string): Array<[string, string]> {
  const pattern = new RegExp(`data-pagefind-${attribute}="([a-z-]+)\\[([^\\]]*)\\]"`, 'g');
  return [...html.matchAll(pattern)].map((match) => [match[1], match[2]] as [string, string]);
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

  it('zero-pads every sort value so Pagefind string order matches numeric order', () => {
    for (const skill of LISTED) {
      const sorts = new Map(pairs(pageFor('en', skill), 'sort'));
      expect([...sorts.keys()]).toEqual(SORT_KEYS);
      const collection = BY_REPO.get(skill.repo);
      expect(sorts.get('score')).toBe(String(skill.score).padStart(3, '0'));
      expect(sorts.get('stars')).toBe(String(collection?.stars ?? 0).padStart(9, '0'));
      expect(sorts.get('forks')).toBe(String(collection?.forks ?? 0).padStart(9, '0'));
      expect(sorts.get('newest')).toBe(skill.indexedAt.slice(0, 10).replace(/-/g, ''));
      expect(sorts.get('updated')).toBe(String(skill.updatedDays).padStart(6, '0'));
    }
  });

  it('carries the skill id as metadata, so a result maps back onto its card', () => {
    for (const skill of LISTED) {
      expect(pageFor('en', skill)).toContain(`data-pagefind-meta="id[${skill.id}]"`);
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
