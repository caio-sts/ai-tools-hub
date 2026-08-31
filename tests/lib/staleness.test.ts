import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION_STALE_DAYS, CLASSIFICATION_WARN_DAYS,
  CRAWL_STALE_DAYS, CRAWL_WARN_DAYS,
  evaluateStaleness, parseMeta, type SiteMeta,
} from '../../src/lib/staleness.ts';
import { STALE_DAYS } from '../../src/lib/format.ts';

const NOW = new Date('2026-08-29T12:00:00.000Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function meta(over: Partial<SiteMeta> = {}): SiteMeta {
  return { crawledAt: daysAgo(1), classifiedAt: daysAgo(2), skillCount: 812, sourceCount: 74, ...over };
}

describe('thresholds', () => {
  it('grades both rows against the one staleness line B1 publishes', () => {
    expect(CRAWL_STALE_DAYS, 'the site has one staleness line: STALE_DAYS').toBe(STALE_DAYS);
    expect(CLASSIFICATION_STALE_DAYS).toBe(STALE_DAYS);
    expect(CRAWL_WARN_DAYS).toBe(Math.floor(STALE_DAYS / 2));
    expect(CLASSIFICATION_WARN_DAYS).toBe(Math.floor(STALE_DAYS / 2));
  });
});

describe('parseMeta', () => {
  it('accepts the documented shape, including a null classifiedAt', () => {
    expect(parseMeta(meta())).not.toBeNull();
    expect(parseMeta(meta({ classifiedAt: null }))?.classifiedAt).toBeNull();
  });

  it('rejects anything it cannot trust', () => {
    expect(parseMeta(null)).toBeNull();
    expect(parseMeta('2026-08-29')).toBeNull();
    expect(parseMeta({})).toBeNull();
    expect(parseMeta({ ...meta(), crawledAt: 'not a date' })).toBeNull();
    expect(parseMeta({ ...meta(), skillCount: 'many' })).toBeNull();
    expect(parseMeta({ ...meta(), classifiedAt: 42 })).toBeNull();
  });
});

describe('evaluateStaleness', () => {
  it('reports the crawl and the classification as two independent rows', () => {
    const rotted = CLASSIFICATION_STALE_DAYS + 5;
    const report = evaluateStaleness(meta({ crawledAt: daysAgo(1), classifiedAt: daysAgo(rotted) }), NOW);
    expect(report.crawl.state).toBe('fresh');
    expect(report.crawl.days).toBe(1);
    expect(report.classification.state).toBe('stale');
    expect(report.classification.days).toBe(rotted);
  });

  it('grades the crawl on its own date', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_WARN_DAYS - 1) }), NOW).crawl.state).toBe('fresh');
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_WARN_DAYS + 1) }), NOW).crawl.state).toBe('warn');
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(CRAWL_STALE_DAYS + 1) }), NOW).crawl.state).toBe('stale');
  });

  it('grades the classification on its own date', () => {
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(1) }), NOW).classification.state).toBe('fresh');
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(CLASSIFICATION_WARN_DAYS + 1) }), NOW).classification.state).toBe('warn');
    expect(evaluateStaleness(meta({ classifiedAt: daysAgo(CLASSIFICATION_STALE_DAYS + 1) }), NOW).classification.state).toBe('stale');
  });

  it('computes the lag as how far classification trails the crawl', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(1), classifiedAt: daysAgo(22) }), NOW).lagDays).toBe(21);
  });

  it('never reports a negative lag when classification ran after the crawl', () => {
    expect(evaluateStaleness(meta({ crawledAt: daysAgo(5), classifiedAt: daysAgo(1) }), NOW).lagDays).toBe(0);
  });

  it('says "never run" rather than pretending, when classification has not happened', () => {
    const report = evaluateStaleness(meta({ classifiedAt: null }), NOW);
    expect(report.classification.state).toBe('unknown');
    expect(report.classification.days).toBeNull();
    expect(report.classification.iso).toBeNull();
    expect(report.lagDays).toBeNull();
  });

  it('degrades to unknown on both rows when meta is unreadable', () => {
    const report = evaluateStaleness(null, NOW);
    expect(report.crawl.state).toBe('unknown');
    expect(report.classification.state).toBe('unknown');
    expect(report.lagDays).toBeNull();
    expect(report.skillCount).toBe(0);
  });

  it('carries the counts through for the stats strip', () => {
    const report = evaluateStaleness(meta(), NOW);
    expect(report.skillCount).toBe(812);
    expect(report.sourceCount).toBe(74);
  });

  it('clamps a future crawl date to zero days rather than going negative', () => {
    const future = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    expect(evaluateStaleness(meta({ crawledAt: future }), NOW).crawl.days).toBe(0);
  });
});
