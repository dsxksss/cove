import { useEffect } from "react";
import { getAudio } from "../lib/audio";
import { usePlayerStore } from "../store/playerStore";

/**
 * Wire the singleton <audio> element events into the Zustand store.
 * Mount once near the app root.
 */
export function useAudioEngine() {
  useEffect(() => {
    const audio = getAudio();
    const store = usePlayerStore.getState;

    const onTime = () => store()._setTime(audio.currentTime);
    const onMeta = () => store()._setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlay = () => store()._setPlaying(true);
    const onPause = () => store()._setPlaying(false);
    const onEnded = () => {
      store()._setPlaying(false);
      void store().next(true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);

    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, []);
}
