import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, X, Loader2, ListMusic, RefreshCw, Save, Settings, LogOut } from "lucide-react";
import GlassPlayer from "./components/GlassPlayer";
import { LoginPanel } from "./components/LoginPanel";
import type { LyricMotionStyle, PlayerLayout, Song as PlayerSong } from "./components/playerTypes";
import { getAudio } from "./lib/audio";
import { useAudioEngine } from "./hooks/useAudioEngine";
import { usePlayerStore } from "./store/playerStore";
import {
  search,
  getFavPlaylistId,
  setFavPlaylistId,
  getLoginStatus,
  logout,
  type LoginStatus,
} from "./lib/api";
import { toPlayerSong } from "./lib/adapter";
import { minimizeWindow, closeWindow } from "./lib/tauri";
import type { Song } from "./lib/types";

/** Default "My Favorites" playlist id detected for this account.
 *  Overridable in SettingsModal → localStorage "nmp.favPlaylistId". */
const DEFAULT_FAV_PLAYLIST_ID = 797461443;
const BACKGROUND_BLUR_KEY = "nmp.backgroundBlur";
const BACKGROUND_OPACITY_KEY = "nmp.backgroundOpacity";
const LYRIC_MOTION_STYLE_KEY = "nmp.lyricMotionStyle";
const USE_COVER_BACKGROUND_KEY = "nmp.useCoverBackground";
const DEFAULT_BACKGROUND_BLUR = 30;
const DEFAULT_BACKGROUND_OPACITY = 0;
const DEFAULT_LYRIC_MOTION_STYLE: LyricMotionStyle = "rail";
const LYRIC_MOTION_STYLE_OPTIONS: Array<{ value: LyricMotionStyle; label: string }> = [
  { value: "rail", label: "流动" },
  { value: "cascade", label: "分层" },
  { value: "focus", label: "聚焦" },
  { value: "typewriter", label: "打印" },
  { value: "beam", label: "光束" },
  { value: "dialogue", label: "对话" },
  { value: "poster", label: "海报" },
  { value: "tilt", label: "倾斜" },
  { value: "ripple", label: "涟漪" },
  { value: "float", label: "漂浮" },
  { value: "stagger", label: "散列" },
];

