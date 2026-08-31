import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, panelOf, summaryOf, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();

describe('license display', () => {
  it('shows the resolved license, or Not declared, in the expanded panel', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const expected = skill.license ?? strings.en['skill.licenseNotDeclared'];
      expect(text(elementWith(panel, 'data-field="license"'))).toBe(expected);
    }
  });

  it('flags an unresolved license as hazard and a resolved one plain', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      const classes = classesOf(tagWith(panel, 'data-field="license"'));
      expect(classes.includes('license__value--undeclared'), skill.id).toBe(skill.license === null);
    }
  });

  it('names the resolution source only when there is one', () => {
    for (const skill of SKILLS) {
      const panel = panelOf(cardOf(pageFor('en', skill)));
      if (skill.licenseSource === null) {
        expect(panel).not.toContain('data-field="license-source"');
      } else {
        expect(text(elementWith(panel, 'data-field="license-source"'))).toBe(skill.licenseSource);
      }
    }
  });

  it('translates Not declared on the pt route', () => {
    for (const skill of SKILLS.filter((s) => s.license === null)) {
      const panel = panelOf(cardOf(pageFor('pt', skill)));
      expect(text(elementWith(panel, 'data-field="license"'))).toBe(strings.pt['skill.licenseNotDeclared']);
    }
  });

  it('keeps every license marker out of the closed card', () => {
    for (const skill of SKILLS) {
      const summary = summaryOf(cardOf(pageFor('en', skill)));
      expect(summary).not.toContain('license');
      expect(text(summary)).not.toContain(strings.en['skill.license']);
    }
  });
});
