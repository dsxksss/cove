export interface CoverFlowRange {
  start: number;
  end: number;
}

/** Keep a centered cover-flow window with an exclusive end index. */
export function getCoverFlowRange(
  itemCount: number,
  focusIndex: number,
  radius = 4,
): CoverFlowRange {
  const count = Math.max(0, Math.floor(itemCount));
  if (count === 0) return { start: 0, end: 0 };
  const safeRadius = Math.max(0, Math.floor(radius));
  const windowSize = safeRadius * 2 + 1;
  const focus = Math.max(0, Math.min(count - 1, Math.floor(focusIndex)));
  const start = Math.max(0, Math.min(focus - safeRadius, count - windowSize));
  return { start, end: Math.min(count, start + windowSize) };
}
