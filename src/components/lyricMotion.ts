/**
 * Folia-major inspired lyric motion presets.
 *
 * Curves ported from tmp-folia-major:
 *  - monet  (莫奈)  — MonetLyricsRail resolveLineTone + spring rail
 *  - fume   (浮名)  — soft paper / floating-hero presence (simplified)
 *  - classic(流光)  — blur-in active line with afterglow (classic Visualizer)
 *  - rail / dialogue — lightweight scroll-list styles kept for compatibility
 */
import type { LyricMotionStyle } from "./playerTypes";

export type LineStatus = "waiting" | "active" | "passed";

export type FoliaTone = {
  opacity: number;
  scale: number;
  blurPx: number;
  fontWeight: number;
  zIndex: number;
  yLift: number;
};

export type FoliaEntry = {
  index: number;
  offset: number;
  status: LineStatus;
  tone: FoliaTone;
  /** Absolute y (px) from top of rail, center-anchored. */
  y: number;
  rowGap: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function resolveLineStatus(index: number, activeIndex: number): LineStatus {
  if (index === activeIndex) return "active";
  if (activeIndex >= 0 && index < activeIndex) return "passed";
  return "waiting";
}

/**
 * Monet (莫奈) tone — ported from MonetLyricsRail.resolveLineTone.
 * inactiveScale defaults to ~0.86 (inactiveFont / activeFont in Folia).
 */
export function resolveMonetTone(
  offset: number,
  status: LineStatus,
  inactiveScale = 0.86
): FoliaTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1,
      blurPx: 0,
      fontWeight: 600,
      zIndex: 4,
      yLift: 0,
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
    fontWeight: 500,
    zIndex: isWaiting ? 3 - distance : 2 - distance,
    yLift: 0,
  };
}

/**
 * Fume (浮名 / 浮云) — soft paper stack, hero active line, passed text holds longer.
 * Inspired by VisualizerFume's "article camera" presence, simplified for a rail.
 */
export function resolveFumeTone(offset: number, status: LineStatus): FoliaTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1.1,
      blurPx: 0,
      fontWeight: 700,
      zIndex: 5,
      yLift: -2,
    };
  }

  const distance = Math.max(Math.abs(offset), 1);
  const isWaiting = status === "waiting";
  // textHoldRatio-ish: passed lines stay more readable than Monet
  return {
    opacity: isWaiting
      ? clamp(0.55 - (distance - 1) * 0.12, 0.22, 0.55)
      : clamp(0.48 - (distance - 1) * 0.08, 0.22, 0.48),
    scale: clamp(0.92 - (distance - 1) * 0.04, 0.74, 0.92),
    blurPx: isWaiting
      ? 0.4 + (distance - 1) * 0.55
      : 0.8 + (distance - 1) * 0.45,
    fontWeight: 500,
    zIndex: isWaiting ? 3 - distance : 2 - distance,
    yLift: isWaiting ? distance * 3 : -distance * 2,
  };
}

/**
 * Classic (流光) — blur-in active line, afterglow on passed, soft waiting.
 * From classic Visualizer line variants.
 */
export function resolveClassicTone(offset: number, status: LineStatus): FoliaTone {
  if (status === "active") {
    return {
      opacity: 1,
      scale: 1.04,
      blurPx: 0,
      fontWeight: 700,
      zIndex: 5,
      yLift: 0,
    };
  }

  const distance = Math.max(Math.abs(offset), 1);
  const isWaiting = status === "waiting";
  return {
    opacity: isWaiting
      ? clamp(0.4 - (distance - 1) * 0.1, 0.16, 0.4)
      : clamp(0.55 - (distance - 1) * 0.1, 0.2, 0.55),
    scale: isWaiting
      ? clamp(0.94 - (distance - 1) * 0.03, 0.82, 0.94)
      : clamp(1.02 - (distance - 1) * 0.02, 0.9, 1.02),
    blurPx: isWaiting
      ? 2 + (distance - 1) * 1.4
      : 1.2 + (distance - 1) * 0.9,
    fontWeight: isWaiting ? 500 : 600,
    zIndex: isWaiting ? 2 - distance : 3 - distance,
    yLift: isWaiting ? 6 + distance * 2 : -4 - distance,
  };
}

export function resolveTone(
  style: LyricMotionStyle,
  offset: number,
  status: LineStatus
): FoliaTone {
  switch (style) {
    case "fume":
      return resolveFumeTone(offset, status);
    case "classic":
      return resolveClassicTone(offset, status);
    case "monet":
    default:
      return resolveMonetTone(offset, status);
  }
}

export const FOLIA_ACTIVE_GAP_PX = 18;
export const FOLIA_INACTIVE_GAP_PX = 14;
export const FOLIA_SCROLL_BEFORE = 8;
export const FOLIA_SCROLL_AFTER = 8;
export const FOLIA_ROW_HEIGHT = 56;
/** Monet idle reset after manual browse (MONET_SCROLL_IDLE_RESET_MS). */
export const FOLIA_SCROLL_IDLE_MS = 1800;
/** Wheel delta accumulation per step (MONET_SCROLL_STEP_PX). */
export const FOLIA_SCROLL_STEP_PX = 72;
export const FOLIA_TOUCH_STEP_PX = 52;
/** Glow pad so blur/shadow is not clipped (≈ lyricFontPx * 1.2). */
export const FOLIA_GLOW_BUFFER_RATIO = 1.2;

