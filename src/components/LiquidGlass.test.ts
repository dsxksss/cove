import { describe, expect, it } from "vitest";
import {
  CornerStyle,
  LiquidGlassType,
  liquidGlassClassName,
  liquidGlassStyle,
} from "./LiquidGlass";

describe("liquidGlassClassName", () => {
  it("mirrors expo type + cornerStyle class tokens", () => {
    expect(
      liquidGlassClassName({
        type: LiquidGlassType.Clear,
        cornerStyle: CornerStyle.Circular,
      })
    ).toBe("liquid-glass liquid-glass--clear liquid-glass--corner-circular");
  });

  it("marks interactive when type is interactive or flag is set", () => {
    expect(
      liquidGlassClassName({ type: LiquidGlassType.Interactive })
    ).toContain("liquid-glass-is-interactive");
    expect(
      liquidGlassClassName({
        type: LiquidGlassType.Clear,
        isInteractive: true,
      })
    ).toContain("liquid-glass-is-interactive");
  });

  it("appends caller className last", () => {
    expect(
      liquidGlassClassName({ type: LiquidGlassType.Regular }, "foo bar")
    ).toMatch(/foo bar$/);
  });
});

describe("liquidGlassStyle", () => {
  it("sets radius CSS var and type-specific fill/blur", () => {
    const clear = liquidGlassStyle({
      type: LiquidGlassType.Clear,
      cornerRadius: 30,
    });
    expect(clear["--lg-radius"]).toBe("30px");
    expect(clear["--lg-blur"]).toBe("14px");
    expect(clear["--lg-fill"]).toContain("rgba");

    const tint = liquidGlassStyle({
      type: LiquidGlassType.Tint,
      tint: "#ff6b6b",
    });
    expect(tint["--lg-tint"]).toBe("#ff6b6b");
    expect(tint["--lg-fill"]).toContain("#ff6b6b");
  });

  it("identity type disables glass fill/blur", () => {
    const identity = liquidGlassStyle({ type: LiquidGlassType.Identity });
    expect(identity["--lg-blur"]).toBe("0px");
    expect(identity["--lg-fill"]).toBe("transparent");
  });
});
