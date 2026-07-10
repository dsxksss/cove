/**
 * Persist / restore playback preferences (mode, quality, speed).
 * Pure localStorage helpers — testable without the audio engine.
 */

import type { RepeatMode } from "./types";

const REPEAT_KEY = "nmp.repeat";
const SHUFFLE_KEY = "nmp.shuffle";
const LEVEL_KEY = "nmp.level";
const SPEED_KEY = "nmp.speed";

/** Stored repeat flags. "off" is legacy (old sequence / stop-at-end) and migrates to "all". */
const VALID_REPEAT: RepeatMode[] = ["off", "all", "one"];
export const VALID_LEVELS = new Set([
  "standard",
  "higher",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "sky",
  "jymaster",
]);

/** UI options for playback quality (shared across NetEase / QQ / Kugou). */
export const LEVEL_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: "standard", label: "标准", hint: "≈128kbps" },
  { value: "higher", label: "较高", hint: "≈192kbps" },
  { value: "exhigh", label: "极高", hint: "≈320kbps" },
  { value: "lossless", label: "无损", hint: "FLAC" },
  { value: "hires", label: "Hi-Res", hint: "高解析" },
  { value: "jyeffect", label: "高清环绕", hint: "网易云" },
  { value: "sky", label: "沉浸环绕", hint: "网易云" },
  { value: "jymaster", label: "超清母带", hint: "网易云" },
];

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadRepeatMode(fallback: RepeatMode = "all"): RepeatMode {
  const v = readString(REPEAT_KEY);
  if (!v || !(VALID_REPEAT as string[]).includes(v)) return fallback;
  // Legacy "off" = order-once / stop-at-end — no longer a UI mode; treat as list loop.
  if (v === "off") return "all";
  return v as RepeatMode;
}

export function saveRepeatMode(mode: RepeatMode): void {
  writeString(REPEAT_KEY, mode);
}

export function loadShuffle(fallback = false): boolean {
  const v = readString(SHUFFLE_KEY);
  if (v === "1" || v === "true") return true;
  if (v === "0" || v === "false") return false;
  return fallback;
}

export function saveShuffle(on: boolean): void {
  writeString(SHUFFLE_KEY, on ? "1" : "0");
}

export function loadLevel(fallback = "exhigh"): string {
  const v = readString(LEVEL_KEY);
  return v && VALID_LEVELS.has(v) ? v : fallback;
}

export function saveLevel(level: string): void {
  writeString(LEVEL_KEY, level);
}

export function loadSpeed(fallback = 1): number {
  const v = parseFloat(readString(SPEED_KEY) ?? "");
  if (!Number.isFinite(v)) return fallback;
  return Math.min(2, Math.max(0.5, v));
}

export function saveSpeed(speed: number): void {
  writeString(SPEED_KEY, String(Math.min(2, Math.max(0.5, speed))));
}

/**
 * Unified UI play modes — exactly three (no off / sequence / stop-at-end):
 * - list:    列表循环
 * - one:     单曲循环
 * - shuffle: 随机播放
 */
export type PlayMode = "list" | "one" | "shuffle";

export const PLAY_MODE_ORDER: readonly PlayMode[] = ["list", "one", "shuffle"];

/** Derive unified play-mode label from repeat + shuffle flags. */
export function derivePlayMode(repeat: RepeatMode, shuffle: boolean): PlayMode {
  if (shuffle) return "shuffle";
  if (repeat === "one") return "one";
  // "all" and legacy "off" both map to list loop
  return "list";
}

/** Map unified play mode back to repeat + shuffle store fields. */
export function playModeToFlags(mode: PlayMode): { repeat: RepeatMode; shuffle: boolean } {
  switch (mode) {
    case "one":
      return { repeat: "one", shuffle: false };
    case "shuffle":
      // Keep repeat=all under shuffle so end-of-queue never "stops".
      return { repeat: "all", shuffle: true };
    case "list":
    default:
      return { repeat: "all", shuffle: false };
  }
}

/** Cycle list → one → shuffle → list. */
export function nextPlayMode(repeat: RepeatMode, shuffle: boolean): PlayMode {
  const current = derivePlayMode(repeat, shuffle);
  const i = PLAY_MODE_ORDER.indexOf(current);
  return PLAY_MODE_ORDER[(i < 0 ? 0 : i + 1) % PLAY_MODE_ORDER.length];
}
