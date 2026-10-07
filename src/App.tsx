import {
  useEffect,
  useCallback,
  lazy,
  memo,
  Suspense,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Search,
  X,
  Loader2,
  ListMusic,
  Library,
  RefreshCw,
  Settings,
  LogOut,
  Minus,
  ChevronLeft,
  ChevronRight,
  UserRound,
  Server,
  Image as ImageIcon,
  Aperture,
  Contrast,
  LogIn,
  Plus,
  Trash2,
  ListPlus,
  Pencil,
  Check,
  Mic2,
} from "lucide-react";
import GlassPlayer from "./components/GlassPlayer";
import StudioWorkspace from "./components/StudioWorkspace";
import { ToastHost } from "./components/ToastHost";
import type { LyricMotionStyle, PlayerLayout, Song as PlayerSong } from "./components/playerTypes";
import { getAudio } from "./lib/audio";
import { CollectionSongVirtualList } from "./components/CollectionSongVirtualList";
import { SearchOverlay } from "./components/SearchOverlay";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { useDesktopBlur } from "./hooks/useDesktopBlur";
import { usePlayerStore } from "./store/playerStore";
import {
  loadMotionLevel,
  saveMotionLevel,
  MOTION_LEVEL_OPTIONS,
  type MotionLevel,
} from "./lib/motionPrefs";
import {
  getFavPlaylistId,
  setFavPlaylistId,
  getUserPlaylists,
  getSongMetadata,
  getKugouUserPlaylists,
  getQqUserPlaylists,
  getAllQqPlaylistSongs,
  type PlaylistSummary,
  type LoginStatus,
} from "./lib/api";
import {
  AUTH_PLATFORM_LABEL,
  emptyMultiAuth,
  getMultiAuthStatus,
  logoutAll,
  logoutPlatform,
  type AuthPlatform,
  type MultiAuthStatus,
} from "./lib/auth";
import { toPlayerSong } from "./lib/adapter";
import { resolvePlayback } from "./lib/musicSources";
import { minimizeWindow, closeWindow } from "./lib/tauri";
import type { Song } from "./lib/types";
import {
  loadLyricSourceMode,
  saveLyricSourceMode,
  type LyricSourceMode,
} from "./lib/lyrics/matchLyrics";
import { pickQqFavoritesPlaylist } from "./lib/defaultPlaylist";
import {
  addSongToAppPlaylist,
  createAppPlaylist,
  deleteAppPlaylist,
  loadAppPlaylists,
  loadNativeAppPlaylists,
  moveSongInAppPlaylist,
  removeSongFromAppPlaylist,
  renameAppPlaylist,
  persistAppPlaylists,
  type AppPlaylist,
} from "./lib/appPlaylists";
import { toast } from "./store/toastStore";
import { getCoverFlowRange } from "./lib/coverFlow";
import { createStudioProject, type StudioProject } from "./studio/types";
import { getProjectDuration } from "./lib/studioSchedule";

const LoginPanel = lazy(() =>
  import("./components/LoginPanel").then((module) => ({ default: module.LoginPanel })),
);

/** Default "My Favorites" playlist id detected for this account.
 *  Overridable via localStorage "nmp.favPlaylistId". */
const DEFAULT_FAV_PLAYLIST_ID = 797461443;
const BACKGROUND_BLUR_KEY = "nmp.backgroundBlur";
const BACKGROUND_OPACITY_KEY = "nmp.backgroundOpacity";
const LYRIC_MOTION_STYLE_KEY = "nmp.lyricMotionStyle";
const LYRIC_OFFSET_KEY = "nmp.lyricOffsetSeconds";
const USE_COVER_BACKGROUND_KEY = "nmp.useCoverBackground";
const SHOW_TRANSLATION_KEY = "nmp.showTranslation";
const DEFAULT_BACKGROUND_BLUR = 30;
const DEFAULT_BACKGROUND_OPACITY = 80;
const DEFAULT_LYRIC_OFFSET_SECONDS = 0;
const DEFAULT_LYRIC_MOTION_STYLE: LyricMotionStyle = "monet";
const LYRIC_MOTION_STYLE_OPTIONS: Array<{ value: LyricMotionStyle; label: string }> = [
  { value: "monet", label: "莫奈" },
  { value: "fume", label: "浮名" },
  { value: "classic", label: "流光" },
  { value: "rail", label: "滚动" },
  { value: "dialogue", label: "对话" },
];

function loadBackgroundBlur(): number {
  try {
    const stored = localStorage.getItem(BACKGROUND_BLUR_KEY);
    if (stored == null) return DEFAULT_BACKGROUND_BLUR;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.min(60, Math.max(0, value)) : DEFAULT_BACKGROUND_BLUR;
  } catch {
    return DEFAULT_BACKGROUND_BLUR;
  }
}

