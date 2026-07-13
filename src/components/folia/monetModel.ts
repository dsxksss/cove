/**
 * Monet rail model — ported from Folia monetLyricsModel + MonetLyricsRail helpers.
 */
import type { LyricsLine } from "../playerTypes";
import type { LyricMotionStyle } from "../playerTypes";
import { buildTimedLine, type TimedLine } from "../../lib/lyricTiming";
import { layoutWithLines, prepareWithSegments } from "@chenglou/pretext";

export type LineStatus = "waiting" | "active" | "passed";

export type MonetLineTone = {
  opacity: number;
  scale: number;
  blurPx: number;
  baseColor: string;
  fontWeight: number;
  zIndex: number;
};

export type MonetVisibleLineEntry = {
  key: string;
  line: TimedLine;
  source: LyricsLine;
  index: number;
  offset: number;
  status: LineStatus;
};

export type MonetMeasuredLineLayout = {
  textHeightPx: number;
  textPaddingTopPx: number;
  textPaddingBottomPx: number;
  translationHeightPx: number;
  translationPaddingTopPx: number;
  translationPaddingBottomPx: number;
  visualHeightPx: number;
  lineHeightPx: number;
  translationLineHeightPx: number;
  isTextClipped: boolean;
};

/** The WebView's final line boxes can differ from Pretext's estimate. */
export type MonetDomLineMeasurement = Pick<
  MonetMeasuredLineLayout,
  "textHeightPx" | "translationHeightPx"
>;

export type PositionedMonetLineEntry = MonetVisibleLineEntry & {
  y: number;
  tone: MonetLineTone;
  layout: MonetMeasuredLineLayout;
  scaledHeight: number;
};

export const MONET_ACTIVE_GAP_PX = 14;
export const MONET_INACTIVE_GAP_PX = 10;
export const MONET_GLOW_RISE_DURATION_SCALE = 1.18;
export const MONET_GLOW_PASS_TAIL_SECONDS = 1.05;
export const MONET_SCROLL_IDLE_RESET_MS = 1800;
export const MONET_SCROLL_STEP_PX = 72;
export const MONET_TOUCH_STEP_PX = 52;
/** Visible lines above / below the anchor — larger than Folia poster mode
 *  so the desktop player fills the tall lyrics pane. */
export const MONET_SCROLL_BEFORE = 8;
export const MONET_SCROLL_AFTER = 8;
/** Tighter auto-follow still keeps more context than Folia's 2/2 poster window. */
export const MONET_AUTO_SCROLL_BEFORE = 6;
export const MONET_AUTO_SCROLL_AFTER = 7;
export const MONET_ACTIVE_TEXT_LINE_LIMIT = 3;
export const MONET_INACTIVE_TEXT_LINE_LIMIT = 2;

export const MONET_SCROLL_TRANSITION = {
  // Position and scale must share the exact same progress curve. Different
  // springs can temporarily compress two otherwise non-overlapping line boxes
  // into each other while the active line changes size.
  y: { duration: 0.34, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
  scale: { duration: 0.34, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
  opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
  filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
};

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const clampScrollSteps = (steps: number) => Math.max(-1, Math.min(1, steps));
export const getScrollDirection = (delta: number) =>
  delta === 0 ? 0 : delta > 0 ? 1 : -1;

export function resolveClampFontPx(
  minRem: number,
  preferredVw: number,
  maxRem: number
): number {
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  return Math.min(maxRem * 16, Math.max(minRem * 16, viewportWidth * (preferredVw / 100)));
}

export function resolveRailLineStatus(
  lineIndex: number,
  activeLineIndex: number
): LineStatus {
  if (lineIndex === activeLineIndex) return "active";
  if (activeLineIndex >= 0 && lineIndex < activeLineIndex) return "passed";
  return "waiting";
}

/** Folia MonetLyricsRail.resolveLineTone */
export function resolveMonetLineTone(
  offset: number,
  status: LineStatus,
  inactiveScale: number,
  primaryRgb = "rgba(255,255,255,1)"
): MonetLineTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1,
      blurPx: 0,
      baseColor: primaryRgb.replace(/[\d.]+\)$/, "0.34)"),
      fontWeight: 600,
      zIndex: 4,
    };
  }
  const distance = Math.max(Math.abs(offset), 1);
  const isWaiting = status === "waiting";
  const scale = clamp(inactiveScale * Math.pow(0.9, distance - 1), 0.68, 0.92);
  return {
    opacity: isWaiting
      ? clamp(0.72 - (distance - 1) * 0.18, 0.36, 0.72)
      : clamp(0.52 - (distance - 1) * 0.12, 0.28, 0.52),
    scale,
    blurPx: isWaiting
      ? distance === 1
        ? 0.7
        : 1.8 + (distance - 2) * 0.8
      : 1.1 + (distance - 1) * 0.7,
    baseColor: primaryRgb.replace(
      /[\d.]+\)$/,
      isWaiting ? "0.46)" : "0.36)"
    ),
    fontWeight: 500,
    zIndex: isWaiting ? 3 - distance : 2 - distance,
  };
}

