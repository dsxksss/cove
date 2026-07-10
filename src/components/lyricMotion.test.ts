import { describe, expect, it } from "vitest";
import {
  buildFoliaRailEntries,
  buildKaraokeMask,
  getLyricLineMotion,
  lineFillProgress,
  monetGlowIntensity,
  progressToFillWidth,
  resolveClassicTone,
  resolveFumeTone,
  resolveLineStatus,
  resolveMonetTone,
  smoothstep,
  splitGraphemes,
} from "./lyricMotion";

describe("resolveLineStatus", () => {
  it("classifies waiting / active / passed", () => {
    expect(resolveLineStatus(2, 2)).toBe("active");
    expect(resolveLineStatus(1, 2)).toBe("passed");
    expect(resolveLineStatus(3, 2)).toBe("waiting");
  });
});

describe("resolveMonetTone (folia MonetLyricsRail)", () => {
  it("active line is full opacity, scale 1, no blur", () => {
    const t = resolveMonetTone(0, "active");
    expect(t.opacity).toBe(1);
    expect(t.scale).toBe(1);
    expect(t.blurPx).toBe(0);
    expect(t.fontWeight).toBe(600);
  });

  it("waiting neighbors fade and blur with distance", () => {
    const near = resolveMonetTone(1, "waiting");
    const far = resolveMonetTone(3, "waiting");
    expect(near.opacity).toBeGreaterThan(far.opacity);
    expect(far.blurPx).toBeGreaterThan(near.blurPx);
    expect(near.scale).toBeLessThan(1);
  });

  it("passed lines use softer opacity than waiting at same distance", () => {
    const wait = resolveMonetTone(1, "waiting");
    const pass = resolveMonetTone(-1, "passed");
    expect(wait.opacity).toBeGreaterThan(pass.opacity);
  });
});

describe("resolveFumeTone / resolveClassicTone", () => {
  it("fume hero active is larger than monet", () => {
    expect(resolveFumeTone(0, "active").scale).toBeGreaterThan(resolveMonetTone(0, "active").scale);
  });

  it("classic waiting is blurrier than monet at distance 1", () => {
    expect(resolveClassicTone(1, "waiting").blurPx).toBeGreaterThan(
      resolveMonetTone(1, "waiting").blurPx
    );
  });
});

describe("buildFoliaRailEntries", () => {
  it("centers the anchor and windows neighbors", () => {
    const entries = buildFoliaRailEntries({
      lineCount: 20,
      anchorIndex: 10,
      activeIndex: 10,
      style: "monet",
      railHeight: 400,
    });
    expect(entries.length).toBeGreaterThan(5);
    const anchor = entries.find((e) => e.offset === 0);
    expect(anchor).toBeTruthy();
    expect(anchor!.status).toBe("active");
    // Optical center ~46% of rail
    expect(anchor!.y).toBeGreaterThan(100);
    expect(anchor!.y).toBeLessThan(250);
  });
});

describe("lineFillProgress / glow / karaoke mask", () => {
  it("maps time into 0..1 fill", () => {
    expect(lineFillProgress(1, 0, 2)).toBeCloseTo(0.5, 5);
    expect(lineFillProgress(0, 1, 2)).toBe(0);
    expect(lineFillProgress(3, 1, 2)).toBe(1);
  });

  it("smoothstep and glow stay in 0..1", () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(monetGlowIntensity(0.2)).toBeGreaterThan(0);
    expect(monetGlowIntensity(0.2)).toBeLessThanOrEqual(1);
  });

  it("builds soft-edge karaoke mask from fill px", () => {
    const mask = buildKaraokeMask(40, 22);
    expect(mask).toContain("linear-gradient");
    expect(mask).toContain("40");
  });

  it("progressToFillWidth interpolates grapheme offsets", () => {
    const offsets = [0, 10, 20, 30];
    expect(progressToFillWidth(0, offsets)).toBe(0);
    expect(progressToFillWidth(1, offsets)).toBe(30);
    expect(progressToFillWidth(0.5, offsets)).toBeCloseTo(15, 5);
  });

  it("splitGraphemes handles CJK", () => {
    expect(splitGraphemes("你好").length).toBe(2);
  });
});

describe("getLyricLineMotion (scroll rail)", () => {
  it("dialogue offsets sides", () => {
    const left = getLyricLineMotion({
      style: "dialogue",
      index: 0,
      isFocused: true,
      isActive: true,
      isPassed: false,
      distance: 0,
      text: "a",
    });
    const right = getLyricLineMotion({
      style: "dialogue",
      index: 1,
      isFocused: true,
      isActive: true,
      isPassed: false,
      distance: 0,
      text: "b",
    });
    expect(left.dialogueSide).toBe("left");
    expect(right.dialogueSide).toBe("right");
    expect(right.x).toBeGreaterThan(left.x);
  });
});
