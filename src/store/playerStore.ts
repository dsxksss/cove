import { create } from "zustand";
import type { LyricLine, RepeatMode, Song } from "../lib/types";
import { getAudio, saveVolume } from "../lib/audio";
import { getFavPlaylistId, getPlaylistPage, getSongMetadata } from "../lib/api";
import { resolvePlayback, resolvePlaybackUrl, sameSong } from "../lib/musicSources";
import { mergeTranslation, parseLrc, parseTranslation } from "../lib/lyric";
import { extractAccent } from "../lib/color";
import type { AccentColor } from "../lib/types";
import { toDurationMs, toDurationSeconds } from "../lib/adapter";
import {
  loadLevel,
  loadRepeatMode,
  loadShuffle,
  loadSpeed,
  nextPlayMode,
  playModeToFlags,
  saveLevel,
  saveRepeatMode,
  saveShuffle,
  saveSpeed,
} from "../lib/playbackPrefs";
import { clearPreload, preloadAudioUrl } from "../lib/preload";
import {
  loadLyricSourceMode,
  resolveExternalLyrics,
  type LyricSourceMode,
} from "../lib/lyrics/matchLyrics";
import { LatestRequestGate } from "../lib/requestGate";

/** Page size for favorites playlist pagination (server-side). */
const FAV_PAGE_SIZE = 100;
const SHUFFLE_TRAIL_LIMIT = 200;
const playbackGate = new LatestRequestGate();
const playlistLoadGate = new LatestRequestGate();
const browseGate = new LatestRequestGate();
const browseMoreGate = new LatestRequestGate();

/** User-facing message when a track has no playable stream (VIP / rights / region). */
function playRestrictionMessage(song: Song, resolvedName?: string): string {
  const title = (resolvedName || song.name || "这首歌").trim();
  const src = song.source ?? "netease";
  if (src === "qq") {
    return `无法播放「${title}」：QQ 音乐音源受限，可能需要会员或暂无试听`;
  }
  if (src === "kugou") {
    return `无法播放「${title}」：酷狗音源受限，可能需要会员或暂无免费音源`;
  }
  return `无法播放「${title}」：网易云音源受限，可能需要会员或因版权无法播放`;
}

/** Normalize invoke / network failures into readable Chinese tips. */
function formatPlayError(raw: unknown, song?: Song): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const title = song?.name ? `「${song.name}」` : "这首歌";
  const lower = msg.toLowerCase();
  if (/vip|会员|付费|试听|版权|无版权|not free|need.?login|privilege|fee/i.test(msg)) {
    return `无法播放${title}：需要会员或受版权限制`;
  }
  if (/cookie|登录|login|auth|未登录|unauthorized|401|403/i.test(msg)) {
    return `无法播放${title}：登录状态失效或权限不足，请重新扫码登录`;
  }
  if (/network|fetch|timeout|timed out|econn|dns|连接/i.test(lower)) {
    return `无法播放${title}：网络异常，请稍后重试`;
  }
  if (msg.trim()) {
    // Keep concise — strip noisy Rust/JS stacks.
    const short = msg.replace(/\s+/g, " ").trim().slice(0, 120);
    return `无法播放${title}：${short}`;
  }
  return `无法播放${title}：播放出错`;
}

/** Best-effort: resolve + warm-cache the next track's audio URL. */
async function warmNextTrack(): Promise<void> {
  const state = usePlayerStore.getState();
  const { queue, index, shuffle, shuffleFuture, level, repeat } = state;
  if (queue.length <= 1 || index < 0) return;

  let nextIndex = -1;
  if (shuffle && shuffleFuture.length > 0) {
    nextIndex = shuffleFuture[shuffleFuture.length - 1];
  } else if (!shuffle) {
    nextIndex = index + 1;
    if (nextIndex >= queue.length) {
      // Always list-loop semantics (no stop-at-end mode).
      if (repeat === "one") return; // single-loop: next track preload not needed
      nextIndex = 0;
    }
  } else {
    // Shuffle without a known future: pick a different random track to warm.
    // Guard with a max-attempt counter so a corrupt queue can never spin forever.
    let guard = 0;
    do {
      nextIndex = Math.floor(Math.random() * queue.length);
      guard += 1;
    } while (nextIndex === index && queue.length > 1 && guard < 32);
    if (nextIndex === index) return;
  }

  const nextSong = queue[nextIndex];
  if (!nextSong) return;
  try {
    const url = await resolvePlaybackUrl(nextSong, level);
    if (url) {
      clearPreload(); // keep only the latest next candidate
      preloadAudioUrl(url);
    }
  } catch {
    /* preload is best-effort */
  }
}

