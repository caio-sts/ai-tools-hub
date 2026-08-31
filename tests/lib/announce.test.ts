import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedAnnouncer } from '../../src/lib/announce.ts';

describe('createDebouncedAnnouncer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('says nothing before the debounce window elapses', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText, 300).announce('1 result');
    vi.advanceTimersByTime(299);
    expect(setText).not.toHaveBeenCalled();
  });

  it('collapses a burst of keystrokes into one announcement of the last value', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    for (const message of ['9 results', '4 results', '2 results', '1 result', 'No results']) {
      announcer.announce(message);
      vi.advanceTimersByTime(50);
    }
    expect(setText).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(setText).toHaveBeenCalledTimes(1);
    expect(setText).toHaveBeenCalledWith('No results');
  });

  it('announces again after a new quiet period', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    vi.advanceTimersByTime(300);
    announcer.announce('7 results');
    vi.advanceTimersByTime(300);
    expect(setText.mock.calls).toEqual([['3 results'], ['7 results']]);
  });

  it('cancel drops the pending announcement', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    announcer.cancel();
    vi.advanceTimersByTime(1000);
    expect(setText).not.toHaveBeenCalled();
  });

  it('flush announces immediately and only once', () => {
    const setText = vi.fn();
    const announcer = createDebouncedAnnouncer(setText, 300);
    announcer.announce('3 results');
    announcer.flush();
    expect(setText).toHaveBeenCalledWith('3 results');
    vi.advanceTimersByTime(1000);
    expect(setText).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending is a no-op', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText, 300).flush();
    expect(setText).not.toHaveBeenCalled();
  });

  it('defaults to a 300 ms window', () => {
    const setText = vi.fn();
    createDebouncedAnnouncer(setText).announce('3 results');
    vi.advanceTimersByTime(299);
    expect(setText).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setText).toHaveBeenCalledTimes(1);
  });
});
