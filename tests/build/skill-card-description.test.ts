import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../helpers/skill-card.ts';
import { readBuiltCss } from '../styles/built-css.ts';

const SOURCE = readFileSync(join(ROOT, 'src/components/SkillCard.astro'), 'utf8');

/** The declaration block the browser applies to the card's description, from the built CSS. */
function descriptionRule(): string {
  const match = /\.skill-card__description[^{]*\{([^}]*)\}/.exec(readBuiltCss('dist'));
  if (!match) throw new Error('no .skill-card__description rule in the built CSS');
  return match[1];
}

describe('the card description', () => {
  // §7 budgets 160 characters and the card clips to it. The clamp is a second, independent limit,
  // and at 456px — a card in the three-column grid — --text-sm fits about 55 characters to a line,
  // so two lines showed barely 110 of the 160 the budget already paid for. Three lines cover the
  // budget; a fourth would only pad cards whose author wrote less.
  it('clamps to three lines, enough to show the whole 160-character budget', () => {
    const rule = descriptionRule();
    expect(rule).toMatch(/-webkit-line-clamp:\s*3/);
    expect(rule).toMatch(/[^-]line-clamp:\s*3/);
  });

  it('still clips the text itself at the budget §7 sets', () => {
    expect(SOURCE).toMatch(/MAX_DESCRIPTION = 160/);
  });
});
