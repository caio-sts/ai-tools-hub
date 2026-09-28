import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMITS,
  RateLimitedError,
  createBudget,
  isRateLimited,
  timeBudgetFromEnv,
} from '../../scripts/harvest/budget.ts';

function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status, headers });
}

describe('createBudget', () => {
  it('ships the reserves the spec fixes, and no time limit by default', () => {
    expect(DEFAULT_LIMITS).toEqual({ coreReserve: 200, graphqlReserve: 200, timeBudgetMs: null });
  });

  it('is not exhausted before any response has been observed', () => {
    expect(createBudget().exhausted()).toBeNull();
  });

  it('stops on the core quota once x-ratelimit-remaining drops below the reserve', () => {
    const budget = createBudget();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '200' }));
    expect(budget.exhausted()).toBeNull();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '199' }));
    expect(budget.exhausted()).toBe('core quota');
  });

  it('ignores a response without a usable rate-limit header', () => {
    const budget = createBudget();
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '10' }));
    budget.observeCore(res(200));
    budget.observeCore(res(200, { 'x-ratelimit-remaining': 'soon' }));
    expect(budget.exhausted()).toBe('core quota');
  });

  it('stops on the GraphQL quota, and ignores the -1 "unknown" sentinel', () => {
    const budget = createBudget();
    budget.observeGraphql(-1);
    expect(budget.exhausted()).toBeNull();
    budget.observeGraphql(150);
    expect(budget.exhausted()).toBe('graphql quota');
  });

  it('stops on elapsed time only when a time budget is set', () => {
    let t = 0;
    const timed = createBudget({ timeBudgetMs: 1000 }, () => t);
    const untimed = createBudget({}, () => t);
    t = 999;
    expect(timed.exhausted()).toBeNull();
    t = 1000;
    expect(timed.exhausted()).toBe('time budget');
    t = 10_000_000;
    expect(untimed.exhausted()).toBeNull();
  });

  it('honours custom reserves', () => {
    const budget = createBudget({ coreReserve: 5 });
    budget.observeCore(res(200, { 'x-ratelimit-remaining': '5' }));
    expect(budget.exhausted()).toBeNull();
  });
});

describe('isRateLimited', () => {
  it('recognises the primary limit, the secondary limit and 429', () => {
    expect(isRateLimited(res(429))).toBe(true);
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '0' }))).toBe(true);
    expect(isRateLimited(res(403, { 'retry-after': '60' }))).toBe(true);
  });

  it('does not mistake a plain 403 or a success for a rate limit', () => {
    expect(isRateLimited(res(403))).toBe(false);
    expect(isRateLimited(res(403, { 'x-ratelimit-remaining': '4000' }))).toBe(false);
    expect(isRateLimited(res(200, { 'x-ratelimit-remaining': '0' }))).toBe(false);
  });
});

describe('RateLimitedError', () => {
  it('names what was refused', () => {
    const error = new RateLimitedError('tree owner/repo');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RateLimitedError');
    expect(error.message).toBe('tree owner/repo: rate limited');
  });
});

describe('timeBudgetFromEnv', () => {
  it('reads minutes and returns milliseconds', () => {
    expect(timeBudgetFromEnv('35')).toBe(2_100_000);
    expect(timeBudgetFromEnv('0.5')).toBe(30_000);
  });

  it('means "no limit" when unset or blank', () => {
    expect(timeBudgetFromEnv(undefined)).toBeNull();
    expect(timeBudgetFromEnv('')).toBeNull();
    expect(timeBudgetFromEnv('  ')).toBeNull();
  });

  it('refuses a value it cannot honour, instead of running unbounded', () => {
    expect(() => timeBudgetFromEnv('abc')).toThrow('HARVEST_TIME_BUDGET_MIN');
    expect(() => timeBudgetFromEnv('0')).toThrow('HARVEST_TIME_BUDGET_MIN');
    expect(() => timeBudgetFromEnv('-5')).toThrow('HARVEST_TIME_BUDGET_MIN');
  });
});
