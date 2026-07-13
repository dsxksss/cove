import { describe, expect, it } from "vitest";
import {
  MONET_ACTIVE_GAP_PX,
  MONET_INACTIVE_GAP_PX,
  MONET_SCROLL_IDLE_RESET_MS,
  MONET_SCROLL_STEP_PX,
  MONET_SCROLL_TRANSITION,
  buildPositionedEntries,
  buildScrollableRailEntries,
  measureMonetLineLayout,
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
    expect(MONET_SCROLL_TRANSITION.y.duration).toBe(0.34);
    expect(MONET_SCROLL_TRANSITION.scale.duration).toBe(
      MONET_SCROLL_TRANSITION.y.duration,
    );
    expect(MONET_SCROLL_TRANSITION.scale.ease).toEqual(
      MONET_SCROLL_TRANSITION.y.ease,
    );
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

describe("measureMonetLineLayout", () => {
  it("reserves translation space below a wrapped active lyric", () => {
    const layout = measureMonetLineLayout({
      text: "Hate you hate you don’t come back again",
      translation: "我恨你！你不要再回来了！",
      status: "active",
      fontPx: 28,
      fontWeight: 600,
      translationFontPx: 15,
      fontStack: "sans-serif",
      maxWidthPx: 360,
      showSubtitleTranslation: true,
    });
    expect(layout.textHeightPx).toBeGreaterThan(28 * 1.18);
    expect(layout.translationHeightPx).toBeGreaterThan(0);
    expect(layout.textPaddingBottomPx + layout.translationPaddingTopPx).toBeLessThan(9);
    expect(layout.visualHeightPx).toBe(
      layout.textHeightPx + layout.translationHeightPx
    );
  });

  it("uses final DOM heights when browser wrapping differs from the estimate", () => {
    const source = [
      {
        time: 0,
        text: "A long main lyric that WebView wraps differently",
        tr: "翻译歌词",
      },
    ];
    const entries = buildScrollableRailEntries(
      toTimedLines(source, 10),
      source,
      0,
      0,
      0,
      0,
    );
    const domMeasurements = new Map([
      [entries[0].key, { textHeightPx: 100, translationHeightPx: 30 }],
    ]);

    const [positioned] = buildPositionedEntries(
      entries,
      340,
      680,
      "monet",
      28,
      22,
      15,
      "sans-serif",
      34,
      true,
      domMeasurements,
    );

    expect(positioned.layout.textHeightPx).toBe(100);
    expect(positioned.layout.translationHeightPx).toBe(30);
    expect(positioned.layout.visualHeightPx).toBe(130);
    expect(positioned.scaledHeight).toBe(130);
  });

  it("reserves translation space for inactive lyrics too", () => {
    const layout = measureMonetLineLayout({
      text: "Waiting lyric",
      translation: "等待中的翻译",
      status: "waiting",
      fontPx: 24,
      translationFontPx: 14,
      fontStack: "sans-serif",
      maxWidthPx: 420,
      showSubtitleTranslation: true,
    });
    expect(layout.translationHeightPx).toBeGreaterThan(0);
  });
});
