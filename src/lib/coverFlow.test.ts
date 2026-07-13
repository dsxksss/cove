import { describe, expect, it } from "vitest";
import { getCoverFlowRange } from "./coverFlow";

describe("getCoverFlowRange", () => {
  it("never mounts more than nine covers", () => {
    expect(getCoverFlowRange(200, 100)).toEqual({ start: 96, end: 105 });
  });

  it("fills the window at both boundaries", () => {
    expect(getCoverFlowRange(200, 0)).toEqual({ start: 0, end: 9 });
    expect(getCoverFlowRange(200, 199)).toEqual({ start: 191, end: 200 });
  });
});
