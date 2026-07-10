/**
 * Motion intensity prefs (jh3yy-style micro-interactions).
 * off | light (default) | full
 */

export type MotionLevel = "off" | "light" | "full";

const MOTION_KEY = "nmp.motionLevel";

export const MOTION_LEVEL_OPTIONS: Array<{ value: MotionLevel; label: string; hint: string }> = [
  { value: "off", label: "关闭", hint: "无额外动效" },
  { value: "light", label: "轻量", hint: "列表与进度反馈" },
  { value: "full", label: "完整", hint: "指针光晕 + 按钮高光" },
];

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  } catch {
    return false;
  }
}

export function loadMotionLevel(fallback: MotionLevel = "light"): MotionLevel {
  try {
    const v = localStorage.getItem(MOTION_KEY);
    if (v === "off" || v === "light" || v === "full") return v;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function saveMotionLevel(level: MotionLevel): void {
  try {
    localStorage.setItem(MOTION_KEY, level);
  } catch {
    /* ignore */
  }
}

/** Effective level after OS reduced-motion. */
export function resolveMotionLevel(level: MotionLevel): MotionLevel {
  if (prefersReducedMotion()) return "off";
  return level;
}

export function motionAllowsPointer(level: MotionLevel): boolean {
  return resolveMotionLevel(level) === "full";
}

export function motionAllowsListStagger(level: MotionLevel): boolean {
  const e = resolveMotionLevel(level);
  return e === "light" || e === "full";
}

export function motionAllowsGlow(level: MotionLevel): boolean {
  return resolveMotionLevel(level) === "full";
}

export function motionAllowsProgressPop(level: MotionLevel): boolean {
  const e = resolveMotionLevel(level);
  return e === "light" || e === "full";
}
