import { describe, it, expect, vi } from 'vitest';
import { moveFocusToResults, type FocusableTarget } from '../../src/lib/focus.ts';

function stub(initialTabindex: string | null = null) {
  const attrs = new Map<string, string>();
  if (initialTabindex !== null) attrs.set('tabindex', initialTabindex);
  const focus = vi.fn();
  const target: FocusableTarget = {
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => void attrs.set(name, value),
    focus,
  };
  return { target, attrs, focus };
}

describe('moveFocusToResults', () => {
  it('makes a plain heading programmatically focusable and focuses it', () => {
    const { target, attrs, focus } = stub();
    expect(moveFocusToResults(target)).toBe(true);
    expect(attrs.get('tabindex')).toBe('-1');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('never overwrites an author-supplied tabindex', () => {
    const { target, attrs, focus } = stub('0');
    moveFocusToResults(target);
    expect(attrs.get('tabindex')).toBe('0');
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('reports failure instead of throwing when the heading is missing', () => {
    expect(moveFocusToResults(null)).toBe(false);
  });
});
