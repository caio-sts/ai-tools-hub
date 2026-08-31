import { describe, expect, it } from 'vitest';
import { loadSkills } from '../../src/lib/data.ts';
import strings from '../../src/lib/i18n/skill.ts';
import { cardOf, classesOf, distFiles, elementWith, pageFor, tagWith, text } from '../helpers/skill-card.ts';
import { readFileSync } from 'node:fs';

const SKILLS = loadSkills();
const SIGNALS = ['executes', 'network', 'env', 'tools'];

function row(card: string, signal: string): { classes: string[]; value: string } {
  const element = elementWith(card, `data-signal="${signal}"`);
  return {
    classes: classesOf(tagWith(card, `data-signal="${signal}"`)),
    value: text(elementWith(element, 'class="safety-row__value"')),
  };
}

describe('the safety strip', () => {
  it('renders the four derived signals on every card', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      for (const signal of SIGNALS) expect(card).toContain(`data-signal="${signal}"`);
    }
  });

  it('marks executing, networking and env-reading skills as hazard and nothing else', () => {
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const hazard = {
        executes: skill.safety.executesCode,
        network: skill.safety.network,
        env: skill.safety.readsEnv,
        tools: false,
      };
      for (const signal of SIGNALS) {
        const flagged = row(card, signal).classes.includes('safety-row--hazard');
        expect(flagged, `${skill.id} / ${signal}`).toBe(hazard[signal as keyof typeof hazard]);
      }
    }
  });

  it('reports the script count and languages, or says there are none', () => {
    const en = strings.en;
    for (const skill of SKILLS) {
      const card = cardOf(pageFor('en', skill));
      const { scriptCount, languages, executesCode } = skill.safety;
      const word = scriptCount === 1 ? en['skill.script'] : en['skill.scripts'];
      const suffix = languages.length > 0 ? ` (${languages.join(', ')})` : '';
      const expected = executesCode ? `${scriptCount} ${word}${suffix}` : en['skill.noScripts'];
      expect(row(card, 'executes').value).toBe(expected);
    }
  });

  it('prints declared tools verbatim, or Not declared', () => {
    const en = strings.en;
    for (const skill of SKILLS) {
      const tools = skill.safety.declaredTools;
      const expected = tools && tools.length > 0 ? tools.join(', ') : en['skill.toolsNotDeclared'];
      expect(row(cardOf(pageFor('en', skill)), 'tools').value).toBe(expected);
    }
  });

  it('exposes only two safety states across every built page', () => {
    const seen = new Set<string>();
    for (const file of distFiles('.html')) {
      const html = readFileSync(file, 'utf8');
      for (const match of html.matchAll(/<[a-z]+[^>]*data-signal="[^"]*"[^>]*>/gi)) {
        for (const token of classesOf(match[0])) seen.add(token);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const token of seen) expect(['safety-row', 'safety-row--hazard']).toContain(token);
  });

  it('translates the signal labels on the pt route', () => {
    const card = cardOf(pageFor('pt', SKILLS[0]));
    expect(text(elementWith(card, 'data-signal="network"'))).toContain(strings.pt['skill.network']);
    expect(text(elementWith(card, 'data-signal="env"'))).toContain(strings.pt['skill.env']);
  });
});
