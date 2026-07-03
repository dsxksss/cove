import { useMemo } from "react";
import { findActiveIndex } from "../lib/lyric";
import { usePlayerStore } from "../store/playerStore";

/** Derive the active lyric line index from currentTime. */
export function useActiveLyric() {
  const lyrics = usePlayerStore((s) => s.lyrics);
  const currentTime = usePlayerStore((s) => s.currentTime);
  return useMemo(
    () => findActiveIndex(lyrics, currentTime),
    [lyrics, currentTime]
  );
}
