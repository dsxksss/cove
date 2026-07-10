/**
 * Multi-source lyric matching (NetEase → AMLL is native; QQ / Kugou here).
 * Mirrors Folia autoMatchBestLyric priority for timed LRC fallback.
 */

import { parseLrc, mergeTranslation, parseTranslation } from "../lyric";
import type { LyricLine } from "../types";
import { fetchKugouLyrics, searchKugouLyrics } from "./kugouProvider";
import { fetchQQLyrics, searchQQLyrics, type ExternalLyricHit } from "./qqProvider";

export type LyricSourceMode = "auto" | "netease" | "qq" | "kugou";

const LYRIC_SOURCE_KEY = "nmp.lyricSource";

export function loadLyricSourceMode(): LyricSourceMode {
  try {
    const v = localStorage.getItem(LYRIC_SOURCE_KEY);
    if (v === "auto" || v === "netease" || v === "qq" || v === "kugou") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function saveLyricSourceMode(mode: LyricSourceMode) {
  try {
    localStorage.setItem(LYRIC_SOURCE_KEY, mode);
  } catch {
    /* ignore */
  }
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)|（.*?）|\[.*?\]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function scoreHit(
  hit: ExternalLyricHit,
  title: string,
  artist: string,
  durationMs: number
): number {
  const t = normalize(title);
  const ht = normalize(hit.name);
  if (!t || !ht) return -1;
  let score = 0;
  if (ht === t) score += 50;
  else if (ht.includes(t) || t.includes(ht)) score += 30;
  else return -1;

  const a = normalize(artist.split(/[/|,，]/)[0] ?? artist);
  const ha = normalize(hit.artist);
  if (a && ha) {
    if (ha.includes(a) || a.includes(ha)) score += 25;
    else score -= 10;
  }
  if (durationMs > 0 && hit.durationMs > 0) {
    const diff = Math.abs(durationMs - hit.durationMs);
    if (diff <= 3000) score += 20;
    else if (diff <= 10000) score += 8;
    else if (diff > 30000) score -= 20;
  }
  return score;
}

export type MatchedLyrics = {
  lines: LyricLine[];
  source: "qq" | "kugou";
  matchedTitle: string;
  matchedArtist: string;
};

async function matchFromHits(
  hits: ExternalLyricHit[],
  title: string,
  artist: string,
  durationMs: number,
  fetch: (h: ExternalLyricHit) => Promise<{ lrc: string; tlyric: string } | null>
): Promise<MatchedLyrics | null> {
  const ranked = hits
    .map((h) => ({ h, s: scoreHit(h, title, artist, durationMs) }))
    .filter((x) => x.s >= 30)
    .sort((a, b) => b.s - a.s)
    .slice(0, 4);

  for (const { h } of ranked) {
    try {
      const raw = await fetch(h);
      if (!raw?.lrc) continue;
      const lrc = parseLrc(raw.lrc);
      if (lrc.length < 2) continue;
      const merged = raw.tlyric
        ? mergeTranslation(lrc, parseTranslation(raw.tlyric))
        : lrc;
      return {
        lines: merged,
        source: h.source,
        matchedTitle: h.name,
        matchedArtist: h.artist,
      };
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Search QQ for timed lyrics matching title/artist. */
export async function matchQQLyrics(
  title: string,
  artist: string,
  durationMs = 0
): Promise<MatchedLyrics | null> {
  const q = `${artist} ${title}`.trim();
  const hits = await searchQQLyrics(q, 1, 10);
  return matchFromHits(hits, title, artist, durationMs, fetchQQLyrics);
}

/** Search Kugou for timed lyrics matching title/artist. */
export async function matchKugouLyrics(
  title: string,
  artist: string,
  durationMs = 0
): Promise<MatchedLyrics | null> {
  const q = `${artist} ${title}`.trim();
  const hits = await searchKugouLyrics(q, 1, 10);
  return matchFromHits(hits, title, artist, durationMs, fetchKugouLyrics);
}

/**
 * Resolve lyrics for a playing track when NetEase LRC is empty/weak,
 * following Folia-style multi-source order.
 */
export async function resolveExternalLyrics(options: {
  title: string;
  artist: string;
  durationMs?: number;
  mode?: LyricSourceMode;
}): Promise<MatchedLyrics | null> {
  const mode = options.mode ?? loadLyricSourceMode();
  const { title, artist, durationMs = 0 } = options;
  if (!title.trim()) return null;

  if (mode === "qq") return matchQQLyrics(title, artist, durationMs);
  if (mode === "kugou") return matchKugouLyrics(title, artist, durationMs);
  if (mode === "netease") return null;

  // auto: QQ then Kugou (NetEase already tried by caller / native backend)
  const qq = await matchQQLyrics(title, artist, durationMs);
  if (qq) return qq;
  return matchKugouLyrics(title, artist, durationMs);
}