type PlaySongOptions = {
  keepShuffleTrail?: boolean;
  shuffleHistory?: number[];
  shuffleFuture?: number[];
};

interface PlayerState {
  queue: Song[];
  queueSource: "favorites" | "playlist" | "custom";
  activePlaylistId: number | null;
  index: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: RepeatMode;
  shuffle: boolean;
  shuffleHistory: number[];
  shuffleFuture: number[];
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
  /** Where the current lyrics came from (netease / qq / kugou / amll…). */
  lyricSourceLabel: string | null;
  /** favorites playlist pagination: total tracks + how many loaded so far.
   *  0 total = not loaded / unknown. */
  favTotal: number;
  favLoaded: number;
  favLoadingMore: boolean;
  favSongIds: string[];
  playlistTotal: number;
  playlistLoaded: number;
  playlistLoadingMore: boolean;

  /** Browsing list: songs shown in the queue drawer while the user flips
   *  through playlists WITHOUT playing. The drawer shows browseList when
   *  browsePlaylistId is set, falling back to the live queue. Playing a
   *  track commits its playlist as the live queue. */
  browseList: Song[];
  browsePlaylistId: number | null;
  /** Platform of the browsed playlist — ids can collide across netease/qq/kugou. */
  browseSource: "netease" | "qq" | "kugou" | null;
  browseTotal: number;
  browseLoaded: number;
  browseLoadingMore: boolean;

  // derived
  currentSong: () => Song | undefined;

