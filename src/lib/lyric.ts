import type { LyricLine } from "./types";

/**
 * Parse LRC-formatted lyrics into timed lines.
 * Supports multiple timestamps on one line: [00:01.00][00:05.00]text
 * Also strips id tags like [ti:],[ar:],[al:],[by:].
 * Applies global [offset:±ms] (positive = lyrics early → subtract from times).
 */
export function parseLrc(raw: string | undefined | null): LyricLine[] {
  if (!raw || typeof raw !== "string") return [];
  const lines: LyricLine[] = [];
  const tagRe = /^\s*\[(ti|ar|al|by|offset|re|ve|length):/i;
  const offsetRe = /^\s*\[offset\s*:\s*([+-]?\d+)\s*\]/i;
  const tsRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  let offsetMs = 0;

  for (const rawLine of raw.split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const offsetMatch = offsetRe.exec(rawLine);
    if (offsetMatch) {
      offsetMs = parseInt(offsetMatch[1], 10) || 0;
      continue;
    }
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

  // LRC offset is milliseconds; positive means display lyrics earlier.
  const offsetSec = offsetMs / 1000;
  if (offsetSec !== 0) {
    for (const line of lines) {
      line.time = Math.max(0, line.time - offsetSec);
    }
  }

  lines.sort((a, b) => a.time - b.time);
  return lines;
}

/** Parse a single LRC timestamp token into seconds. */
export function parseTimestampToSeconds(
  min: string,
  sec: string,
  fracStr = "0"
): number {
  const minutes = parseInt(min, 10);
  const seconds = parseInt(sec, 10);
  const frac = parseInt(fracStr, 10) / Math.pow(10, fracStr.length);
  return minutes * 60 + seconds + frac;
}

/** Parse translated lyrics into a time->text map (for merging by nearest time). */
export function parseTranslation(raw: string | undefined | null): Map<number, string> {
  const out = new Map<number, string>();
  if (!raw) return out;
  const tsRe = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  for (const rawLine of raw.split(/\r?\n/)) {
    const m = tsRe.exec(rawLine);
    if (!m) continue;
    const t =
      Math.round(parseTimestampToSeconds(m[1], m[2], m[3] ?? "0") * 10) / 10;
    const text = rawLine.replace(tsRe, "").trim();
    if (text) out.set(t, text);
  }
  return out;
}

/**
 * Merge translation map into lyric lines.
 * Prefers exact 0.1s key match, otherwise the nearest translation within 0.6s.
 */
export function mergeTranslation(lines: LyricLine[], trMap: Map<number, string>): LyricLine[] {
  if (trMap.size === 0) return lines;
  return lines.map((l) => {
    const key = Math.round(l.time * 10) / 10;
    let tr = trMap.get(key);
    if (!tr) {
      let bestDist = 0.6;
      for (const [tk, tv] of trMap) {
        const dist = Math.abs(tk - key);
        if (dist < bestDist) {
          bestDist = dist;
          tr = tv;
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
