import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, elementWith, pageFor, panelOf, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const MAX = { adoption: 25, maintenance: 30, provenance: 25, completeness: 20 } as const;
const TERMS = Object.keys(MAX) as Array<keyof typeof MAX>;

function parts(panel: string): string[] {
  return [...panel.matchAll(/data-part="([^"]+)"/g)].map((match) => match[1]);
}

describe('score bars', () => {
  it('renders exactly four bars, one per formula term', () => {
    for (const skill of SKILLS) {
      expect(parts(panelOf(cardOf(pageFor('en', skill))))).toHaveLength(4);
    }
  });

  it('keeps them in formula order', () => {
    const panel = panelOf(cardOf(pageFor('en', SKILLS[0])));
    expect(parts(panel)).toEqual(['adoption', 'maintenance', 'provenance', 'completeness']);
  });

  it('prints value over the term own maximum', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      for (const term of TERMS) {
        const bar = elementWith(panel, `data-part="${term}"`);
        expect(text(bar)).toContain(`${skill.breakdown[term]}/${MAX[term]}`);
      }
    }
  });

  it('fills each bar by its value over its own maximum', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      for (const term of TERMS) {
        const bar = elementWith(panel, `data-part="${term}"`);
        const expected = Math.round((skill.breakdown[term] / MAX[term]) * 100);
        expect(bar, `${skill.id} / ${term}`).toContain(`width:${expected}%`);
      }
    }
  });

  it('never ships a component over its cap', () => {
    for (const skill of SKILLS) {
      for (const term of TERMS) {
        expect(skill.breakdown[term], `${skill.id} / ${term}`).toBeLessThanOrEqual(MAX[term]);
        expect(skill.breakdown[term], `${skill.id} / ${term}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('shows a total that equals the chip score and the sum of the four terms', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const sum = TERMS.reduce((acc, term) => acc + skill.breakdown[term], 0);
      expect(skill.breakdown.total, skill.id).toBe(sum);
      expect(skill.score, skill.id).toBe(skill.breakdown.total);
      expect(text(elementWith(panelOf(card), 'data-field="total"'))).toBe(String(skill.breakdown.total));
    }
  });

  it('translates the term labels on the pt route', () => {
    const panel = panelOf(cardOf(pageFor('pt', SKILLS[0])));
    expect(text(elementWith(panel, 'data-part="adoption"'))).toContain(strings.pt['skill.adoption']);
    expect(text(elementWith(panel, 'data-part="maintenance"'))).toContain(strings.pt['skill.maintenance']);
  });

  it('hides the bar graphic from assistive technology, which reads the numbers instead', () => {
    const bar = elementWith(panelOf(cardOf(pageFor('en', SKILLS[0]))), 'data-part="adoption"');
    expect(bar).toContain('aria-hidden="true"');
  });
});
