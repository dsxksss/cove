export interface VirtualListRange {
  start: number;
  end: number;
  topHeight: number;
  bottomHeight: number;
}

/** Calculate a fixed-row window using an exclusive end index. */
export function getVirtualListRange(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): VirtualListRange {
  const count = Math.max(0, Math.floor(itemCount));
  const height = Math.max(1, rowHeight);
  const extra = Math.max(0, Math.floor(overscan));
  const top = Math.max(0, scrollTop);
  const viewport = Math.max(0, viewportHeight);
  const start = Math.max(0, Math.floor(top / height) - extra);
  const end = Math.min(count, Math.ceil((top + viewport) / height) + extra);
  return {
    start,
    end,
    topHeight: start * height,
    bottomHeight: Math.max(0, (count - end) * height),
  };
}
