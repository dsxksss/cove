import { useEffect } from "react";
import { getAudio } from "../lib/audio";
import {
  applyMediaSession,
  setMediaPlaybackState,
  setMediaPositionState,
} from "../lib/mediaSession";
import { usePlayerStore } from "../store/playerStore";

/**
 * Wire the singleton <audio> element events into the Zustand store,
 * plus OS Media Session controls and a smoother rAF time clock for lyrics.
 * Mount once near the app root.
 */
export function useAudioEngine() {
  useEffect(() => {
    const audio = getAudio();
    const store = usePlayerStore.getState;

    let rafId = 0;
    let lastPublishedTime = -1;
    let lastMediaPositionTime = -1;

    const publishTime = (force = false) => {
      const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      // Avoid flooding React for sub-frame noise; ~30Hz is plenty for lyrics.
      if (!force && Math.abs(t - lastPublishedTime) < 1 / 30) return;
      lastPublishedTime = t;
      store()._setTime(t);
      // OS media-session synchronization does not need a frame-rate clock and
      // may cross the WebView/native boundary. Once per second is sufficient.
      if (force || Math.abs(t - lastMediaPositionTime) >= 1) {
        lastMediaPositionTime = t;
        const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
        setMediaPositionState({
          duration: dur > 0 && dur < Infinity ? dur : 0,
          playbackRate: audio.playbackRate || 1,
          position: t,
        });
      }
    };

    const stopRaf = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    const tick = () => {
      publishTime();
      if (!audio.paused && !audio.ended) {
        rafId = requestAnimationFrame(tick);
      } else {
        rafId = 0;
      }
    };

    const startRaf = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(tick);
    };

    const onTime = () => publishTime();
    const onMeta = () => {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration < Infinity
        ? audio.duration
        : 0;
      if (dur > 0) store()._setDuration(dur);
      // New media → force a fresh clock so progress/lyrics don't stick on the
      // previous track's lastPublishedTime throttle window.
      lastPublishedTime = -1;
      lastMediaPositionTime = -1;
      publishTime(true);
    };
    const onPlay = () => {
      store()._setPlaying(true);
      setMediaPlaybackState("playing");
      lastPublishedTime = -1;
      publishTime(true);
      startRaf();
    };
    const onPause = () => {
      // Ignore transient pause while a new src is being assigned mid-playSong.
      if (store().loading && !audio.error) return;
      store()._setPlaying(false);
      setMediaPlaybackState("paused");
      stopRaf();
      publishTime(true);
    };
    const onEnded = () => {
      store()._setPlaying(false);
      setMediaPlaybackState("none");
      stopRaf();
      void store().next(true);
    };
    // Surface audio load/playback errors (e.g. CSP-blocked media, dead URL)
    // instead of failing silently. The <audio> fires 'error' when the src
    // can't be loaded/decoded.
    const onError = () => {
      const code = audio.error?.code;
      // MEDIA_ERR_ABORTED (1): normal when switching tracks (src reassignment).
      // Don't kill the clock / toast / auto-skip — it freezes progress + lyrics.
      if (code === 1) return;
      // If a new track already started playing after a stale error, ignore.
      if (!audio.paused && !audio.error) return;

      const song = store().currentSong();
      const title = song?.name ? `「${song.name}」` : "当前歌曲";
      const msg =
        code === 4
          ? `${title} 音频源无效或受限，可能需要会员 / 版权授权`
          : code === 3
            ? `${title} 音频解码失败`
            : code === 2
              ? `${title} 音频加载失败（网络或音源限制）`
              : `${title} 播放出错，可能因 VIP 或音源限制无法播放`;
      store()._setPlaying(false);
      store()._setErr(msg);
      setMediaPlaybackState("none");
      stopRaf();
      // Skip broken stream (VIP / dead URL). forceAdvance avoids single-loop stuck.
      window.setTimeout(() => {
        if (store().error === msg) {
          void store().next(true, { forceAdvance: true });
        }
      }, 2800);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    // ---- Media Session: headset / keyboard / lock-screen controls ----
    const seekBy = (delta: number) => {
      const dur = Number.isFinite(audio.duration) ? audio.duration : 0;
      const next = Math.max(0, Math.min((audio.currentTime || 0) + delta, dur || audio.currentTime + delta));
      store().seek(next);
    };

    applyMediaSession(null, {
      play: () => {
        void audio.play().catch(() => {});
      },
      pause: () => {
        audio.pause();
      },
      previoustrack: () => store().prev(),
      nexttrack: () => {
        void store().next();
      },
      seekbackward: (d) => seekBy(-(d.seekOffset ?? 10)),
      seekforward: (d) => seekBy(d.seekOffset ?? 10),
      seekto: (d) => {
        if (typeof d.seekTime === "number") store().seek(d.seekTime);
      },
      stop: () => {
        audio.pause();
        store().seek(0);
      },
    });

    // Keep metadata in sync with the store.
    const unsub = usePlayerStore.subscribe((state, prev) => {
      const song = state.currentSong();
      const prevSong = prev.currentSong();
      const coverChanged = state.currentCover !== prev.currentCover;
      const songChanged = song?.id !== prevSong?.id;
      if (song && (songChanged || coverChanged || !prevSong)) {
        applyMediaSession(
          {
            title: song.name,
            artist: song.artist,
            album: song.album,
            artworkUrl: state.currentCover ?? song.pic,
          },
          {
            play: () => {
              void audio.play().catch(() => {});
            },
            pause: () => audio.pause(),
            previoustrack: () => store().prev(),
            nexttrack: () => {
              void store().next();
            },
            seekbackward: (d) => seekBy(-(d.seekOffset ?? 10)),
            seekforward: (d) => seekBy(d.seekOffset ?? 10),
            seekto: (d) => {
              if (typeof d.seekTime === "number") store().seek(d.seekTime);
            },
            stop: () => {
              audio.pause();
              store().seek(0);
            },
          }
        );
      }
      if (state.isPlaying !== prev.isPlaying) {
        setMediaPlaybackState(state.isPlaying ? "playing" : "paused");
      }
    });

    // Seed metadata if a song is already loaded.
    const initial = store().currentSong();
    if (initial) {
      applyMediaSession(
        {
          title: initial.name,
          artist: initial.artist,
          album: initial.album,
          artworkUrl: store().currentCover ?? initial.pic,
        },
        {
          play: () => {
            void audio.play().catch(() => {});
          },
          pause: () => audio.pause(),
          previoustrack: () => store().prev(),
          nexttrack: () => {
            void store().next();
          },
          seekbackward: (d) => seekBy(-(d.seekOffset ?? 10)),
          seekforward: (d) => seekBy(d.seekOffset ?? 10),
          seekto: (d) => {
            if (typeof d.seekTime === "number") store().seek(d.seekTime);
          },
          stop: () => {
            audio.pause();
            store().seek(0);
          },
        }
      );
      setMediaPlaybackState(store().isPlaying ? "playing" : "paused");
    }

    if (!audio.paused) startRaf();

    return () => {
      stopRaf();
      unsub();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);
}
