import { describe, expect, it } from "vitest";
import { detectScrollEdge, edgeResistanceImpulse } from "./useScrollEdgeFriction";

describe("scroll edge friction", () => {
  it("detects outward wheel gestures only at a real boundary", () => {
    expect(detectScrollEdge({ scrollTop: 0, scrollHeight: 500, clientHeight: 200 }, -20)).toBe("start");
    expect(detectScrollEdge({ scrollTop: 300, scrollHeight: 500, clientHeight: 200 }, 20)).toBe("end");
    expect(detectScrollEdge({ scrollTop: 120, scrollHeight: 500, clientHeight: 200 }, 20)).toBe(null);
  });

  it("does nothing when the content is not scrollable", () => {
    expect(detectScrollEdge({ scrollTop: 0, scrollHeight: 200, clientHeight: 200 }, -20)).toBe(null);
  });

  it("pushes opposite the wheel direction and clamps the distance", () => {
    expect(edgeResistanceImpulse(-1000)).toBe(11);
    expect(edgeResistanceImpulse(1000)).toBe(-11);
  });
});