  // actions
  playSong: (song: Song, queue?: Song[], options?: PlaySongOptions) => Promise<void>;
  /** Insert a song directly after the current track without interrupting playback. */
  playNext: (song: Song) => void;
  /** Remove one queue entry. Removing the current track advances to its replacement. */
  removeQueueItem: (index: number) => Promise<void>;
  /** Reorder the live queue while keeping the current track selected. */
  moveQueueItem: (from: number, to: number) => void;
  /** Stop playback and remove every item from the live queue. */
  clearQueue: () => void;
  /** Load the user's "My Favorites" playlist as the queue (no autoplay).
   *  Paginated: loads the first page fast, more on loadMoreFav(). */
  loadFavPlaylist: () => Promise<void>;
  /** Load any account playlist as the queue (no autoplay). */
  loadPlaylist: (id: number, source?: "favorites" | "playlist") => Promise<void>;
  /** Commit an already-loaded playlist's songs as the live queue and start
   *  playing a given song from it. Unlike loadPlaylist, it does NOT refetch —
   *  it reuses the provided songs — and fully sets queue/source/pagination so
   *  next/prev/shuffle operate over the whole playlist. `total` is the true
   *  playlist track count (may exceed songs.length if only partly loaded). */
  playFromPlaylist: (playlistId: number, songs: Song[], song: Song, source?: "favorites" | "playlist", total?: number) => Promise<void>;
  /** Browse a playlist's songs WITHOUT affecting playback. Fills browseList
   *  only; index/isPlaying/currentTime/currentCover/lyrics are untouched. */
  browsePlaylist: (id: number, source?: "netease" | "qq" | "kugou") => Promise<void>;
  /** Append the next page of the currently-browsed playlist. */
  browseMore: () => Promise<void>;
  /** Drop the browse list, reverting the drawer to the live queue. */
  clearBrowse: () => void;
  /** Load the next page of favorites and append to the queue. */
  loadMoreFav: () => Promise<void>;
  loadMorePlaylist: () => Promise<void>;
  toggle: () => void;
  /**
   * Advance to another track. `auto` = natural end-of-track.
   * `forceAdvance` skips single-loop replay (used when current track fails / VIP).
   */
  next: (auto?: boolean, opts?: { forceAdvance?: boolean }) => Promise<void>;
  prev: () => void;
  seek: (t: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  /** Unified play mode: "list" | "one" | "shuffle". Cycles on click. */
  cyclePlayMode: () => void;
  setLevel: (l: string) => void;
  setSpeed: (s: number) => void;
  // internal setters used by useAudioEngine
  _setTime: (t: number) => void;
  _setDuration: (d: number) => void;
  _setPlaying: (p: boolean) => void;
  _clearError: () => void;
  _setErr: (msg: string) => void;
}

export const usePlayerStore = create<PlayerState>((set, get) => ({
  queue: [],
  queueSource: "custom",
  activePlaylistId: null,
  index: -1,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: getAudio().volume,
  muted: false,
  repeat: loadRepeatMode("all"),
  shuffle: loadShuffle(false),
  shuffleHistory: [],
  shuffleFuture: [],
  currentCover: undefined,
  lyrics: [],
  loading: false,
  error: null,
  accent: null,
  level: loadLevel("exhigh"),
  speed: loadSpeed(1.0),
  lyricSourceLabel: null,
  favTotal: 0,
  favLoaded: 0,
  favLoadingMore: false,
  favSongIds: [],
  playlistTotal: 0,
  playlistLoaded: 0,
  playlistLoadingMore: false,

  browseList: [],
  browsePlaylistId: null,
  browseSource: null,
  browseTotal: 0,
  browseLoaded: 0,
  browseLoadingMore: false,

  currentSong: () => {
    const { queue, index } = get();
    return index >= 0 ? queue[index] : undefined;
  },

  clearQueue: () => {
    playbackGate.cancel();
    playlistLoadGate.cancel();
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    set({
      queue: [],
      queueSource: "custom",
      activePlaylistId: null,
      index: -1,
      isPlaying: false,
      loading: false,
      error: null,
      currentTime: 0,
      duration: 0,
      currentCover: undefined,
      lyrics: [],
      lyricSourceLabel: null,
      accent: null,
      playlistTotal: 0,
      playlistLoaded: 0,
      playlistLoadingMore: false,
      shuffleHistory: [],
      shuffleFuture: [],
    });
  },

  playNext: (song) => {
    const state = get();
    const current = state.currentSong();
    if (!current) {
      set({
        queue: [song],
        queueSource: "custom",
        activePlaylistId: null,
        index: 0,
        currentCover: song.pic,
        playlistTotal: 1,
        playlistLoaded: 1,
        playlistLoadingMore: false,
        shuffleHistory: [],
        shuffleFuture: [],
      });
      return;
    }
    if (sameSong(current, song)) return;

    // Move an existing copy instead of creating duplicate entries.
    const queue = state.queue.filter(
      (item, itemIndex) => itemIndex === state.index || !sameSong(item, song),
    );
    const currentIndex = queue.indexOf(current);
    queue.splice(currentIndex + 1, 0, song);
    set({
      queue,
      queueSource: "custom",
      activePlaylistId: null,
      index: currentIndex,
      playlistTotal: queue.length,
      playlistLoaded: queue.length,
      playlistLoadingMore: false,
      shuffleHistory: [],
      shuffleFuture: [],
    });
  },

  removeQueueItem: async (removeIndex) => {
    const state = get();
    if (removeIndex < 0 || removeIndex >= state.queue.length) return;
    const removingCurrent = removeIndex === state.index;
    const queue = state.queue.slice();
    queue.splice(removeIndex, 1);

    if (queue.length === 0) {
      const audio = getAudio();
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      set({
        queue: [],
        queueSource: "custom",
        activePlaylistId: null,
        index: -1,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        currentCover: undefined,
        lyrics: [],
        lyricSourceLabel: null,
        accent: null,
        playlistTotal: 0,
        playlistLoaded: 0,
        playlistLoadingMore: false,
        shuffleHistory: [],
        shuffleFuture: [],
      });
      return;
    }

    if (removingCurrent) {
      const replacementIndex = Math.min(removeIndex, queue.length - 1);
      set({ queue, index: replacementIndex, queueSource: "custom", activePlaylistId: null });
      await get().playSong(queue[replacementIndex], queue);
      return;
    }

    const nextIndex = removeIndex < state.index ? state.index - 1 : state.index;
    set({
      queue,
      queueSource: "custom",
      activePlaylistId: null,
      index: nextIndex,
      playlistTotal: queue.length,
      playlistLoaded: queue.length,
      playlistLoadingMore: false,
      shuffleHistory: [],
      shuffleFuture: [],
    });
  },

  moveQueueItem: (from, to) => {
    const state = get();
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= state.queue.length ||
      to >= state.queue.length
    ) {
      return;
    }
    const current = state.queue[state.index];
    const queue = state.queue.slice();
    const [song] = queue.splice(from, 1);
    queue.splice(to, 0, song);
    set({
      queue,
      queueSource: "custom",
      activePlaylistId: null,
      index: current ? queue.indexOf(current) : -1,
      playlistTotal: queue.length,
      playlistLoaded: queue.length,
      playlistLoadingMore: false,
      shuffleHistory: [],
      shuffleFuture: [],
    });
  },

  playSong: async (song, queue, options) => {
    const requestToken = playbackGate.next();
    const state = get();
    const queueProvided = queue !== undefined;
    let q = queueProvided ? queue.slice() : state.queue.slice();
    let idx = q.findIndex((s) => sameSong(s, song));
    if (idx < 0) {
      // playing ad-hoc: make a single-item queue
      q = [song];
      idx = 0;
    }
    const shuffleTrail = options?.keepShuffleTrail
      ? {
          shuffleHistory: options.shuffleHistory ?? state.shuffleHistory,
          shuffleFuture: options.shuffleFuture ?? state.shuffleFuture,
        }
      : { shuffleHistory: [], shuffleFuture: [] };
    // Show the new track's cover immediately so we never keep the previous
    // song's art for the whole resolve/lyrics window (felt like a delayed jump).
    set({
      queue: q,
      queueSource: queueProvided ? "custom" : state.queueSource,
      activePlaylistId: queueProvided ? null : state.activePlaylistId,
      index: idx,
      loading: true,
      error: null,
      lyrics: [],
      currentTime: 0,
      duration: 0,
      currentCover: song.pic,
      accent: null,
      lyricSourceLabel: null,
      ...shuffleTrail,
    });
    const audio = getAudio();
    audio.pause();
    try {
      // Multi-source resolve: NetEase / QQ / Kugou streaming + metadata.
      const { url, meta } = await resolvePlayback(song, state.level);
      if (!playbackGate.isCurrent(requestToken)) return;
      // Prefer playlist/search pic when present — API often returns a different
      // CDN size/path for the same cover and causes a second visual change.
      let pic = song.pic || meta.pic;
      const rawLrc = meta.lyric ?? "";
      const rawTr = meta.tlyric ?? "";
      let name = song.name;
      let artist = song.artist;
      let album = song.album;

      if (meta.name) name = meta.name;
      if (meta.ar_name) artist = meta.ar_name;
      if (meta.al_name) album = meta.al_name;
      if (!song.pic && meta.pic) pic = meta.pic;

      if (!url) {
        const msg = playRestrictionMessage(song, name);
        set({ loading: false, isPlaying: false, error: msg });
        // Give the user a moment to read the toast, then skip to next.
        // forceAdvance: don't re-loop the same VIP/broken track in single-loop mode.
        setTimeout(() => {
          if (playbackGate.isCurrent(requestToken) && get().error === msg) {
            void get().next(true, { forceAdvance: true });
          }
        }, 3200);
        return;
      }

      // Seed duration from catalog immediately so the progress bar has a real
      // denominator before loadedmetadata (ms → seconds).
      const seededDuration = toDurationSeconds(0, song.duration);

      // Provider LRC first (sync). External match (QQ/Kugou) runs AFTER play
      // starts — waiting on network lyrics previously froze progress/lyrics
      // for multi-source tracks until the match finished.
      let lrc = parseLrc(rawLrc);
      let merged = rawTr ? mergeTranslation(lrc, parseTranslation(rawTr)) : lrc;
      let lyricSourceLabel: string | null =
        merged.length > 0
          ? meta.lyric_source
            ? String(meta.lyric_source)
            : song.source ?? "netease"
          : null;

      // Start audio ASAP so currentTime / rAF clock run while lyrics resolve.
      audio.src = url;
      audio.volume = state.muted ? 0 : state.volume;
      audio.playbackRate = state.speed;
      try {
        await audio.play();
      } catch {
        if (!playbackGate.isCurrent(requestToken)) return;
        // MediaElementError is surfaced via the 'error' event → useAudioEngine.
        // Autoplay block (no media error) just pauses UI.
        set({ loading: false, isPlaying: false });
      }
      if (!playbackGate.isCurrent(requestToken)) return;

      const audioDur =
        Number.isFinite(audio.duration) && audio.duration > 0 && audio.duration < Infinity
          ? audio.duration
          : 0;
      const resolvedDuration = audioDur > 0 ? audioDur : seededDuration;

      // patch song meta in queue
      const updated: Song = {
        ...song,
        name,
        artist,
        album,
        pic,
        duration: song.duration ?? (resolvedDuration > 0 ? Math.round(resolvedDuration * 1000) : undefined),
        source: song.source ?? "netease",
      };
      const latestQueue = get().queue;
      const patchIndex = latestQueue.findIndex((s) => sameSong(s, song));
      const newQ = latestQueue.length > 0 ? latestQueue.slice() : q.slice();
      newQ[patchIndex >= 0 ? patchIndex : idx] = updated;

      // Only write currentCover when it actually changes (avoids img remount flicker).
      const coverNow = get().currentCover;
      const coverNext = pic || coverNow;
      set({
        queue: newQ,
        loading: false,
        isPlaying: !audio.paused,
        currentTime: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        duration: resolvedDuration,
        currentCover: coverNext,
        lyrics: merged,
        lyricSourceLabel,
      });

      // Background external lyric match — does not block the progress clock.
      const mode: LyricSourceMode = loadLyricSourceMode();
      const needsExternal =
        mode === "qq" ||
        mode === "kugou" ||
        (mode === "auto" && merged.length < 2);

      if (needsExternal) {
        const playToken = song;
        void (async () => {
          try {
            const extMode: LyricSourceMode =
              mode === "qq" || mode === "kugou" ? mode : "auto";
            const ext = await resolveExternalLyrics({
              title: name,
              artist,
              durationMs: toDurationMs(song.duration) || Math.round(resolvedDuration * 1000),
              mode: extMode,
            });
            if (!playbackGate.isCurrent(requestToken)) return;
            // Drop if user already skipped ahead.
            const cur = get().currentSong();
            if (!cur || !sameSong(cur, playToken)) return;
            if (ext && ext.lines.length >= 2) {
              if (mode === "qq" || mode === "kugou" || get().lyrics.length < 2) {
                set({ lyrics: ext.lines, lyricSourceLabel: ext.source });
              }
            }
          } catch (e) {
            console.warn("[lyrics] external match failed", e);
          }
        })();
      }

      if (coverNext && coverNext !== coverNow) {
        extractAccent(coverNext).then((c) => {
          // Drop stale accent work if user already skipped ahead.
          if (
            c &&
            playbackGate.isCurrent(requestToken) &&
            sameSong(get().currentSong() ?? song, song)
          ) {
            set({ accent: c });
          }
        });
      } else if (coverNext && !get().accent) {
        extractAccent(coverNext).then((c) => {
          if (
            c &&
            playbackGate.isCurrent(requestToken) &&
            sameSong(get().currentSong() ?? song, song)
          ) {
            set({ accent: c });
          }
        });
      }

      void warmNextTrack();
    } catch (e: unknown) {
      if (!playbackGate.isCurrent(requestToken)) return;
      const msg = formatPlayError(e, song);
      set({ loading: false, isPlaying: false, error: msg });
      setTimeout(() => {
        if (get().error === msg) void get().next(true, { forceAdvance: true });
      }, 3200);
    }
  },

  loadFavPlaylist: async () => {
    const pid = getFavPlaylistId();
    if (!pid) return; // not configured — stays empty, user searches manually
    await get().loadPlaylist(pid, "favorites");
  },

  loadPlaylist: async (pid, source = "playlist") => {
    const requestToken = playlistLoadGate.next();
    try {
      // Paginated: fetch only the first page (100 tracks) for a fast initial
      // load. More pages load on demand when the queue drawer scrolls near the bottom.
      const page = await getPlaylistPage(pid, FAV_PAGE_SIZE, 0);
      if (!playlistLoadGate.isCurrent(requestToken)) return;
      if (page.songs.length === 0) {
        set({ error: "歌单为空或读取失败，请稍后重试" });
        return;
      }
      set({
        queue: page.songs,
        queueSource: source,
        activePlaylistId: pid,
        index: 0,
        isPlaying: false,
        currentTime: 0,
        duration: 0,
        error: null,
        playlistTotal: page.total,
        playlistLoaded: page.songs.length,
        playlistLoadingMore: false,
        shuffleHistory: [],
        shuffleFuture: [],
        favTotal: page.total,
        favLoaded: page.songs.length,
        favLoadingMore: false,
        favSongIds: source === "favorites" ? page.songs.map((song) => String(song.id)) : get().favSongIds,
      });
      // Pre-fetch first track metadata (cover + lyrics) — don't play.
      const first = page.songs[0];
      try {
        const json = await getSongMetadata(first.id);
        if (!playlistLoadGate.isCurrent(requestToken)) return;
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
          ? `加载歌单失败：${e.message}`
          : "加载歌单失败，请稍后重试",
      });
    }
  },

  playFromPlaylist: async (playlistId, songs, song, source = "playlist", total) => {
    if (songs.length === 0) {
      set({ error: "歌单为空或无法播放" });
      return;
    }
    // locate the picked song within the provided list
    let idx = songs.findIndex((s) => s.id === song.id);
    let q = songs;
    if (idx < 0) {
      // song not in the list (e.g. partially loaded) — prepend it
      q = [song, ...songs];
      idx = 0;
    }
    const isFav = source === "favorites";
    // true total may be larger than loaded when browsing only fetched page 1;
    // pass it so loadMorePlaylist can still fetch the remaining pages.
    const realTotal = total ?? q.length;
    // Commit the whole playlist as the live queue with full pagination state,
    // then play the picked song. This makes next/prev/shuffle operate over the
    // entire playlist (the "play queue"), not just the single track.
    set({
      queue: q,
      queueSource: source,
      activePlaylistId: playlistId,
      index: idx,
      isPlaying: false, // playSong below will set it true on audio.play()
      currentTime: 0,
      duration: 0,
      loading: true,
      error: null,
      lyrics: [],
      accent: null,
      playlistTotal: realTotal,
      playlistLoaded: q.length,
      playlistLoadingMore: false,
      favTotal: realTotal,
      favLoaded: q.length,
      favLoadingMore: false,
      favSongIds: isFav ? q.map((s) => String(s.id)) : get().favSongIds,
      shuffleHistory: [],
      shuffleFuture: [],
    });
    // Keep browseList/browsePlaylistId intact. Playback and browsing are
    // independent contexts: choosing a track must not close the playlist page
    // or discard its pagination/scroll state.
    // If the playlist has more pages than we loaded, fetch the rest in the
    // background so shuffle/next cover the full playlist.
    if (realTotal > q.length) {
      void get().loadMorePlaylist();
    }
    await get().playSong(song);
  },

  browsePlaylist: async (pid, source = "netease") => {
    const cur = get();
    // already browsing this exact platform playlist? no-op (avoid refetch flicker)
    if (
      cur.browsePlaylistId === pid &&
      cur.browseSource === source &&
      cur.browseList.length > 0
    ) {
      return;
    }
    const requestToken = browseGate.next();
    browseMoreGate.cancel();
    // Clear first so the UI doesn't keep showing the previous platform's tracks.
    set({
      browseList: [],
      browsePlaylistId: pid,
      browseSource: source,
      browseTotal: 0,
      browseLoaded: 0,
      browseLoadingMore: true,
      error: null,
    });
    try {
      const page = await getPlaylistPage(pid, FAV_PAGE_SIZE, 0);
      if (!browseGate.isCurrent(requestToken)) return;
      // NOTE: deliberately does NOT touch index / isPlaying / currentTime /
      // currentCover / lyrics — playback keeps running undisturbed.
      set({
        browseList: page.songs,
        browsePlaylistId: pid,
        browseSource: source,
        browseTotal: page.total,
        browseLoaded: page.songs.length,
        browseLoadingMore: false,
        error:
          page.songs.length === 0 ? "歌单为空或读取失败，请稍后重试" : null,
      });
    } catch (e: unknown) {
      if (!browseGate.isCurrent(requestToken)) return;
      const msg = e instanceof Error ? e.message : "加载歌单失败";
      set({
        browseList: [],
        browsePlaylistId: pid,
        browseSource: source,
        browseTotal: 0,
        browseLoaded: 0,
        browseLoadingMore: false,
        error: msg,
      });
    }
  },

  browseMore: async () => {
    const { browsePlaylistId, browseSource, browseLoadingMore, browseLoaded, browseTotal } = get();
    if (browsePlaylistId == null || browseLoadingMore) return;
    if (browseLoaded >= browseTotal) return;
    const requestToken = browseMoreGate.next();
    set({ browseLoadingMore: true });
    try {
      const page = await getPlaylistPage(browsePlaylistId, FAV_PAGE_SIZE, browseLoaded);
      const latest = get();
      if (
        !browseMoreGate.isCurrent(requestToken) ||
        latest.browsePlaylistId !== browsePlaylistId ||
        latest.browseSource !== browseSource
      ) return;
      set({
        browseList: [...latest.browseList, ...page.songs],
        browseLoaded: latest.browseLoaded + page.songs.length,
        browseLoadingMore: false,
      });
    } catch {
      if (browseMoreGate.isCurrent(requestToken)) set({ browseLoadingMore: false });
    }
  },

  clearBrowse: () => {
    browseGate.cancel();
    browseMoreGate.cancel();
    set({
      browseList: [],
      browsePlaylistId: null,
      browseSource: null,
      browseTotal: 0,
      browseLoaded: 0,
      browseLoadingMore: false,
    });
  },

  loadMoreFav: async () => {
    await get().loadMorePlaylist();
  },

  loadMorePlaylist: async () => {
    const {
      activePlaylistId,
      playlistLoadingMore,
      playlistLoaded,
      playlistTotal,
      favSongIds,
      queue,
      queueSource,
    } = get();
    // already loading, or nothing more to load
    if (!activePlaylistId || playlistLoadingMore || playlistLoaded >= playlistTotal) return;
    set({ playlistLoadingMore: true, favLoadingMore: true });
    try {
      const page = await getPlaylistPage(activePlaylistId, FAV_PAGE_SIZE, playlistLoaded);
      if (page.songs.length > 0) {
        const nextFavSongIds = Array.from(
          new Set([...favSongIds, ...page.songs.map((song) => String(song.id))])
        );
        set({
          queue: [...queue, ...page.songs],
          playlistLoaded: playlistLoaded + page.songs.length,
          playlistTotal: page.total || playlistTotal,
          favLoaded: playlistLoaded + page.songs.length,
          favTotal: page.total || playlistTotal,
          favSongIds: queueSource === "favorites" ? nextFavSongIds : favSongIds,
        });
      }
    } catch {
      /* load-more is best-effort; don't surface a hard error */
    } finally {
      set({ playlistLoadingMore: false, favLoadingMore: false });
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

  next: async (auto, opts) => {
    const { queue, index, repeat, shuffle, shuffleHistory, shuffleFuture } = get();
    if (queue.length === 0) return;
    const forceAdvance = Boolean(opts?.forceAdvance);

    // Single-loop only on natural track end — never when skipping a failed/VIP track.
    if (repeat === "one" && auto && !forceAdvance) {
      const s = queue[index];
      if (s) {
        await get().playSong(s, undefined, {
          keepShuffleTrail: true,
          shuffleHistory,
          shuffleFuture,
        });
      }
      return;
    }

    let ni: number;
    if (shuffle && queue.length > 1) {
      const nextFuture = shuffleFuture.slice();
      const nextHistory = index >= 0
        ? [...shuffleHistory, index].slice(-SHUFFLE_TRAIL_LIMIT)
        : shuffleHistory.slice();

      if (nextFuture.length > 0) {
        ni = nextFuture.pop()!;
      } else {
        let guard = 0;
        do {
          ni = Math.floor(Math.random() * queue.length);
          guard += 1;
        } while (ni === index && queue.length > 1 && guard < 32);
        if (ni === index) ni = (index + 1) % queue.length;
      }
      // When force-skipping a broken track, never re-pick the same index.
      if (forceAdvance && ni === index && queue.length > 1) {
        ni = (index + 1) % queue.length;
      }
      const target = queue[ni];
      if (!target) return;
      await get().playSong(target, undefined, {
        keepShuffleTrail: true,
        shuffleHistory: nextHistory,
        shuffleFuture: nextFuture,
      });
      return;
    }

    // List loop (and forced advance from single-loop on failure): always wrap.
    // There is no "off / stop at end" mode anymore.
    if (queue.length === 1) {
      const only = queue[0];
      if (only) await get().playSong(only);
      return;
    }
    ni = index + 1;
    if (ni >= queue.length) ni = 0;
    if (ni < 0) ni = 0;
    const target = queue[ni];
    if (!target) return;
    await get().playSong(target);
  },

  prev: () => {
    const { queue, index, shuffle, shuffleHistory, shuffleFuture } = get();
    if (queue.length === 0) return;
    // if more than 3s in, restart current
    const audio = getAudio();
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    if (shuffle && shuffleHistory.length > 0) {
      const nextHistory = shuffleHistory.slice();
      const pi = nextHistory.pop();
      if (pi == null || !queue[pi]) return;
      const nextFuture = index >= 0
        ? [...shuffleFuture, index].slice(-SHUFFLE_TRAIL_LIMIT)
        : shuffleFuture.slice();
      void get().playSong(queue[pi], undefined, {
        keepShuffleTrail: true,
        shuffleHistory: nextHistory,
        shuffleFuture: nextFuture,
      });
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
    // Legacy API: only list loop ↔ single loop (shuffle is via cyclePlayMode / toggleShuffle).
    const repeat: RepeatMode = get().repeat === "one" ? "all" : "one";
    saveRepeatMode(repeat);
    saveShuffle(false);
    set({ repeat, shuffle: false, shuffleHistory: [], shuffleFuture: [] });
  },

  toggleShuffle: () => {
    const shuffle = !get().shuffle;
    saveShuffle(shuffle);
    // Turning shuffle on keeps list-loop semantics underneath.
    if (shuffle) {
      saveRepeatMode("all");
      set({ shuffle: true, repeat: "all", shuffleHistory: [], shuffleFuture: [] });
    } else {
      set({ shuffle: false, shuffleHistory: [], shuffleFuture: [] });
    }
  },

  cyclePlayMode: () => {
    // Exactly three modes: list → one → shuffle → list (no off / sequence).
    // Sync-only so the click never hangs on network work.
    try {
      const { repeat, shuffle } = get();
      const next = nextPlayMode(repeat, shuffle);
      const flags = playModeToFlags(next);
      saveRepeatMode(flags.repeat);
      saveShuffle(flags.shuffle);
      set({
        repeat: flags.repeat,
        shuffle: flags.shuffle,
        shuffleHistory: [],
        shuffleFuture: [],
      });
    } catch {
      const { repeat, shuffle } = get();
      const next = nextPlayMode(repeat, shuffle);
      const flags = playModeToFlags(next);
      set({
        repeat: flags.repeat,
        shuffle: flags.shuffle,
        shuffleHistory: [],
        shuffleFuture: [],
      });
    }
  },

  setLevel: (l) => {
    const prev = get().level;
    if (prev === l) return;
    saveLevel(l);
    set({ level: l });
    // Re-resolve stream at the new quality if something is already loaded.
    const song = get().currentSong();
    if (!song) return;
    const audio = getAudio();
    const wasPlaying = !audio.paused;
    const t = audio.currentTime;
    void (async () => {
      try {
        const { url } = await resolvePlayback(song, l);
        if (!url) {
          set({
            error: `「${song.name}」该音质不可用（可能需要会员），请尝试更低音质`,
          });
          return;
        }
        // Ignore if user switched quality again while we were resolving.
        if (get().level !== l) return;
        const cur = get().currentSong();
        if (!cur || !sameSong(cur, song)) return;
        audio.src = url;
        audio.currentTime = t;
        if (wasPlaying) {
          await audio.play().catch(() => undefined);
        }
      } catch (e: unknown) {
        set({
          error:
            e instanceof Error && e.message
              ? `切换音质失败：${e.message.slice(0, 80)}`
              : "切换音质失败，已保持原音质",
        });
      }
    })();
  },
  setSpeed: (s) => {
    const speed = Math.min(2, Math.max(0.5, s));
    const audio = getAudio();
    audio.playbackRate = speed;
    saveSpeed(speed);
    set({ speed });
  },

  _setTime: (t) => set({ currentTime: t }),
  _setDuration: (d) => set({ duration: d }),
  _setPlaying: (p) => set({ isPlaying: p }),
  _clearError: () => set({ error: null }),
  _setErr: (msg) => set({ loading: false, isPlaying: false, error: msg }),
}));
