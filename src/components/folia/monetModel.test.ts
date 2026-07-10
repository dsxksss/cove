import { describe, expect, it } from "vitest";
import {
  MONET_ACTIVE_GAP_PX,
  MONET_INACTIVE_GAP_PX,
  MONET_SCROLL_IDLE_RESET_MS,
  MONET_SCROLL_STEP_PX,
  MONET_SCROLL_TRANSITION,
  buildScrollableRailEntries,
  resolveClassicLineTone,
  resolveFumeLineTone,
  resolveMonetLineTone,
  resolveRailLineStatus,
  toTimedLines,
} from "./monetModel";

describe("Folia Monet constants (1:1 with MonetLyricsRail)", () => {
  it("matches Folia numeric constants", () => {
    expect(MONET_ACTIVE_GAP_PX).toBe(14);
    expect(MONET_INACTIVE_GAP_PX).toBe(10);
    expect(MONET_SCROLL_IDLE_RESET_MS).toBe(1800);
    expect(MONET_SCROLL_STEP_PX).toBe(72);
    expect(MONET_SCROLL_TRANSITION.y.stiffness).toBe(142);
    expect(MONET_SCROLL_TRANSITION.scale.stiffness).toBe(150);
  });
});

describe("resolveMonetLineTone", () => {
  it("active line is full presence", () => {
    const t = resolveMonetLineTone(0, "active", 0.86);
    expect(t.opacity).toBe(1);
    expect(t.scale).toBe(1);
    expect(t.blurPx).toBe(0);
    expect(t.fontWeight).toBe(600);
  });

  it("waiting distance falloff matches Folia formula", () => {
    const d1 = resolveMonetLineTone(1, "waiting", 0.86);
    const d3 = resolveMonetLineTone(3, "waiting", 0.86);
    expect(d1.blurPx).toBe(0.7);
    expect(d3.blurPx).toBeGreaterThan(d1.blurPx);
    expect(d1.opacity).toBeGreaterThan(d3.opacity);
  });
});

describe("fume / classic tones", () => {
  it("fume active is larger than monet", () => {
    expect(resolveFumeLineTone(0, "active").scale).toBeGreaterThan(
      resolveMonetLineTone(0, "active", 0.86).scale
    );
  });

  it("classic waiting is blurrier", () => {
    expect(resolveClassicLineTone(1, "waiting").blurPx).toBeGreaterThan(
      resolveMonetLineTone(1, "waiting", 0.86).blurPx
    );
  });
});

describe("buildScrollableRailEntries + toTimedLines", () => {
  it("builds timed window around anchor", () => {
    const source = Array.from({ length: 12 }, (_, i) => ({
      time: i * 2,
      text: `line ${i}`,
      tr: i % 2 === 0 ? `译${i}` : undefined,
    }));
    const timed = toTimedLines(source, 30);
    const entries = buildScrollableRailEntries(timed, source, 5, 5, 2, 2);
    expect(entries.length).toBe(5); // 5-2 .. 5+2
    expect(entries.find((e) => e.offset === 0)?.status).toBe("active");
    expect(resolveRailLineStatus(3, 5)).toBe("passed");
    expect(resolveRailLineStatus(7, 5)).toBe("waiting");
  });
});
