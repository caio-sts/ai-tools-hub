export type StopReason = 'core quota' | 'graphql quota' | 'time budget' | 'rate limited';

export interface BudgetLimits {
  coreReserve: number;
  graphqlReserve: number;
  /** null = no time limit. */
  timeBudgetMs: number | null;
}

export const DEFAULT_LIMITS: BudgetLimits = { coreReserve: 200, graphqlReserve: 200, timeBudgetMs: null };

/** Checked between repos, never inside one (spec §3.4). */
export interface Budget {
  observeCore(res: Response): void;
  observeGraphql(remaining: number): void;
  exhausted(): StopReason | null;
}

export function createBudget(limits: Partial<BudgetLimits> = {}, now: () => number = Date.now): Budget {
  const { coreReserve, graphqlReserve, timeBudgetMs } = { ...DEFAULT_LIMITS, ...limits };
  const started = now();
  let core = Number.POSITIVE_INFINITY;
  let graphql = Number.POSITIVE_INFINITY;

  return {
    observeCore(res) {
      const header = res.headers.get('x-ratelimit-remaining');
      if (header === null || header.trim() === '') return;
      const remaining = Number(header);
      if (Number.isFinite(remaining)) core = remaining;
    },
    observeGraphql(remaining) {
      if (remaining >= 0) graphql = remaining;
    },
    exhausted() {
      if (core < coreReserve) return 'core quota';
      if (graphql < graphqlReserve) return 'graphql quota';
      if (timeBudgetMs !== null && now() - started >= timeBudgetMs) return 'time budget';
      return null;
    },
  };
}

/** Primary limit (remaining 0), secondary limit (retry-after), or 429. */
export function isRateLimited(res: Response): boolean {
  if (res.status === 429) return true;
  if (res.status !== 403) return false;
  return res.headers.get('x-ratelimit-remaining') === '0' || res.headers.get('retry-after') !== null;
}

export class RateLimitedError extends Error {
  constructor(what: string) {
    super(`${what}: rate limited`);
    this.name = 'RateLimitedError';
  }
}

export function timeBudgetFromEnv(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`HARVEST_TIME_BUDGET_MIN must be a positive number of minutes, got "${value}"`);
  }
  return minutes * 60_000;
}
