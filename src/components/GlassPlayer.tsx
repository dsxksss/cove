import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  MoreHorizontal,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Volume1,
  Plus,
  Languages,
  Minus,
  X,
  Clipboard,
  Maximize2,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
  LocateFixed,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Sparkles,
  ListMusic,
} from 'lucide-react';
// LiquidGlassCanvas (WebGL glass) removed for performance — pure CSS
// backdrop-filter is used on the player card instead.
import { LyricMotionStyle, Song, PlayerLayout } from './playerTypes';
import { getLyricLineMotion, isFoliaAbsoluteStyle } from './lyricMotion';
import FoliaLyricsRail from './FoliaLyricsRail';
import { LEVEL_OPTIONS } from '../lib/playbackPrefs';
import type { LyricSourceMode } from '../lib/lyrics/matchLyrics';
import { useScrollEdgeFriction } from '../hooks/useScrollEdgeFriction';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

const LYRIC_MOTION_OPTIONS: Array<{ value: LyricMotionStyle; label: string }> = [
  { value: "monet", label: "莫奈" },
  { value: "fume", label: "浮名" },
  { value: "classic", label: "流光" },
  { value: "rail", label: "滚动" },
  { value: "dialogue", label: "对话" },
];

const LYRIC_SOURCE_OPTIONS: Array<{ value: LyricSourceMode; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "netease", label: "网易云音乐" },
  { value: "qq", label: "QQ音乐" },
  { value: "kugou", label: "酷狗音乐" },
];

interface GlassPlayerProps {
  song: Song;
  isPlaying: boolean;
  currentTime: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onOpenQueue: () => void;
  onLyricsPanelHoverChange?: (hovered: boolean) => void;
  onSeek: (time: number) => void;
  layout: PlayerLayout;
  onToggleLayout: (layout: PlayerLayout) => void;
  lyricOffsetSeconds: number;
  onLyricOffsetChange: (offsetSeconds: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  onOpenSettings: () => void;
  onReloadFavorites: () => void | Promise<void>;
  backgroundBlur: number;
  backgroundOpacity: number;
  lyricMotionStyle: LyricMotionStyle;
  onLyricMotionStyleChange: (value: LyricMotionStyle) => void;
  lyricSourceMode: LyricSourceMode;
  onLyricSourceModeChange: (value: LyricSourceMode) => void;
  level: string;
  onLevelChange: (level: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  useCoverBackground: boolean;
  /** whether to render the translated line (tr) beneath the original */
  showTranslation: boolean;
  onToggleTranslation: () => void;
  onMinimize: () => void;
  onClose: () => void;
  /** unified play mode: list | one | shuffle */
  playMode: "list" | "one" | "shuffle";
  onCyclePlayMode: () => void;
  /** jh3yy-style motion intensity */
  motionLevel?: "off" | "light" | "full";
}

export default function GlassPlayer({
  song,
  isPlaying,
  currentTime,
  onPlayPause,
  onNext,
  onPrev,
  onOpenQueue,
  onLyricsPanelHoverChange,
  onSeek,
  layout,
  onToggleLayout,
  lyricOffsetSeconds,
  onLyricOffsetChange,
  volume,
  onVolumeChange,
  onOpenSettings,
  onReloadFavorites,
  backgroundBlur,
  backgroundOpacity,
  lyricMotionStyle,
  onLyricMotionStyleChange,
  lyricSourceMode,
  onLyricSourceModeChange,
  level,
  onLevelChange,
  speed,
  onSpeedChange,
  useCoverBackground,
  showTranslation,
  onToggleTranslation,
  onMinimize,
  onClose,
  playMode,
  onCyclePlayMode,
  motionLevel = "light",
}: GlassPlayerProps) {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [seekPop, setSeekPop] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const morePanelRef = useRef<HTMLDivElement>(null);
  const volumePanelRef = useRef<HTMLDivElement>(null);
  const lyricQuickRef = useRef<HTMLDivElement>(null);
  const lyricsChromeLeaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  type MorePage =
    | "root"
    | "quality"
    | "speed"
    | "lyrics"
    | "motion"
    | "source";

  // State
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [morePage, setMorePage] = useState<MorePage>("root");
  /** Volume slider is toggled by its own button (not the More menu). */
  const [volumeOpen, setVolumeOpen] = useState(false);
  /** Fixed position for More popover (portal — avoids overflow:hidden clipping). */
  const [moreMenuBox, setMoreMenuBox] = useState<{
    top?: number;
    bottom?: number;
    right: number;
    maxHeight: number;
  } | null>(null);
  /** Sticky hover for lyrics chrome — CSS group-hover fails over Tauri drag regions. */
  const [lyricsPanelHovered, setLyricsPanelHovered] = useState(false);
  /** Window controls have their own top-right hover target. */
  const [windowChromeHovered, setWindowChromeHovered] = useState(false);
  const canUseSongActions = song.id !== 'empty';

  // Lyrics footer (offset / follow) — only while hovering the lyrics panel.
  const lyricsChromeOpen = lyricsPanelHovered;

  const closeMoreMenu = () => {
    setIsMoreOpen(false);
    setMorePage("root");
    setMoreMenuBox(null);
  };

  const openMoreMenu = () => {
    setMorePage("root");
    setIsMoreOpen((v) => !v);
    // Don't couple volume to more; leave volumeOpen as-is.
  };

  // Place More menu in a fixed portal so left-panel overflow-hidden cannot clip it.
  useLayoutEffect(() => {
    if (!isMoreOpen) {
      setMoreMenuBox(null);
      return;
    }
    const place = () => {
      const btn = moreBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const gap = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      // Prefer opening upward (more room over the cover); flip if needed.
      const openUp = spaceBelow < 260 || spaceAbove >= spaceBelow;
      const maxHeight = Math.max(
        160,
        Math.min(400, openUp ? spaceAbove : spaceBelow)
      );
      setMoreMenuBox(
        openUp
          ? {
              bottom: window.innerHeight - rect.top + gap,
              right: Math.max(8, window.innerWidth - rect.right),
              maxHeight,
            }
          : {
              top: rect.bottom + gap,
              right: Math.max(8, window.innerWidth - rect.right),
              maxHeight,
            }
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isMoreOpen, morePage]);

  const toggleVolumeOpen = () => {
    setVolumeOpen((v) => !v);
  };

  const clearLyricsChromeLeaveTimer = () => {
    if (lyricsChromeLeaveTimer.current != null) {
      clearTimeout(lyricsChromeLeaveTimer.current);
      lyricsChromeLeaveTimer.current = null;
    }
  };

  const handleLyricsPanelEnter = () => {
    clearLyricsChromeLeaveTimer();
    setLyricsPanelHovered(true);
  };

  const handleLyricsPanelLeave = () => {
    clearLyricsChromeLeaveTimer();
    // Delay hide so the cursor can travel onto top/footer controls without flicker.
    lyricsChromeLeaveTimer.current = setTimeout(() => {
      setLyricsPanelHovered(false);
      lyricsChromeLeaveTimer.current = null;
    }, 280);
  };

  useEffect(() => {
    return () => clearLyricsChromeLeaveTimer();
  }, []);

  useEffect(() => {
    if (layout !== "lyrics") {
      clearLyricsChromeLeaveTimer();
      setLyricsPanelHovered(false);
      setWindowChromeHovered(false);
    }
  }, [layout]);

  useEffect(() => {
    onLyricsPanelHoverChange?.(lyricsPanelHovered);
    return () => {
      if (lyricsPanelHovered) onLyricsPanelHoverChange?.(false);
    };
  }, [lyricsPanelHovered, onLyricsPanelHoverChange]);

  const levelLabel = LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level;
  const speedLabel = `${String(speed).replace(/\.0$/, "")}×`;
  const motionLabel =
    LYRIC_MOTION_OPTIONS.find((o) => o.value === lyricMotionStyle)?.label ?? "动画";
  const sourceLabel =
    LYRIC_SOURCE_OPTIONS.find((o) => o.value === lyricSourceMode)?.label ?? "来源";

  useEffect(() => {
    if (!isMoreOpen && !volumeOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const t = event.target as Node;
      const el = event.target as HTMLElement | null;
      if (
        moreMenuRef.current?.contains(t) ||
        morePanelRef.current?.contains(t)
      ) {
        /* keep more */
      } else if (isMoreOpen) {
        closeMoreMenu();
      }
      const inVolume =
        volumePanelRef.current?.contains(t) ||
        Boolean(el?.closest?.("[data-volume-panel]"));
      if (!inVolume && volumeOpen) {
        setVolumeOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isMoreOpen) {
        if (morePage !== "root") setMorePage("root");
        else closeMoreMenu();
        return;
      }
      if (volumeOpen) setVolumeOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isMoreOpen, morePage, volumeOpen]);

  useEffect(() => {
    if (!isDraggingProgress) return;
    const stopDragging = () => setIsDraggingProgress(false);
    window.addEventListener('mouseup', stopDragging);
    window.addEventListener('mouseleave', stopDragging);
    return () => {
      window.removeEventListener('mouseup', stopDragging);
      window.removeEventListener('mouseleave', stopDragging);
    };
  }, [isDraggingProgress]);

  // Formatting utilities
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // Guard against duration=0 (NaN/Infinity width freezes the bar visually).
  const safeDuration = Number.isFinite(song.duration) && song.duration > 0 ? song.duration : 0;
  const progressPercent =
    safeDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / safeDuration) * 100))
      : 0;

  // Handles
  const seekFromProgressClientX = (clientX: number, pop = false) => {
    if (!progressBarRef.current || safeDuration <= 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    onSeek(clickRatio * safeDuration);
    if (pop && motionLevel !== "off") {
      setSeekPop(true);
      window.setTimeout(() => setSeekPop(false), 320);
    }
  };

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingProgress(true);
    seekFromProgressClientX(e.clientX, true);
  };

  const handleProgressDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingProgress || e.buttons !== 1) return;
    seekFromProgressClientX(e.clientX);
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    onVolumeChange(clickRatio);
  };

