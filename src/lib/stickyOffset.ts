/** WCAG 2.2 2.4.11: scroll targets clear the sticky header by exactly this much. */
export const HEADER_OFFSET_PROPERTY = '--header-h';

export function syncHeaderOffset(
  headerHeight: number,
  setProperty: (name: string, value: string) => void,
  minPx = 48,
): number {
  const measured = Number.isFinite(headerHeight) ? Math.round(headerHeight) : 0;
  const value = Math.max(minPx, measured);
  setProperty(HEADER_OFFSET_PROPERTY, `${value}px`);
  return value;
}
