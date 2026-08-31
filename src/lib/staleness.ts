import { STALE_DAYS } from './format.ts';

/** Shape of data/meta.json. Written by the harvest run and by the classification PR. */
export interface SiteMeta {
  crawledAt: string;
  classifiedAt: string | null;
  skillCount: number;
  sourceCount: number;
}

export type FreshnessState = 'fresh' | 'warn' | 'stale' | 'unknown';

export interface FreshnessRow {
  state: FreshnessState;
  days: number | null;
  iso: string | null;
}

export interface StalenessReport {
  crawl: FreshnessRow;
  classification: FreshnessRow;
  /** How many days classification trails the crawl. Null when it never ran. */
  lagDays: number | null;
  skillCount: number;
  sourceCount: number;
}

/**
 * The site publishes exactly one staleness line — STALE_DAYS in src/lib/format.ts (B1) — and both
 * rows are graded against it, each on its own date. The rows still rot independently and are never
 * merged into a single "last updated" figure.
 */
export const CRAWL_STALE_DAYS = STALE_DAYS;
export const CLASSIFICATION_STALE_DAYS = STALE_DAYS;

/** Warn at half the published line. */
export const CRAWL_WARN_DAYS = Math.floor(STALE_DAYS / 2);
export const CLASSIFICATION_WARN_DAYS = Math.floor(STALE_DAYS / 2);

const DAY_MS = 86_400_000;
const UNKNOWN: FreshnessRow = { state: 'unknown', days: null, iso: null };

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function parseMeta(raw: unknown): SiteMeta | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (!isIsoDate(record.crawledAt)) return null;
  if (record.classifiedAt !== null && !isIsoDate(record.classifiedAt)) return null;
  if (!Number.isFinite(record.skillCount) || !Number.isFinite(record.sourceCount)) return null;
  return {
    crawledAt: record.crawledAt,
    classifiedAt: (record.classifiedAt as string | null) ?? null,
    skillCount: record.skillCount as number,
    sourceCount: record.sourceCount as number,
  };
}

function wholeDaysBetween(later: number, earlier: number): number {
  return Math.max(0, Math.floor((later - earlier) / DAY_MS));
}

function grade(days: number, warnAt: number, staleAt: number): FreshnessState {
  if (days >= staleAt) return 'stale';
  if (days >= warnAt) return 'warn';
  return 'fresh';
}

/**
 * Crawl date and classification lag are reported separately and never merged.
 * Harvest keeps running on the weekly Action even when the maintainer's machine is off;
 * classification does not (§6.1, §13).
 */
export function evaluateStaleness(meta: SiteMeta | null, now: Date): StalenessReport {
  if (!meta) {
    return { crawl: UNKNOWN, classification: UNKNOWN, lagDays: null, skillCount: 0, sourceCount: 0 };
  }

  const nowMs = now.getTime();
  const crawledMs = Date.parse(meta.crawledAt);
  const crawlDays = wholeDaysBetween(nowMs, crawledMs);
  const crawl: FreshnessRow = {
    state: grade(crawlDays, CRAWL_WARN_DAYS, CRAWL_STALE_DAYS),
    days: crawlDays,
    iso: meta.crawledAt,
  };

  if (meta.classifiedAt === null) {
    return {
      crawl,
      classification: UNKNOWN,
      lagDays: null,
      skillCount: meta.skillCount,
      sourceCount: meta.sourceCount,
    };
  }

  const classifiedMs = Date.parse(meta.classifiedAt);
  const classifiedDays = wholeDaysBetween(nowMs, classifiedMs);

  return {
    crawl,
    classification: {
      state: grade(classifiedDays, CLASSIFICATION_WARN_DAYS, CLASSIFICATION_STALE_DAYS),
      days: classifiedDays,
      iso: meta.classifiedAt,
    },
    lagDays: wholeDaysBetween(crawledMs, classifiedMs),
    skillCount: meta.skillCount,
    sourceCount: meta.sourceCount,
  };
}
