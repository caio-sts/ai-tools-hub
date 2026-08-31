import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = (): string => readFileSync('dist/styleguide/index.html', 'utf8');

const NEUTRAL = Array.from({ length: 12 }, (_, i) => `--color-n-${i + 1}`);
const ACCENT = Array.from({ length: 12 }, (_, i) => `--color-a-${i + 1}`);
const SEMANTIC = [
  '--background', '--foreground', '--card', '--card-foreground', '--popover',
  '--popover-foreground', '--primary', '--primary-foreground', '--secondary',
  '--secondary-foreground', '--muted', '--muted-foreground', '--accent',
  '--accent-foreground', '--destructive', '--destructive-foreground',
  '--border', '--input', '--ring',
];
const TEXT = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
const MOTION = ['--motion-state', '--motion-enter', '--motion-overlay', '--motion-ease'];
const OTHER = ['--color-hazard', '--radius', '--spacing', '--font-sans', '--font-mono'];
const RUNTIME_ORDER = ['claude', 'openclaw', 'codex', 'cursor', 'generic'];

/** The full opening tag carrying `attr`, so an inline style can be read off it. */
function tagWith(page: string, attr: string): string {
  return new RegExp(`<[^>]*${attr}[^>]*>`).exec(page)?.[0] ?? '';
}

describe('styleguide — tokens', () => {
  it('renders a swatch for every colour token', () => {
    const page = html();
    for (const token of [...NEUTRAL, ...ACCENT, ...SEMANTIC]) {
      expect(page).toContain(`data-token="${token}"`);
    }
  });

  it('renders the non-colour tokens too', () => {
    const page = html();
    for (const token of OTHER) expect(page).toContain(`data-token="${token}"`);
  });

  it('labels each ramp step with its Radix role', () => {
    const page = html();
    for (const role of [
      'app background', 'component bg', 'hover', 'pressed / selected',
      'subtle border', 'interactive border', 'focus ring', 'solid',
      'solid hover', 'low-contrast text', 'high-contrast text',
    ]) {
      expect(page).toContain(role);
    }
  });

  it('renders every step of the text scale', () => {
    const page = html();
    for (const step of TEXT) expect(page).toContain(`data-token="--text-${step}"`);
  });

  it('renders the motion tokens', () => {
    const page = html();
    for (const token of MOTION) expect(page).toContain(`data-token="${token}"`);
  });

  it('states the hazard reservation in words on the page', () => {
    expect(html()).toContain('safety module only');
  });

  it('keeps the palette guard in place', () => {
    expect(html()).toContain('data-guard="palette-wipe"');
  });
});

describe('styleguide — component states', () => {
  it('renders all five button states', () => {
    const page = html();
    for (const state of ['rest', 'hover', 'focus', 'pressed', 'disabled']) {
      expect(page).toContain(`data-state="${state}"`);
    }
  });

  it('renders the three taxonomy node states from §10.1', () => {
    const page = html();
    for (const state of ['active', 'below-mass', 'empty']) {
      expect(page).toContain(`data-node-state="${state}"`);
    }
    expect(page).toContain('no entries yet');
  });

  it('renders a runtime LED for every runtime, in RUNTIME_ORDER', () => {
    const page = html();
    const positions = RUNTIME_ORDER.map((runtime) => page.indexOf(`data-led="${runtime}"`));
    expect(positions.filter((at) => at === -1)).toEqual([]);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('paints the safety strip rows that are hazardous, and only those', () => {
    const page = html();
    for (const row of ['executes-code', 'network', 'reads-env', 'not-declared']) {
      expect(page).toContain(`data-safety="${row}"`);
    }
    expect(tagWith(page, 'data-safety="executes-code"')).toContain('var(--color-hazard)');
    expect(tagWith(page, 'data-safety="reads-env"')).not.toContain('var(--color-hazard)');
  });

  it('paints a stale date in hazard', () => {
    expect(tagWith(html(), 'data-stale="true"')).toContain('var(--color-hazard)');
  });

  it('paints an undeclared licence in hazard and a resolved one plainly', () => {
    const page = html();
    expect(tagWith(page, 'data-license="not-declared"')).toContain('var(--color-hazard)');
    expect(tagWith(page, 'data-license="resolved"')).not.toContain('var(--color-hazard)');
  });

  it('renders the four score bars', () => {
    const page = html();
    for (const part of ['adoption', 'maintenance', 'provenance', 'completeness']) {
      expect(page).toContain(`data-score="${part}"`);
    }
  });

  it('renders a 24px facet hit area (WCAG 2.2 2.5.8)', () => {
    const page = html();
    expect(page).toContain('data-hit="24"');
    expect(tagWith(page, 'data-hit="24"')).toContain('min-height: calc(var(--spacing) * 6)');
  });

  it('ships a working three-state theme switcher', () => {
    const page = html();
    for (const mode of ['light', 'dark', 'system']) {
      expect(page).toContain(`data-set-theme="${mode}"`);
    }
    expect(page).toContain("removeAttribute('data-theme')");
  });
});
