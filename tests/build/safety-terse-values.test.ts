import { describe, expect, it } from 'vitest';
import strings from '../../src/lib/i18n/skill.ts';

// The safety strip is the card's most important block and the one a reader scans. Its inert values
// restated their own key — "Environment: No environment reads" says environment twice — and at six
// columns that row wrapped on 24 cards out of 24, breaking the key/value alignment that makes the
// block scannable at all. The key asks; the value answers.
const PAIRS = [
  ['skill.executes', 'skill.noScripts'],
  ['skill.network', 'skill.networkNo'],
  ['skill.env', 'skill.envNo'],
  ['skill.tools', 'skill.toolsNotDeclared'],
] as const;

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

  // Measured: the block is 183px wide at six columns, and the longest key already takes 145 of it.
  // An inert answer has to be an answer, not a sentence.
  it.each(PAIRS)('answers %s briefly enough to sit on the key\'s line', (_keyId, valueId) => {
    expect(strings[lang][valueId].length).toBeLessThanOrEqual(8);
  });

  // Measured at six columns: the block is 183px and a mono glyph at --text-xs is about 6.6px, so
  // roughly 27 characters fit on a row. The key has to leave room for its answer — in pt-BR
  // "Ferramentas declaradas" alone took 145 of the 183 and wrapped on 24 cards out of 24, which no
  // amount of shortening the VALUE could have fixed.
  it.each(PAIRS)('keeps the key short enough to leave room for the answer (%s)', (keyId) => {
    expect(strings[lang][keyId].length).toBeLessThanOrEqual(18);
  });

  // The hazard state is deliberately the loud one (B4.5: two states, no green), so it stays a
  // sentence. This asserts the asymmetry is intentional rather than drift.
  it('keeps the hazard answers explicit', () => {
    expect(strings[lang]['skill.networkYes'].length).toBeGreaterThan(8);
    expect(strings[lang]['skill.envYes'].length).toBeGreaterThan(8);
  });
});
