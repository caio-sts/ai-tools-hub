import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import { skillHref } from '../../src/lib/slug.ts';
import { bundles, cardOf, pageFor, tagWith } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const JS = bundles().map((bundle) => bundle.js).join('\n');

describe('expand-in-place URL sync', () => {
  it('groups every card into one exclusive accordion', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('en', skill)), 'data-skill-id=')).toContain('name="skill-expand"');
    }
  });

  it('carries the base-aware static path on each card', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('en', skill)), 'data-skill-id='))
        .toContain(`data-href="${skillHref(skill, 'en')}"`);
    }
  });

  it('points the pt card at the pt static page', () => {
    for (const skill of SKILLS) {
      expect(tagWith(cardOf(pageFor('pt', skill)), 'data-skill-id='))
        .toContain(`data-href="${skillHref(skill, 'pt')}"`);
    }
  });

  it('ships a toggle listener that replaces history rather than pushing it', () => {
    expect(JS).toContain('toggle');
    expect(JS).toContain('replaceState');
    expect(JS).not.toContain('pushState');
  });

  it('closes any other open card', () => {
    expect(JS).toContain('.skill-card[open]');
  });
});