  const copySongInfo = async () => {
    if (!canUseSongActions) return;
    const info = `${song.title} - ${song.artist}`;
    await navigator.clipboard?.writeText(info).catch(() => {});
  };

  // Find active lyric index
  const lyricCurrentTime = Math.max(0, currentTime + lyricOffsetSeconds);

  const activeLyricIndex = song.lyrics.reduce((acc, line, idx) => {
    if (lyricCurrentTime >= line.time) {
      return idx;
    }
    return acc;
  }, -1);

  const lyricAnchorIndex = useMemo(() => {
    if (activeLyricIndex >= 0) return activeLyricIndex;
    const upcomingIndex = song.lyrics.findIndex((line) => line.time > lyricCurrentTime);
    return upcomingIndex >= 0 ? upcomingIndex : 0;
  }, [activeLyricIndex, lyricCurrentTime, song.lyrics]);

  // ---- Manual lyric scrolling ----
  // null = follow the active line. number = user is browsing manually.
  // Manual browsing remains locked until the user selects a line or taps
  // "回到当前"; an idle timer must not pull the list away before they click.
  const [manualAnchor, setManualAnchor] = useState<number | null>(null);
  // Spotlight for blur/scale/opacity:
  //   auto-follow  → playing line (original rail effect)
  //   manual browse → line nearest viewport center (same curves, different anchor)
  const [visualFocusIndex, setVisualFocusIndex] = useState(0);
  const lyricScrollRef = useRef<HTMLDivElement>(null);
  const lyricLineRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<number | null>(null);
  const ignoreUserScrollUntilRef = useRef(0);
  const focusRafRef = useRef<number | null>(null);

  useScrollEdgeFriction(
    lyricScrollRef,
    layout === "lyrics" && !isFoliaAbsoluteStyle(lyricMotionStyle),
  );

