import { describe, expect, it } from 'vitest';
import { loadCollections, loadSkills } from '../../src/lib/data.ts';
import { STALE_DAYS, compactNumber, relativeDays } from '../../src/lib/format.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const BY_REPO = new Map(loadCollections().map((collection) => [collection.repo, collection]));

function field(card: string, name: string): string {
  return text(elementWith(card, `data-field="${name}"`));
}

describe('card metadata', () => {
  it('names the source repo', () => {
    for (const skill of SKILLS) {
      expect(field(cardOf(pageFor('en', skill)), 'repo')).toBe(skill.repo);
    }
  });

  it('shows compact stars and forks, or an em-dash when no collection row exists', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const row = BY_REPO.get(skill.repo);
      expect(field(card, 'stars')).toBe(row ? compactNumber(row.stars, 'en') : '—');
      expect(field(card, 'forks')).toBe(row ? compactNumber(row.forks, 'en') : '—');
    }
  });

  it('prints the crawl date verbatim, so it can be checked against meta.json', () => {
    for (const skill of SKILLS) {
      // The day, not the instant: the harvest records a full ISO timestamp, and rendering it
      // wrapped onto its own line and outweighed the name above it.
      expect(field(cardOf(pageFor('en', skill)), 'picked')).toBe(skill.indexedAt.slice(0, 10));
    }
  });

  it('prints the per-path age through relativeDays in the page language', () => {
    for (const lang of ['en', 'pt'] as const) {
      for (const skill of SKILLS) {
        expect(field(cardOf(pageFor(lang, skill)), 'updated')).toBe(relativeDays(skill.updatedDays, lang));
      }
    }
  });

  it('marks an age over 60 days stale and leaves fresher ones plain', () => {
    for (const skill of SKILLS) {
      const tag = tagWith(cardOf(pageFor('en', skill)), 'data-field="updated"');
      expect(classesOf(tag).includes('meta__updated--stale'), skill.id).toBe(skill.updatedDays > STALE_DAYS);
    }
  });

  it('puts the safety strip above the metadata so it is read first', () => {
    const card = cardOf(pageFor('en', SKILLS[0]));
    expect(card.indexOf('data-signal="executes"')).toBeLessThan(card.indexOf('data-field="repo"'));
  });

  it('translates the metadata labels on the pt route', () => {
    const card = cardOf(pageFor('pt', SKILLS[0]));
    expect(text(elementWith(card, 'data-field="meta"'))).toContain(strings.pt['skill.source']);
    expect(text(elementWith(card, 'data-field="meta"'))).toContain(strings.pt['skill.updated']);
  });
});
