/** The slice of Element this module needs, so the logic is testable without a DOM. */
export interface FocusableTarget {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  focus(): void;
}

/**
 * Moves focus to the results heading after a destructive filter change.
 * Returns false when the heading is absent so the caller can fail loudly.
 */
export function moveFocusToResults(target: FocusableTarget | null): boolean {
  if (!target) return false;
  if (target.getAttribute('tabindex') === null) target.setAttribute('tabindex', '-1');
  target.focus();
  return true;
}