function saveBackgroundBlur(value: number) {
  try {
    localStorage.setItem(BACKGROUND_BLUR_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function loadBackgroundOpacity(): number {
  try {
    const stored = localStorage.getItem(BACKGROUND_OPACITY_KEY);
    if (stored == null) return DEFAULT_BACKGROUND_OPACITY;
    const value = Number(stored);
    return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : DEFAULT_BACKGROUND_OPACITY;
  } catch {
    return DEFAULT_BACKGROUND_OPACITY;
  }
}

function saveBackgroundOpacity(value: number) {
  try {
    localStorage.setItem(BACKGROUND_OPACITY_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function isLyricMotionStyle(value: string | null): value is LyricMotionStyle {
  return LYRIC_MOTION_STYLE_OPTIONS.some((option) => option.value === value);
}

function loadLyricMotionStyle(): LyricMotionStyle {
  try {
    const value = localStorage.getItem(LYRIC_MOTION_STYLE_KEY);
    return isLyricMotionStyle(value) ? value : DEFAULT_LYRIC_MOTION_STYLE;
  } catch {
    return DEFAULT_LYRIC_MOTION_STYLE;
  }
}

function saveLyricMotionStyle(value: LyricMotionStyle) {
  try {
    localStorage.setItem(LYRIC_MOTION_STYLE_KEY, value);
  } catch {
    /* ignore */
  }
}

function loadLyricOffsetSeconds(): number {
  try {
    const value = Number(localStorage.getItem(LYRIC_OFFSET_KEY));
    return Number.isFinite(value) ? Math.min(5, Math.max(-5, value)) : DEFAULT_LYRIC_OFFSET_SECONDS;
  } catch {
    return DEFAULT_LYRIC_OFFSET_SECONDS;
  }
}

function saveLyricOffsetSeconds(value: number) {
  try {
    localStorage.setItem(LYRIC_OFFSET_KEY, String(value));
  } catch {
    /* ignore */
  }
}

function loadUseCoverBackground(): boolean {
  try {
    return localStorage.getItem(USE_COVER_BACKGROUND_KEY) === "1";
  } catch {
    return false;
  }
}

function saveUseCoverBackground(value: boolean) {
  try {
    localStorage.setItem(USE_COVER_BACKGROUND_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function loadShowTranslation(): boolean {
  try {
    return localStorage.getItem(SHOW_TRANSLATION_KEY) !== "0";
  } catch {
    return true;
  }
}

function saveShowTranslation(value: boolean) {
  try {
    localStorage.setItem(SHOW_TRANSLATION_KEY, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [studioOpen, setStudioOpen] = useState(false);
  useAudioEngine(!studioOpen);
  const desktopBlur = useDesktopBlur();

  // ---- data layer (Zustand) ----
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const duration = usePlayerStore((s) => s.duration);
  const cover = usePlayerStore((s) => s.currentCover);
  const lyrics = usePlayerStore((s) => s.lyrics);
  const accent = usePlayerStore((s) => s.accent);
  const volume = usePlayerStore((s) => s.volume);
  const playSong = usePlayerStore((s) => s.playSong);
  const loadFavPlaylist = usePlayerStore((s) => s.loadFavPlaylist);
  const toggle = usePlayerStore((s) => s.toggle);
  const next = usePlayerStore((s) => s.next);
  const prev = usePlayerStore((s) => s.prev);
  const seek = usePlayerStore((s) => s.seek);
  const setVolume = usePlayerStore((s) => s.setVolume);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const cyclePlayMode = usePlayerStore((s) => s.cyclePlayMode);
  const level = usePlayerStore((s) => s.level);
  const setLevel = usePlayerStore((s) => s.setLevel);
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const activePlaylistId = usePlayerStore((s) => s.activePlaylistId);
  const playlistLoaded = usePlayerStore((s) => s.playlistLoaded);
  const playlistTotal = usePlayerStore((s) => s.playlistTotal);
  const playlistLoadingMore = usePlayerStore((s) => s.playlistLoadingMore);
  const browseList = usePlayerStore((s) => s.browseList);
  const browsePlaylistId = usePlayerStore((s) => s.browsePlaylistId);
  const browseTotal = usePlayerStore((s) => s.browseTotal);
  const browseLoaded = usePlayerStore((s) => s.browseLoaded);
  const browseLoadingMore = usePlayerStore((s) => s.browseLoadingMore);
  const browsePlaylist = usePlayerStore((s) => s.browsePlaylist);
  const clearBrowse = usePlayerStore((s) => s.clearBrowse);
  const playFromPlaylist = usePlayerStore((s) => s.playFromPlaylist);
  const playNext = usePlayerStore((s) => s.playNext);
  const removeQueueItem = usePlayerStore((s) => s.removeQueueItem);
  const moveQueueItem = usePlayerStore((s) => s.moveQueueItem);
  const clearQueue = usePlayerStore((s) => s.clearQueue);
  // unified play mode: only list | one | shuffle (legacy "off"/sequence → list)
  const playMode: "list" | "one" | "shuffle" = shuffle
    ? "shuffle"
    : repeat === "one"
      ? "one"
      : "list";

  // ---- UI-only state ----
  const [layout, setLayout] = useState<PlayerLayout>("lyrics");
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPlatform, setLoginPlatform] = useState<AuthPlatform>("netease");
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** null while bootstrapping auth */
  const [multiAuth, setMultiAuth] = useState<MultiAuthStatus | null>(null);
  /** NetEase-shaped status for playlist/favorites (derived from multiAuth) */
  const loginStatus: LoginStatus | null = multiAuth
    ? {
        logged_in: multiAuth.netease.logged_in,
        nickname: multiAuth.netease.nickname,
        uid: multiAuth.netease.uid ? Number(multiAuth.netease.uid) || undefined : undefined,
        vip_type: multiAuth.netease.vip ? 1 : 0,
      }
    : null;
  const [backgroundBlur, setBackgroundBlur] = useState(loadBackgroundBlur);
  const [backgroundOpacity, setBackgroundOpacity] = useState(loadBackgroundOpacity);
  const [motionLevel, setMotionLevel] = useState<MotionLevel>(() => loadMotionLevel());
  const [lyricMotionStyle, setLyricMotionStyle] = useState(loadLyricMotionStyle);
  const [lyricOffsetSeconds, setLyricOffsetSeconds] = useState(loadLyricOffsetSeconds);
  const [useCoverBackground, setUseCoverBackground] = useState(loadUseCoverBackground);
  const [showTranslation, setShowTranslation] = useState(loadShowTranslation);
  const [lyricSourceMode, setLyricSourceMode] = useState<LyricSourceMode>(loadLyricSourceMode);
  const [accountPlaylists, setAccountPlaylists] = useState<PlaylistSummary[]>([]);
  const [accountPlaylistsLoading, setAccountPlaylistsLoading] = useState(false);
  const [playlistSort, setPlaylistSort] = useState<"updated" | "count" | "name">("updated");
  const [appPlaylists, setAppPlaylists] = useState<AppPlaylist[]>(loadAppPlaylists);
  const appPlaylistsRef = useRef(appPlaylists);
  const [activeAppPlaylistId, setActiveAppPlaylistId] = useState<string | null>(null);
  const [songActionTarget, setSongActionTarget] = useState<Song | null>(null);
  const [studioProject, setStudioProject] = useState<StudioProject | null>(null);
  const studioPlayerUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (studioPlayerUrlRef.current) URL.revokeObjectURL(studioPlayerUrlRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadNativeAppPlaylists()
      .then(async (native) => {
        if (cancelled) return;
        if (native.exists) {
          appPlaylistsRef.current = native.playlists;
          setAppPlaylists(native.playlists);
          return;
        }
        const legacy = appPlaylistsRef.current;
        if (legacy.length > 0) await persistAppPlaylists(legacy);
      })
      .catch((error) => console.warn("[playlists] native persistence unavailable", error));
    return () => {
      cancelled = true;
    };
  }, []);

  // hide the hint after 6s
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const handleMotionLevelChange = (level: MotionLevel) => {
    setMotionLevel(level);
    saveMotionLevel(level);
  };

  const activeRaw: Song | undefined = index >= 0 ? queue[index] : undefined;

  // adapt runtime-resolved data -> UI Song.
  // Prefer store cover, but fall back to the track's own pic so multi-source
  // switches never keep the previous song's art while resolve is in flight.
  const activePlayerSong: PlayerSong | undefined = useMemo(() => {
    if (!activeRaw) return undefined;
    const coverUrl = cover || activeRaw.pic;
    return toPlayerSong(activeRaw, coverUrl, lyrics, accent, duration);
  }, [activeRaw, cover, lyrics, accent, duration]);

  useEffect(() => {
    void (async () => {
      try {
        const st = await getMultiAuthStatus();
        setMultiAuth(st);
        // Hard gate: must sign in to at least one platform (no guest mode).
        if (!st.anyLoggedIn) setLoginOpen(true);
      } catch {
        setMultiAuth(emptyMultiAuth());
        setLoginOpen(true);
      }
    })();
  }, []);

  /** Prevent overlapping QQ startup queue loads. */
  const qqDefaultQueueLoadingRef = useRef(false);

  const refreshAccountPlaylists = useCallback(async (uid = loginStatus?.uid) => {
    setAccountPlaylistsLoading(true);
    try {
      const tasks: Array<Promise<PlaylistSummary[]>> = [];
      if (uid) {
        tasks.push(
          getUserPlaylists(uid, 200, 0).then((items) =>
            items
              .filter((playlist) => playlist.createdByAccount)
              .map((playlist) => ({ ...playlist, source: "netease" as const })),
          ),
        );
      }
      if (multiAuth?.qq.logged_in) tasks.push(getQqUserPlaylists());
      if (multiAuth?.kugou.logged_in) tasks.push(getKugouUserPlaylists());
      const settled = await Promise.allSettled(tasks);
      setAccountPlaylists(
        settled.flatMap((result) =>
          result.status === "fulfilled" ? result.value : [],
        ),
      );
    } catch {
      setAccountPlaylists([]);
    } finally {
      setAccountPlaylistsLoading(false);
    }
  }, [loginStatus?.uid, multiAuth?.qq.logged_in, multiAuth?.kugou.logged_in]);

  useEffect(() => {
    const hasNetease = Boolean(loginStatus?.logged_in && loginStatus.uid);
    const hasQq = Boolean(multiAuth?.qq.logged_in);
    const hasKugou = Boolean(multiAuth?.kugou.logged_in);
    if (!hasNetease && !hasQq && !hasKugou) {
      setAccountPlaylists([]);
      return;
    }
    void refreshAccountPlaylists(loginStatus?.uid);
  }, [
    loginStatus?.logged_in,
    loginStatus?.uid,
    multiAuth?.qq.logged_in,
    multiAuth?.kugou.logged_in,
    refreshAccountPlaylists,
  ]);

  // QQ-only startup: prime the player with the first track from "我喜欢".
  // This mirrors the NetEase startup behavior but deliberately does not autoplay.
  useEffect(() => {
    const onlyQq = Boolean(
      multiAuth?.qq.logged_in &&
        !multiAuth.netease.logged_in &&
        !multiAuth.kugou.logged_in
    );
    if (!onlyQq) {
      qqDefaultQueueLoadingRef.current = false;
      return;
    }
    if (queue.length > 0 || accountPlaylistsLoading || qqDefaultQueueLoadingRef.current) {
      return;
    }

    const favorites = pickQqFavoritesPlaylist(accountPlaylists);
    if (!favorites) return;

    qqDefaultQueueLoadingRef.current = true;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const disstid =
      favorites.qqDissTid && favorites.qqDissTid > 0
        ? favorites.qqDissTid
        : favorites.id;

    const tryLoad = async (attempt: number) => {
      try {
        const page = await getAllQqPlaylistSongs(disstid, { pagesize: 50 });
        if (cancelled || usePlayerStore.getState().queue.length > 0) return;
        if (page.songs.length === 0) throw new Error("QQ 我喜欢歌单为空");

        const first = page.songs[0];
        const total = page.total || page.songs.length;
        usePlayerStore.setState({
          queue: page.songs,
          queueSource: "favorites",
          activePlaylistId: favorites.id,
          index: 0,
          isPlaying: false,
          loading: false,
          currentTime: 0,
          duration: 0,
          currentCover: first.pic,
          lyrics: [],
          lyricSourceLabel: null,
          accent: null,
          error: null,
          playlistTotal: total,
          playlistLoaded: page.songs.length,
          playlistLoadingMore: false,
          favTotal: total,
          favLoaded: page.songs.length,
          favLoadingMore: false,
          favSongIds: page.songs.map((song) => String(song.id)),
          shuffleHistory: [],
          shuffleFuture: [],
          browseList: [],
          browsePlaylistId: null,
          browseSource: null,
          browseTotal: 0,
          browseLoaded: 0,
          browseLoadingMore: false,
        });
      } catch (error) {
        if (!cancelled && attempt < 2) {
          retryTimer = setTimeout(() => void tryLoad(attempt + 1), 1500 * (attempt + 1));
          return;
        }
        qqDefaultQueueLoadingRef.current = false;
        console.warn("[playlists] QQ default favorites load failed", error);
      }
    };

    void tryLoad(0);
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [
    accountPlaylists,
    accountPlaylistsLoading,
    multiAuth?.kugou.logged_in,
    multiAuth?.netease.logged_in,
    multiAuth?.qq.logged_in,
    queue.length,
  ]);

  // on startup: default the queue to the user's "My Favorites" playlist.
  // If it fails (API not ready yet / network), retry a couple times with delay
  // — the Netease_url service may still be starting up when the app launches.
  useEffect(() => {
    if (!loginStatus?.logged_in) return;
    if (!getFavPlaylistId()) setFavPlaylistId(DEFAULT_FAV_PLAYLIST_ID);
    let cancelled = false;
    const tryLoad = async (attempt: number) => {
      if (cancelled) return;
      await loadFavPlaylist();
      if (cancelled) return;
      // if still empty/error after load, retry (up to 3x, with backoff)
      const stillEmpty = usePlayerStore.getState().queue.length === 0;
      if (stillEmpty && attempt < 3) {
        setTimeout(() => void tryLoad(attempt + 1), 2000 * (attempt + 1));
      }
    };
    void tryLoad(0);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginStatus?.logged_in]);

  // keyboard: space play/pause, arrows seek/skip, / search, q queue, p playlists
  useEffect(() => {
    // Only the visible mode owns keyboard shortcuts. The studio has its own
    // transport and must not restart or seek the background catalog player.
    if (studioOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;

      if (e.key === " ") {
        e.preventDefault();
        if (e.repeat) return;
        toggle();
      } else if (e.key === "ArrowRight" && mod) {
        e.preventDefault();
        void next();
      } else if (e.key === "ArrowLeft" && mod) {
        e.preventDefault();
        prev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(usePlayerStore.getState().currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(Math.max(0, usePlayerStore.getState().currentTime - 5));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setVolume(Math.min(1, volume + 0.05));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setVolume(Math.max(0, volume - 0.05));
      } else if (e.key === "/") {
        e.preventDefault();
        setShowHint(false);
        setSearchOpen(true);
      } else if (e.key === "q" || e.key === "Q") {
        setShowHint(false);
        setPlaylistsOpen(false);
        setQueueOpen((v) => !v);
      } else if (e.key === "p" || e.key === "P") {
        setShowHint(false);
        setQueueOpen(false);
        setPlaylistsOpen((v) => !v);
      } else if (e.key === "l" || e.key === "L") {
        setShowHint(false);
        setLoginOpen(true);
      } else if ((e.key === "," || e.key === "，") && mod) {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setQueueOpen(false);
        setPlaylistsOpen(false);
        setSettingsOpen(false);
        // Login is a hard gate until at least one platform is signed in.
        if (multiAuth?.anyLoggedIn) setLoginOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [studioOpen, toggle, next, prev, seek, volume, setVolume, multiAuth?.anyLoggedIn]);

  const handleReloadFavorites = async () => {
    await loadFavPlaylist();
    await refreshAccountPlaylists();
  };

  const handleSelectFromQueue = useCallback((i: number) => {
    if (queue[i]) void playSong(queue[i]);
  }, [playSong, queue]);

  const commitAppPlaylists = useCallback((next: AppPlaylist[]) => {
    appPlaylistsRef.current = next;
    setAppPlaylists(next);
    void persistAppPlaylists(next).catch((error) => {
      console.warn("[playlists] save failed", error);
      toast("自建歌单保存失败，已保留本地恢复副本", { tone: "warning" });
    });
  }, []);

  const handleCreateAppPlaylist = useCallback((name: string) => {
    const result = createAppPlaylist(appPlaylistsRef.current, name);
    if (!result.playlist) return;
    commitAppPlaylists(result.playlists);
    setActiveAppPlaylistId(result.playlist.id);
    toast(`已创建歌单「${result.playlist.name}」`, { tone: "success" });
  }, [commitAppPlaylists]);

  const handleRenameAppPlaylist = useCallback((id: string, name: string) => {
    commitAppPlaylists(renameAppPlaylist(appPlaylistsRef.current, id, name));
  }, [commitAppPlaylists]);

  const handleDeleteAppPlaylist = useCallback((id: string) => {
    const deleted = appPlaylistsRef.current.find((playlist) => playlist.id === id);
    commitAppPlaylists(deleteAppPlaylist(appPlaylistsRef.current, id));
    if (deleted) toast(`已删除歌单「${deleted.name}」`, { tone: "success" });
    setActiveAppPlaylistId((current) => (current === id ? null : current));
  }, [commitAppPlaylists]);

  const handleAddSongToAppPlaylist = useCallback((id: string, song: Song) => {
    const current = appPlaylistsRef.current;
    const result = addSongToAppPlaylist(current, id, song);
    const playlist = current.find((item) => item.id === id);
    if (result.added) {
      commitAppPlaylists(result.playlists);
      toast(`已添加到「${playlist?.name ?? "自建歌单"}」`, { tone: "success" });
    } else {
      toast(`「${song.name}」已在该歌单中`, { tone: "warning" });
    }
  }, [commitAppPlaylists]);

  const handleCreateAppPlaylistWithSong = useCallback((name: string, song: Song) => {
    const created = createAppPlaylist(appPlaylistsRef.current, name);
    if (!created.playlist) return;
    const result = addSongToAppPlaylist(created.playlists, created.playlist.id, song);
    commitAppPlaylists(result.playlists);
    setActiveAppPlaylistId(created.playlist.id);
    toast(`已创建「${created.playlist.name}」并添加歌曲`, { tone: "success" });
  }, [commitAppPlaylists]);

  const handleRemoveAppPlaylistSong = useCallback((id: string, itemIndex: number) => {
    commitAppPlaylists(removeSongFromAppPlaylist(appPlaylistsRef.current, id, itemIndex));
  }, [commitAppPlaylists]);

  const handleMoveAppPlaylistSong = useCallback((id: string, from: number, to: number) => {
    commitAppPlaylists(moveSongInAppPlaylist(appPlaylistsRef.current, id, from, to));
  }, [commitAppPlaylists]);

  const handleOpenAppPlaylist = useCallback((id: string) => {
    setActiveAppPlaylistId(id);
  }, []);

  const handlePlayFromAppPlaylist = useCallback((playlist: AppPlaylist, song: Song) => {
    void playSong(song, playlist.songs);
  }, [playSong]);

  const handlePlayNext = useCallback((song: Song) => {
    playNext(song);
    toast(`已将「${song.name}」设为下一首`, { tone: "success" });
  }, [playNext]);

  /** All platforms share the store's request generation and browse state. */
  const handleBrowsePlaylist = useCallback(
    (playlist: PlaylistSummary) => { void browsePlaylist(playlist); },
    [browsePlaylist],
  );

  /** Play a song from the browse list: commit its playlist as the live queue
   *  (so next/prev/shuffle operate over the whole playlist) then play the
   *  picked song. Reuses already-fetched songs — no refetch. */
  const handlePlayFromBrowse = useCallback((song: Song) => {
    const pid = browsePlaylistId;
    const songs = browseList.length > 0 ? browseList.slice() : [song];
    if (pid == null) {
      // no playlist context — just play the single song
      void playSong(song, [song]);
      clearBrowse();
      return;
    }
    const source = String(pid) === String(getFavPlaylistId()) ? "favorites" : "playlist";
    void playFromPlaylist(pid, songs, song, source, browseTotal);
  }, [browseList, browsePlaylistId, browseTotal, clearBrowse, playFromPlaylist, playSong]);

  const handleCloseCollection = useCallback(() => {
    setQueueOpen(false);
    setPlaylistsOpen(false);
  }, []);

  const handleRefreshPlaylists = useCallback(() => {
    void refreshAccountPlaylists();
  }, [refreshAccountPlaylists]);

  const handleBackgroundBlurChange = (value: number) => {
    const nextValue = Math.min(60, Math.max(0, Math.round(value)));
    setBackgroundBlur(nextValue);
    saveBackgroundBlur(nextValue);
  };

  const handleBackgroundOpacityChange = (value: number) => {
    const nextValue = Math.min(100, Math.max(0, Math.round(value)));
    setBackgroundOpacity(nextValue);
    saveBackgroundOpacity(nextValue);
  };

  const handleLyricMotionStyleChange = (value: LyricMotionStyle) => {
    setLyricMotionStyle(value);
    saveLyricMotionStyle(value);
  };

  const handleLyricOffsetChange = (value: number) => {
    const nextValue = Math.round(Math.min(5, Math.max(-5, value)) * 10) / 10;
    setLyricOffsetSeconds(nextValue);
    saveLyricOffsetSeconds(nextValue);
  };

  const handleUseCoverBackgroundChange = (value: boolean) => {
    setUseCoverBackground(value);
    saveUseCoverBackground(value);
  };

  const handleShowTranslationChange = (value: boolean) => {
    setShowTranslation(value);
    saveShowTranslation(value);
  };

  // empty-state placeholder song so the UI renders before any track loads
  const emptySong: PlayerSong = useMemo(
    () => ({
      id: "empty",
      title: "SEARCH A SONG",
      artist: "按 / 开始搜索",
      coverUrl: "",
      backgroundUrl: "",
      duration: 1,
      badge: "Lossless",
      lyrics: [{ time: 0, text: "搜索一首歌开始播放" }],
      themeColor: "rgba(99, 102, 241, 0.25)",
      textColor: "text-white",
    }),
    []
  );

  const shown = activePlayerSong ?? emptySong;

  const openStudioForSong = useCallback(async (song: Song | undefined) => {
    if (!song) {
      toast("请先播放或选择一首歌曲", { tone: "error" });
      return;
    }
    // A rendered studio mix already has a complete project behind it. Reopen
    // that project directly instead of trying to send its blob URL through
    // the remote stem downloader.
    if (song.localAudioUrl && studioProject) {
      setStudioProject(studioProject);
      setStudioOpen(true);
      getAudio().pause();
      setSearchOpen(false);
      setQueueOpen(false);
      setPlaylistsOpen(false);
      setSettingsOpen(false);
      return;
    }
    const isPlaceholder = (value: string | undefined, fallback: string) => {
      const text = value?.trim();
      return !text || text === "未知歌曲" || text === "未知歌手" ? fallback : text;
    };
    const firstMeaningful = (...values: Array<string | undefined>) =>
      values.map((value) => value?.trim()).find(
        (value) => value && value !== "未知歌曲" && value !== "未知歌手",
      );
    let projectSong = song;
    // Entering the studio can race the player's background metadata request.
    // Hydrate a NetEase track once more so the project never freezes a
    // temporary "未知歌曲/未知歌手" label while lyrics are already available.
    if (isPlaceholder(song.name, "") === "" || isPlaceholder(song.artist, "") === "") {
      try {
        const source = song.source ?? "netease";
        const metadata = source === "netease"
          ? await getSongMetadata(song.id)
          : (await resolvePlayback(song, level)).meta;
        if (metadata) {
          projectSong = {
            ...song,
            name: isPlaceholder(metadata.name, song.name),
            artist: isPlaceholder(metadata.ar_name, song.artist),
            album: isPlaceholder(metadata.al_name, song.album ?? "") || song.album,
            pic: song.pic ?? metadata.pic,
          };
        }
      } catch {
        // Keep the catalog fields if the detail refresh is temporarily unavailable.
      }
    }
    // Do not use the UI placeholder as a fallback: a project created while
    // playback metadata is still loading must never permanently save it.
    const title = firstMeaningful(projectSong.name, shown.title) ?? "未命名歌曲";
    const artist = firstMeaningful(projectSong.artist, shown.artist) ?? "未知歌手";
    const coverUrl = projectSong.pic ?? (projectSong === activeRaw ? cover : undefined) ?? "";
    const nextProject = createStudioProject({
      songId: String(projectSong.id),
      source: projectSong.source ?? "netease",
      title,
      artist,
      album: projectSong.album,
      coverUrl,
      durationSec: projectSong === activeRaw ? shown.duration : Math.max(0, (projectSong.duration ?? 0) / 1000),
      lyrics: projectSong === activeRaw ? lyrics : [],
    });
    setStudioProject(nextProject);
    setStudioOpen(true);
    getAudio().pause();
    setSearchOpen(false);
    setQueueOpen(false);
    setPlaylistsOpen(false);
    setSettingsOpen(false);
  }, [activeRaw, cover, level, lyrics, shown.artist, shown.duration, shown.title, studioProject]);

  const playStudioMixInPlayer = useCallback(async (audioUrl: string, project: StudioProject) => {
    if (studioPlayerUrlRef.current) URL.revokeObjectURL(studioPlayerUrlRef.current);
    studioPlayerUrlRef.current = audioUrl;
    const localSong: Song = {
      // Keep this queue entry distinct from the catalog song so the player
      // cannot silently resolve the original stream after the handoff.
      id: -Date.now(),
      name: project.title,
      artist: project.artist,
      album: project.album ?? "翻唱工作室",
      pic: project.coverUrl || undefined,
      duration: Math.max(0, Math.round(getProjectDuration(project) * 1000)),
      source: project.source,
      localAudioUrl: audioUrl,
      localLyrics: project.lyrics,
    };
    await playSong(localSong, [localSong]);
    setStudioProject(project);
    setStudioOpen(false);
  }, [playSong]);

  const handleAuthChange = (status: MultiAuthStatus) => {
    setMultiAuth(status);
    // Do not close the scanner after the first successful platform login: the
    // same panel is also the entry point for adding a second/third account.
    // The user leaves explicitly via “进入播放器”.
    if (!status.anyLoggedIn) setLoginOpen(true);
  };

  const handleLoggedIn = (_status: LoginStatus) => {
    void getMultiAuthStatus().then((status) => {
      setMultiAuth(status);
      if (!status.anyLoggedIn) setLoginOpen(true);
    });
  };

  const clearNeteasePlaybackState = () => {
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    usePlayerStore.setState({
      queue: [],
      queueSource: "custom",
      activePlaylistId: null,
      favSongIds: [],
      playlistTotal: 0,
      playlistLoaded: 0,
      playlistLoadingMore: false,
      index: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      currentCover: undefined,
      lyrics: [],
      accent: null,
      error: null,
    });
    setAccountPlaylists([]);
  };

  const handleLogoutPlatform = async (platform: AuthPlatform) => {
    const current = multiAuth ?? emptyMultiAuth();
    const wiped = { platform, logged_in: false as const };
    const next: MultiAuthStatus = {
      ...current,
      netease: platform === "netease" ? wiped : current.netease,
      qq: platform === "qq" ? wiped : current.qq,
      kugou: platform === "kugou" ? wiped : current.kugou,
      anyLoggedIn: false,
    };
    next.anyLoggedIn = next.netease.logged_in || next.qq.logged_in || next.kugou.logged_in;

    // Update the gate before touching disk; native logout itself is local-only.
    setMultiAuth(next);
    if (platform === "netease" || !next.anyLoggedIn) clearNeteasePlaybackState();
    if (!next.anyLoggedIn) {
      setSettingsOpen(false);
      setLoginPlatform(platform);
      setLoginOpen(true);
    }

    try {
      await logoutPlatform(platform);
    } catch {
      toast(`${AUTH_PLATFORM_LABEL[platform]}退出失败，请重试`, { tone: "error" });
      const refreshed = await getMultiAuthStatus().catch(() => current);
      setMultiAuth(refreshed);
      setLoginOpen(!refreshed.anyLoggedIn);
    }
  };

  const handleLogoutAll = async () => {
    setMultiAuth(emptyMultiAuth());
    clearNeteasePlaybackState();
    setSettingsOpen(false);
    setStudioOpen(false);
    setStudioProject(null);
    setQueueOpen(false);
    setSearchOpen(false);
    setPlaylistsOpen(false);
    setSongActionTarget(null);
    setLoginPlatform("netease");
    setLoginOpen(true);
    try {
      await logoutAll();
    } catch {
      toast("退出账号失败，请重试", { tone: "error" });
    }
  };

  if (multiAuth === null) {
    return (
      <div className="app-window-frame app-liquid-page relative w-screen h-screen overflow-hidden font-sans">
        {/* Bootstrapping login status — still allow window drag + chrome */}
        <div
          data-tauri-drag-region
          className="app-liquid-bar absolute inset-x-0 top-0 z-20 flex h-16 items-center justify-end border-b px-4"
        >
          <div className="flex items-center gap-1 no-drag">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void minimizeWindow()}
              className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="最小化窗口"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => void closeWindow()}
              className="grid h-8 w-8 place-items-center rounded-full text-white/55 transition-colors hover:bg-red-500/80 hover:text-white"
              aria-label="关闭窗口"
            >
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="grid h-full place-items-center text-sm text-white/40">正在检查登录状态…</div>
      </div>
    );
  }

  // Hard authentication boundary: the player tree is not mounted at all until
  // at least one platform session is present. This prevents keyboard shortcuts,
  // panel closing, or overlay races from exposing a guest player.
  if (!multiAuth.anyLoggedIn) {
    return (
      <div className="app-window-frame relative h-screen w-screen overflow-hidden font-sans">
        <ToastHost />
        <Suspense
          fallback={
            <div className="grid h-full place-items-center text-sm text-white/45">
              正在打开登录面板…
            </div>
          }
        >
          <LoginPanel
            open
            onClose={() => {}}
            onLoggedIn={handleLoggedIn}
            onAuthChange={handleAuthChange}
            closable={false}
            initialPlatform={loginPlatform}
          />
        </Suspense>
      </div>
    );
  }

  return (
    <div className="app-window-frame relative w-screen h-screen overflow-hidden font-sans">
      <ToastHost />
      <AnimatePresence>
        {showHint && !searchOpen && !queueOpen && !playlistsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 text-white/30 text-[11px] font-medium tracking-wide select-none pointer-events-none"
          >
            <span className="font-mono bg-white/10 rounded px-1 py-0.5 mr-1.5">/</span>
            搜索
            <span className="font-mono bg-white/10 rounded px-1 py-0.5 ml-3 mr-1.5">q</span>
            队列
            <span className="font-mono bg-white/10 rounded px-1 py-0.5 ml-3 mr-1.5">p</span>
            歌单
            <span className="font-mono bg-white/10 rounded px-1 py-0.5 ml-3 mr-1.5">l</span>
            登录
          </motion.div>
        )}
      </AnimatePresence>

      {multiAuth.anyLoggedIn && !studioOpen && <NavigationRail
        searchOpen={searchOpen}
        playlistsOpen={playlistsOpen}
        settingsOpen={settingsOpen}
        onOpenSearch={() => {
          setQueueOpen(false);
          setPlaylistsOpen(false);
          setSettingsOpen(false);
          setSearchOpen((value) => !value);
        }}
        onTogglePlaylists={() => {
          setSearchOpen(false);
          setQueueOpen(false);
          setSettingsOpen(false);
          setPlaylistsOpen((value) => !value);
        }}
        onOpenSettings={() => {
          setSearchOpen(false);
          setQueueOpen(false);
          setPlaylistsOpen(false);
          setSettingsOpen((value) => !value);
        }}
      />}

      <div className="relative z-10 w-full h-full">
        {studioOpen && studioProject ? (
          <StudioWorkspace
            key={studioProject.id}
            project={studioProject}
            onBack={(updatedProject) => { if (updatedProject) setStudioProject(updatedProject); setStudioOpen(false); }}
            onPlayInPlayer={playStudioMixInPlayer}
          />
        ) : (
          <GlassPlayer
            song={shown}
            isPlaying={isPlaying}
            onPlayPause={toggle}
            onNext={() => void next()}
            onPrev={prev}
            onOpenQueue={() => {
              setSearchOpen(false);
              setPlaylistsOpen(false);
              setSettingsOpen(false);
              setQueueOpen(true);
            }}
            onOpenStudio={() => openStudioForSong(activeRaw)}
            onSeek={seek}
            layout={layout}
            onToggleLayout={setLayout}
            lyricOffsetSeconds={lyricOffsetSeconds}
            onLyricOffsetChange={handleLyricOffsetChange}
            volume={volume}
            onVolumeChange={setVolume}
            onOpenSettings={() => setSettingsOpen(true)}
            onReloadFavorites={handleReloadFavorites}
            backgroundBlur={backgroundBlur}
            backgroundOpacity={backgroundOpacity}
            lyricMotionStyle={lyricMotionStyle}
            onLyricMotionStyleChange={handleLyricMotionStyleChange}
            lyricSourceMode={lyricSourceMode}
            onLyricSourceModeChange={(mode) => {
              setLyricSourceMode(mode);
              saveLyricSourceMode(mode);
            }}
            level={level}
            onLevelChange={setLevel}
            speed={speed}
            onSpeedChange={setSpeed}
            useCoverBackground={useCoverBackground}
            showTranslation={showTranslation}
            onToggleTranslation={() => handleShowTranslationChange(!showTranslation)}
            onMinimize={() => void minimizeWindow()}
            onClose={() => void closeWindow()}
            playMode={playMode}
            onCyclePlayMode={cyclePlayMode}
            motionLevel={motionLevel}
            suspendVisuals={
              queueOpen || playlistsOpen || searchOpen || settingsOpen || loginOpen
            }
          />
        )}
      </div>

      <CollectionDrawer
        open={queueOpen || playlistsOpen}
        mode={playlistsOpen ? "playlists" : "queue"}
        onClose={handleCloseCollection}
        queue={queue}
        activeIndex={index}
        onSelect={handleSelectFromQueue}
        onRemoveQueueItem={(itemIndex) => void removeQueueItem(itemIndex)}
        onMoveQueueItem={moveQueueItem}
        onClearQueue={clearQueue}
        onOpenSongActions={setSongActionTarget}
        browseList={browseList}
        browsePlaylistId={browsePlaylistId}
        browseTotal={browseTotal}
        browseLoaded={browseLoaded}
        browseLoadingMore={browseLoadingMore}
        onPlayFromBrowse={handlePlayFromBrowse}
        playlistLoaded={playlistLoaded}
        playlistTotal={playlistTotal}
        playlistLoadingMore={playlistLoadingMore}
        playlists={accountPlaylists}
        playlistsLoading={accountPlaylistsLoading}
        playlistSort={playlistSort}
        onPlaylistSortChange={setPlaylistSort}
        activePlaylistId={activePlaylistId}
        onRefreshPlaylists={handleRefreshPlaylists}
        onBrowsePlaylist={handleBrowsePlaylist}
        appPlaylists={appPlaylists}
        activeAppPlaylistId={activeAppPlaylistId}
        onOpenAppPlaylist={handleOpenAppPlaylist}
        onCreateAppPlaylist={handleCreateAppPlaylist}
        onRenameAppPlaylist={handleRenameAppPlaylist}
        onDeleteAppPlaylist={handleDeleteAppPlaylist}
        onRemoveAppPlaylistSong={handleRemoveAppPlaylistSong}
        onMoveAppPlaylistSong={handleMoveAppPlaylistSong}
        onPlayFromAppPlaylist={handlePlayFromAppPlaylist}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onOpenSongActions={setSongActionTarget}
        onPick={async (s) => {
          await playSong(s, []);
          setSearchOpen(false);
        }}
      />

      <SongActionDialog
        song={songActionTarget}
        appPlaylists={appPlaylists}
        onClose={() => setSongActionTarget(null)}
        onPlayNext={handlePlayNext}
        onAddToPlaylist={handleAddSongToAppPlaylist}
        onCreatePlaylistWithSong={handleCreateAppPlaylistWithSong}
        onOpenStudio={(song) => openStudioForSong(song)}
      />

      <Suspense fallback={null}>
        {loginOpen && (
          <LoginPanel
            open
            onClose={() => {
              // Only allow leaving login after at least one platform is signed in.
              if (multiAuth?.anyLoggedIn) setLoginOpen(false);
            }}
            onLoggedIn={handleLoggedIn}
            onAuthChange={handleAuthChange}
            closable={Boolean(multiAuth?.anyLoggedIn)}
            initialPlatform={loginPlatform}
          />
        )}
      </Suspense>

      <SettingsPanel
        open={settingsOpen}
        desktopBlur={desktopBlur}
        onClose={() => setSettingsOpen(false)}
        multiAuth={multiAuth}
        onLogoutPlatform={handleLogoutPlatform}
        onLogoutAll={handleLogoutAll}
        onOpenLogin={(p) => {
          setLoginPlatform(p);
          setSettingsOpen(false);
          setLoginOpen(true);
        }}
        backgroundBlur={backgroundBlur}
        onBackgroundBlurChange={handleBackgroundBlurChange}
        hasBackgroundCover={Boolean(shown.backgroundUrl || shown.coverUrl)}
        backgroundOpacity={backgroundOpacity}
        onBackgroundOpacityChange={handleBackgroundOpacityChange}
        useCoverBackground={useCoverBackground}
        onUseCoverBackgroundChange={handleUseCoverBackgroundChange}
        motionLevel={motionLevel}
        onMotionLevelChange={handleMotionLevelChange}
      />
    </div>
  );
}

function SettingsPanel({
  open,
  desktopBlur,
  onClose,
  multiAuth,
  onLogoutPlatform,
  onLogoutAll,
  onOpenLogin,
  backgroundBlur,
  onBackgroundBlurChange,
  hasBackgroundCover,
  backgroundOpacity,
  onBackgroundOpacityChange,
  useCoverBackground,
  onUseCoverBackgroundChange,
  motionLevel,
  onMotionLevelChange,
}: {
  open: boolean;
  desktopBlur: ReturnType<typeof useDesktopBlur>;
  onClose: () => void;
  multiAuth: MultiAuthStatus;
  onLogoutPlatform: (p: AuthPlatform) => void | Promise<void>;
  onLogoutAll: () => void | Promise<void>;
  onOpenLogin: (p: AuthPlatform) => void;
  backgroundBlur: number;
  onBackgroundBlurChange: (value: number) => void;
  hasBackgroundCover: boolean;
  backgroundOpacity: number;
  onBackgroundOpacityChange: (value: number) => void;
  useCoverBackground: boolean;
  onUseCoverBackgroundChange: (value: boolean) => void;
  motionLevel: MotionLevel;
  onMotionLevelChange: (value: MotionLevel) => void;
}) {
  /** Confirm before destructive logout */
  const [logoutConfirm, setLogoutConfirm] = useState<
    null | { kind: "all" } | { kind: "platform"; platform: AuthPlatform }
  >(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLogoutConfirm(null);
    setLogoutBusy(false);
  }, [open]);

  const runConfirmedLogout = async () => {
    if (!logoutConfirm || logoutBusy) return;
    setLogoutBusy(true);
    try {
      if (logoutConfirm.kind === "all") {
        await onLogoutAll();
      } else {
        await onLogoutPlatform(logoutConfirm.platform);
      }
    } finally {
      setLogoutBusy(false);
      setLogoutConfirm(null);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.section
          initial={{ x: 30, opacity: 0, scale: 0.99 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: 22, opacity: 0, scale: 0.99 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.72 }}
          style={{ contain: "layout paint" }}
          className="context-panel context-panel--tab-page player-liquid-glass settings-player-page absolute z-50 flex flex-col text-white overflow-hidden"
        >
            <header
              data-tauri-drag-region
              className="context-panel-layer player-liquid-content settings-player-header h-16 px-7 flex items-center justify-between border-b border-white/6 shrink-0"
              style={{ ["--context-layer" as string]: 0 }}
            >
              <div className="flex items-center gap-2.5 font-bold tracking-wide text-white/85">
                <span className="settings-player-title-orb grid h-9 w-9 place-items-center rounded-full text-white/85">
                  <Settings size={16} />
                </span>
                <div>
                  <p className="text-sm font-black tracking-wide text-white/90">设置</p>
                  <p className="mt-0.5 text-[9px] font-bold tracking-[0.18em] text-white/30">
                    COVE · 可沃
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} />
              </button>
            </header>

            <div
              className="context-panel-layer player-liquid-content settings-player-grid flex-1 min-h-0 grid grid-cols-[minmax(280px,0.88fr)_minmax(330px,1.12fr)] gap-4 p-5 pt-4 no-drag"
              style={{ contain: "layout paint", overscrollBehavior: "contain", ["--context-layer" as string]: 1 }}
            >
              <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
              <section className="settings-player-section rounded-[22px] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="settings-player-title-orb mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/75">
                      <UserRound size={15} strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white/85">账号</p>
                      <p className="mt-1 text-xs text-white/45">三平台独立登录，可同时保持会话</p>
                    </div>
                  </div>
                  {multiAuth.anyLoggedIn && (
                    <button
                      type="button"
                      disabled={logoutBusy}
                      onClick={() => setLogoutConfirm({ kind: "all" })}
                      className="h-8 min-w-[88px] shrink-0 whitespace-nowrap px-2.5 rounded-full bg-red-500/15 hover:bg-red-500/22 border border-red-300/15 text-[11px] font-semibold text-red-100 transition-colors inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <LogOut size={12} className="shrink-0" />
                      全部退出
                    </button>
                  )}
                </div>
                {(
                  [
                    ["netease", multiAuth.netease, "/brands/netease.png?v=2"],
                    ["qq", multiAuth.qq, "/brands/qq.png?v=2"],
                    ["kugou", multiAuth.kugou, "/brands/kugou.png?v=3"],
                  ] as const
                ).map(([key, st, logo]) => (
                  <div
                    key={key}
                    className="settings-player-row flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <img
                        src={logo}
                        alt=""
                        className="h-8 w-8 shrink-0 rounded-[22%] object-cover ring-1 ring-white/10"
                        draggable={false}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white/80">{AUTH_PLATFORM_LABEL[key]}</p>
                        <p className="mt-0.5 truncate text-[11px] text-white/40">
                          {st.logged_in
                            ? st.nickname || st.uid || "已登录"
                            : "未登录"}
                        </p>
                      </div>
                    </div>
                    {st.logged_in ? (
                      <button
                        type="button"
                        disabled={logoutBusy}
                        onClick={() => setLogoutConfirm({ kind: "platform", platform: key })}
                        className="h-8 shrink-0 rounded-full border border-white/10 bg-white/8 px-3 text-[11px] font-semibold text-white/75 hover:bg-white/14 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <LogOut size={12} />
                        退出
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={logoutBusy}
                        onClick={() => onOpenLogin(key)}
                        className="h-8 shrink-0 rounded-full bg-white px-3 text-[11px] font-bold text-slate-950 inline-flex items-center gap-1.5 disabled:opacity-50"
                      >
                        <LogIn size={12} />
                        登录
                      </button>
                    )}
                  </div>
                ))}
              </section>

              <p className="flex items-start gap-2 text-[11px] leading-relaxed text-white/35 px-1">
                <ListMusic size={13} className="mt-0.5 shrink-0 text-white/30" />
                <span>
                  音质、倍速在播放页进度条下方调节；歌词动画与来源在歌词面板顶部悬停时调节。
                </span>
              </p>

              </div>

              <div className="min-h-0 space-y-4 overflow-y-auto pl-1">
              <section className="settings-player-section rounded-[22px] p-4 space-y-4">
                <div className="flex items-center gap-2.5 pb-0.5">
                  <span className="settings-player-title-orb grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/75">
                    <ImageIcon size={15} strokeWidth={2} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/85">外观</p>
                    <p className="mt-0.5 text-xs text-white/45">桌面毛玻璃与歌曲封面背景</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/85">桌面背景模糊</p>
                    <p className="mt-1 text-xs text-white/45">仅模糊透过 Cove 窗口看到的背景，不修改桌面壁纸</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-label="桌面背景模糊"
                    aria-checked={desktopBlur.enabled}
                    disabled={desktopBlur.busy}
                    onClick={() => desktopBlur.apply(!desktopBlur.enabled)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${desktopBlur.enabled ? "bg-white/85" : "bg-white/15"}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform ${desktopBlur.enabled ? "translate-x-[20px] bg-slate-950" : "bg-white"}`} />
                  </button>
                </div>
                <p className="text-xs text-white/45">拖动或调整窗口时暂停毛玻璃和播放画面更新，音乐继续播放，松开后恢复。</p>
                {desktopBlur.error && <p role="alert" className="text-xs text-amber-200">{desktopBlur.error}</p>}

                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="settings-player-inline-icon mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/55">
                      <ImageIcon size={13} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white/85">使用封面背景</p>
                      <p className="mt-1 text-xs text-white/45">将当前歌曲封面铺在播放器背景中</p>
                    </div>
                  </div>
                  <button
                    onClick={() => onUseCoverBackgroundChange(!useCoverBackground)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      useCoverBackground
                        ? "bg-white/85"
                        : "bg-white/15"
                    }`}
                    role="switch"
                    aria-checked={useCoverBackground}
                    aria-label="使用封面背景"
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${
                        useCoverBackground
                          ? "translate-x-[20px] bg-slate-950"
                          : "translate-x-0 bg-white"
                      }`}
                    />
                  </button>
                </div>

                <label className="block">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-white/85">
                      <span className="settings-player-inline-icon grid h-7 w-7 place-items-center rounded-full text-white/55">
                        <Aperture size={13} />
                      </span>
                      封面背景模糊度
                    </span>
                    <span className="font-mono text-xs text-white/45">{backgroundBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={backgroundBlur}
                    aria-label="封面背景模糊度"
                    aria-describedby="cover-blur-hint"
                    disabled={!useCoverBackground || !hasBackgroundCover}
                    onChange={(e) => onBackgroundBlurChange(Number(e.target.value))}
                    className="w-full accent-white disabled:cursor-not-allowed disabled:opacity-35"
                  />
                  <p id="cover-blur-hint" className="mt-1 text-xs text-white/45">
                    {!useCoverBackground
                      ? "开启“使用封面背景”后可调节模糊度"
                      : !hasBackgroundCover
                        ? "当前没有歌曲封面，选择带封面的歌曲后可调节"
                        : "仅影响歌曲封面背景；关闭设置面板后查看效果"}
                  </p>
                </label>

                <label className="block">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="inline-flex items-center gap-2 text-sm font-semibold text-white/85">
                      <span className="settings-player-inline-icon grid h-7 w-7 place-items-center rounded-full text-white/55">
                        <Contrast size={13} />
                      </span>
                      背景不透明度
                    </span>
                    <span className="font-mono text-xs text-white/45">{backgroundOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={backgroundOpacity}
                    onChange={(e) => onBackgroundOpacityChange(Number(e.target.value))}
                    className="w-full accent-white"
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/85">
                    <span className="settings-player-inline-icon grid h-7 w-7 place-items-center rounded-full text-white/55">
                      <Aperture size={13} />
                    </span>
                    动效强度
                  </div>
                  <p className="mb-2 text-xs text-white/45">
                    歌词、按钮与进度反馈动画（受系统「减少动态效果」影响）
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {MOTION_LEVEL_OPTIONS.map(({ value, label, hint }) => (
                      <button
                        key={value}
                        type="button"
                        title={hint}
                        onClick={() => onMotionLevelChange(value)}
                        className={`rounded-full px-3 py-1.5 text-[12px] font-bold transition-colors ${
                          motionLevel === value
                            ? "bg-white text-slate-950"
                            : "bg-white/8 text-white/70 hover:bg-white/12 hover:text-white"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              </div>
            </div>

            {/* Logout confirmation */}
            <AnimatePresence>
              {logoutConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="app-liquid-overlay absolute inset-0 z-[60] flex items-center justify-center p-6"
                  onClick={() => {
                    if (!logoutBusy) setLogoutConfirm(null);
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 380, damping: 28 }}
                    className="app-liquid-popover w-full max-w-[320px] rounded-2xl p-5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-500/15 text-red-200 ring-1 ring-red-300/20">
                        <LogOut size={18} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white/90">
                          {logoutConfirm.kind === "all"
                            ? "确认退出全部账号？"
                            : `确认退出${AUTH_PLATFORM_LABEL[logoutConfirm.platform]}？`}
                        </p>
                        <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">
                          {logoutConfirm.kind === "all"
                            ? "将清除网易云音乐、QQ音乐、酷狗音乐的本地登录状态，需重新扫码。"
                            : "仅退出该平台的本地登录状态，其他平台不受影响。"}
                        </p>
                      </div>
                    </div>
                    <div className="mt-5 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={logoutBusy}
                        onClick={() => setLogoutConfirm(null)}
                        className="h-9 rounded-full px-4 text-[12px] font-semibold text-white/65 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        disabled={logoutBusy}
                        onClick={() => void runConfirmedLogout()}
                        className="inline-flex h-9 items-center gap-1.5 rounded-full bg-red-500/90 px-4 text-[12px] font-bold text-white transition-colors hover:bg-red-500 disabled:opacity-60"
                      >
                        {logoutBusy ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <LogOut size={13} />
                        )}
                        {logoutBusy ? "退出中…" : "确认退出"}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

const NavigationRail = memo(function NavigationRail({
  searchOpen,
  playlistsOpen,
  settingsOpen,
  onOpenSearch,
  onTogglePlaylists,
  onOpenSettings,
}: {
  searchOpen: boolean;
  playlistsOpen: boolean;
  settingsOpen: boolean;
  onOpenSearch: () => void;
  onTogglePlaylists: () => void;
  onOpenSettings: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [lingerVisible, setLingerVisible] = useState(false);
  const [hoverSuppressed, setHoverSuppressed] = useState(false);
  const pointerInsideRef = useRef(false);
  const hideTimerRef = useRef<number | null>(null);
  const anyPageOpen = searchOpen || playlistsOpen || settingsOpen;
  const previousPageOpenRef = useRef(anyPageOpen);
  const visible = anyPageOpen || lingerVisible || (hovered && !hoverSuppressed);

  useEffect(() => {
    const wasOpen = previousPageOpenRef.current;
    previousPageOpenRef.current = anyPageOpen;
    if (hideTimerRef.current != null) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (anyPageOpen) {
      setLingerVisible(false);
      setHoverSuppressed(false);
      return;
    }
    if (!wasOpen) return;
    setLingerVisible(true);
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setLingerVisible(false);
      setHovered(false);
      setHoverSuppressed(pointerInsideRef.current);
    }, 5000);
  }, [anyPageOpen]);

  useEffect(
    () => () => {
      if (hideTimerRef.current != null) clearTimeout(hideTimerRef.current);
    },
    [],
  );
  const items = [
    { label: "搜索", icon: Search, active: searchOpen, action: onOpenSearch },
    { label: "我的歌单", icon: Library, active: playlistsOpen, action: onTogglePlaylists },
    { label: "设置", icon: Settings, active: settingsOpen, action: onOpenSettings },
  ];

  return (
    <aside
      className="fixed right-0 top-1/2 z-[80] flex h-[220px] w-[72px] -translate-y-1/2 items-center justify-end pr-[14px] no-drag"
      onPointerEnter={() => {
        pointerInsideRef.current = true;
        if (!hoverSuppressed) setHovered(true);
      }}
      onPointerLeave={() => {
        pointerInsideRef.current = false;
        setHovered(false);
        setHoverSuppressed(false);
      }}
      onFocus={() => setHovered(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false);
      }}
    >
      <motion.nav
        initial={false}
        animate={{
          x: visible ? 0 : 12,
          scale: visible ? 1 : 0.94,
          opacity: visible ? 1 : 0,
        }}
        transition={{ type: "spring", stiffness: 420, damping: 32, mass: 0.65 }}
        aria-label="主导航"
        tabIndex={visible ? 0 : -1}
        className={`app-liquid-tab-rail flex w-[52px] flex-col gap-1 p-1 text-white outline-none ${
          visible ? "pointer-events-auto" : "pointer-events-none"
        }`}
        role="tablist"
        aria-orientation="vertical"
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-label={item.label}
              aria-selected={item.active}
              tabIndex={visible ? 0 : -1}
              onClick={item.action}
              className={`app-liquid-tab-button group relative grid h-11 w-11 place-items-center rounded-[14px] transition-colors ${
                item.active ? "is-active text-white" : "text-white/65 hover:text-white"
              }`}
            >
              {item.active && (
                <motion.span
                  layoutId="navigation-active-tab"
                  className="app-liquid-tab-active absolute inset-0 rounded-[14px]"
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              )}
              <Icon className="relative z-10" size={17} strokeWidth={item.active ? 2.4 : 2} />
              <span
                className={`app-liquid-tab-label pointer-events-none absolute right-[calc(100%+10px)] whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-bold text-white/85 transition-all group-hover:translate-x-0 group-hover:opacity-100 ${
                  item.active ? "translate-x-0 opacity-100" : "opacity-0"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </motion.nav>
    </aside>
  );
});

function SongActionDialog({
  song,
  appPlaylists,
  onClose,
  onPlayNext,
  onAddToPlaylist,
  onCreatePlaylistWithSong,
  onOpenStudio,
}: {
  song: Song | null;
  appPlaylists: AppPlaylist[];
  onClose: () => void;
  onPlayNext: (song: Song) => void;
  onAddToPlaylist: (id: string, song: Song) => void;
  onCreatePlaylistWithSong: (name: string, song: Song) => void;
  onOpenStudio: (song: Song) => void;
}) {
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (song) setNewName("");
  }, [song]);

  const createAndAdd = () => {
    if (!song || !newName.trim()) return;
    onCreatePlaylistWithSong(newName, song);
    onClose();
  };

  return (
    <AnimatePresence>
      {song && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="app-liquid-overlay absolute inset-0 z-[90] flex items-center justify-center p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="app-liquid-popover w-full max-w-[380px] rounded-[24px] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-1 pb-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/6 ring-1 ring-white/10">
                {song.pic && <img src={song.pic} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-white/90">{song.name}</p>
                <p className="mt-0.5 truncate text-[11px] text-white/40">
                  {song.artist} · {AUTH_PLATFORM_LABEL[song.source ?? "netease"]}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full text-white/45 hover:bg-white/10 hover:text-white"
                aria-label="关闭歌曲操作"
              >
                <X size={15} />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                onOpenStudio(song);
                onClose();
              }}
              className="mt-2 flex h-11 w-full items-center gap-3 rounded-2xl bg-lime-200/15 px-3 text-left text-sm font-bold text-lime-100 hover:bg-lime-200/25"
            >
              <Mic2 size={17} />
              打开翻唱工作室
            </button>

            <button
              type="button"
              onClick={() => {
                onPlayNext(song);
                onClose();
              }}
              className="app-liquid-control flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-sm font-bold text-white/85"
            >
              <ListPlus size={17} className="text-white/55" />
              下一首播放
            </button>

            <div className="my-3 h-px bg-white/8" />
            <p className="px-1 text-[10px] font-black tracking-[0.16em] text-white/35">添加到自建歌单</p>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto">
              {appPlaylists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  onClick={() => {
                    onAddToPlaylist(playlist.id, song);
                    onClose();
                  }}
                  className="app-liquid-row flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left"
                >
                  <Library size={15} className="text-white/45" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/75">
                    {playlist.name}
                  </span>
                  <span className="text-[10px] text-white/30">{playlist.songs.length} 首</span>
                </button>
              ))}
              {appPlaylists.length === 0 && (
                <p className="py-3 text-center text-[11px] text-white/35">还没有自建歌单，可以直接在下方创建</p>
              )}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") createAndAdd();
                }}
                placeholder="新歌单名称"
                maxLength={40}
                className="app-liquid-input h-10 min-w-0 flex-1 rounded-xl px-3 text-sm text-white outline-none placeholder:text-white/30"
              />
              <button
                type="button"
                disabled={!newName.trim()}
                onClick={createAndAdd}
                className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-950 transition-opacity disabled:opacity-35"
                aria-label="创建歌单并添加"
              >
                <Plus size={17} />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Separate full-window views for the live queue and account playlists. */
const CollectionDrawer = memo(function CollectionDrawer({
  open,
  mode,
  onClose,
  queue,
  activeIndex,
  onSelect,
  onRemoveQueueItem,
  onMoveQueueItem,
  onClearQueue,
  onOpenSongActions,
  browseList,
  browsePlaylistId,
  browseTotal,
  browseLoaded,
  browseLoadingMore,
  onPlayFromBrowse,
  playlistLoaded,
  playlistTotal,
  playlistLoadingMore,
  playlists,
  playlistsLoading,
  playlistSort,
  onPlaylistSortChange,
  activePlaylistId,
  onRefreshPlaylists,
  onBrowsePlaylist,
  appPlaylists,
  activeAppPlaylistId,
  onOpenAppPlaylist,
  onCreateAppPlaylist,
  onRenameAppPlaylist,
  onDeleteAppPlaylist,
  onRemoveAppPlaylistSong,
  onMoveAppPlaylistSong,
  onPlayFromAppPlaylist,
}: {
  open: boolean;
  mode: "queue" | "playlists";
  onClose: () => void;
  queue: Song[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onRemoveQueueItem: (i: number) => void;
  onMoveQueueItem: (from: number, to: number) => void;
  onClearQueue: () => void;
  onOpenSongActions: (song: Song) => void;
  browseList: Song[];
  browsePlaylistId: number | null;
  browseTotal: number;
  browseLoaded: number;
  browseLoadingMore: boolean;
  onPlayFromBrowse: (song: Song) => void;
  playlistLoaded: number;
  playlistTotal: number;
  playlistLoadingMore: boolean;
  playlists: PlaylistSummary[];
  playlistsLoading: boolean;
  playlistSort: "updated" | "count" | "name";
  onPlaylistSortChange: (sort: "updated" | "count" | "name") => void;
  activePlaylistId: number | null;
  onRefreshPlaylists: () => void;
  onBrowsePlaylist: (pl: PlaylistSummary) => void;
  appPlaylists: AppPlaylist[];
  activeAppPlaylistId: string | null;
  onOpenAppPlaylist: (id: string) => void;
  onCreateAppPlaylist: (name: string) => void;
  onRenameAppPlaylist: (id: string, name: string) => void;
  onDeleteAppPlaylist: (id: string) => void;
  onRemoveAppPlaylistSong: (id: string, index: number) => void;
  onMoveAppPlaylistSong: (id: string, from: number, to: number) => void;
  onPlayFromAppPlaylist: (playlist: AppPlaylist, song: Song) => void;
}) {
  const [playlistLibrary, setPlaylistLibrary] = useState<"app" | "platform">(
    activeAppPlaylistId ? "app" : "platform"
  );
  const [sourceFilter, setSourceFilter] = useState<"all" | AuthPlatform>("all");
  const [playlistSearchOpen, setPlaylistSearchOpen] = useState(false);
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [renamingPlaylistId, setRenamingPlaylistId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeletePlaylistId, setConfirmDeletePlaylistId] = useState<string | null>(null);
  const [confirmClearQueue, setConfirmClearQueue] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const browseSource = usePlayerStore((state) => state.browseSource);

  const isPlaylistMode = mode === "playlists";
  const activeAppPlaylist = appPlaylists.find((playlist) => playlist.id === activeAppPlaylistId) ?? null;
  const isAppLibrary = isPlaylistMode && playlistLibrary === "app";
  const isPlatformLibrary = isPlaylistMode && playlistLibrary === "platform";
  const isAppBrowsing = isAppLibrary && activeAppPlaylist != null;
  const isPlatformBrowsing = isPlatformLibrary && browsePlaylistId != null;
  const isBrowsing = isAppBrowsing || isPlatformBrowsing;
  const list = isAppBrowsing
    ? activeAppPlaylist.songs
    : isPlatformLibrary
      ? browseList
      : isPlaylistMode
        ? []
        : queue;
  // App playlists are fully local — never reuse queue/platform pagination totals.
  const listTotal = isAppBrowsing
    ? list.length
    : isPlatformBrowsing
      ? browseTotal
      : isPlaylistMode
        ? 0
        : playlistTotal;
  const listLoaded = isAppBrowsing
    ? list.length
    : isPlatformBrowsing
      ? browseLoaded
      : isPlaylistMode
        ? 0
        : playlistLoaded;
  const listLoadingMore = isAppBrowsing
    ? false
    : isPlatformBrowsing
      ? browseLoadingMore
      : isPlaylistMode
        ? false
        : playlistLoadingMore;
  const showLoadMoreFooter =
    !isAppLibrary && listTotal > 0 && listLoaded < listTotal;
  useEffect(() => {
    setConfirmClearQueue(false);
    setPlaylistSearchOpen(false);
    setPlaylistSearchQuery("");
  }, [mode, open]);
  useEffect(() => {
    if (!isPlaylistMode || !open || playlistLibrary !== "app") return;
    if (activeAppPlaylist || appPlaylists.length === 0) return;
    onOpenAppPlaylist(appPlaylists[0].id);
  }, [activeAppPlaylist, appPlaylists, isPlaylistMode, onOpenAppPlaylist, open, playlistLibrary]);

  const previousActiveAppPlaylistIdRef = useRef(activeAppPlaylistId);
  useEffect(() => {
    if (
      activeAppPlaylistId &&
      activeAppPlaylistId !== previousActiveAppPlaylistIdRef.current
    ) {
      setPlaylistLibrary("app");
    }
    previousActiveAppPlaylistIdRef.current = activeAppPlaylistId;
  }, [activeAppPlaylistId]);

  const sourceCounts = useMemo(() => {
    const c = { all: playlists.length, netease: 0, qq: 0, kugou: 0 };
    for (const p of playlists) {
      const s = p.source ?? "netease";
      if (s === "qq" || s === "kugou" || s === "netease") c[s] += 1;
    }
    return c;
  }, [playlists]);
  const sortedPlaylists = useMemo(() => {
    const sourceFiltered =
      sourceFilter === "all"
        ? playlists
        : playlists.filter((p) => (p.source ?? "netease") === sourceFilter);
    const keyword = playlistSearchQuery.trim().toLocaleLowerCase("zh-Hans-CN");
    const filtered = keyword
      ? sourceFiltered.filter((playlist) =>
          playlist.name.toLocaleLowerCase("zh-Hans-CN").includes(keyword)
        )
      : sourceFiltered;
    return [...filtered].sort((a, b) => {
      if (playlistSort === "count") return b.trackCount - a.trackCount;
      if (playlistSort === "name") return a.name.localeCompare(b.name, "zh-Hans-CN");
      // source then updateTime — keep platforms grouped when sorting "recent"
      const sa = a.source ?? "netease";
      const sb = b.source ?? "netease";
      if (sa !== sb) return sa.localeCompare(sb);
      return b.updateTime - a.updateTime;
    });
  }, [playlistSearchQuery, playlistSort, playlists, sourceFilter]);

  const renderPlaylistSearch = (compact = false) => (
    <AnimatePresence initial={false} mode="wait">
      {playlistSearchOpen ? (
        <motion.div
          key="playlist-search-input"
          initial={{ width: 30, opacity: 0 }}
          animate={{ width: compact ? 132 : 176, opacity: 1 }}
          exit={{ width: 30, opacity: 0 }}
          transition={{ type: "spring", stiffness: 360, damping: 30 }}
          className={`app-liquid-input flex shrink-0 items-center gap-1 overflow-hidden rounded-full ${
            compact ? "h-6 px-2" : "h-7 px-2.5"
          }`}
        >
          <Search size={compact ? 11 : 12} className="shrink-0 text-white/35" />
          <input
            autoFocus
            value={playlistSearchQuery}
            onChange={(event) => setPlaylistSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setPlaylistSearchOpen(false);
                setPlaylistSearchQuery("");
              }
            }}
            placeholder="搜索歌单"
            aria-label="按名称搜索平台歌单"
            className={`min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/25 ${
              compact ? "text-[10px]" : "text-[11px]"
            }`}
          />
          <button
            type="button"
            onClick={() => {
              setPlaylistSearchOpen(false);
              setPlaylistSearchQuery("");
            }}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"
            aria-label="关闭歌单搜索"
          >
            <X size={10} />
          </button>
        </motion.div>
      ) : (
        <motion.button
          key="playlist-search-button"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          type="button"
          onClick={() => setPlaylistSearchOpen(true)}
          className={`app-liquid-control grid shrink-0 place-items-center rounded-full text-white/45 hover:text-white ${
            compact ? "h-6 w-6" : "h-7 w-7"
          }`}
          aria-label="搜索平台歌单"
          title="搜索平台歌单"
        >
          <Search size={compact ? 11 : 12} />
        </motion.button>
      )}
    </AnimatePresence>
  );

  const submitCreatePlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    onCreateAppPlaylist(name);
    setNewPlaylistName("");
    setCreatingPlaylist(false);
  };

  const submitRenamePlaylist = (id: string) => {
    const name = renameValue.trim();
    if (!name) return;
    onRenameAppPlaylist(id, name);
    setRenamingPlaylistId(null);
    setRenameValue("");
  };

  const moveVisibleItem = useCallback(
    (from: number, to: number) => {
      if (isAppBrowsing && activeAppPlaylist) {
        onMoveAppPlaylistSong(activeAppPlaylist.id, from, to);
      } else if (!isPlaylistMode) {
        onMoveQueueItem(from, to);
      }
    },
    [
      activeAppPlaylist,
      isAppBrowsing,
      isPlaylistMode,
      onMoveAppPlaylistSong,
      onMoveQueueItem,
    ],
  );
  const handleRowPlay = useCallback(
    (song: Song, index: number) => {
      if (isAppBrowsing && activeAppPlaylist) {
        onPlayFromAppPlaylist(activeAppPlaylist, song);
      } else if (isPlaylistMode) {
        onPlayFromBrowse(song);
      } else {
        onSelect(index);
      }
    },
    [
      activeAppPlaylist,
      isAppBrowsing,
      isPlaylistMode,
      onPlayFromAppPlaylist,
      onPlayFromBrowse,
      onSelect,
    ],
  );
  const handleRowRemove = useCallback(
    (index: number) => {
      if (isAppBrowsing && activeAppPlaylist) {
        onRemoveAppPlaylistSong(activeAppPlaylist.id, index);
      } else {
        onRemoveQueueItem(index);
      }
    },
    [activeAppPlaylist, isAppBrowsing, onRemoveAppPlaylistSong, onRemoveQueueItem],
  );
  const handleRowDragStateChange = useCallback(
    (index: number | null) => setDragIndex(index),
    [],
  );

  return (
    <AnimatePresence>
      {open && !isPlaylistMode && (
        <motion.div
          key="queue-dismiss-layer"
          className="absolute inset-0 z-40 no-drag"
          aria-hidden="true"
          onClick={onClose}
        />
      )}
      {open && (
        <motion.section
          key={mode}
          initial={{ x: 30, opacity: 0, scale: 0.99 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ x: 22, opacity: 0, scale: 0.99 }}
          transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.72 }}
          style={{ contain: "layout paint" }}
          className={`context-panel player-liquid-glass settings-player-page absolute z-50 flex flex-col text-white overflow-hidden ${
            isPlaylistMode
              ? "context-panel--tab-page"
              : "context-panel--queue"
          }`}
        >
            <header
              data-tauri-drag-region
              className="context-panel-layer player-liquid-content settings-player-header flex h-16 shrink-0 items-center justify-between border-b border-white/6 px-7"
              style={{ ["--context-layer" as string]: 0 }}
            >
              <div className="flex items-center gap-2 text-white/85">
                {isPlaylistMode ? <Library size={17} /> : <ListMusic size={17} />}
                <span className="font-bold tracking-wide">
                  {isPlaylistMode ? "我的歌单" : "播放队列"}
                </span>
                <span className="text-xs text-white/40">
                  {isPlaylistMode ? `${playlists.length + appPlaylists.length} 个` : `${queue.length} 首`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {!isPlaylistMode && queue.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirmClearQueue) {
                        setConfirmClearQueue(true);
                        return;
                      }
                      onClearQueue();
                      setConfirmClearQueue(false);
                      toast("播放队列已清空", { tone: "success" });
                    }}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-bold transition-colors ${
                      confirmClearQueue
                        ? "bg-red-500/85 text-white"
                        : "text-white/45 hover:bg-red-500/12 hover:text-red-100"
                    }`}
                  >
                    <Trash2 size={12} />
                    {confirmClearQueue ? "确认清空" : "清空"}
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="grid place-items-center w-8 h-8 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                  aria-label="关闭面板"
                >
                  <X size={16} />
                </button>
              </div>
            </header>
            <AnimatePresence initial={false}>
              {isPlaylistMode && creatingPlaylist && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                  className="context-panel-layer player-liquid-content shrink-0 overflow-hidden border-b border-white/6 no-drag"
                  style={{ ["--context-layer" as string]: 0 }}
                >
                  <div className="px-6 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold tracking-wide text-white/80">
                          新建歌单
                        </p>
                        <p className="mt-0.5 text-[10px] text-white/35">
                          保存在本机，仅此设备可见
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingPlaylist(false);
                          setNewPlaylistName("");
                        }}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/8 hover:text-white/75"
                        aria-label="取消新建"
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3.5 focus-within:border-white/20 focus-within:bg-white/[0.09]">
                        <Library size={14} className="shrink-0 text-white/35" />
                        <input
                          autoFocus
                          value={newPlaylistName}
                          onChange={(event) => setNewPlaylistName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") submitCreatePlaylist();
                            if (event.key === "Escape") {
                              setCreatingPlaylist(false);
                              setNewPlaylistName("");
                            }
                          }}
                          maxLength={40}
                          placeholder="歌单名称"
                          className="h-full min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white outline-none placeholder:text-white/30"
                        />
                      </div>
                      <button
                        type="button"
                        disabled={!newPlaylistName.trim()}
                        onClick={submitCreatePlaylist}
                        className="h-10 shrink-0 rounded-full bg-white px-4 text-[12px] font-bold text-slate-950 transition-opacity disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        创建
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            {isPlaylistMode && (
              <section
                className="context-panel-layer player-liquid-content shrink-0 border-b border-white/6 px-6 py-3 no-drag"
                style={{ ["--context-layer" as string]: 1 }}
              >
                <div className="app-liquid-segment grid grid-cols-2 gap-1 rounded-2xl p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setCreatingPlaylist(false);
                      setPlaylistLibrary("platform");
                    }}
                    className={`flex h-11 items-center gap-2 rounded-xl px-3 text-left transition-colors ${
                      playlistLibrary === "platform"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-white/55 hover:bg-white/8 hover:text-white"
                    }`}
                    aria-pressed={playlistLibrary === "platform"}
                  >
                    <Server size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-black">平台歌单</span>
                      <span className={`block text-[9px] ${playlistLibrary === "platform" ? "text-slate-500" : "text-white/30"}`}>
                        已登录账号同步
                      </span>
                    </span>
                    <span className={`text-[11px] font-bold ${playlistLibrary === "platform" ? "text-slate-500" : "text-white/30"}`}>
                      {playlists.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlaylistLibrary("app");
                      if (!activeAppPlaylist && appPlaylists[0]) onOpenAppPlaylist(appPlaylists[0].id);
                    }}
                    className={`flex h-11 items-center gap-2 rounded-xl px-3 text-left transition-colors ${
                      playlistLibrary === "app"
                        ? "bg-white text-slate-950 shadow-sm"
                        : "text-white/55 hover:bg-white/8 hover:text-white"
                    }`}
                    aria-pressed={playlistLibrary === "app"}
                  >
                    <Library size={15} className="shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-black">自建歌单</span>
                      <span className={`block text-[9px] ${playlistLibrary === "app" ? "text-slate-500" : "text-white/30"}`}>
                        本地混合收藏
                      </span>
                    </span>
                    <span className={`text-[11px] font-bold ${playlistLibrary === "app" ? "text-slate-500" : "text-white/30"}`}>
                      {appPlaylists.length}
                    </span>
                  </button>
                </div>

                {playlistLibrary === "app" ? (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                    {appPlaylists.map((playlist) => {
                      const selected = playlist.id === activeAppPlaylistId;
                      const renaming = playlist.id === renamingPlaylistId;
                      const confirmingDelete = playlist.id === confirmDeletePlaylistId;
                      return (
                        <div
                          key={playlist.id}
                          className={`intent-surface flex h-12 min-w-[210px] items-center gap-2 rounded-xl border px-2.5 transition-colors ${
                            selected
                              ? "border-white/24 bg-white/12"
                              : "border-white/8 bg-white/[0.035] hover:bg-white/[0.07]"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => onOpenAppPlaylist(playlist.id)}
                            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${selected ? "bg-white text-slate-950" : "bg-white/8 text-white/55"}`}
                            aria-label={`打开歌单 ${playlist.name}`}
                          >
                            <Library size={13} />
                          </button>
                          <div className="min-w-0 flex-1">
                            {renaming ? (
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(event) => setRenameValue(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") submitRenamePlaylist(playlist.id);
                                  if (event.key === "Escape") setRenamingPlaylistId(null);
                                }}
                                maxLength={40}
                                className="h-6 w-full rounded-md border border-white/12 bg-white/8 px-1.5 text-[11px] text-white outline-none"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => onOpenAppPlaylist(playlist.id)}
                                className="block w-full truncate text-left text-[11px] font-bold text-white/80"
                              >
                                {playlist.name}
                              </button>
                            )}
                            <p className="text-[9px] text-white/30">{playlist.songs.length} 首</p>
                          </div>
                          {renaming ? (
                            <button
                              type="button"
                              onClick={() => submitRenamePlaylist(playlist.id)}
                              className="grid h-7 w-7 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                              aria-label="保存歌单名称"
                            >
                              <Check size={12} />
                            </button>
                          ) : confirmingDelete ? (
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteAppPlaylist(playlist.id);
                                setConfirmDeletePlaylistId(null);
                              }}
                              className="h-7 rounded-full bg-red-500/80 px-2 text-[10px] font-bold text-white"
                            >
                              确认
                            </button>
                          ) : (
                            <div className="intent-controls flex shrink-0 items-center">
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingPlaylistId(playlist.id);
                                  setRenameValue(playlist.name);
                                }}
                                className="grid h-7 w-7 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"
                                aria-label="重命名歌单"
                              >
                                <Pencil size={11} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeletePlaylistId(playlist.id)}
                                className="grid h-7 w-7 place-items-center rounded-full text-white/35 hover:bg-red-500/15 hover:text-red-200"
                                aria-label="删除歌单"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {appPlaylists.length > 0 && !creatingPlaylist && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingPlaylist(true);
                          setNewPlaylistName("");
                        }}
                        className="flex h-12 min-w-[96px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-white/[0.03] text-[11px] font-semibold text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white/70"
                      >
                        <Plus size={13} />
                        新建
                      </button>
                    )}
                    {appPlaylists.length === 0 && !creatingPlaylist && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingPlaylist(true);
                          setNewPlaylistName("");
                        }}
                        className="flex h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl bg-white/[0.04] text-white/40 transition-colors hover:bg-white/[0.07] hover:text-white/70"
                      >
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/70">
                          <Plus size={14} />
                        </span>
                        <span className="text-[11px] font-semibold">新建第一个歌单</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none">
                        {(
                          [
                            ["all", "全部", sourceCounts.all],
                            ["netease", "网易云", sourceCounts.netease],
                            ["qq", "QQ", sourceCounts.qq],
                            ["kugou", "酷狗", sourceCounts.kugou],
                          ] as const
                        ).map(([key, label, count]) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => setSourceFilter(key)}
                            className={`h-7 shrink-0 rounded-full border px-2.5 text-[10px] font-bold transition-colors ${
                              sourceFilter === key
                                ? "border-white bg-white text-slate-950"
                                : "border-white/10 bg-white/[0.04] text-white/45 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {label}{count > 0 ? ` ${count}` : ""}
                          </button>
                        ))}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {renderPlaylistSearch(true)}
                        <span className="mx-0.5 text-[10px] font-bold text-white/30">排序</span>
                        {[
                          ["updated", "最近"],
                          ["count", "歌曲数"],
                          ["name", "名称"],
                        ].map(([value, label]) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => onPlaylistSortChange(value as "updated" | "count" | "name")}
                            className={`h-6 shrink-0 rounded-full px-2 text-[10px] font-bold transition-colors ${
                              playlistSort === value
                                ? "bg-white/14 text-white"
                                : "text-white/35 hover:bg-white/8 hover:text-white/70"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                        <button
                          type="button"
                          onClick={onRefreshPlaylists}
                          className="app-liquid-control grid h-6 w-6 place-items-center rounded-full text-white/45 hover:text-white"
                          title="刷新平台歌单"
                          aria-label="刷新平台歌单"
                        >
                          <RefreshCw size={11} />
                        </button>
                      </div>
                    </div>
                    <PlaylistCoverFlow
                      playlists={sortedPlaylists}
                      loading={playlistsLoading}
                      activePlaylistId={activePlaylistId}
                      onOpenPlaylist={onBrowsePlaylist}
                      compact={isPlatformBrowsing}
                    />
                  </>
                )}
              </section>
            )}
            <CollectionSongVirtualList
              open={open}
              mode={mode}
              list={list}
              queue={queue}
              activeIndex={activeIndex}
              isBrowsing={isBrowsing}
              isAppBrowsing={isAppBrowsing}
              browseLoadingMore={browseLoadingMore}
              scrollRef={scrollRef}
              resetKey={`${activeAppPlaylistId ?? ""}:${browseSource ?? ""}:${browsePlaylistId ?? ""}:${mode}:${playlistLibrary}`}
              dragIndex={dragIndex}
              onPlay={handleRowPlay}
              onOpenActions={onOpenSongActions}
              onRemove={handleRowRemove}
              onMove={moveVisibleItem}
              onDragStateChange={handleRowDragStateChange}
              listTotal={listTotal}
              listLoadingMore={listLoadingMore}
              showLoadMoreFooter={showLoadMoreFooter}
            />
          </motion.section>
      )}
    </AnimatePresence>
  );
});

/**
 * PlaylistCoverFlow — early-Apple-Music / iTunes style 3D cover-flow carousel
 * for the user's playlists. The focused playlist sits centered & flat; covers
 * on either side recede into 3D (perspective + rotateY) like a fanned deck.
 *
 * - drag / wheel / arrow keys / click to browse
 * - double-click (or Enter) the centered cover to open that playlist
 * - follows the currently active playlist when it changes
 */
const PlaylistCoverFlow = memo(function PlaylistCoverFlow({
  playlists,
  loading,
  activePlaylistId,
  onOpenPlaylist,
  compact = false,
}: {
  playlists: PlaylistSummary[];
  loading: boolean;
  activePlaylistId: number | null;
  onOpenPlaylist: (pl: PlaylistSummary) => void;
  compact?: boolean;
}) {
  const dragRef = useRef({ active: false, startX: 0, startFocus: 0, moved: false, lastDelta: 0 });

  // which cover is centered
  const initialFocus = useMemo(() => {
    const i = playlists.findIndex((p) => p.id === activePlaylistId);
    return i >= 0 ? i : 0;
  }, [playlists, activePlaylistId]);
  const [focus, setFocus] = useState(initialFocus);
  // mirror focus + playlists into refs so async callbacks (wheel/arrow timers)
  // always read the LATEST values instead of a stale render closure.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const playlistsRef = useRef(playlists);
  playlistsRef.current = playlists;
  useEffect(() => {
    setFocus(initialFocus);
  }, [initialFocus]);

  // Auto-open only AFTER a drag ends: we open the cover that ends up centered
  // when the pointer is released. This avoids firing network requests + queue
  // resets mid-drag (which caused jank). Keep onOpenPlaylist in a ref so the
  // pointer handlers don't depend on an unstable parent callback.
  const openRef = useRef(onOpenPlaylist);
  openRef.current = onOpenPlaylist;

  // When the playlist set changes (platform filter / sort / refresh), the
  // centered cover changes but we used to leave the song list on the previous
  // browse — auto-open the new centered playlist after focus settles.
  const playlistsKey = useMemo(
    () => playlists.map((p) => `${p.source ?? "netease"}:${p.id}`).join("|"),
    [playlists]
  );
  useEffect(() => {
    if (playlists.length === 0) return;
    const t = window.setTimeout(() => {
      const p = playlistsRef.current[focusRef.current] ?? playlistsRef.current[0];
      if (p) openRef.current(p);
    }, 80);
    return () => clearTimeout(t);
    // only when the set of playlists changes (filter), not on every focus tick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistsKey]);

  const clamp = (n: number) => Math.max(0, Math.min(playlists.length - 1, n));

  // raf token to throttle setFocus during drag (one React render per frame max)
  const rafRef = useRef<number | null>(null);
  // debounce timer for browse-after-wheel/arrow: only browse once scrolling settles
  const wheelBrowseRef = useRef<number | null>(null);

  // clear any pending browse/raf timer on unmount to avoid a post-unmount call
  useEffect(() => {
    return () => {
      if (wheelBrowseRef.current != null) {
        clearTimeout(wheelBrowseRef.current);
        wheelBrowseRef.current = null;
      }
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Safety net: if a drag is in progress and the window loses focus or is
  // hidden (Alt-Tab, minimize, clicking another app), force-end the drag
  // WITHOUT browsing — otherwise the drag stays "stuck" because no pointerup
  // reaches the element. setPointerCapture covers the pointer-leaving-element
  // case; this covers the window-itself-losing-focus case.
  useEffect(() => {
    const cancel = () => {
      if (!dragRef.current.active) return;
      // hard reset drag state, cancel pending work, but don't browse — this
      // is an aborted drag, not an intentional release.
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (wheelBrowseRef.current != null) {
        clearTimeout(wheelBrowseRef.current);
        wheelBrowseRef.current = null;
      }
      dragRef.current.active = false;
      downIndexRef.current = -1;
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, []);

  // keyboard: only when this carousel is "active" via hover focus
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.activeElement !== wrapRef.current && !wrapRef.current?.contains(document.activeElement)) return;
      if (e.key === "ArrowLeft") {
        setFocus((i) => clamp(i - 1));
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        setFocus((i) => clamp(i + 1));
        e.preventDefault();
      } else if (e.key === "Enter") {
        // Enter immediately browses the centered cover
        if (wheelBrowseRef.current != null) {
          clearTimeout(wheelBrowseRef.current);
          wheelBrowseRef.current = null;
        }
        browseCurrent();
      }
      // after an arrow press, schedule a browse like wheel does (so quickly
      // tapping arrows doesn't fire a request per key)
      if ((e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        if (wheelBrowseRef.current != null) clearTimeout(wheelBrowseRef.current);
        wheelBrowseRef.current = window.setTimeout(() => {
          wheelBrowseRef.current = null;
          browseCurrent();
        }, 450);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, playlists]);

  // which cover index the pointer went down on (for tap detection), -1 = none
  const downIndexRef = useRef(-1);

  // Browse the cover currently centered. Shared by drag-end and wheel-settle.
  // Reads from refs so it always sees the latest focus/playlists even inside
  // a setTimeout callback that captured an older render closure.
  const browseCurrent = () => {
    const p = playlistsRef.current[focusRef.current];
    if (p) openRef.current(p);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const button = (e.target as HTMLElement).closest("button");
    // Arrow buttons need their own click; capturing here retargets it to the
    // carousel and prevents the button's handler from running.
    if (button && !button.hasAttribute("data-cover-idx")) return;
    dragRef.current = { active: true, startX: e.clientX, startFocus: focus, moved: false, lastDelta: 0 };
    // Capture the pointer so we keep receiving move/up events even if it leaves
    // the element (e.g. dragged outside the window edge). Without this, a
    // pointerup outside the element is never received and the drag never ends.
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    // detect which cover was tapped via data attribute
    const idx = Number((e.target as HTMLElement).closest("[data-cover-idx]")?.getAttribute("data-cover-idx") ?? -1);
    downIndexRef.current = idx;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d.active) return;
    const delta = e.clientX - d.startX;
    if (Math.abs(delta) > 6) d.moved = true;
    d.lastDelta = delta;
    // throttle: coalesce pointer moves into a single rAF so we don't trigger a
    // synchronous React re-render (expensive 3D re-layout) on every move event.
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const dd = dragRef.current;
      const step = Math.round(-dd.lastDelta / 120);
      const next = clamp(dd.startFocus + step);
      setFocus(next);
    });
  };
  const endDrag = (releasePointerId?: number, el?: HTMLElement) => {
    if (!dragRef.current.active) return;
    // release pointer capture if we still hold it
    if (releasePointerId != null && el?.hasPointerCapture(releasePointerId)) {
      el.releasePointerCapture(releasePointerId);
    }
    // cancel any pending frame
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // cancel any pending wheel-settle browse — the pointer up takes over
    if (wheelBrowseRef.current != null) {
      clearTimeout(wheelBrowseRef.current);
      wheelBrowseRef.current = null;
    }
    const d = dragRef.current;
    dragRef.current.active = false;
    const tappedIdx = downIndexRef.current;
    downIndexRef.current = -1;
    if (d.moved) {
      // real drag ended → browse whichever cover is now centered
      browseCurrent();
    } else if (tappedIdx >= 0) {
      // a tap (no movement): always open the tapped cover's track list
      const p = playlists[tappedIdx];
      if (p) {
        if (tappedIdx !== focus) {
          setFocus(tappedIdx);
          focusRef.current = tappedIdx;
        }
        openRef.current(p);
      }
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    endDrag(e.pointerId, e.currentTarget as HTMLDivElement);
  };
  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    setFocus((i) => clamp(i + (e.deltaY > 0 ? 1 : -1)));
    // wheel scrolling is continuous — debounce so we only browse once it
    // settles (~450ms of no wheel events), instead of firing per notch.
    if (wheelBrowseRef.current != null) clearTimeout(wheelBrowseRef.current);
    wheelBrowseRef.current = window.setTimeout(() => {
      wheelBrowseRef.current = null;
      browseCurrent();
    }, 450);
  };

  const CARD = compact ? 108 : 168; // cover width/height
  const gap = compact ? 72 : 96;    // horizontal offset per step from center
  const coverRange = getCoverFlowRange(playlists.length, focus);
  const visiblePlaylists = playlists.slice(coverRange.start, coverRange.end);

  if (playlists.length === 0) {
    return (
      <div
        ref={wrapRef}
        tabIndex={0}
        className={`app-liquid-card grid place-items-center rounded-2xl text-xs text-white/35 ${
          compact ? "h-28" : "h-40"
        }`}
      >
        {loading ? "正在加载歌单" : "没有读取到账号创建的歌单"}
      </div>
    );
  }

  return (
    <div
      ref={wrapRef}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      className={`relative cursor-grab active:cursor-grabbing outline-none select-none ${
        compact ? "h-28" : "h-44"
      }`}
      style={{ perspective: "1300px", perspectiveOrigin: "50% 44%" }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
        {visiblePlaylists.map((playlist, visibleIndex) => {
          const i = coverRange.start + visibleIndex;
          const offset = i - focus;
          const absOff = Math.abs(offset);
          const rotateY = offset === 0 ? 0 : offset > 0 ? -56 : 56;
          const x = offset * gap;
          const z = -absOff * 90;
          const scale = offset === 0 ? 1 : Math.max(0.64, 1 - absOff * 0.055);
          const opacity = offset === 0 ? 1 : Math.max(0.28, 1 - absOff * 0.14);
          const isActive = playlist.id === activePlaylistId;
          return (
            <button
              key={`${playlist.source ?? "netease"}-${playlist.id}`}
              data-cover-idx={i}
              type="button"
              onClick={(e) => e.preventDefault()}
              className="pointer-events-auto group absolute left-1/2 top-1/2"
              style={{
                width: CARD,
                height: CARD,
                marginLeft: -CARD / 2,
                marginTop: -CARD / 2,
                transform: `translate3d(${x}px, 0, ${z}px) rotateY(${rotateY}deg) scale(${scale})`,
                transformStyle: "preserve-3d",
                zIndex: 200 - absOff,
                opacity,
                transition: "transform 0.5s cubic-bezier(0.22,0.61,0.36,1), opacity 0.5s ease",
              }}
              title={`${playlist.name} — ${playlist.trackCount} 首`}
            >
              <div
                className={`relative w-full h-full overflow-hidden rounded-2xl ring-1 bg-slate-900 shadow-2xl transition-shadow ${
                  offset === 0
                    ? "ring-white/40 shadow-[0_28px_72px_-18px_rgba(0,0,0,0.78)]"
                    : "ring-white/10"
                }`}
              >
                {playlist.coverImgUrl ? (
                  <img
                    src={playlist.coverImgUrl}
                    alt={playlist.name}
                    draggable={false}
                    loading="eager"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover transition-opacity group-hover:opacity-95"
                  />
                ) : (
                  <div className="w-full h-full grid place-items-center text-white/30">
                    <ListMusic size={30} />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/15 to-white/5" />
                <div className={`absolute inset-x-0 bottom-0 text-left ${compact ? "p-2" : "p-3"}`}>
                  <p className={`line-clamp-2 font-black leading-tight text-white drop-shadow ${
                    compact ? "text-[10px]" : "text-[13px]"
                  }`}>
                    {playlist.name}
                  </p>
                  <p className={`mt-0.5 font-semibold text-white/55 ${compact ? "text-[9px]" : "text-[11px]"}`}>
                    {playlist.trackCount} 首
                  </p>
                </div>
                {(() => {
                  const src = (playlist.source ?? "netease") as AuthPlatform;
                  const logo =
                    {
                      netease: "/brands/netease.png?v=2",
                      qq: "/brands/qq.png?v=2",
                      kugou: "/brands/kugou.png?v=3",
                    }[src];
                  return (
                    <span
                      className="absolute left-2 top-2 grid h-6 w-6 place-items-center overflow-hidden rounded-[7px] bg-transparent shadow-md"
                      title={AUTH_PLATFORM_LABEL[src]}
                    >
                      <img
                        src={logo}
                        alt={AUTH_PLATFORM_LABEL[src]}
                        className="h-full w-full object-cover"
                        draggable={false}
                      />
                    </span>
                  );
                })()}
                {isActive && (
                  <span className="absolute right-2 top-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-slate-950">
                    当前
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* focus position indicator */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <span className="rounded-full bg-black/40 px-2.5 py-0.5 text-[10px] font-bold text-white/55 backdrop-blur-sm">
          {focus + 1} / {playlists.length}
        </span>
      </div>

      {/* nav arrows */}
      {focus > 0 && (
        <button
          onClick={() => {
            const next = clamp(focus - 1);
            setFocus(next);
            focusRef.current = next;
            const playlist = playlists[next];
            if (playlist) openRef.current(playlist);
          }}
          className="absolute left-2 top-1/2 z-[300] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white/80 backdrop-blur-md border border-white/10 hover:bg-white/20 hover:text-white transition-colors"
          title="上一个歌单"
        >
          <ChevronLeft size={16} />
        </button>
      )}
      {focus < playlists.length - 1 && (
        <button
          onClick={() => {
            const next = clamp(focus + 1);
            setFocus(next);
            focusRef.current = next;
            const playlist = playlists[next];
            if (playlist) openRef.current(playlist);
          }}
          className="absolute right-2 top-1/2 z-[300] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white/80 backdrop-blur-md border border-white/10 hover:bg-white/20 hover:text-white transition-colors"
          title="下一个歌单"
        >
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
});
