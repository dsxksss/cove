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
  const viewport = Math.max(0, viewportHeight);
  // A previous playlist (or a deleted queue tail) can leave an obsolete offset.
  const top = Math.min(Math.max(0, scrollTop), Math.max(0, count * height - viewport));
  const start = Math.max(0, Math.floor(top / height) - extra);
  const end = Math.min(count, Math.ceil((top + viewport) / height) + extra);
  return {
    start,
    end,
    topHeight: start * height,
    bottomHeight: Math.max(0, (count - end) * height),
  };
}

/** Reuse the mounted window until the viewport approaches its buffered edge. */
export function getBufferedVirtualListRange(
  itemCount: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
  previous: VirtualListRange,
): VirtualListRange {
  const visible = getVirtualListRange(itemCount, scrollTop, viewportHeight, rowHeight, 0);
  const guard = Math.min(2, Math.max(0, Math.floor(overscan)));
  if (
    previous.start <= Math.max(0, visible.start - guard) &&
    previous.end >= Math.min(itemCount, visible.end + guard) &&
    previous.end <= itemCount &&
    previous.bottomHeight === Math.max(0, (itemCount - previous.end) * rowHeight)
  ) {
    return previous;
  }
  return getVirtualListRange(itemCount, scrollTop, viewportHeight, rowHeight, overscan);
}
