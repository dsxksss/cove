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
    duration: durationSec || song.duration ? Math.round((durationSec || (song.duration ?? 0) / 1000)) : 0,
    badge: "Lossless",
    lyrics: lyrics.map((l) => ({ time: l.time, text: l.tr ? `${l.text}\n${l.tr}` : l.text })),
    themeColor: theme,
    textColor: "text-white",
  };
}

/** Pre-compute the accent color for a cover (used to theme the player glow). */
export function fetchAccent(coverUrl: string | undefined): Promise<AccentColor | null> {
  return coverUrl ? extractAccent(coverUrl) : Promise.resolve(null);
}

export type { AudioBadge };