/** Fume tone — hero active, paper hold on passed */
export function resolveFumeLineTone(
  offset: number,
  status: LineStatus
): MonetLineTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1.08,
      blurPx: 0,
      baseColor: "rgba(255,255,255,0.32)",
      fontWeight: 700,
      zIndex: 5,
    };
  }
  const distance = Math.max(Math.abs(offset), 1);
  const isWaiting = status === "waiting";
  return {
    opacity: isWaiting
      ? clamp(0.55 - (distance - 1) * 0.12, 0.22, 0.55)
      : clamp(0.5 - (distance - 1) * 0.08, 0.24, 0.5),
    scale: clamp(0.9 - (distance - 1) * 0.035, 0.74, 0.9),
    blurPx: isWaiting ? 0.5 + (distance - 1) * 0.5 : 0.9 + (distance - 1) * 0.4,
    baseColor: isWaiting ? "rgba(255,255,255,0.42)" : "rgba(255,255,255,0.38)",
    fontWeight: 500,
    zIndex: isWaiting ? 3 - distance : 2 - distance,
  };
}

/** Classic tone — stronger waiting blur, afterglow passed */
export function resolveClassicLineTone(
  offset: number,
  status: LineStatus
): MonetLineTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1,
      blurPx: 0,
      baseColor: "rgba(255,255,255,0.3)",
      fontWeight: 700,
      zIndex: 5,
    };
  }
  const distance = Math.max(Math.abs(offset), 1);
  const isWaiting = status === "waiting";
  return {
    opacity: isWaiting
      ? clamp(0.38 - (distance - 1) * 0.1, 0.14, 0.38)
      : clamp(0.58 - (distance - 1) * 0.1, 0.22, 0.58),
    scale: isWaiting
      ? clamp(0.94 - (distance - 1) * 0.03, 0.84, 0.94)
      : clamp(1.0 - (distance - 1) * 0.02, 0.9, 1.0),
    blurPx: isWaiting
      ? 3 + (distance - 1) * 1.6
      : 1.4 + (distance - 1) * 1.0,
    baseColor: isWaiting ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.42)",
    fontWeight: isWaiting ? 500 : 600,
    zIndex: isWaiting ? 2 - distance : 3 - distance,
  };
}

export function resolveTone(
  style: LyricMotionStyle,
  offset: number,
  status: LineStatus,
  inactiveScale: number
): MonetLineTone {
  if (style === "fume") return resolveFumeLineTone(offset, status);
  if (style === "classic") return resolveClassicLineTone(offset, status);
  return resolveMonetLineTone(offset, status, inactiveScale);
}

const MONET_MIN_MEASURE_WIDTH_PX = 180;

function fallbackTextLineCount(text: string, fontSpec: string, maxWidthPx: number): number {
  const fontPx = Number(fontSpec.match(/([\d.]+)px/)?.[1] ?? 16);
  const widthOf = (value: string) =>
    Array.from(value).reduce(
      (sum, char) => sum + (/\s/.test(char) ? fontPx * 0.32 : /[\u3000-\u9fff]/.test(char) ? fontPx : fontPx * 0.58),
      0,
    );
  const width = Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX);
  let lines = 1;
  let rowWidth = 0;
  const tokens = /[\u3000-\u9fff]/.test(text)
    ? Array.from(text)
    : (text || " ").split(/(\s+)/);
  for (const token of tokens) {
    const tokenWidth = widthOf(token);
    if (rowWidth > 0 && rowWidth + tokenWidth > width) {
      lines += 1;
      rowWidth = tokenWidth;
    } else {
      rowWidth += tokenWidth;
    }
  }
  return lines;
}

