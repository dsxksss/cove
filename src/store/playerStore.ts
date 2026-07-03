import { create } from "zustand";
import type { LyricLine, RepeatMode, Song } from "../lib/types";
import { getAudio, saveVolume } from "../lib/audio";
import { getFavPlaylistId, getPlaylistPage, getSongJson, getSongUrl } from "../lib/api";
import { mergeTranslation, parseLrc, parseTranslation } from "../lib/lyric";
import { extractAccent } from "../lib/color";
import type { AccentColor } from "../lib/types";

/** Page size for favorites playlist pagination (server-side). */
const FAV_PAGE_SIZE = 100;

interface PlayerState {
  queue: Song[];
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  /** resolved cover for current song */
  currentCover: string | undefined;
  lyrics: LyricLine[];
  /** loading state for resolving the next track */
  loading: boolean;
  /** last error message (e.g. restricted song) */
  error: string | null;
  accent: AccentColor | null;
  level: string;
  /** playback speed multiplier (1.0 = normal). Wired to audio.playbackRate. */
  speed: number;
  /** favorites playlist pagination: total tracks + how many loaded so far.
   *  0 total = not loaded / unknown. */
  favTotal: number;
  favLoaded: number;
  favLoadingMore: boolean;

  // derived
  currentSong: () => Song | undefined;

  // actions
  playSong: (song: Song, queue?: Song[]) => Promise<void>;
  /** Load the user's "My Favorites" playlist as the queue (no autoplay).
   *  Paginated: loads the first page fast, more on loadMoreFav(). */
  loadFavPlaylist: () => Promise<void>;
  /** Load the next page of favorites and append to the queue. */
  loadMoreFav: () => Promise<void>;
  toggle: () => void;
  next: (auto?: boolean) => Promise<void>;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  /** Unified play mode: "sequence" | "list" | "one" | "shuffle". Cycles on click. */
  cyclePlayMode: () => void;
  setLevel: (l: string) => void;
  setSpeed: (s: number) => void;
  // internal setters used by useAudioEngine
  _setTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _setPlaying: (p: boolean) => void;
  _clearError: () => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  index: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: getAudio().volume,
  muted: false,
  repeat: "off",
  shuffle: false,
  currentCover: undefined,
  lyrics: [],
  loading: false,
  error: null,
  accent: null,
  level: "exhigh",
  speed: 1.0,
  favTotal: 0,
  favLoaded: 0,
  favLoadingMore: false,

  currentSong: () => {
    const { queue, index } = get();
    return index >= 0 ? queue[index] : undefined;
  },

  playSong: async (song, queue) => {
    const state = get();
    const q = queue ?? state.queue;
    let idx = q.findIndex((s) => s.id === song.id);
    if (idx < 0) {
      // playing ad-hoc: make a single-item queue
      q.length = 0;
      q.push(song);
      idx = 0;
    }
    set({ queue: q, index: idx, loading: true, error: null, lyrics: [], currentTime: 0, duration: 0, accent: null });
    const audio = getAudio();
    try {
      // Prefer the combined json call: gets cover + lyrics + url at once.
      const json = await getSongJson(song.id);
      let url: string | null = json?.url ?? null;
      let pic = song.pic ?? json?.pic;
      let rawLrc = json?.lyric ?? "";
      let rawTr = json?.tlyric ?? "";
      let name = song.name;
      let artist = song.artist;
      let album = song.album;

      if (json) {
        if (!pic && json.pic) pic = json.pic;
        if (!rawLrc && json.lyric) rawLrc = json.lyric;
        if (!rawTr && json.tlyric) rawTr = json.tlyric;
        if (json.name) name = json.name;
        if (json.ar_name) artist = json.ar_name;
        if (json.al_name) album = json.al_name;
      }
      // If json didn't return a url, fall back to the url-only endpoint.
      if (!url) url = await getSongUrl(song.id, state.level);

      if (!url) {
        set({ loading: false, error: "无法播放：该歌曲可能受版权限制或需要会员" });
        // auto-advance after a beat
        setTimeout(() => {
          if (get().error) void get().next(true);
        }, 2500);
        return;
      }

      // lyrics
      const lrc = parseLrc(rawLrc);
      const merged = rawTr ? mergeTranslation(lrc, parseTranslation(rawTr)) : lrc;

      audio.src = url;
      audio.volume = state.muted ? 0 : state.volume;
      audio.playbackRate = state.speed;
      await audio.play().catch(() => {
        /* autoplay may be blocked on first user gesture; toggle() will retry */
      });

      // patch song meta in queue
      const updated: Song = { ...song, name, artist, album, pic };
      const newQ = q.slice();
      newQ[idx] = updated;

      set({
        queue: newQ,
        loading: false,
        isPlaying: !audio.paused,
        currentCover: pic,
        lyrics: merged,
      });

      // accent color from cover (non-blocking)
      if (pic) {
        extractAccent(pic).then((c) => {
          if (c && get().index === idx) set({ accent: c });
        });
      }
    } catch (e: any) {
      set({ loading: false, error: e?.message ? String(e.message) : "播放出错" });
    }
  },