  const findLineNearestViewportCenter = () => {
    const container = lyricScrollRef.current;
    if (!container) return lyricAnchorIndex;
    // Match scrollLyricIntoCenter's optical center (~44% from top).
    const centerY = container.scrollTop + container.clientHeight * 0.44;
    let bestIndex = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < lyricLineRefs.current.length; i++) {
      const row = lyricLineRefs.current[i];
      if (!row) continue;
      const mid = row.offsetTop + row.offsetHeight / 2;
      const dist = Math.abs(mid - centerY);
      if (dist < bestDist) {
        bestDist = dist;
        bestIndex = i;
      }
    }
    return bestIndex;
  };

  const scheduleVisualFocusFromScroll = () => {
    if (focusRafRef.current != null) return;
    focusRafRef.current = window.requestAnimationFrame(() => {
      focusRafRef.current = null;
      setVisualFocusIndex(findLineNearestViewportCenter());
    });
  };

  const scrollLyricIntoCenter = (index: number, behavior: ScrollBehavior = "smooth") => {
    const container = lyricScrollRef.current;
    const row = lyricLineRefs.current[index];
    if (!container || !row) return;

    if (programmaticScrollTimerRef.current != null) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }

    programmaticScrollRef.current = true;
    const targetTop =
      row.offsetTop - container.clientHeight * 0.44 + row.offsetHeight / 2;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior,
    });
    // Smooth scroll can keep emitting residual scroll events after the timer;
    // keep a short grace window so auto-follow is not mis-detected as manual.
    const lockMs = behavior === "smooth" ? 900 : 120;
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollRef.current = false;
      programmaticScrollTimerRef.current = null;
      ignoreUserScrollUntilRef.current = performance.now() + 180;
    }, lockMs);
  };

  useEffect(() => {
    // Folia absolute rails (莫奈/浮名/流光) own their own layout — no native scroll.
    if (layout !== "lyrics" || manualAnchor != null || isFoliaAbsoluteStyle(lyricMotionStyle)) return;
    scrollLyricIntoCenter(lyricAnchorIndex, activeLyricIndex < 1 ? "auto" : "smooth");
  }, [activeLyricIndex, lyricAnchorIndex, layout, manualAnchor, song.id, lyricMotionStyle]);

  // Auto-follow: spotlight hard-locks to the playing line (original behavior).
  useEffect(() => {
    if (manualAnchor != null) return;
    setVisualFocusIndex(Math.max(0, lyricAnchorIndex));
  }, [lyricAnchorIndex, manualAnchor]);

  const resumeAutoFollow = () => {
    programmaticScrollRef.current = false;
    // Clearing manualAnchor re-enables the auto-scroll + spotlight effects
    // (see effects keyed on manualAnchor / lyricAnchorIndex).
    setManualAnchor(null);
  };

  // Clear any pending programmatic scroll timer on unmount / song change.
  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current != null) {
        clearTimeout(programmaticScrollTimerRef.current);
        programmaticScrollTimerRef.current = null;
      }
      if (focusRafRef.current != null) {
        cancelAnimationFrame(focusRafRef.current);
        focusRafRef.current = null;
      }
      programmaticScrollRef.current = false;
    };
  }, [song.id]);

  // Reset manual lock when switching songs
  useEffect(() => {
    setManualAnchor(null);
    programmaticScrollRef.current = false;
    setVisualFocusIndex(0);
  }, [song.id]);

  const enterManualLyricScroll = () => {
    if (programmaticScrollRef.current) return;
    if (performance.now() < ignoreUserScrollUntilRef.current) return;
    if (programmaticScrollTimerRef.current != null) {
      clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = null;
    }
    programmaticScrollRef.current = false;
    setManualAnchor((prev) => prev ?? lyricAnchorIndex);
    scheduleVisualFocusFromScroll();
  };

  const handleLyricScroll = () => {
    if (programmaticScrollRef.current) return;
    if (performance.now() < ignoreUserScrollUntilRef.current) return;
    enterManualLyricScroll();
    scheduleVisualFocusFromScroll();
  };

  const handleLyricWheel = () => {
    enterManualLyricScroll();
  };

  /** Folia absolute rail: wheel steps focus index (parent schedules auto-resume). */
  const handleFoliaManualStep = (nextIndex: number) => {
    if (programmaticScrollRef.current) return;
    setManualAnchor(nextIndex);
    setVisualFocusIndex(nextIndex);
  };

  const lyricRenderStyle: LyricMotionStyle = lyricMotionStyle;
  const seekToLyricTime = (lineTime: number) => {
    // lyricCurrentTime = playback + offset, so invert the offset when seeking
    // to make the clicked line become active at the exact destination.
    onSeek(Math.max(0, lineTime - lyricOffsetSeconds));
  };

  const activeLyricProgress = useMemo(() => {
    if (activeLyricIndex < 0) return 0;
    const activeLine = song.lyrics[activeLyricIndex];
    if (!activeLine) return 0;
    const nextTime = song.lyrics[activeLyricIndex + 1]?.time ?? safeDuration;
    const duration = Math.max(0.2, nextTime - activeLine.time);
    return Math.min(1, Math.max(0, (lyricCurrentTime - activeLine.time) / duration));
  }, [activeLyricIndex, lyricCurrentTime, safeDuration, song.lyrics]);

  // Adjust lyric sync offset. Positive values make lyrics advance earlier.
  const increaseLyricOffset = () => {
    onLyricOffsetChange(lyricOffsetSeconds + 0.1);
  };

  const decreaseLyricOffset = () => {
    onLyricOffsetChange(lyricOffsetSeconds - 0.1);
  };

  const backgroundImageUrl = song.backgroundUrl || song.coverUrl;
  const glassTintOpacity = Math.min(80, Math.max(0, backgroundOpacity)) / 100;
  const motionClass =
    motionLevel === "off"
      ? "motion-off"
      : motionLevel === "full"
        ? "motion-pop motion-full"
        : "motion-pop";

  const progressTrack = (compact: boolean) => (
    <div
      ref={progressBarRef}
      onMouseDown={handleProgressMouseDown}
      onMouseMove={handleProgressDrag}
      className={`progress-track ${compact ? "h-4 flex-1" : "h-6 w-full"} ${
        isDraggingProgress ? "is-dragging" : ""
      } ${seekPop ? "is-seek-pop" : ""}`}
    >
      <div className="progress-track__rail" />
      <div
        className="progress-track__fill"
        style={{ width: `${progressPercent}%` }}
      />
      <div
        className="progress-track__thumb"
        style={{ left: `${progressPercent}%` }}
      />
    </div>
  );

  return (
    <div
      id="unified-player-card"
      data-glow={motionLevel === "full" ? "" : undefined}
      className={`player-liquid-glass relative overflow-hidden text-white select-none flex flex-row items-stretch ${motionClass}`}
      style={
        {
          width: "100%",
          height: "100%",
          borderRadius: "20px",
          /* Pure-CSS liquid glass — fast (WebView2 native backdrop-filter).
             No WebGL/Canvas, no cover background, no theme glow.
             Desktop wallpaper shows through, frosted + saturated by this. */
          background: `rgba(8, 10, 14, ${glassTintOpacity})`,
          backdropFilter: `blur(${backgroundBlur}px) saturate(180%) brightness(1.08)`,
          WebkitBackdropFilter: `blur(${backgroundBlur}px) saturate(180%) brightness(1.08)`,
          boxShadow:
            "inset 0 1px 1px rgba(255,255,255,0.55), inset 1px 0 1px rgba(255,255,255,0.20), inset -1px 0 1px rgba(255,255,255,0.08), inset 0 -1px 1px rgba(255,255,255,0.18), 0 0 0 1px rgba(255,255,255,0.14), 0 26px 64px -18px rgba(0,0,0,0.6)",
          ["--glow-hue" as string]: "210",
          ["--player-theme-color" as string]: song.themeColor || "rgba(255,255,255,0.9)",
        } as React.CSSProperties
      }
    >
      <div className="player-glow-spotlight" aria-hidden />
      <div className="player-glow-rim" aria-hidden />
      {/* Titlebar drag — ABOVE panels (z-40) so the window is always movable.
          Interactive chrome is a higher sibling (z-50) with no-drag; only the
          actual button clusters use pointer-events-auto so empty gaps still drag. */}
      <div
        data-tauri-drag-region
        aria-hidden
        className={`absolute inset-x-0 top-0 z-40 pointer-events-auto ${
          layout === "mini" ? "h-16" : "h-12"
        }`}
      />

      {/* Window chrome — an independent top-right hover target, unrelated to lyrics hover. */}
      {layout === "lyrics" && (
        <div
          onPointerEnter={() => setWindowChromeHovered(true)}
          onPointerLeave={() => setWindowChromeHovered(false)}
          className="absolute right-0 top-0 z-50 flex h-12 w-24 items-center justify-end pr-3 no-drag"
          style={{ WebkitAppRegion: "no-drag", appRegion: "no-drag" } as React.CSSProperties}
        >
          <div
            className={`flex items-center gap-1 transition-all duration-200 ${
              windowChromeHovered
                ? "translate-y-0 opacity-100"
                : "pointer-events-none -translate-y-1 opacity-0"
            }`}
          >
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onMinimize}
              title="最小化"
              className="grid place-items-center w-8 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer no-drag"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={onClose}
              title="关闭"
              className="grid place-items-center w-8 h-7 rounded-md text-white/60 hover:text-white hover:bg-red-500/80 transition-colors cursor-pointer no-drag"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}
      {useCoverBackground && backgroundImageUrl && (
        <div className="absolute inset-0 z-0 overflow-hidden rounded-[20px] pointer-events-none">
          <img
            key={backgroundImageUrl}
            src={backgroundImageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover scale-110 opacity-55 saturate-[1.18] brightness-75"
            style={{ filter: `blur(${Math.max(0, backgroundBlur)}px)` }}
          />
          <div className="absolute inset-0 bg-black/35" />
        </div>
      )}

      {/* ========================================================= */}
      {/* 1. MINI LAYOUT */}
      {/* ========================================================= */}
      {layout === 'mini' && (
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }}
          className="player-liquid-content relative flex flex-col justify-between w-full h-full p-5"
        >
          <div
            data-tauri-drag-region
            aria-hidden
            className="absolute inset-x-0 top-0 z-10 h-24"
          />
          {/* Top Row: Mini Info — above titlebar drag; interactive bits are no-drag */}
          <div className="relative z-50 flex items-center gap-3.5 w-full no-drag">
            <motion.div 
              layoutId="album-art"
              className="w-[52px] h-[52px] rounded-xl overflow-hidden shadow-md flex-shrink-0"
              animate={{ scale: isPlaying ? 1.04 : 0.96 }}
              transition={{ duration: 0.5 }}
            >
              {song.coverUrl && (
                <img
                  key={song.coverUrl}
                  src={song.coverUrl}
                  alt={song.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
              )}
            </motion.div>
            
            <div key={song.id} className="flex-1 min-w-0 pr-1 song-meta-enter">
              <motion.h3 
                layoutId="song-title"
                className="text-[15px] font-bold tracking-tight text-white uppercase truncate font-sans text-left"
              >
                {song.title}
              </motion.h3>
              <motion.p 
                layoutId="song-artist"
                className="text-[12px] font-medium text-white/55 truncate flex items-center gap-1.5 mt-0.5"
              >
                <span>{song.artist}</span>
                <span className="inline-block w-1 h-1 bg-white/40 rounded-full" />
                <span className="text-[10px] font-bold text-white/40 tracking-wider uppercase font-sans">
                  {song.badge}
                </span>
              </motion.p>
            </div>

            {isPlaying && (
              <div className="flex items-end gap-0.5 h-3.5 pr-2">
                <span className="w-[2px] bg-white rounded-full animate-[bounce_0.8s_infinite_100ms]" style={{ height: '40%' }} />
                <span className="w-[2px] bg-white rounded-full animate-[bounce_0.8s_infinite_300ms]" style={{ height: '100%' }} />
                <span className="w-[2px] bg-white rounded-full animate-[bounce_0.8s_infinite_200ms]" style={{ height: '60%' }} />
              </div>
            )}
          </div>

          {/* Middle Row: Progress Slider */}
          <div className="flex items-center gap-2 text-[10px] font-bold text-white/50 font-mono tracking-wider">
            <span className="w-8 text-right">{formatTime(currentTime)}</span>
            {progressTrack(true)}
            <span className="w-8 text-left">{formatTime(safeDuration)}</span>
          </div>

          {/* Bottom Row: Compact Controls */}
          <div className="flex items-center justify-between mt-1 px-1">
            <div className="flex items-center gap-1.5">
              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => onToggleLayout('vertical')}
                className="liquid-glass-solid flex items-center justify-center cursor-pointer"
                style={{ ["--lg-solid-size" as string]: "2rem" }}
                title="Expand to Full Player"
              >
                <Maximize2 size={15} />
              </motion.button>
            </div>

            <div className="flex items-center gap-2.5">
              <motion.button
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                onClick={onPrev}
                className="liquid-glass-play w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shrink-0"
              >
                <span className="play-glow" aria-hidden />
                <SkipBack size={14} fill="currentColor" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                onClick={onPlayPause}
                className="liquid-glass-play w-9 h-9 rounded-full flex items-center justify-center cursor-pointer shrink-0"
              >
                <span className="play-glow" aria-hidden />
                {isPlaying ? (
                  <Pause size={16} fill="currentColor" strokeWidth={1} />
                ) : (
                  <Play size={16} fill="currentColor" className="ml-0.5" strokeWidth={1} />
                )}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.06 }}
                whileTap={{ scale: 0.92 }}
                onClick={onNext}
                className="liquid-glass-play w-8 h-8 rounded-full flex items-center justify-center cursor-pointer shrink-0"
              >
                <span className="play-glow" aria-hidden />
                <SkipForward size={14} fill="currentColor" />
              </motion.button>

              <motion.button
                type="button"
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onOpenQueue}
                className="liquid-glass-solid flex items-center justify-center cursor-pointer"
                style={{ ["--lg-solid-size" as string]: "2rem" }}
                title="播放队列"
                aria-label="播放队列"
              >
                <ListMusic size={15} />
              </motion.button>
            </div>

            <div className="w-8 shrink-0" aria-hidden />
          </div>
        </motion.div>
      )}

      {/* ========================================================= */}
      {/* 2. VERTICAL & LYRICS EXPANDED LAYOUT */}
      {/* ========================================================= */}
      {layout !== 'mini' && (
        <>
          {/* LEFT PLAYER PANEL (Vertical Control Card)
              Do NOT put data-tauri-drag-region on the whole panel — WebView2 can
              swallow button clicks (e.g. cycle play mode) and leave the window
              feeling "stuck". Drag only on cover / title chrome. */}
          {/*
            Early layout (liquid-glass checkpoint):
            3 justify-between children — cover | meta(title+progress) | transport.
            Do NOT nest transport inside meta (that collapses the rhythm).
          */}
          <div
            className="player-liquid-content relative z-20 w-[360px] h-full p-7 flex flex-col justify-between flex-shrink-0 rounded-l-[20px] overflow-hidden"
          >
            {/* 1) Cover */}
            <motion.div 
              layoutId="album-art"
              data-tauri-drag-region
              className="relative w-full h-[320px] rounded-[24px] overflow-hidden group shadow-lg flex-shrink-0"
            >
              {song.coverUrl && (
                <>
                  <motion.img
                    key={song.coverUrl}
                    src={song.coverUrl}
                    alt={song.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover rounded-[24px] select-none pointer-events-none"
                    animate={{ scale: isPlaying ? 1.02 : 0.98 }}
                    transition={{ duration: 0.8 }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/40 pointer-events-none" />
                </>
              )}
            </motion.div>

            {/* 2) Meta — title/more + progress only (gap-5 mt-4 as original) */}
            <div className="flex flex-col gap-5 mt-4 flex-shrink-0">
              <div className="flex items-center justify-between w-full">
                <div
                  key={song.id}
                  data-tauri-drag-region
                  className="flex-1 min-w-0 pr-4 text-left song-meta-enter"
                >
                  <motion.h2 
                    layoutId="song-title"
                    className="text-xl font-bold tracking-tight text-white uppercase truncate font-sans"
                  >
                    {song.title}
                  </motion.h2>
                  <motion.p 
                    layoutId="song-artist"
                    className="text-[14px] font-medium text-white/60 truncate mt-0.5 font-sans"
                  >
                    {song.artist}
                  </motion.p>
                </div>

                <div className="flex items-center gap-2.5 flex-shrink-0 no-drag">
                  <div ref={volumePanelRef} className="relative">
                    <motion.button
                      type="button"
                      whileHover={{ scale: 1.06 }}
                      whileTap={{ scale: 0.94 }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={toggleVolumeOpen}
                      title={volumeOpen ? "收起音量" : "音量"}
                      className={`liquid-glass-solid flex items-center justify-center cursor-pointer ${
                        volumeOpen ? "liquid-glass-solid--active" : ""
                      }`}
                      style={{ ["--lg-solid-size" as string]: "2.25rem" }}
                    >
                      <Volume1 size={17} />
                    </motion.button>
                  </div>

                  <div ref={moreMenuRef} className="relative shrink-0">
                  <motion.button
                    ref={moreBtnRef}
                    type="button"
                    whileHover={{ scale: 1.06 }}
                    whileTap={{ scale: 0.94 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={openMoreMenu}
                    title="更多"
                    className={`liquid-glass-solid flex items-center justify-center cursor-pointer ${
                      isMoreOpen ? "liquid-glass-solid--active" : ""
                    }`}
                    style={{ ["--lg-solid-size" as string]: "2.25rem" }}
                  >
                    <MoreHorizontal size={17} />
                  </motion.button>

                  {typeof document !== "undefined" &&
                    createPortal(
                  <AnimatePresence mode="wait">
                    {isMoreOpen && moreMenuBox && (
                      <motion.div
                        ref={morePanelRef}
                        key={morePage}
                        initial={{ opacity: 0, y: moreMenuBox.bottom != null ? 6 : -6, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: moreMenuBox.bottom != null ? 4 : -4, scale: 0.98 }}
                        transition={{ duration: 0.14 }}
                        style={{
                          position: "fixed",
                          top: moreMenuBox.top,
                          bottom: moreMenuBox.bottom,
                          right: moreMenuBox.right,
                          maxHeight: moreMenuBox.maxHeight,
                          zIndex: 10000,
                        }}
                        className="app-liquid-popover w-56 overflow-y-auto overscroll-contain rounded-2xl no-drag scrollbar-none"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                          {/* ── Root ── */}
                          {morePage === "root" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("quality")}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Gauge size={15} className="text-white/45 shrink-0" />
                                <span className="flex-1">音质</span>
                                <span className="text-[11px] font-bold text-white/40">{levelLabel}</span>
                                <ChevronRight size={14} className="text-white/30" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setMorePage("speed")}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Sparkles size={15} className="text-white/45 shrink-0" />
                                <span className="flex-1">倍速</span>
                                <span className="text-[11px] font-mono font-bold text-white/40">{speedLabel}</span>
                                <ChevronRight size={14} className="text-white/30" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setMorePage("lyrics")}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Languages size={15} className="text-white/45 shrink-0" />
                                <span className="flex-1">歌词</span>
                                <span className="max-w-[5.5rem] truncate text-[11px] font-bold text-white/40">
                                  {motionLabel} · {sourceLabel}
                                </span>
                                <ChevronRight size={14} className="text-white/30" />
                              </button>
                              <div className="my-1 h-px bg-white/8" />
                              <button
                                type="button"
                                onClick={() => {
                                  void onReloadFavorites();
                                  closeMoreMenu();
                                }}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Repeat size={15} className="text-white/45 shrink-0" />
                                刷新我喜欢
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  void copySongInfo();
                                  closeMoreMenu();
                                }}
                                disabled={!canUseSongActions}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:text-white/25 disabled:hover:bg-transparent"
                              >
                                <Clipboard size={15} className="text-white/45 shrink-0" />
                                复制歌曲信息
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  onOpenSettings();
                                  closeMoreMenu();
                                }}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Settings size={15} className="text-white/45 shrink-0" />
                                设置
                              </button>
                            </div>
                          )}

                          {/* ── Quality ── */}
                          {morePage === "quality" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("root")}
                                className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[12px] font-bold text-white/55 hover:bg-white/8 hover:text-white/80"
                              >
                                <ChevronLeft size={14} />
                                音质
                              </button>
                              <div className="mx-2 mb-1 h-px bg-white/8" />
                              {LEVEL_OPTIONS.map(({ value, label, hint }) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    onLevelChange(value);
                                    closeMoreMenu();
                                  }}
                                  className={`flex h-9 w-full items-center justify-between px-3 text-left text-[12px] font-semibold ${
                                    level === value
                                      ? "bg-white/12 text-white"
                                      : "text-white/70 hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  <span>{label}</span>
                                  <span className={level === value ? "text-white/50" : "text-white/30"}>
                                    {hint}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )}

                          {/* ── Speed ── */}
                          {morePage === "speed" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("root")}
                                className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[12px] font-bold text-white/55 hover:bg-white/8 hover:text-white/80"
                              >
                                <ChevronLeft size={14} />
                                倍速
                              </button>
                              <div className="mx-2 mb-1 h-px bg-white/8" />
                              {SPEED_OPTIONS.map((s) => (
                                <button
                                  key={s}
                                  type="button"
                                  onClick={() => {
                                    onSpeedChange(s);
                                    closeMoreMenu();
                                  }}
                                  className={`flex h-9 w-full items-center px-3 text-left font-mono text-[12px] font-bold ${
                                    speed === s
                                      ? "bg-white/12 text-white"
                                      : "text-white/70 hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  {s}×
                                </button>
                              ))}
                            </div>
                          )}

                          {/* ── Lyrics hub ── */}
                          {morePage === "lyrics" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("root")}
                                className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[12px] font-bold text-white/55 hover:bg-white/8 hover:text-white/80"
                              >
                                <ChevronLeft size={14} />
                                歌词
                              </button>
                              <div className="mx-2 mb-1 h-px bg-white/8" />
                              <button
                                type="button"
                                onClick={() => setMorePage("motion")}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <span className="flex-1">动画样式</span>
                                <span className="text-[11px] font-bold text-white/40">{motionLabel}</span>
                                <ChevronRight size={14} className="text-white/30" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setMorePage("source")}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <span className="flex-1">歌词来源</span>
                                <span className="text-[11px] font-bold text-white/40">{sourceLabel}</span>
                                <ChevronRight size={14} className="text-white/30" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onToggleTranslation()}
                                className="flex h-10 w-full items-center gap-2.5 px-3 text-left text-[13px] font-semibold text-white/80 hover:bg-white/10 hover:text-white"
                              >
                                <Languages size={15} className="text-white/45 shrink-0" />
                                <span className="flex-1">显示翻译</span>
                                <span className="text-[11px] font-bold text-white/45">
                                  {showTranslation ? "开" : "关"}
                                </span>
                              </button>
                            </div>
                          )}

                          {/* ── Motion styles ── */}
                          {morePage === "motion" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("lyrics")}
                                className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[12px] font-bold text-white/55 hover:bg-white/8 hover:text-white/80"
                              >
                                <ChevronLeft size={14} />
                                动画样式
                              </button>
                              <div className="mx-2 mb-1 h-px bg-white/8" />
                              {LYRIC_MOTION_OPTIONS.map(({ value, label }) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    onLyricMotionStyleChange(value);
                                    setMorePage("lyrics");
                                  }}
                                  className={`flex h-9 w-full items-center px-3 text-left text-[12px] font-semibold ${
                                    lyricMotionStyle === value
                                      ? "bg-white/12 text-white"
                                      : "text-white/70 hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* ── Lyric source ── */}
                          {morePage === "source" && (
                            <div className="py-1">
                              <button
                                type="button"
                                onClick={() => setMorePage("lyrics")}
                                className="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[12px] font-bold text-white/55 hover:bg-white/8 hover:text-white/80"
                              >
                                <ChevronLeft size={14} />
                                歌词来源
                              </button>
                              <div className="mx-2 mb-1 h-px bg-white/8" />
                              {LYRIC_SOURCE_OPTIONS.map(({ value, label }) => (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    onLyricSourceModeChange(value);
                                    setMorePage("lyrics");
                                  }}
                                  className={`flex h-9 w-full items-center px-3 text-left text-[12px] font-semibold ${
                                    lyricSourceMode === value
                                      ? "bg-white/12 text-white"
                                      : "text-white/70 hover:bg-white/10 hover:text-white"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>,
                      document.body
                    )}
                  </div>
                  </div>
                </div>

              {/* Progress Track */}
              <div className="flex flex-col gap-2 no-drag">
                {progressTrack(false)}

                <div className="flex items-center justify-between text-[11px] font-semibold text-white/50 tracking-wider font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(safeDuration)}</span>
                </div>
              </div>
            </div>

            {/*
              3) Bottom stack — volume + transport as one justify-between child.
              Opening volume only grows this stack; transport layout-animates down/up.
            */}
            <div className="flex flex-col items-stretch flex-shrink-0 no-drag mb-1">
              <AnimatePresence initial={false}>
                {volumeOpen && (
                  <motion.div
                    key="volume-reveal"
                    initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                    animate={{ opacity: 1, height: "auto", marginBottom: 10 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ type: "spring", damping: 28, stiffness: 320 }}
                    className="overflow-hidden"
                    data-volume-panel=""
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <div
                      className="nested-radius flex items-center gap-2 rounded-full border border-white/8 bg-white/8 px-3 py-2"
                      title="音量"
                    >
                      <Volume1 size={14} className="text-white/45 shrink-0" />
                      <div
                        onClick={handleVolumeClick}
                        className="relative h-3 w-full flex items-center cursor-pointer"
                      >
                        <div className="absolute left-0 right-0 h-[3px] bg-white/15 rounded-full" />
                        <div
                          className="absolute left-0 h-[3px] bg-white/80 rounded-full"
                          style={{ width: `${volume * 100}%` }}
                        />
                      </div>
                      <span className="w-8 shrink-0 text-right font-mono text-[10px] font-bold text-white/45">
                        {Math.round(volume * 100)}
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <motion.div
                layout
                transition={{ type: "spring", damping: 28, stiffness: 320 }}
                className="flex items-center justify-center gap-5"
              >
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.88 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onCyclePlayMode();
                  }}
                  title={
                    playMode === "shuffle"
                      ? "随机播放"
                      : playMode === "one"
                        ? "单曲循环"
                        : "列表循环"
                  }
                  className="liquid-glass-solid flex items-center justify-center cursor-pointer"
                  style={{ ["--lg-solid-size" as string]: "2.25rem" }}
                >
                  {playMode === "shuffle" ? (
                    <Shuffle size={18} />
                  ) : playMode === "one" ? (
                    <Repeat1 size={18} />
                  ) : (
                    <Repeat size={18} />
                  )}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onPrev}
                  className="liquid-glass-play w-11 h-11 rounded-full flex items-center justify-center cursor-pointer shrink-0"
                >
                  <span className="play-glow" aria-hidden />
                  <SkipBack size={20} fill="currentColor" />
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onPlayPause}
                  className="liquid-glass-play w-[56px] h-[56px] rounded-full flex items-center justify-center cursor-pointer shrink-0"
                >
                  <span className="play-glow" aria-hidden />
                  {isPlaying ? (
                    <Pause size={26} fill="currentColor" strokeWidth={1} />
                  ) : (
                    <Play size={26} fill="currentColor" className="ml-0.5" strokeWidth={1} />
                  )}
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.06 }}
                  whileTap={{ scale: 0.92 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onNext}
                  className="liquid-glass-play w-11 h-11 rounded-full flex items-center justify-center cursor-pointer shrink-0"
                >
                  <span className="play-glow" aria-hidden />
                  <SkipForward size={20} fill="currentColor" />
                </motion.button>

                <motion.button
                  type="button"
                  whileHover={{ scale: 1.12 }}
                  whileTap={{ scale: 0.88 }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onOpenQueue}
                  className="liquid-glass-solid flex items-center justify-center cursor-pointer"
                  style={{ ["--lg-solid-size" as string]: "2.25rem" }}
                  title="播放队列"
                  aria-label="播放队列"
                >
                  <ListMusic size={18} />
                </motion.button>

              </motion.div>
            </div>
          </div>

          {/* SLIDING LYRICS DRAWER PANEL */}
          <AnimatePresence>
            {layout === 'lyrics' && (
              <motion.div
                key="lyrics-drawer"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 130 }}
                onPointerEnter={handleLyricsPanelEnter}
                onPointerLeave={handleLyricsPanelLeave}
                className="player-liquid-content group relative z-20 h-full flex-1 min-w-0 flex flex-col justify-between p-7 rounded-r-[20px] overflow-hidden text-left before:absolute before:left-0 before:top-7 before:bottom-7 before:w-px before:bg-white/6 before:pointer-events-none"
              >
                {/* Extra drag surface under the titlebar (blank lyrics chrome).
                    Toolbar buttons live on the root overlay above the titlebar. */}
                <div
                  data-tauri-drag-region
                  aria-hidden
                  className="absolute inset-x-0 top-12 z-0 h-20"
                />
                {/* Synced Lyrics — Folia absolute rail (莫奈/浮名/流光) or scroll list */}
                {isFoliaAbsoluteStyle(lyricRenderStyle) ? (
                  <div className="relative flex-1 min-h-0 flex flex-col pb-14 pt-10">
                    <div className="relative flex-1 min-h-0 no-drag">
                      <FoliaLyricsRail
                        style={lyricRenderStyle}
                        lines={song.lyrics}
                        currentTime={lyricCurrentTime}
                        activeIndex={activeLyricIndex}
                        anchorIndex={lyricAnchorIndex}
                        showTranslation={showTranslation}
                        songDuration={safeDuration}
                        onSeek={seekToLyricTime}
                        manualAnchor={manualAnchor}
                        onManualStep={handleFoliaManualStep}
                        onResumeAuto={resumeAutoFollow}
                      />
                    </div>
                  </div>
                ) : (
                <div
                  ref={lyricScrollRef}
                  onScroll={handleLyricScroll}
                  onWheel={handleLyricWheel}
                  className="relative flex-1 min-h-0 overflow-y-auto pr-2 pb-24 pt-16 no-drag [scrollbar-width:none] [-ms-overflow-style:none]"
                  style={{
                    maskImage: 'linear-gradient(to bottom, transparent 0%, white 12%, white 78%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, white 12%, white 78%, transparent 100%)'
                  }}
                >
                  <div className="flex min-h-full flex-col justify-center gap-5 py-[42vh]">
                    {song.lyrics.map((line, index) => {
                      const isActive = index === activeLyricIndex;
                      const isFocused = index === visualFocusIndex;
                      const distance = Math.abs(index - visualFocusIndex);
                      const isPassed = index < visualFocusIndex;
                      const motionProps = getLyricLineMotion({
                        style: lyricRenderStyle,
                        index,
                        isFocused,
                        isActive,
                        isPassed,
                        distance,
                        lineProgress: isActive ? activeLyricProgress : 0,
                        text: line.text,
                      });
                      const {
                        scale,
                        opacity,
                        blur,
                        x,
                        y,
                        displayText,
                        rowVariant,
                        dialogueSide,
                        color,
                        textShadow,
                      } = motionProps;
                      const filterValue = `blur(${blur}px)`;

                      const rowClassName =
                        rowVariant === "dialogue"
                          ? `relative block w-fit max-w-[82%] cursor-pointer select-none rounded-2xl border px-4 py-3 text-left font-sans text-[clamp(15px,2vw,18px)] font-extrabold leading-snug tracking-tight backdrop-blur-xl ${
                              dialogueSide === "right"
                                ? "ml-auto rounded-br-md"
                                : "mr-auto rounded-bl-md"
                            }`
                          : "relative block w-full cursor-pointer select-none rounded-2xl px-2 py-3 text-left font-sans text-[clamp(17px,2.45vw,22px)] font-extrabold leading-snug tracking-tight";

                      return (
                        <motion.button
                          type="button"
                          key={`${index}-${line.time}-${line.text}`}
                          ref={(el) => {
                            lyricLineRefs.current[index] = el;
                          }}
                          title={`点击跳转到 ${formatTime(Math.max(0, line.time - lyricOffsetSeconds))}`}
                          onClick={() => {
                            setManualAnchor(null);
                            programmaticScrollRef.current = false;
                            setVisualFocusIndex(index);
                            seekToLyricTime(line.time);
                          }}
                          initial={{
                            opacity: 0,
                            y: y + 12,
                            x: x * 0.6,
                            scale: scale * 0.98,
                            filter: `blur(${blur + 1}px)`,
                          }}
                          animate={{
                            opacity,
                            y,
                            x,
                            scale,
                            filter: filterValue,
                          }}
                          transition={{
                            y: { type: "spring", stiffness: 148, damping: 30, mass: 0.82 },
                            x: { type: "spring", stiffness: 136, damping: 28, mass: 0.8 },
                            scale: { type: "spring", stiffness: 170, damping: 30, mass: 0.78 },
                            opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
                            filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
                          }}
                          className={rowClassName}
                          style={{
                            color,
                            wordBreak: "break-word",
                            willChange: "filter, opacity, transform",
                            background:
                              rowVariant === "dialogue"
                                ? isFocused
                                  ? dialogueSide === "right"
                                    ? "linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))"
                                    : "linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))"
                                  : "rgba(255,255,255,0.045)"
                                : undefined,
                            borderColor:
                              rowVariant === "dialogue"
                                ? isFocused
                                  ? "rgba(255,255,255,0.22)"
                                  : "rgba(255,255,255,0.08)"
                                : undefined,
                            textShadow,
                          }}
                        >
                          <span className="relative inline-block max-w-full align-top" style={{ wordBreak: "break-word" }}>
                            <span className="relative z-10">{displayText}</span>
                          </span>
                          {showTranslation && line.tr && (
                            <span
                              className="mt-1.5 block max-w-full font-sans text-[15px] font-semibold leading-snug tracking-tight"
                              style={{
                                color: isFocused || isActive ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.42)",
                                textShadow: isActive ? "0 1px 14px rgba(0,0,0,0.3)" : "0 1px 12px rgba(0,0,0,0.24)",
                              }}
                            >
                              {line.tr}
                            </span>
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
                )}
                {/* Lyrics context tools — only offset + follow (hover). Volume is on left card. */}
                <div
                  ref={lyricQuickRef}
                  onPointerEnter={handleLyricsPanelEnter}
                  className={`absolute bottom-5 left-5 right-5 z-50 flex flex-wrap items-center justify-end gap-2 no-drag transition-opacity duration-200 ${
                    lyricsChromeOpen
                      ? "opacity-100 pointer-events-auto"
                      : "opacity-0 pointer-events-none"
                  }`}
                  style={{ WebkitAppRegion: "no-drag", appRegion: "no-drag" } as React.CSSProperties}
                >
                  {manualAnchor != null && (
                    <button
                      type="button"
                      onClick={resumeAutoFollow}
                      title="立即回到当前播放歌词（停止滚动约 2.5 秒也会自动恢复）"
                      className="flex items-center gap-1.5 bg-white/18 text-white backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10 shadow-md text-[11px] font-bold transition-colors hover:bg-white/24 cursor-pointer"
                    >
                      <LocateFixed size={13} />
                      <span>跟随</span>
                    </button>
                  )}

                  <div className="flex items-center gap-2.5 bg-white/8 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5 shadow-md text-[11px] font-bold text-white/90">
                    <button
                      type="button"
                      onClick={decreaseLyricOffset}
                      title="歌词延后 0.1 秒"
                      className="p-1 text-white/50 hover:text-white cursor-pointer"
                    >
                      <Minus size={12} className="stroke-[2.5px]" />
                    </button>
                    <span className="min-w-[64px] text-center font-mono">
                      {lyricOffsetSeconds >= 0 ? "+" : ""}
                      {lyricOffsetSeconds.toFixed(1)}s
                    </span>
                    <button
                      type="button"
                      onClick={increaseLyricOffset}
                      title="歌词提前 0.1 秒"
                      className="p-1 text-white/50 hover:text-white cursor-pointer"
                    >
                      <Plus size={12} className="stroke-[2.5px]" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </div>
  );
}
