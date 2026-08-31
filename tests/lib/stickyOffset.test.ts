import { describe, it, expect, vi } from 'vitest';
import { HEADER_OFFSET_PROPERTY, syncHeaderOffset } from '../../src/lib/stickyOffset.ts';

describe('syncHeaderOffset', () => {
  it('publishes the measured header height in pixels', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(96.4, setProperty)).toBe(96);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '96px');
  });

  it('uses the property name the catalog already reads', () => {
    expect(HEADER_OFFSET_PROPERTY).toBe('--header-h');
  });

  it('never publishes an offset below the floor', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(0, setProperty)).toBe(48);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '48px');
  });

  it('falls back to the floor for an unmeasurable header', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(Number.NaN, setProperty)).toBe(48);
    expect(syncHeaderOffset(Number.POSITIVE_INFINITY, setProperty)).toBe(48);
  });

  it('honours a custom floor', () => {
    const setProperty = vi.fn();
    expect(syncHeaderOffset(10, setProperty, 72)).toBe(72);
    expect(setProperty).toHaveBeenCalledWith(HEADER_OFFSET_PROPERTY, '72px');
  });
});