function loadBackgroundBlur(): number {
  try {
    const value = Number(localStorage.getItem(BACKGROUND_BLUR_KEY));
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
    const value = Number(localStorage.getItem(BACKGROUND_OPACITY_KEY));
    return Number.isFinite(value) ? Math.min(80, Math.max(0, value)) : DEFAULT_BACKGROUND_OPACITY;
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

export default function App() {
  useAudioEngine();

  // ---- data layer (Zustand) ----
  const queue = usePlayerStore((s) => s.queue);
  const index = usePlayerStore((s) => s.index);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const currentTime = usePlayerStore((s) => s.currentTime);
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
  const speed = usePlayerStore((s) => s.speed);
  const setSpeed = usePlayerStore((s) => s.setSpeed);
  const repeat = usePlayerStore((s) => s.repeat);
  const shuffle = usePlayerStore((s) => s.shuffle);
  const cyclePlayMode = usePlayerStore((s) => s.cyclePlayMode);
  const favLoaded = usePlayerStore((s) => s.favLoaded);
  const favTotal = usePlayerStore((s) => s.favTotal);
  const favLoadingMore = usePlayerStore((s) => s.favLoadingMore);
  const loadMoreFav = usePlayerStore((s) => s.loadMoreFav);
  // unified play mode derived from repeat+shuffle
  const playMode: "sequence" | "list" | "one" | "shuffle" = shuffle
    ? "shuffle"
    : repeat === "one"
    ? "one"
    : repeat === "all"
    ? "list"
    : "sequence";

  // ---- UI-only state ----
  const [layout, setLayout] = useState<PlayerLayout>("lyrics");
  const [searchOpen, setSearchOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);
  const [showHint, setShowHint] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loginStatus, setLoginStatus] = useState<LoginStatus | null>(null);
  const [backgroundBlur, setBackgroundBlur] = useState(loadBackgroundBlur);
  const [backgroundOpacity, setBackgroundOpacity] = useState(loadBackgroundOpacity);
  const [lyricMotionStyle, setLyricMotionStyle] = useState(loadLyricMotionStyle);
  const [useCoverBackground, setUseCoverBackground] = useState(loadUseCoverBackground);
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});

  // hide the hint after 6s
  useEffect(() => {
    const t = setTimeout(() => setShowHint(false), 6000);
    return () => clearTimeout(t);
  }, []);

  const activeRaw: Song | undefined = index >= 0 ? queue[index] : undefined;

  // adapt runtime-resolved data -> UI Song
  const activePlayerSong: PlayerSong | undefined = useMemo(() => {
    if (!activeRaw) return undefined;
    return toPlayerSong(activeRaw, cover, lyrics, accent, duration);
  }, [activeRaw, cover, lyrics, accent, duration]);

  // favorites persistence
  useEffect(() => {
    try {
      const saved = localStorage.getItem("nmp_favorites");
      if (saved) setFavorites(JSON.parse(saved));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const st = await getLoginStatus();
        setLoginStatus(st);
        setLoginOpen(!st.logged_in);
      } catch {
        setLoginStatus({ logged_in: false });
        setLoginOpen(true);
      }
    })();
  }, []);

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

  // on startup: check login status; if not logged in, open the QR panel
  useEffect(() => {
    void (async () => {
      try {
        const st = await getLoginStatus();
        setLoginStatus(st);
        setLoginOpen(!st.logged_in);
      } catch {
        /* API down — don't block, user can open login manually */
      }
    })();
  }, []);

  // keyboard: space play/pause, / search, q queue, Esc closes overlays
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        toggle();
      } else if (e.key === "/") {
        e.preventDefault();
        setShowHint(false);
        setSearchOpen(true);
      } else if (e.key === "q" || e.key === "Q") {
        setShowHint(false);
        setQueueOpen((v) => !v);
      } else if (e.key === "l" || e.key === "L") {
        setShowHint(false);
        setLoginOpen(true);
      } else if (e.key === "Escape") {
        setSearchOpen(false);
        setQueueOpen(false);
        setLoginOpen(false);
        setSettingsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const handleToggleFavorite = () => {
    if (!activeRaw) return;
    const id = String(activeRaw.id);
    const f = { ...favorites, [id]: !favorites[id] };
    setFavorites(f);
    try {
      localStorage.setItem("nmp_favorites", JSON.stringify(f));
    } catch {
      /* ignore */
    }
  };

  const handleSelectFromQueue = (i: number) => {
    if (queue[i]) void playSong(queue[i]);
  };

  const handleBackgroundBlurChange = (value: number) => {
    const nextValue = Math.min(60, Math.max(0, Math.round(value)));
    setBackgroundBlur(nextValue);
    saveBackgroundBlur(nextValue);
  };

  const handleBackgroundOpacityChange = (value: number) => {
    const nextValue = Math.min(80, Math.max(0, Math.round(value)));
    setBackgroundOpacity(nextValue);
    saveBackgroundOpacity(nextValue);
  };

  const handleLyricMotionStyleChange = (value: LyricMotionStyle) => {
    setLyricMotionStyle(value);
    saveLyricMotionStyle(value);
  };

  const handleUseCoverBackgroundChange = (value: boolean) => {
    setUseCoverBackground(value);
    saveUseCoverBackground(value);
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
  const requiresLogin = loginStatus?.logged_in === false;

  const handleLoggedIn = (status: LoginStatus) => {
    setLoginStatus(status.logged_in ? status : { ...status, logged_in: true });
    setLoginOpen(false);
  };

  const handleLogout = async () => {
    await logout().catch(() => {});
    const audio = getAudio();
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    usePlayerStore.setState({
      queue: [],
      index: -1,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      currentCover: undefined,
      lyrics: [],
      accent: null,
      error: null,
    });
    setSettingsOpen(false);
    setLoginStatus({ logged_in: false });
    setLoginOpen(true);
  };

  if (loginStatus === null) {
    return <div className="app-window-frame relative w-screen h-screen overflow-hidden font-sans" />;
  }

  if (requiresLogin) {
    return (
      <div className="app-window-frame relative w-screen h-screen overflow-hidden font-sans">
        <LoginPanel
          open
          closable={false}
          onClose={() => {}}
          onLoggedIn={handleLoggedIn}
        />
      </div>
    );
  }

  return (
    <div className="app-window-frame relative w-screen h-screen overflow-hidden font-sans">
      <AnimatePresence>
        {showHint && !searchOpen && !queueOpen && (
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
            <span className="font-mono bg-white/10 rounded px-1 py-0.5 ml-3 mr-1.5">l</span>
            登录
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative z-10 w-full h-full">
        <GlassPlayer
          song={shown}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onPlayPause={toggle}
          onNext={() => void next()}
          onPrev={prev}
          onSeek={seek}
          layout={layout}
          onToggleLayout={setLayout}
          isFavorited={activeRaw ? !!favorites[String(activeRaw.id)] : false}
          onToggleFavorite={handleToggleFavorite}
          speed={speed}
          onSpeedChange={setSpeed}
          volume={volume}
          onVolumeChange={setVolume}
          isShowQueue={queueOpen}
          onShowQueueToggle={() => setQueueOpen((v) => !v)}
          onOpenSettings={() => setSettingsOpen(true)}
          backgroundBlur={backgroundBlur}
          backgroundOpacity={backgroundOpacity}
          lyricMotionStyle={lyricMotionStyle}
          useCoverBackground={useCoverBackground}
          onMinimize={() => void minimizeWindow()}
          onClose={() => void closeWindow()}
          playMode={playMode}
          onCyclePlayMode={cyclePlayMode}
        />
      </div>

      <QueueDrawer
        open={queueOpen}
        onClose={() => setQueueOpen(false)}
        queue={queue}
        activeIndex={index}
        onSelect={(i) => {
          handleSelectFromQueue(i);
        }}
        favLoaded={favLoaded}
        favTotal={favTotal}
        favLoadingMore={favLoadingMore}
        onLoadMore={() => void loadMoreFav()}
      />

      <SearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onPick={async (s) => {
          await playSong(s, []);
          setSearchOpen(false);
        }}
      />

      <LoginPanel
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onLoggedIn={handleLoggedIn}
      />

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onReloadFavorites={() => loadFavPlaylist()}
        onLogout={handleLogout}
        loginStatus={loginStatus}
        backgroundBlur={backgroundBlur}
        onBackgroundBlurChange={handleBackgroundBlurChange}
        backgroundOpacity={backgroundOpacity}
        onBackgroundOpacityChange={handleBackgroundOpacityChange}
        lyricMotionStyle={lyricMotionStyle}
        onLyricMotionStyleChange={handleLyricMotionStyleChange}
        useCoverBackground={useCoverBackground}
        onUseCoverBackgroundChange={handleUseCoverBackgroundChange}
      />
    </div>
  );
}

function SettingsPanel({
  open,
  onClose,
  onReloadFavorites,
  onLogout,
  loginStatus,
  backgroundBlur,
  onBackgroundBlurChange,
  backgroundOpacity,
  onBackgroundOpacityChange,
  lyricMotionStyle,
  onLyricMotionStyleChange,
  useCoverBackground,
  onUseCoverBackgroundChange,
}: {
  open: boolean;
  onClose: () => void;
  onReloadFavorites: () => void | Promise<void>;
  onLogout: () => void | Promise<void>;
  loginStatus: LoginStatus | null;
  backgroundBlur: number;
  onBackgroundBlurChange: (value: number) => void;
  backgroundOpacity: number;
  onBackgroundOpacityChange: (value: number) => void;
  lyricMotionStyle: LyricMotionStyle;
  onLyricMotionStyleChange: (value: LyricMotionStyle) => void;
  useCoverBackground: boolean;
  onUseCoverBackgroundChange: (value: boolean) => void;
}) {
  const [playlistId, setPlaylistId] = useState(String(getFavPlaylistId() ?? DEFAULT_FAV_PLAYLIST_ID));
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) return;
    setPlaylistId(String(getFavPlaylistId() ?? DEFAULT_FAV_PLAYLIST_ID));
    setStatus("");
  }, [open]);

  const savePlaylistId = () => {
    const nextId = Number(playlistId.trim());
    if (!Number.isFinite(nextId) || nextId <= 0) {
      setStatus("请输入有效的歌单 ID");
      return false;
    }
    setFavPlaylistId(nextId);
    setStatus("已保存");
    return true;
  };

  const reloadFavorites = async () => {
    if (!savePlaylistId()) return;
    setStatus("正在刷新歌单...");
    await onReloadFavorites();
    setStatus("歌单已刷新");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 z-50 grid place-items-center bg-black/35 backdrop-blur-sm px-6"
        >
          <motion.section
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] rounded-[20px] border border-white/14 bg-slate-950/75 backdrop-blur-2xl shadow-2xl overflow-hidden text-white"
          >
            <header className="h-14 px-5 flex items-center justify-between border-b border-white/10">
              <div className="flex items-center gap-2.5 font-bold tracking-wide">
                <Settings size={18} className="text-white/80" />
                <span>设置</span>
              </div>
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-full text-white/55 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} />
              </button>
            </header>

            <div className="p-5 space-y-5">
              <section className="rounded-2xl bg-white/[0.06] border border-white/10 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/85">账号</p>
                    <p className="mt-1 text-xs text-white/45 truncate">
                      {loginStatus?.logged_in
                        ? loginStatus.nickname || `UID ${loginStatus.uid ?? ""}`
                        : "未登录"}
                    </p>
                  </div>
                  <button
                    onClick={() => void onLogout()}
                    className="h-9 px-3 rounded-full bg-red-500/15 hover:bg-red-500/22 border border-red-300/15 text-sm font-semibold text-red-100 transition-colors inline-flex items-center gap-2"
                  >
                    <LogOut size={14} />
                    退出登录
                  </button>
                </div>
              </section>

              <section className="rounded-2xl bg-white/[0.06] border border-white/10 p-4 space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white/85">使用封面背景</p>
                    <p className="mt-1 text-xs text-white/45">将当前歌曲封面铺在播放器背景中</p>
                  </div>
                  <button
                    onClick={() => onUseCoverBackgroundChange(!useCoverBackground)}
                    className={`relative h-7 w-12 rounded-full border transition-colors ${
                      useCoverBackground
                        ? "bg-white/85 border-white/40"
                        : "bg-white/10 border-white/12"
                    }`}
                    aria-pressed={useCoverBackground}
                  >
                    <span
                      className={`absolute top-1 h-5 w-5 rounded-full transition-transform ${
                        useCoverBackground
                          ? "translate-x-[18px] bg-slate-950"
                          : "translate-x-1 bg-white/70"
                      }`}
                    />
                  </button>
                </div>

                <label className="block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-white/85">背景模糊度</span>
                    <span className="font-mono text-xs text-white/45">{backgroundBlur}px</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={60}
                    step={1}
                    value={backgroundBlur}
                    onChange={(e) => onBackgroundBlurChange(Number(e.target.value))}
                    className="w-full accent-white"
                  />
                </label>

                <label className="block">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-white/85">背景不透明度</span>
                    <span className="font-mono text-xs text-white/45">{backgroundOpacity}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    step={1}
                    value={backgroundOpacity}
                    onChange={(e) => onBackgroundOpacityChange(Number(e.target.value))}
                    className="w-full accent-white"
                  />
                </label>

                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold text-white/85">歌词动画</span>
                    <span className="font-mono text-xs text-white/45">
                      {LYRIC_MOTION_STYLE_OPTIONS.find((option) => option.value === lyricMotionStyle)?.label ?? "流动"}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 rounded-2xl bg-white/[0.06] p-1 border border-white/10">
                    {LYRIC_MOTION_STYLE_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => onLyricMotionStyleChange(value)}
                        className={`h-8 rounded-full text-xs font-bold transition-colors ${
                          lyricMotionStyle === value
                            ? "bg-white text-slate-950"
                            : "text-white/55 hover:text-white hover:bg-white/8"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <label className="block">
                <span className="block text-sm font-semibold text-white/85 mb-2">
                  我喜欢歌单 ID
                </span>
                <input
                  value={playlistId}
                  onChange={(e) => {
                    setPlaylistId(e.target.value);
                    setStatus("");
                  }}
                  inputMode="numeric"
                  className="w-full h-10 rounded-xl bg-white/8 border border-white/10 px-3 text-sm text-white outline-none focus:border-white/28 focus:bg-white/10"
                  placeholder="输入歌单 ID"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={() => {
                    setPlaylistId(String(DEFAULT_FAV_PLAYLIST_ID));
                    setStatus("");
                  }}
                  className="h-9 px-3 rounded-full text-sm font-medium text-white/65 hover:text-white hover:bg-white/10 transition-colors"
                >
                  恢复默认
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={savePlaylistId}
                    className="h-9 px-3 rounded-full bg-white/10 hover:bg-white/16 border border-white/10 text-sm font-semibold text-white transition-colors inline-flex items-center gap-2"
                  >
                    <Save size={14} />
                    保存
                  </button>
                  <button
                    onClick={() => void reloadFavorites()}
                    className="h-9 px-3 rounded-full bg-white text-slate-950 text-sm font-bold transition-colors inline-flex items-center gap-2"
                  >
                    <RefreshCw size={14} />
                    刷新歌单
                  </button>
                </div>
              </div>

              {status && (
                <p className="text-xs font-medium text-white/50">
                  {status}
                </p>
              )}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Right-side slide-in queue drawer. */
function QueueDrawer({
  open,
  onClose,
  queue,
  activeIndex,
  onSelect,
  favLoaded,
  favTotal,
  favLoadingMore,
  onLoadMore,
}: {
  open: boolean;
  onClose: () => void;
  queue: Song[];
  activeIndex: number;
  onSelect: (i: number) => void;
  favLoaded: number;
  favTotal: number;
  favLoadingMore: boolean;
  onLoadMore: () => void;
}) {
  // Virtualized-ish rendering: only render the first `limit` rows, grow on
  // scroll near the bottom. Avoids mounting 1785 <button>+<img> at once.
  const [limit, setLimit] = useState(60);
  const scrollRef = useRef<HTMLDivElement>(null);

  // reset limit when reopening / queue changes drastically
  useEffect(() => {
    if (open) setLimit(60);
  }, [open]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight > el.scrollHeight - 400;
    if (nearBottom) {
      // grow the client-side render window
      if (limit < queue.length) setLimit((l) => Math.min(l + 60, queue.length));
      // and fetch the next server page if we've rendered most of what's loaded
      if (limit + 60 >= queue.length && favLoaded < favTotal && !favLoadingMore) {
        onLoadMore();
      }
    }
  };

  const visible = queue.slice(0, limit);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-50 bg-black/40"
          />
          <motion.aside
            initial={{ x: 360, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 360, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="absolute top-0 right-0 bottom-0 z-50 w-[340px] flex flex-col bg-slate-950/85 backdrop-blur-2xl border-l border-white/10 shadow-2xl"
          >
            <header className="flex items-center justify-between px-5 h-14 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2 text-white/85">
                <ListMusic size={17} />
                <span className="font-bold tracking-wide">播放队列</span>
                <span className="text-xs text-white/40">{queue.length} 首</span>
              </div>
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-full text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X size={16} />
              </button>
            </header>
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
              {queue.length === 0 && (
                <p className="px-5 py-10 text-center text-sm text-white/35">
                  队列为空
                </p>
              )}
              {visible.map((s, i) => {
                const active = i === activeIndex;
                return (
                  <button
                    key={`${s.id}-${i}`}
                    onClick={() => onSelect(i)}
                    className={`w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors ${
                      active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
                    }`}
                  >
                    <span
                      className={`w-5 text-xs tabular-nums ${
                        active ? "text-white" : "text-white/30"
                      }`}
                    >
                      {active ? (
                        <span className="inline-block w-2 h-2 rounded-full bg-white animate-pulse" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <div className="w-10 h-10 rounded-md overflow-hidden bg-white/5 ring-1 ring-white/10 shrink-0">
                      {s.pic && (
                        <img
                          src={s.pic}
                          alt=""
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-sm ${
                          active ? "text-white font-medium" : "text-white/80"
                        }`}
                      >
                        {s.name}
                      </p>
                      <p className="truncate text-xs text-white/40">{s.artist}</p>
                    </div>
                  </button>
                );
              })}
              {favTotal > 0 && favLoaded < favTotal && (
                <div className="py-4 text-center text-xs text-white/30">
                  {favLoadingMore
                    ? "加载中…"
                    : `已加载 ${queue.length} / ${favTotal}，向下滚动加载更多`}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Live NetEase search overlay. */
function SearchOverlay({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: Song) => void | Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    setErr(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const kw = q.trim();
    if (!kw) {
      setResults([]);
      setLoading(false);
      setErr(null);
      return;
    }
    setLoading(true);
    setErr(null);
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await search(kw, 40, ctrl.signal);
        setResults(r);
        if (r.length === 0) setErr("没有找到相关歌曲");
      } catch (e: any) {
        if (e?.name !== "AbortError")
          setErr(e?.message ? `搜索失败：${e.message}` : "搜索失败，请检查 API 服务");
      } finally {
        setLoading(false);
      }
    }, 380);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 z-50 flex items-start justify-center pt-20 px-6 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: -16, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -10, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-2xl bg-slate-900/90 ring-1 ring-white/10 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
              <Search size={20} className="text-white/40 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "Enter" && results[0]) void onPick(results[0]);
                }}
                placeholder="搜索歌曲、歌手…"
                className="flex-1 bg-transparent outline-none text-white placeholder:text-white/35 text-base"
              />
              {loading && <Loader2 size={18} className="animate-spin text-white/40" />}
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-full text-white/50 hover:text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {err && !loading && (
                <p className="px-5 py-8 text-center text-sm text-white/45">{err}</p>
              )}
              {!err && !loading && results.length === 0 && !q.trim() && (
                <p className="px-5 py-8 text-center text-sm text-white/30">
                  输入关键词搜索网易云音乐
                </p>
              )}
              {results.map((s, i) => (
                <button
                  key={`${s.id}-${i}`}
                  onClick={() => void onPick(s)}
                  className="w-full flex items-center gap-3 px-5 py-2.5 text-left hover:bg-white/[0.06] transition-colors"
                >
                  <div className="w-10 h-10 rounded-md overflow-hidden bg-white/5 ring-1 ring-white/10 shrink-0">
                    {s.pic && <img src={s.pic} alt="" className="w-full h-full object-cover" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">{s.name}</p>
                    <p className="truncate text-xs text-white/45">{s.artist}</p>
                  </div>
                  {s.album && (
                    <span className="hidden sm:block truncate text-xs text-white/35 max-w-[140px]">
                      {s.album}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
