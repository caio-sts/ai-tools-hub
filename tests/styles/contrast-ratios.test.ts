import { describe, expect, it } from 'vitest';
import { readBuiltCss, splitMediaRegions } from './built-css.ts';
import { contrastRatio, readOklch, themeBlocks } from './contrast.ts';

// Nothing guarded these before, and the light palette shipped two AA failures: the accent — which
// is --primary, so every link and every solid button — at 3.39, and hazard at 4.23. Dark passed
// everything, which is how a dark-first palette hides a light-mode regression.
const { outside } = splitMediaRegions(readBuiltCss('dist'));
const { light, dark } = themeBlocks(outside);
const THEMES: Array<[string, string]> = [['light', light], ['dark', dark]];

function ratio(block: string, fg: string, bg: string): number {
  const a = readOklch(block, fg);
  const b = readOklch(block, bg);
  expect(a, `${fg} is not declared in this theme`).not.toBeNull();
  expect(b, `${bg} is not declared in this theme`).not.toBeNull();
  return contrastRatio(a!, b!);
}

describe.each(THEMES)('WCAG contrast — %s', (name, block) => {
  it('sets body text against the page at AAA', () => {
    expect(ratio(block, '--color-n-12', '--color-n-1')).toBeGreaterThanOrEqual(7);
  });

  it('sets body text against a card at AAA', () => {
    expect(ratio(block, '--color-n-12', '--color-n-2')).toBeGreaterThanOrEqual(7);
  });

  it('sets secondary text against a card at AA', () => {
    expect(ratio(block, '--color-n-11', '--color-n-2')).toBeGreaterThanOrEqual(4.5);
  });

  // --color-a-9 is --primary: every link, every solid control.
  it('sets the accent against a card at AA', () => {
    expect(ratio(block, '--color-a-9', '--color-n-2')).toBeGreaterThanOrEqual(4.5);
  });

  // Hazard is the safety module's only colour. It carries meaning, so it is read as text.
  it('sets hazard against a card at AA', () => {
    expect(ratio(block, '--color-hazard', '--color-n-2')).toBeGreaterThanOrEqual(4.5);
  });

  it('sets hazard against the page at AA', () => {
    expect(ratio(block, '--color-hazard', '--color-n-1')).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 1.4.11: an input's boundary is what identifies the control.
  it('sets the interactive border against a card at the non-text minimum', () => {
    expect(ratio(block, '--color-n-7', '--color-n-2')).toBeGreaterThanOrEqual(3);
  });
});

describe('the card rises from the page in both themes', () => {
  // Light was the only theme where step 2 sat BELOW step 1, so the panel sank into the page
  // instead of lifting off it — inherited from the Radix light convention, where step 2 is a
  // subtly darker background. That is why light had no panel metaphor at all.
  it.each(THEMES)('%s: step 2 is lighter than step 1', (_name, block) => {
    const page = readOklch(block, '--color-n-1')!;
    const card = readOklch(block, '--color-n-2')!;
    expect(card.l).toBeGreaterThan(page.l);
  });
});
