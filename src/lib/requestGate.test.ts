import { describe, expect, it } from "vitest";
import { LatestRequestGate } from "./requestGate";

describe("LatestRequestGate", () => {
  it("accepts only the latest request", () => {
    const gate = new LatestRequestGate();
    const first = gate.next();
    const second = gate.next();
    expect(gate.isCurrent(first)).toBe(false);
    expect(gate.isCurrent(second)).toBe(true);
  });

  it("invalidates in-flight work on cancel", () => {
    const gate = new LatestRequestGate();
    const token = gate.next();
    gate.cancel();
    expect(gate.isCurrent(token)).toBe(false);
  });
});