/** Monet spring transitions (MonetLyricsRail MONET_SCROLL_TRANSITION). */
export const FOLIA_SPRING = {
  y: { type: "spring" as const, stiffness: 142, damping: 28, mass: 0.82 },
  scale: { type: "spring" as const, stiffness: 150, damping: 30, mass: 0.78 },
  opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
  filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
};

export const FOLIA_EXIT_TRANSITION = {
  duration: 0.2,
  ease: [0.32, 0.72, 0, 1] as [number, number, number, number],
};

type GraphemeSegmenter = {
  segment: (input: string) => Iterable<{ segment: string }>;
};

const graphemeSegmenter: GraphemeSegmenter | null = (() => {
  try {
    const Ctor = (Intl as unknown as { Segmenter?: new (locales?: unknown, options?: { granularity: string }) => GraphemeSegmenter }).Segmenter;
    return Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

let measureCanvas: HTMLCanvasElement | null = null;

/** Cumulative grapheme pixel offsets (Monet measureMonetGraphemeOffsets). */
export function measureGraphemeOffsets(
  text: string,
  fontPx: number,
  fontSpec = `600 ${fontPx}px "Inter", "Segoe UI", sans-serif`
): number[] {
  const graphemes = splitGraphemes(text);
  const offsets = new Array<number>(graphemes.length + 1).fill(0);
  if (typeof document === "undefined") {
    for (let i = 1; i <= graphemes.length; i++) {
      offsets[i] = i * fontPx * 0.92;
    }
    return offsets;
  }
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) {
    for (let i = 1; i <= graphemes.length; i++) {
      offsets[i] = i * fontPx * 0.92;
    }
    return offsets;
  }
  ctx.font = fontSpec;
  let acc = 0;
  for (let i = 0; i < graphemes.length; i++) {
    acc += ctx.measureText(graphemes[i]).width;
    offsets[i + 1] = acc;
  }
  return offsets;
}

/**
 * Soft-edge karaoke mask (MonetWordSweep maskImage).
 * fillPx = swept width in pixels; fontPx controls feather size.
 */
export function buildKaraokeMask(fillPx: number, fontPx: number): string {
  const edgeSoftness = Math.max(Math.min(fontPx * 0.45, 16), 6);
  const solidEnd = Math.max(fillPx - edgeSoftness, 0);
  const featherStart = Math.max(fillPx - edgeSoftness * 0.55, 0);
  const featherEnd = Math.max(fillPx, 0);
  return `linear-gradient(90deg, rgba(0,0,0,1) 0px, rgba(0,0,0,1) ${solidEnd}px, rgba(0,0,0,0.92) ${featherStart}px, rgba(0,0,0,0) ${featherEnd}px, rgba(0,0,0,0) 100%)`;
}

/** Map line progress 0..1 → fill width using grapheme offsets. */
export function progressToFillWidth(progress: number, offsets: number[]): number {
  const full = offsets[offsets.length - 1] ?? 0;
  if (progress <= 0) return 0;
  if (progress >= 1) return full;
  const count = Math.max(offsets.length - 1, 1);
  const floatIndex = progress * count;
  const whole = Math.floor(floatIndex);
  const frac = floatIndex - whole;
  const start = offsets[Math.min(whole, offsets.length - 1)] ?? 0;
  const end = offsets[Math.min(whole + 1, offsets.length - 1)] ?? start;
  return start + (end - start) * frac;
}

/**
 * Monet word glow intensity vs line progress.
 * Rise with smoothstep, soft tail after peak (~45%).
 */
export function monetGlowIntensity(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 0.28;
  if (progress < 0.45) return smoothstep(progress / 0.45);
  const remaining = 1 - smoothstep((progress - 0.45) / 0.55);
  return Math.max(0.28, remaining);
}

export function clampScrollSteps(steps: number): number {
  return Math.max(-1, Math.min(1, steps));
}

/**
 * Build a window of lines around the anchor (Monet: before=4, after=4/5)
 * and lay them out with absolute y around the optical center.
 */
export function buildFoliaRailEntries(options: {
  lineCount: number;
  anchorIndex: number;
  activeIndex: number;
  style: LyricMotionStyle;
  railHeight: number;
  rowHeight?: number;
}): FoliaEntry[] {
  const {
    lineCount,
    anchorIndex,
    activeIndex,
    style,
    railHeight,
    rowHeight = FOLIA_ROW_HEIGHT,
  } = options;

  if (lineCount <= 0) return [];

  const safeAnchor = Math.round(clamp(anchorIndex, 0, lineCount - 1));
  const start = Math.max(0, safeAnchor - FOLIA_SCROLL_BEFORE);
  const end = Math.min(lineCount - 1, safeAnchor + FOLIA_SCROLL_AFTER);

  const entries: FoliaEntry[] = [];
  for (let index = start; index <= end; index++) {
    const offset = index - safeAnchor;
    const status = resolveLineStatus(index, activeIndex);
    const tone = resolveTone(style, offset, status);
    entries.push({
      index,
      offset,
      status,
      tone,
      y: 0,
      rowGap: status === "active" ? FOLIA_ACTIVE_GAP_PX : FOLIA_INACTIVE_GAP_PX,
    });
  }

  if (entries.length === 0) return entries;

  const anchorLocal = Math.max(0, entries.findIndex((e) => e.offset === 0));
  const focusCenterY = railHeight * 0.46;
  const scaledH = (e: FoliaEntry) => rowHeight * e.tone.scale;

  entries[anchorLocal].y =
    focusCenterY - scaledH(entries[anchorLocal]) / 2 + entries[anchorLocal].tone.yLift;

  for (let i = anchorLocal + 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    const gap =
      prev.status === "active" || cur.status === "active"
        ? FOLIA_ACTIVE_GAP_PX
        : FOLIA_INACTIVE_GAP_PX;
    cur.y = prev.y + scaledH(prev) + gap + cur.tone.yLift;
  }

  for (let i = anchorLocal - 1; i >= 0; i--) {
    const cur = entries[i];
    const next = entries[i + 1];
    const gap =
      cur.status === "active" || next.status === "active"
        ? FOLIA_ACTIVE_GAP_PX
        : FOLIA_INACTIVE_GAP_PX;
    cur.y = next.y - scaledH(cur) - gap + cur.tone.yLift;
  }

  return entries;
}

/** Karaoke fill progress 0..1 for the active line (simple line-level, not word-timed). */
export function lineFillProgress(
  currentTime: number,
  lineStart: number,
  lineEnd: number
): number {
  if (currentTime <= lineStart) return 0;
  if (currentTime >= lineEnd) return 1;
  return (currentTime - lineStart) / Math.max(0.001, lineEnd - lineStart);
}

/** Smoothstep for glow intensity (Monet word glow curve). */
export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---- legacy scroll-list helpers (rail / dialogue) ----

export type LyricMotionInput = {
  style: LyricMotionStyle;
  index: number;
  isFocused: boolean;
  isActive: boolean;
  isPassed: boolean;
  distance: number;
  lineProgress?: number;
  text: string;
};

export type LyricMotionResult = {
  scale: number;
  opacity: number;
  blur: number;
  x: number;
  rotate: number;
  y: number;
  displayText: string;
  activePulse: boolean;
  rowVariant: "rail" | "dialogue";
  dialogueSide: "left" | "right";
  color: string;
  textShadow: string;
};

export function typewriterText(text: string, progress: number): string {
  if (!text) return "";
  const p = clamp(progress, 0, 1);
  const count = Math.max(1, Math.ceil(text.length * Math.max(p, 0.02)));
  return text.slice(0, count);
}

/** Lightweight motion for the native scroll list (rail / dialogue only). */
export function getLyricLineMotion(input: LyricMotionInput): LyricMotionResult {
  const { style, index, isFocused, isActive, isPassed, distance, text } = input;
  const dialogueSide: "left" | "right" = index % 2 === 0 ? "left" : "right";
  const isDialogue = style === "dialogue";

  let scale = 1;
  let x = 0;
  if (isDialogue) {
    if (isFocused) scale = 1.02;
    else scale = Math.max(0.86, 0.92 - distance * 0.03);
    x = dialogueSide === "right" ? (isFocused ? 8 : 18) : isFocused ? 0 : -8;
  } else if (!isFocused) {
    scale = Math.max(0.86, 0.96 - distance * 0.035);
  }

  const opacity = isFocused
    ? 1
    : isPassed
      ? Math.max(0.1, 0.46 - distance * 0.1)
      : Math.max(0.16, 0.62 - distance * 0.11);
  const blur = isFocused ? 0 : Math.min(2.2, 0.35 + distance * 0.38);

  return {
    scale,
    opacity,
    blur,
    x,
    rotate: 0,
    y: 0,
    displayText: text,
    activePulse: false,
    rowVariant: isDialogue ? "dialogue" : "rail",
    dialogueSide,
    color: isFocused
      ? "rgba(255,255,255,0.96)"
      : isActive
        ? "rgba(255,255,255,0.78)"
        : "rgba(255,255,255,0.42)",
    textShadow: isFocused
      ? isDialogue
        ? "0 10px 28px rgba(0,0,0,0.42)"
        : "0 10px 36px rgba(255,255,255,0.18), 0 1px 18px rgba(0,0,0,0.42)"
      : "0 1px 14px rgba(0,0,0,0.28)",
  };
}

export function isFoliaAbsoluteStyle(style: LyricMotionStyle): boolean {
  return style === "monet" || style === "fume" || style === "classic";
}
