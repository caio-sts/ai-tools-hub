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

/** Intl locale tags backing each site language. */
const LOCALES: Record<Lang, string> = { en: 'en-US', pt: 'pt-BR' };

function scaled(locale: string, value: number, suffix: string): string {
  const maximumFractionDigits = Math.abs(value) < 10 ? 1 : 0;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(value);
  return `${formatted}${suffix}`;
}

/**
 * Metric count with locale separators: 1234 -> "1.2K" (en) / "1,2K" (pt).
 * K/M/B stay verbatim in both locales; the unit is promoted before rounding
 * could print "1,000K". Non-finite input reads as zero.
 */
export function compactNumber(n: number, lang: Lang): string {
  const locale = LOCALES[lang] ?? LOCALES.en;
  const value = Number.isFinite(n) ? Math.trunc(n) : 0;
  const abs = Math.abs(value);
  if (abs < 1000) return new Intl.NumberFormat(locale).format(value);
  if (abs < 999_500) return scaled(locale, value / 1000, 'K');
  if (abs < 999_500_000) return scaled(locale, value / 1_000_000, 'M');
  return scaled(locale, value / 1_000_000_000, 'B');
}

/** Every digit, locale-grouped: 1830 -> "1,830" (en) / "1.830" (pt). */
export function fullNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(LOCALES[lang] ?? LOCALES.en, { maximumFractionDigits: 0 }).format(n);
}

/**
 * "N of M" in full numbers while a crawl is still reaching every discovered repo (compacting
 * could print "4.4K of 4.4K"); the bare N, in the caller's `render`, once it has.
 */
export function coverage(
  read: number,
  discovered: number,
  of: string,
  lang: Lang,
  render: (n: number) => string,
): string {
  return read < discovered ? `${fullNumber(read, lang)} ${of} ${fullNumber(discovered, lang)}` : render(read);
}
