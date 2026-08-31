import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { withBase } from '../../src/lib/link.ts';
import { nodeName } from '../../src/lib/taxonomy.ts';
import {
  cardOf, classesOf, elementWith, mainOf, pageFor, ranked, summaryOf, tagWith, text,
} from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const ORDER = ranked(SKILLS);
const LOCALES = ['en', 'pt'] as const;

/** §7's rule, restated here rather than imported, so one edit cannot move both sides. */
function clip(input: string): string {
  const value = input.trim().replace(/\s+/g, ' ');
  return value.length <= 160 ? value : `${value.slice(0, 159).trimEnd()}…`;
}

describe('the per-skill static page', () => {
  it('has a corpus to render at all', () => {
    expect(SKILLS.length).toBeGreaterThan(0);
  });

  it('builds one page per skill in both locales, carrying the skill id', () => {
    for (const lang of LOCALES) {
      for (const skill of SKILLS) {
        expect(cardOf(pageFor(lang, skill))).toContain(`data-skill-id="${skill.id}"`);
      }
    }
  });

  it('noindexes an evicted entry and leaves a listed one indexable', () => {
    for (const lang of LOCALES) {
      for (const skill of SKILLS) {
        const noindexed = /<meta[^>]+name="robots"[^>]+content="noindex"/.test(pageFor(lang, skill));
        expect(noindexed, skill.id).toBe(!skill.listed);
      }
    }
  });

  it('gives every card the same class list, so an evicted entry gets no tombstone styling', () => {
    for (const skill of SKILLS) {
      const tag = tagWith(cardOf(pageFor('en', skill)), 'data-skill-id=');
      expect(classesOf(tag), skill.id).toEqual(['skill-card']);
    }
  });

  it('sets the document language per locale', () => {
    const skill = ORDER[0];
    expect(pageFor('en', skill)).toContain('lang="en"');
    expect(pageFor('pt', skill)).toContain('lang="pt-BR"');
  });

  it('titles the page with the skill name', () => {
    for (const skill of SKILLS) {
      const title = /<title>([\s\S]*?)<\/title>/.exec(pageFor('en', skill))?.[1] ?? '';
      expect(text(title)).toContain(text(skill.name));
    }
  });

  it('opens the card on arrival', () => {
    const tag = tagWith(cardOf(pageFor('en', ORDER[0])), 'data-skill-id=');
    expect(tag).toMatch(/\sopen(?=[\s>])/);
  });

  it('numbers the rank by descending score starting at 1', () => {
    expect(text(elementWith(cardOf(pageFor('en', ORDER[0])), 'data-field="rank"'))).toBe('#1');
    if (ORDER.length > 1) {
      expect(text(elementWith(cardOf(pageFor('en', ORDER[1])), 'data-field="rank"'))).toBe('#2');
    }
  });

  it('prints the composite score in a chip that links to the published formula', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      expect(text(elementWith(card, 'data-field="score"'))).toBe(String(skill.score));
      expect(tagWith(card, 'data-field="score"'))
        .toContain(`href="${withBase('/en/methodology/#score')}"`);
    }
  });

  it('shows the author name in the closed part of the card', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      expect(text(elementWith(summary, 'data-field="name"'))).toBe(text(skill.name));
    }
  });

  it('clips the card description to 160 characters', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      const shown = text(elementWith(summary, 'data-field="description"'));
      expect(shown.length).toBeLessThanOrEqual(160);
      expect(shown).toBe(clip(skill.description));
    }
  });

  it('prefers the translated short description on the pt route', () => {
    for (const skill of SKILLS.filter((s) => s.descriptionPt)) {
      const summary = summaryOf(cardOf(pageFor('pt', skill)));
      expect(text(elementWith(summary, 'data-field="description"'))).toBe(clip(skill.descriptionPt!));
    }
  });

  it('breadcrumbs home and the taxonomy path in the page language', () => {
    for (const lang of LOCALES) {
      const skill = ORDER[0];
      const crumbs = text(elementWith(mainOf(pageFor(lang, skill)), 'data-field="crumbs"'));
      expect(crumbs).toContain(strings[lang]['skill.home']);
      expect(crumbs).toContain(nodeName(skill.primary.split('/')[0], lang));
      expect(crumbs).toContain(nodeName(skill.primary, lang));
    }
  });
});