  loadFavPlaylist: async () => {
    const pid = getFavPlaylistId();
    if (!pid) return; // not configured — stays empty, user searches manually
    try {
      // Paginated: fetch only the first page (100 tracks) for a fast initial
      // load (~1.4s vs ~12s for all 1786). More pages load on demand via
      // loadMoreFav() when the queue drawer scrolls near the bottom.
      const page = await getPlaylistPage(pid, FAV_PAGE_SIZE, 0);
      if (page.songs.length === 0) {
        set({ error: "「我喜欢」歌单为空或读取失败，请检查 API 服务" });
        return;
      }
      set({
        queue: page.songs,
        index: 0,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        error: null,
        favTotal: page.total,
        favLoaded: page.songs.length,
        favLoadingMore: false,
      });
      // Pre-fetch first track metadata (cover + lyrics) — don't play.
      const first = page.songs[0];
      try {
        const json = await getSongJson(first.id);
        if (!json) return;
        const pic = first.pic ?? json.pic;
        const rawLrc = json.lyric ?? "";
        const rawTr = json.tlyric ?? "";
        const lrc = parseLrc(rawLrc);
        const merged = rawTr ? mergeTranslation(lrc, parseTranslation(rawTr)) : lrc;
        const updated: Song = {
          ...first,
          name: json.name ?? first.name,
          artist: json.ar_name ?? first.artist,
          album: json.al_name ?? first.album,
          pic,
        };
        const newQ = page.songs.slice();
        newQ[0] = updated;
        set({ queue: newQ, currentCover: pic, lyrics: merged });
        if (pic) {
          extractAccent(pic).then((c) => {
            if (c && get().index === 0) set({ accent: c });
          });
        }
      } catch {
        /* metadata prefetch failed — card still shows song name/artist from the playlist */
      }
    } catch (e: any) {
      set({
        error: e?.message
          ? `加载「我喜欢」失败：${e.message}`
          : "加载「我喜欢」失败，请确认 API 服务在运行",
      });
    }
  },

  loadMoreFav: async () => {
    const { favLoadingMore, favLoaded, favTotal, queue } = get();
    // already loading, or nothing more to load
    if (favLoadingMore || favLoaded >= favTotal) return;
    const pid = getFavPlaylistId();
    if (!pid) return;
    set({ favLoadingMore: true });
    try {
      const page = await getPlaylistPage(pid, FAV_PAGE_SIZE, favLoaded);
      if (page.songs.length > 0) {
        set({
          queue: [...queue, ...page.songs],
          favLoaded: favLoaded + page.songs.length,
          favTotal: page.total || favTotal,
        });
      }
    } catch {
      /* load-more is best-effort; don't surface a hard error */
    } finally {
      set({ favLoadingMore: false });
    }
  },

  toggle: () => {
    const audio = getAudio();
    const cur = get().currentSong();
    if (!cur && get().queue.length === 0) return;
    // If the current song hasn't been loaded into the audio element yet
    // (e.g. on startup we pre-fetched metadata but didn't set audio.src),
    // loading is required before playback — delegate to playSong which
    // resolves the URL and sets the src. Otherwise just resume/pause.
    if (audio.paused) {
      if (!audio.src) {
        if (cur) void get().playSong(cur);
        return;
      }
      void audio.play().then(() => set({ isPlaying: true })).catch(() => {});
    } else {
      audio.pause();
      set({ isPlaying: false });
    }
  },

  next: async (auto) => {
    const { queue, index, repeat, shuffle } = get();
    if (queue.length === 0) return;
    if (repeat === "one" && auto) {
      const s = queue[index];
      if (s) await get().playSong(s);
      return;
    }
    let ni: number;
    if (shuffle && queue.length > 1) {
      do {
        ni = Math.floor(Math.random() * queue.length);
      } while (ni === index);
    } else {
      ni = index + 1;
      if (ni >= queue.length) {
        if (repeat === "all" || !auto) ni = 0;
        else {
          // stop at end
          set({ isPlaying: false });
          return;
        }
      }
    }
    await get().playSong(queue[ni]);
  },

  prev: () => {
    const { queue, index } = get();
    if (queue.length === 0) return;
    // if more than 3s in, restart current
    const audio = getAudio();
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    let pi = index - 1;
    if (pi < 0) pi = queue.length - 1;
    void get().playSong(queue[pi]);
  },

  seek: (t) => {
    const audio = getAudio();
    if (Number.isFinite(t)) {
      audio.currentTime = Math.max(0, Math.min(t, audio.duration || t));
      set({ currentTime: audio.currentTime });
    }
  },

  setVolume: (v) => {
    const vol = Math.min(1, Math.max(0, v));
    const audio = getAudio();
    audio.volume = vol;
    saveVolume(vol);
    set({ volume: vol, muted: vol === 0 });
  },

  toggleMute: () => {
    const audio = getAudio();
    const muted = !get().muted;
    audio.volume = muted ? 0 : get().volume;
    set({ muted });
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ["off", "all", "one"];
    const i = order.indexOf(get().repeat);
    set({ repeat: order[(i + 1) % order.length] });
  },

  toggleShuffle: () => set({ shuffle: !get().shuffle }),

  cyclePlayMode: () => {
    // unified cycle: sequence → list loop → single loop → shuffle → sequence
    const { repeat, shuffle } = get();
    let mode: "sequence" | "list" | "one" | "shuffle";
    if (shuffle) mode = "shuffle";
    else if (repeat === "one") mode = "one";
    else if (repeat === "all") mode = "list";
    else mode = "sequence";
    const order: typeof mode[] = ["sequence", "list", "one", "shuffle"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    set({
      repeat: next === "list" ? "all" : next === "one" ? "one" : "off",
      shuffle: next === "shuffle",
    });
  },

  setLevel: (l) => set({ level: l }),
  setSpeed: (s) => {
    const speed = Math.min(2, Math.max(0.5, s));
    const audio = getAudio();
    audio.playbackRate = speed;
    set({ speed });
  },

  _setTime: (t) => set({ currentTime: t }),
  _setDuration: (d) => set({ duration: d }),
  _setPlaying: (p) => set({ isPlaying: p }),
  _clearError: () => set({ error: null }),
}));
