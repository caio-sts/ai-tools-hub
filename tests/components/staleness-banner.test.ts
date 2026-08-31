import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { evaluateStaleness, parseMeta } from '../../src/lib/staleness.ts';
import { t } from '../../src/lib/i18n/index.ts';

const FILE = 'src/components/StalenessBanner.astro';

function source(): string {
  if (!existsSync(FILE)) throw new Error(`Missing ${FILE}`);
  return readFileSync(FILE, 'utf8');
}

describe('StalenessBanner source', () => {
  it('reads its data through the A6 loaders, never with its own JSON.parse', () => {
    const text = source();
    expect(text).toContain("from '../lib/data.ts'");
    expect(text).not.toContain('JSON.parse');
    expect(text).not.toContain('data/meta.json');
  });

  it('never reaches for the hazard token, which the safety module owns alone', () => {
    expect(source()).not.toContain('--color-hazard');
  });

  it('renders the two rows and the lag in separate elements', () => {
    const text = source();
    expect(text).toContain('data-crawl-state');
    expect(text).toContain('data-classification-state');
    expect(text).toContain('data-classification-lag');
    expect(text).toContain('data-unclassified');
  });
});

describe('the copy the banner shows', () => {
  const NOW = new Date('2026-08-29T12:00:00.000Z');

  it('resolves to "never run" when classification has not happened', () => {
    const report = evaluateStaleness(
      parseMeta({ crawledAt: '2026-08-28T00:00:00.000Z', classifiedAt: null, skillCount: 3, sourceCount: 1 }),
      NOW,
    );
    expect(report.classification.days).toBeNull();
    expect(t('status.neverRun', 'en')).toBe('never run');
    expect(t('status.neverRun', 'pt')).toBe('nunca executada');
  });

  it('labels the lag row in both locales', () => {
    expect(t('status.lag', 'en')).toBe('Classification lag');
    expect(t('status.lag', 'pt')).toBe('Atraso da classificação');
  });
});
