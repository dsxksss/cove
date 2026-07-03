import type { LyricLine } from "./types";

/**
 * Parse LRC-formatted lyrics into timed lines.
 * Supports multiple timestamps on one line: [00:01.00][00:05.00]text
 * Also strips id tags like [ti:],[ar:],[al:],[by:].
 */
export function parseLrc(raw: string | undefined | null): LyricLine[] {
  if (!raw || typeof raw !== "string") return [];
  const lines: LyricLine[] = [];
  const tagRe = /^\s*\[(ti|ar|al|by|offset|re|ve|length):/i;
  const tsRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    if (tagRe.test(rawLine)) continue;

    const stamps: number[] = [];
    let m: RegExpExecArray | null;
    tsRe.lastIndex = 0;
    while ((m = tsRe.exec(rawLine)) !== null) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const fracStr = m[3] ?? "0";
      const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
      stamps.push(min * 60 + sec + frac);
    }
    if (stamps.length === 0) continue;
    const text = rawLine.replace(tsRe, "").trim();
    for (const t of stamps) lines.push({ time: t, text });
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Parse translated lyrics into a time->text map (for merging by nearest time). */
export function parseTranslation(raw: string | undefined | null): Map<number, string> {
  const out = new Map<number, string>();
  if (!raw) return out;
  const tsRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = tsRe.exec(rawLine);
    if (!m) continue;
    const min = parseInt(m[1], 10);
    const sec = parseInt(m[2], 10);
    const fracStr = m[3] ?? "0";
    const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
    const t = Math.round((min * 60 + sec + frac) * 10) / 10;
    const text = rawLine.replace(tsRe, "").trim();
    if (text) out.set(t, text);
  }
  return out;
}

/** Merge translation map into lyric lines (nearest preceding time). */
export function mergeTranslation(lines: LyricLine[], trMap: Map<number, string>): LyricLine[] {
  if (trMap.size === 0) return lines;
  // round line times to 0.1s for matching
  return lines.map((l) => {
    const key = Math.round(l.time * 10) / 10;
    let tr = trMap.get(key);
    if (!tr) {
      // try nearest within 0.6s window
      for (const [tk, tv] of trMap) {
        if (Math.abs(tk - key) < 0.6) {
          tr = tv;
          break;
        }
      }
    }
    return tr ? { ...l, tr } : l;
  });
}

/**
 * Binary search the index of the active line: the last line whose time <= t.
 * Returns -1 if before the first line.
 */
export function findActiveIndex(lines: LyricLine[], t: number): number {
  if (lines.length === 0) return -1;
  if (t < lines[0].time) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
