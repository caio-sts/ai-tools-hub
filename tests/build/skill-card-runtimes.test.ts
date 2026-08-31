import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';

const SKILLS = loadSkills();
const ORDER = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

function leds(card: string): string[] {
  return [...card.matchAll(/data-runtime="([^"]+)"/g)].map((match) => match[1]);
}

describe('runtime LEDs', () => {
  it('renders all five runtimes on every card, supported or not', () => {
    for (const skill of SKILLS) {
      expect(leds(cardOf(pageFor('en', skill)))).toHaveLength(5);
    }
  });

  it('keeps them in RUNTIME_ORDER, never alphabetical', () => {
    for (const skill of SKILLS) {
      expect(leds(cardOf(pageFor('en', skill)))).toEqual(ORDER);
    }
  });

  it('lights exactly the runtimes the skill declares', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      for (const runtime of ORDER) {
        const lit = classesOf(tagWith(card, `data-runtime="${runtime}"`)).includes('led--on');
        expect(lit, `${skill.id} / ${runtime}`).toBe(skill.runtimes.includes(runtime as never));
      }
    }
  });

  it('gives every LED a screen-reader state in the page language', () => {
    for (const lang of ['en', 'pt'] as const) {
      const skill = SKILLS[0];
      const card = cardOf(pageFor(lang, skill));
      for (const runtime of ORDER) {
        const expected = skill.runtimes.includes(runtime as never)
          ? strings[lang]['skill.supported']
          : strings[lang]['skill.unsupported'];
        expect(text(elementWith(card, `data-runtime="${runtime}"`))).toContain(expected);
      }
    }
  });

  it('hides the coloured dot itself from assistive technology', () => {
    const led = elementWith(cardOf(pageFor('en', SKILLS[0])), 'data-runtime="claude"');
    expect(led).toContain('aria-hidden="true"');
  });
});
