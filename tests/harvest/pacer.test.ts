import { describe, expect, it } from 'vitest';
import {
  CODE_SEARCH_PER_MINUTE,
  createPacer,
  SEARCH_PER_MINUTE,
  sleep,
} from '../../scripts/harvest/discover.ts';

describe('createPacer', () => {
  it('lets the first perMinute calls through without sleeping', async () => {
    const slept: number[] = [];
    let clock = 1_000_000;
    const pacer = createPacer(3, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    await pacer.take();
    await pacer.take();

    expect(slept).toEqual([]);
  });

  it('sleeps until the oldest hit leaves the 60s window', async () => {
    const slept: number[] = [];
    let clock = 1_000_000;
    const pacer = createPacer(3, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    await pacer.take();
    await pacer.take();
    await pacer.take();

    expect(slept).toEqual([60_050]);
    expect(clock).toBe(1_060_050);
  });

  it('does not sleep when calls are naturally spread out', async () => {
    const slept: number[] = [];
    let clock = 0;
    const pacer = createPacer(2, {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });

    await pacer.take();
    clock += 30_000;
    await pacer.take();
    clock += 31_000;
    await pacer.take();

    expect(slept).toEqual([]);
  });

  it('exposes both measured bucket limits and a real sleep', async () => {
    expect(SEARCH_PER_MINUTE).toBe(30);
    expect(CODE_SEARCH_PER_MINUTE).toBe(10);
    const start = Date.now();
    await sleep(5);
    expect(Date.now() - start).toBeGreaterThanOrEqual(4);
  });
});