/** Exact Folia wrapping path, using the same segmented pretext layout engine. */
export function measureTextLineCount(
  text: string,
  fontSpec: string,
  maxWidthPx: number,
  lineHeightPx: number,
): number {
  try {
    const prepared = prepareWithSegments(text || " ", fontSpec);
    const layout = layoutWithLines(
      prepared,
      Math.max(maxWidthPx, MONET_MIN_MEASURE_WIDTH_PX),
      lineHeightPx,
    );
    return Math.max(layout.lines.length, 1);
  } catch {
    // Node-only test environments have no canvas. Production WebView2 always
    // uses the exact Folia/pretext branch above.
    return fallbackTextLineCount(text || " ", fontSpec, maxWidthPx);
  }
}

function measureTextWidthAtPx(text: string, fontPx: number, fontSpec: string): number {
  try {
    const prepared = prepareWithSegments(text || " ", fontSpec);
    const layout = layoutWithLines(prepared, 99999, fontPx * 1.2);
    return layout.lines[0]?.width ?? Math.max(text.length, 1) * fontPx * 0.6;
  } catch {
    return Math.max(Array.from(text).length, 1) * fontPx * 0.6;
  }
}

export function measureMonetLineLayout(options: {
  text: string;
  translation?: string;
  status: LineStatus;
  fontPx: number;
  fontWeight?: number;
  translationFontPx: number;
  fontStack: string;
  maxWidthPx: number;
  showSubtitleTranslation: boolean;
}): MonetMeasuredLineLayout {
  const {
    text,
    translation,
    fontPx,
    fontWeight = 600,
    translationFontPx,
    fontStack,
    maxWidthPx,
    showSubtitleTranslation,
  } = options;
  const lineHeightPx = fontPx * 1.18;
  const translationLineHeightPx = translationFontPx * 1.28;
  const textPaddingTopPx = Math.max(fontPx * 0.16, 8);
  // Keep the translation visually attached to its source line. The previous
  // combined bottom/top padding created a conspicuous ~20 px gap.
  const textPaddingBottomPx = Math.max(fontPx * 0.12, 4);
  const translationPaddingTopPx = Math.max(translationFontPx * 0.12, 2);
  const translationPaddingBottomPx = Math.max(translationFontPx * 0.16, 3);
  const fontSpec = `${fontWeight} ${fontPx}px ${fontStack}`;
  const translationFontSpec = `500 ${translationFontPx}px ${fontStack}`;
  const textLineCount = measureTextLineCount(text, fontSpec, maxWidthPx, lineHeightPx);
  // Unlike Folia's compact poster rail, the desktop player must never clip a
  // lyric into the translation or its neighbour. Reserve every measured line.
  const visibleTextLineCount = textLineCount;
  const hasTranslation = showSubtitleTranslation && Boolean(translation?.trim());
  const rawTrCount = hasTranslation
    ? measureTextLineCount(
        translation ?? "",
        translationFontSpec,
        maxWidthPx,
        translationLineHeightPx,
      )
    : 0;
  const translationLineCount = rawTrCount;
  const textContentHeightPx = visibleTextLineCount * lineHeightPx;
  const textHeightPx = textContentHeightPx + textPaddingTopPx + textPaddingBottomPx;
  const translationContentHeightPx = translationLineCount * translationLineHeightPx;
  const translationHeightPx =
    translationLineCount > 0
      ? translationContentHeightPx + translationPaddingTopPx + translationPaddingBottomPx
      : 0;

  return {
    textHeightPx,
    textPaddingTopPx,
    textPaddingBottomPx,
    translationHeightPx,
    translationPaddingTopPx,
    translationPaddingBottomPx,
    visualHeightPx: textHeightPx + translationHeightPx,
    lineHeightPx,
    translationLineHeightPx,
    isTextClipped: textLineCount > visibleTextLineCount,
  };
}

export function toTimedLines(
  lines: LyricsLine[],
  songDuration: number
): TimedLine[] {
  return lines.map((line, i) => {
    const next = lines[i + 1]?.time ?? Math.max(songDuration, line.time + 3);
    return buildTimedLine(line.text, line.time, next, line.tr);
  });
}

