import { describe, expect, it } from "vitest";
import { getBufferedVirtualListRange, getVirtualListRange } from "./virtualList";

describe("getVirtualListRange", () => {
  it("mounts only viewport rows plus overscan for a long playlist", () => {
    const range = getVirtualListRange(2000, 58 * 900, 580, 58, 8);
    expect(range.start).toBe(892);
    expect(range.end).toBe(918);
    expect(range.end - range.start).toBe(26);
    expect(range.end - range.start).toBeLessThanOrEqual(30);
    expect(range.topHeight + (range.end - range.start) * 58 + range.bottomHeight).toBe(
      2000 * 58,
    );
  });

  it("clamps the window at both ends", () => {
    expect(getVirtualListRange(3, -100, 580, 58, 8)).toEqual({
      start: 0,
      end: 3,
      topHeight: 0,
      bottomHeight: 0,
    });
  });

  it("renders a short replacement playlist even with the old deep scroll offset", () => {
    expect(getVirtualListRange(3, 58000, 580, 58, 5)).toEqual({
      start: 0, end: 3, topHeight: 0, bottomHeight: 0,
    });
    expect(getVirtualListRange(0, 58000, 580, 58, 5)).toEqual({
      start: 0, end: 0, topHeight: 0, bottomHeight: 0,
    });
  });

  it("keeps the remaining queue tail visible after removing rows", () => {
    const range = getVirtualListRange(30, 58000, 580, 58, 5);
    expect(range.start).toBe(15);
    expect(range.end).toBe(30);
    expect(range.topHeight + (range.end - range.start) * 58 + range.bottomHeight).toBe(30 * 58);
  });
});

describe("buffered virtual windows", () => {
  it("keeps the same mounted window during small scroll increments", () => {
    const previous = getVirtualListRange(2000, 5800, 580, 58, 8);
    expect(getBufferedVirtualListRange(2000, 5858, 580, 58, 8, previous)).toBe(previous);
  });

  it("covers fast jumps, reversals and the end of the list", () => {
    let range = getVirtualListRange(2000, 0, 580, 58, 8);
    for (const top of [58, 4000, 58000, 580, 0, 999999]) {
      range = getBufferedVirtualListRange(2000, top, 580, 58, 8, range);
      const visible = getVirtualListRange(2000, top, 580, 58, 0);
      expect(range.start).toBeLessThanOrEqual(visible.start);
      expect(range.end).toBeGreaterThanOrEqual(visible.end);
      expect(range.end - range.start).toBeLessThanOrEqual(27);
    }
  });

  it("reconciles list shrink, clear, refill and viewport growth", () => {
    let range = getVirtualListRange(2000, 58000, 580, 58, 8);
    range = getBufferedVirtualListRange(3, 58000, 580, 58, 8, range);
    expect(range.start).toBe(0);
    expect(range.end).toBe(3);
    range = getBufferedVirtualListRange(0, 0, 580, 58, 8, range);
    expect(range.end).toBe(0);
    range = getBufferedVirtualListRange(2000, 0, 580, 58, 8, range);
    expect(range.end).toBe(18);
    range = getBufferedVirtualListRange(2000, 0, 1740, 58, 8, range);
    expect(range.end).toBe(38);
  });
});
