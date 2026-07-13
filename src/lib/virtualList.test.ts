import { describe, expect, it } from "vitest";
import { getVirtualListRange } from "./virtualList";

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
});
