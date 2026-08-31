import { MIN_STARS } from '../../src/lib/inclusion.ts';
export type FetchLike = typeof globalThis.fetch;

/** Measured GitHub `search` bucket limit: 30 requests per minute (spec 6.2). */
export const SEARCH_PER_MINUTE = 30;

/** Measured GitHub `code_search` bucket limit: 10 requests per minute (spec 6.2). */
export const CODE_SEARCH_PER_MINUTE = 10;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PacerDeps {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface Pacer {
  take(): Promise<void>;
}

/** Sliding 60-second window; take() blocks until a slot is free. One pacer per bucket. */
export function createPacer(perMinute: number, deps: PacerDeps = {}): Pacer {
  const now = deps.now ?? (() => Date.now());
  const wait = deps.sleep ?? sleep;
  const hits: number[] = [];
  return {
    async take(): Promise<void> {
      for (;;) {
        const t = now();
        while (hits.length > 0 && t - hits[0] >= 60_000) hits.shift();
        if (hits.length < perMinute) {
          hits.push(t);
          return;
        }
        await wait(60_000 - (t - hits[0]) + 50);
      }
    },
  };
}

/** Topic sweeps. Content categories are NEVER seeded from topics (spec 3.4). */
export const DISCOVERY_TOPICS = [
  'claude-skills',
  'agent-skills',
  'openclaw-skills',
  'claude-code',
  'mcp-server',
] as const;

/**
 * Star partitions beat the hard 1,000-result cap on /search/repositories.
 * The lowest band is derived from MIN_STARS so the swept band and the admitted band
 * cannot drift apart.
 */
export const STAR_PARTITIONS: readonly string[] = ['>=1000', '100..999', `${MIN_STARS}..99`];

export function buildSearchQueries(
  topics: readonly string[] = DISCOVERY_TOPICS,
  partitions: readonly string[] = STAR_PARTITIONS,
): string[] {
  const out: string[] = [];
  for (const topic of topics) {
    for (const partition of partitions) {
      out.push(`topic:${topic} stars:${partition}`);
    }
  }
  return out;
}
