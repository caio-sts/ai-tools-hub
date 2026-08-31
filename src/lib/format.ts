import type { Lang } from '../types.ts';

/**
 * Days after which a crawl date is presented as stale (spec §13). Single-sourced on purpose:
 * B2's home stats strip and B5's staleness banner and card dates both import this, so the site
 * cannot call one date fresh and another stale on the same page load.
 */
export const STALE_DAYS = 60;

/**
 * Compact age label: "today"/"hoje", "12d", "4mo"/"4m", "2y"/"2a".
 * Months are 30 days, years 365; both floor. Negative and non-finite input reads as today.
 */
export function relativeDays(days: number, lang: Lang): string {
  const d = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  if (d === 0) return lang === 'pt' ? 'hoje' : 'today';
  if (d < 30) return `${d}d`;
  if (d < 365) return `${Math.floor(d / 30)}${lang === 'pt' ? 'm' : 'mo'}`;
  return `${Math.floor(d / 365)}${lang === 'pt' ? 'a' : 'y'}`;
}
