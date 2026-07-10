import type { Song as PlayerSong, AudioBadge } from "../components/playerTypes";
import type { Song, LyricLine, AccentColor } from "./types";
import { extractAccent, rgbToCss } from "./color";

/**
 * Adapter between the data layer (NetEase runtime-resolved Song/LyricLine)
 * and the UI layer's static Song shape (playerTypes.ts).
 *
 * The UI expects: coverUrl, backgroundUrl, badge, themeColor, textColor,
 * and inline lyrics. The data layer resolves cover/lyrics/url at play time.
 * themeColor is derived from the cover's dominant color.
 */

/**
 * Normalize duration to **seconds** for the player UI / progress bar.
 *
 * - `audioOrStoreSec`: HTMLMediaElement.duration / store.duration (seconds)
 * - `songDurationField`: catalog `Song.duration` (milliseconds from APIs)
 *
 * Heuristic: values above 10_000 are treated as milliseconds (no song is
 * 10000+ seconds; many catalogs store ms like 245000).
 */
export function toDurationSeconds(
  audioOrStoreSec?: number | null,
  songDurationField?: number | null
): number {
  const fromAudio = Number(audioOrStoreSec);
  if (Number.isFinite(fromAudio) && fromAudio > 0) {
    if (fromAudio > 10_000) return Math.max(0, Math.round(fromAudio / 1000));
    return Math.max(0, fromAudio);
  }
  const raw = Number(songDurationField);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // Catalog fields are ms; tiny values (<~2min in "ms" form) are treated as seconds.
  if (raw > 1000) return Math.max(0, Math.round(raw / 1000));
  return Math.max(0, Math.round(raw));
}

/** Catalog duration → milliseconds (for lyric matching APIs). */
export function toDurationMs(songDurationField?: number | null): number {
  const raw = Number(songDurationField);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw > 1000) return Math.round(raw);
  return Math.round(raw * 1000);
}

export function toPlayerSong(
  song: Song,
  cover: string | undefined,
  lyrics: LyricLine[],
  accent: AccentColor | null,
  durationSec: number
): PlayerSong {
  const bg = cover ?? "";
  const theme = accent
    ? rgbToCss(accent, 0.25)
    : "rgba(99, 102, 241, 0.25)";
  return {
    id: String(song.id),
    title: song.name,
    artist: song.artist,
    coverUrl: cover ?? "",
    backgroundUrl: bg,
    duration: toDurationSeconds(durationSec, song.duration),
    badge: "Lossless",
    lyrics: lyrics.map((l) => ({ time: l.time, text: l.text, tr: l.tr })),
    themeColor: theme,
    textColor: "text-white",
  };
}

/** Pre-compute the accent color for a cover (used to theme the player glow). */
export function fetchAccent(coverUrl: string | undefined): Promise<AccentColor | null> {
  return coverUrl ? extractAccent(coverUrl) : Promise.resolve(null);
}

export type { AudioBadge };
