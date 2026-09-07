import { describe, expect, it } from 'vitest';
import strings from '../../src/lib/i18n/skill.ts';

// The safety strip is the card's most important block and the one a reader scans. Two rules meet
// here. The value must answer rather than restate — "Environment: No environment reads" said
// environment twice — and the key must name the axis it measures, because a bare noun leaves the
// reader to guess: "ENVIRONMENT" alone does not say that the answer is about reading env vars.
const VERDICTS = [
  ['skill.executes', 'skill.noScripts'],
  ['skill.network', 'skill.networkNo'],
  ['skill.env', 'skill.envNo'],
] as const;

// Declared tools is not a verdict. It takes a full-width row of its own beneath the three cells,
// so its key is bounded by the card and not by a third of one: the cell measurements below exempt
// it, while the rules about restating the key still apply.
const TOOLS = ['skill.tools', 'skill.toolsNotDeclared'] as const;
const PAIRS = [...VERDICTS, TOOLS];

function words(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 3);
}

describe.each(['en', 'pt'] as const)('the inert safety answers in %s', (lang) => {
  it.each(PAIRS)('does not restate the key in %s', (keyId, valueId) => {
    const key = strings[lang][keyId];
    const value = strings[lang][valueId];
    for (const word of words(key)) {
      expect(words(value), `"${value}" repeats "${word}" from "${key}"`).not.toContain(word);
    }
  });

  // A verdict key is read on its own, above its answer, so it has to say what was measured. One
  // bare noun does not: it names a subject and leaves the axis — uses it? reads it? — unstated.
  it.each(VERDICTS)('names the axis %s measures rather than a bare noun', (keyId) => {
    const key = strings[lang][keyId];
    expect(key.trim().split(/\s+/).length, `"${key}" names a subject but not a measurement`)
      .toBeGreaterThan(1);
  });

  // Measured in a browser at the three-column width, where a card is 456px: the key sits ABOVE
  // its value in a cell 140px wide, 124px of it usable once the row's 0.5rem padding is taken,
  // and an uppercase mono glyph at 0.625rem with 0.07em tracking measures 6.7px. That is 18
  // characters — but the bound belongs to the hazard state, not the inert one. A flagged row
  // prepends "! " through ::before, 13.4px it takes from the same 124px, so a key that fits when
  // the answer is No wraps the moment the answer is Yes, and every verdict here can be flagged.
  // 124px less the prefix, over 6.7px a glyph, is 16.
  it.each(VERDICTS)('keeps the key %s to one line of its cell, flagged or not', (keyId) => {
    expect(strings[lang][keyId].length).toBeLessThanOrEqual(16);
  });

  // The key may already own two lines of the cell, so the inert answer stays an answer.
  it.each(PAIRS)('answers %s in a word', (_keyId, valueId) => {
    expect(strings[lang][valueId].length).toBeLessThanOrEqual(8);
  });

  // The hazard state is deliberately the loud one (B4.5: two states, no green), so it stays a
  // sentence. This asserts the asymmetry is intentional rather than drift.
  it('keeps the hazard answers explicit', () => {
    expect(strings[lang]['skill.networkYes'].length).toBeGreaterThan(8);
    expect(strings[lang]['skill.envYes'].length).toBeGreaterThan(8);
  });
});

describe('the declared-tools key', () => {
  // Its full-width row is what buys the qualifier back: pt-BR lost "declaradas" when the key had
  // to share a 183px line with its value, and the distinction is the whole point of the row.
  it('says the tools were declared, in both languages', () => {
    expect(strings.en['skill.tools']).toBe('Declared tools');
    expect(strings.pt['skill.tools']).toBe('Ferramentas declaradas');
  });

  // We read what a skill declares in its frontmatter, and only ~9% declare anything at all. A key
  // saying "used" would claim an observation the harvest never made.
  it.each(['en', 'pt'] as const)('never claims in %s that the tools were used', (lang) => {
    expect(strings[lang]['skill.tools'].toLowerCase()).not.toMatch(/\bused\b|usad/);
  });
});
