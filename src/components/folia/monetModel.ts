/**
 * Monet rail model — ported from Folia monetLyricsModel + MonetLyricsRail helpers.
 */
import type { LyricsLine } from "../playerTypes";
import type { LyricMotionStyle } from "../playerTypes";
import { buildTimedLine, type TimedLine } from "../../lib/lyricTiming";

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
  y: { type: "spring" as const, stiffness: 142, damping: 28, mass: 0.82 },
  scale: { type: "spring" as const, stiffness: 150, damping: 30, mass: 0.78 },
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

let measureCanvas: HTMLCanvasElement | null = null;

function measureTextWidth(text: string, fontSpec: string): number {
  if (typeof document === "undefined") return text.length * 12;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 12;
  ctx.font = fontSpec;
  return ctx.measureText(text || " ").width;
}

/** Approximate wrap line count (Folia uses pretext; canvas is close enough). */
export function measureTextLineCount(
  text: string,
  fontSpec: string,
  maxWidthPx: number
): number {
  const width = Math.max(maxWidthPx, 40);
  const raw = text || " ";
  // CJK: break by grapheme-ish char
  const isCjk = /[\u4e00-\u9fff]/.test(raw);
  if (isCjk) {
    let lines = 1;
    let row = "";
    for (const ch of Array.from(raw)) {
      const next = row + ch;
      if (measureTextWidth(next, fontSpec) > width && row) {
        lines += 1;
        row = ch;
      } else {
        row = next;
      }
    }
    return lines;
  }
  const words = raw.split(/(\s+)/);
  let lines = 1;
  let row = "";
  for (const w of words) {
    const next = row + w;
    if (measureTextWidth(next, fontSpec) > width && row.trim()) {
      lines += 1;
      row = w;
    } else {
      row = next;
    }
  }
  return Math.max(lines, 1);
}

export function measureMonetLineLayout(options: {
  text: string;
  translation?: string;
  status: LineStatus;
  fontPx: number;
  translationFontPx: number;
  fontStack: string;
  maxWidthPx: number;
  showSubtitleTranslation: boolean;
}): MonetMeasuredLineLayout {
  const {
    text,
    translation,
    status,
    fontPx,
    translationFontPx,
    fontStack,
    maxWidthPx,
    showSubtitleTranslation,
  } = options;
  const lineHeightPx = fontPx * 1.18;
  const translationLineHeightPx = translationFontPx * 1.28;
  const textPaddingTopPx = Math.max(fontPx * 0.16, 8);
  const textPaddingBottomPx = Math.max(fontPx * 0.34, 14);
  const translationPaddingTopPx = Math.max(translationFontPx * 0.45, 7);
  const translationPaddingBottomPx = Math.max(translationFontPx * 0.18, 5);
  const fontSpec = `600 ${fontPx}px ${fontStack}`;
  const translationFontSpec = `500 ${translationFontPx}px ${fontStack}`;
  const textLineCount = measureTextLineCount(text, fontSpec, maxWidthPx);
  const textLimit =
    status === "active" ? MONET_ACTIVE_TEXT_LINE_LIMIT : MONET_INACTIVE_TEXT_LINE_LIMIT;
  const visibleTextLineCount = Math.min(textLineCount, textLimit);
  const hasActiveTranslation =
    showSubtitleTranslation && status === "active" && Boolean(translation?.trim());
  const rawTrCount = hasActiveTranslation
    ? measureTextLineCount(translation ?? "", translationFontSpec, maxWidthPx)
    : 0;
  const translationLineCount = Math.min(rawTrCount, 2);
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
  showSubtitleTranslation: boolean
): PositionedMonetLineEntry[] {
  const inactiveScale = clamp(inactiveFontPx / Math.max(lyricFontPx, 1), 0.72, 0.92);
  const contentWidthPx = Math.max(railWidth - glowBufferPx * 2, 80);

  const measured: PositionedMonetLineEntry[] = entries.map((entry) => {
    const tone = resolveTone(style, entry.offset, entry.status, inactiveScale);
    const layout = measureMonetLineLayout({
      text: entry.line.fullText,
      translation: entry.line.translation,
      status: entry.status,
      fontPx: lyricFontPx,
      translationFontPx,
      fontStack,
      maxWidthPx: contentWidthPx - 8,
      showSubtitleTranslation,
    });
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
  _fontPx: number,
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
  let acc = 0;
  for (let i = 0; i < graphemes.length; i++) {
    acc += measureTextWidth(graphemes[i], fontSpec);
    offsets[i + 1] = acc;
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