export function buildScrollableRailEntries(
  timedLines: TimedLine[],
  sourceLines: LyricsLine[],
  anchorIndex: number,
  activeLineIndex: number,
  before = MONET_SCROLL_BEFORE,
  after = MONET_SCROLL_AFTER
): MonetVisibleLineEntry[] {
  if (timedLines.length === 0) return [];
  const safeAnchor = Math.round(clamp(anchorIndex, 0, timedLines.length - 1));
  const startIndex = Math.max(0, safeAnchor - before);
  const endIndex = Math.min(timedLines.length - 1, safeAnchor + after);
  const entries: MonetVisibleLineEntry[] = [];
  for (let index = startIndex; index <= endIndex; index++) {
    const line = timedLines[index];
    entries.push({
      key: `${index}-${line.startTime}-${line.fullText}`,
      line,
      source: sourceLines[index],
      index,
      offset: index - safeAnchor,
      status: resolveRailLineStatus(index, activeLineIndex),
    });
  }
  return entries;
}

export function buildPositionedEntries(
  entries: MonetVisibleLineEntry[],
  railHeight: number,
  railWidth: number,
  style: LyricMotionStyle,
  lyricFontPx: number,
  inactiveFontPx: number,
  translationFontPx: number,
  fontStack: string,
  glowBufferPx: number,
  showSubtitleTranslation: boolean,
  domMeasurements?: ReadonlyMap<string, MonetDomLineMeasurement>
): PositionedMonetLineEntry[] {
  const inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
  const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 80);

  const measured: PositionedMonetLineEntry[] = entries.map((entry) => {
    const tone = resolveTone(style, entry.offset, entry.status, inactiveScale);
    const estimatedLayout = measureMonetLineLayout({
      text: entry.line.fullText,
      translation: entry.line.translation,
      status: entry.status,
      fontPx: lyricFontPx,
      fontWeight: tone.fontWeight,
      translationFontPx,
      fontStack,
      maxWidthPx: contentWidthPx - 8,
      showSubtitleTranslation,
    });
    const domMeasurement = domMeasurements?.get(entry.key);
    const layout = domMeasurement
      ? {
          ...estimatedLayout,
          textHeightPx: domMeasurement.textHeightPx,
          translationHeightPx: domMeasurement.translationHeightPx,
          visualHeightPx:
            domMeasurement.textHeightPx + domMeasurement.translationHeightPx,
        }
      : estimatedLayout;
    return {
      ...entry,
      y: 0,
      tone,
      layout,
      scaledHeight: layout.visualHeightPx * tone.scale,
    };
  });

  if (measured.length === 0) return [];

  const anchorIndex = Math.max(
    0,
    measured.findIndex((e) => e.offset === 0)
  );
  const focusCenterY = railHeight * 0.46;
  measured[anchorIndex].y =
    focusCenterY - measured[anchorIndex].scaledHeight / 2;

  for (let i = anchorIndex + 1; i < measured.length; i++) {
    const prev = measured[i - 1];
    const cur = measured[i];
    const gap =
      prev.status === "active" || cur.status === "active"
        ? MONET_ACTIVE_GAP_PX
        : MONET_INACTIVE_GAP_PX;
    cur.y = prev.y + prev.scaledHeight + gap;
  }
  for (let i = anchorIndex - 1; i >= 0; i--) {
    const cur = measured[i];
    const next = measured[i + 1];
    const gap =
      cur.status === "active" || next.status === "active"
        ? MONET_ACTIVE_GAP_PX
        : MONET_INACTIVE_GAP_PX;
    cur.y = next.y - cur.scaledHeight - gap;
  }
  return measured;
}

export function measureGraphemeOffsets(
  text: string,
  fontPx: number,
  fontSpec: string
): number[] {
  const graphemes = Array.from(
    // prefer segmenter via split from lyricTiming path if needed
    typeof Intl !== "undefined"
      ? (() => {
          try {
            const Ctor = (
              Intl as unknown as {
                Segmenter?: new (
                  l?: unknown,
                  o?: { granularity: string }
                ) => { segment: (s: string) => Iterable<{ segment: string }> };
              }
            ).Segmenter;
            if (Ctor) {
              return Array.from(
                new Ctor(undefined, { granularity: "grapheme" }).segment(text),
                (x) => x.segment
              );
            }
          } catch {
            /* fallthrough */
          }
          return Array.from(text);
        })()
      : Array.from(text)
  );
  const offsets = new Array(graphemes.length + 1).fill(0);
  for (let i = 1; i <= graphemes.length; i++) {
    offsets[i] = measureTextWidthAtPx(graphemes.slice(0, i).join(""), fontPx, fontSpec);
  }
  return offsets;
}

export function resolveMonetWordStatus(
  currentTime: number,
  startTime: number,
  endTime: number
): LineStatus {
  if (currentTime < startTime) return "waiting";
  if (currentTime <= endTime) return "active";
  return "passed";
}
