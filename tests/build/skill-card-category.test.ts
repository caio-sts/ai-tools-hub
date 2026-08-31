import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { nodeName } from '../../src/lib/taxonomy.ts';
import { allCss, cardOf, mainOf, occurrences, pageFor, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('the category chip', () => {
  it('is suppressed on the skill page, where the breadcrumb already names the category', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      expect(card).not.toContain('data-field="category"');
      expect(card).not.toContain(`data-category="${skill.primary}"`);
    }
  });

  it('leaves the primary node named exactly once inside main', () => {
    for (const skill of SKILLS) {
      const label = nodeName(skill.primary, 'en');
      expect(occurrences(text(mainOf(pageFor('en', skill))), label), skill.id).toBe(1);
    }
  });

  it('uses the hand-written pt taxonomy label on the pt route', () => {
    for (const skill of SKILLS) {
      expect(text(mainOf(pageFor('pt', skill)))).toContain(nodeName(skill.primary, 'pt'));
    }
  });

  it('still ships the chip styling, so the unfiltered catalog renders a styled chip', () => {
    expect(allCss()).toContain('.skill-card__category');
  });
});
