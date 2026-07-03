import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Star,
  MoreHorizontal,
  SkipBack,
  Play,
  Pause,
  SkipForward,
  Volume1,
  Volume2,
  Plus,
  Minus,
  X,
  ListMusic,
  Maximize2,
  Repeat,
  Repeat1,
  Settings,
  Shuffle,
} from 'lucide-react';
// LiquidGlassCanvas (WebGL glass) removed for performance — pure CSS
// backdrop-filter is used on the player card instead.
import { LyricMotionStyle, Song, PlayerLayout } from './playerTypes';

interface GlassPlayerProps {
  song: Song;
  isPlaying: boolean;
  currentTime: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (time: number) => void;
  layout: PlayerLayout;
  onToggleLayout: (layout: PlayerLayout) => void;
  isFavorited: boolean;
  onToggleFavorite: () => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  isShowQueue: boolean;
  onShowQueueToggle: () => void;
  onOpenSettings: () => void;
  backgroundBlur: number;
  backgroundOpacity: number;
  lyricMotionStyle: LyricMotionStyle;
  useCoverBackground: boolean;
  onMinimize: () => void;
  onClose: () => void;
  /** unified play mode: sequence | list | one | shuffle */
  playMode: "sequence" | "list" | "one" | "shuffle";
  onCyclePlayMode: () => void;
}

export default function GlassPlayer({
  song,
  isPlaying,
  currentTime,
  onPlayPause,
  onNext,
  onPrev,
  onSeek,
  layout,
  onToggleLayout,
  isFavorited,
  onToggleFavorite,
  speed,
  onSpeedChange,
  volume,
  onVolumeChange,
  isShowQueue,
  onShowQueueToggle,
  onOpenSettings,
  backgroundBlur,
  backgroundOpacity,
  lyricMotionStyle,
  useCoverBackground,
  onMinimize,
  onClose,
  playMode,
  onCyclePlayMode,
}: GlassPlayerProps) {
  const progressBarRef = useRef<HTMLDivElement>(null);

  // State
  const [isHoveringProgress, setIsHoveringProgress] = useState(false);

  // Formatting utilities
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const progressPercent = (currentTime / song.duration) * 100;

  // Handles
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    onSeek(clickRatio * song.duration);
  };

  const handleProgressDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.buttons !== 1 || !progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    onSeek(clickRatio * song.duration);
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    onVolumeChange(clickRatio);
  };

  // Find active lyric index
  const activeLyricIndex = song.lyrics.reduce((acc, line, idx) => {
    if (currentTime >= line.time) {
      return idx;
    }
    return acc;
  }, -1);

  const lyricAnchorIndex = useMemo(() => {
    if (activeLyricIndex >= 0) return activeLyricIndex;
    const upcomingIndex = song.lyrics.findIndex((line) => line.time > currentTime);
    return upcomingIndex >= 0 ? upcomingIndex : 0;
  }, [activeLyricIndex, currentTime, song.lyrics]);

  const visibleLyricItems = useMemo(() => {
    const start = Math.max(0, lyricAnchorIndex - 3);
    const end = Math.min(song.lyrics.length - 1, lyricAnchorIndex + 5);
    return song.lyrics.slice(start, end + 1).map((line, localIndex) => {
      const index = start + localIndex;
      return {
        line,
        index,
        offset: index - lyricAnchorIndex,
      };
    });
  }, [lyricAnchorIndex, song.lyrics]);

  const activeLyricProgress = useMemo(() => {
    if (activeLyricIndex < 0) return 0;
    const activeLine = song.lyrics[activeLyricIndex];
    if (!activeLine) return 0;
    const nextTime = song.lyrics[activeLyricIndex + 1]?.time ?? song.duration;
    const duration = Math.max(0.2, nextTime - activeLine.time);
    return Math.min(1, Math.max(0, (currentTime - activeLine.time) / duration));
  }, [activeLyricIndex, currentTime, song.duration, song.lyrics]);

  const getTypewriterText = (text: string) => {
    const chars = Array.from(text);
    if (chars.length === 0) return "";
    const count = Math.min(chars.length, Math.max(1, Math.ceil(chars.length * activeLyricProgress)));
    return chars.slice(0, count).join("");
  };

  // Adjust speed
  const increaseSpeed = () => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = speeds.indexOf(speed);
    if (currentIndex < speeds.length - 1) {
      onSpeedChange(speeds[currentIndex + 1]);
    }
  };

  const decreaseSpeed = () => {
    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = speeds.indexOf(speed);
    if (currentIndex > 0) {
      onSpeedChange(speeds[currentIndex - 1]);
    }
  };

  const backgroundImageUrl = song.backgroundUrl || song.coverUrl;
  const glassTintOpacity = Math.min(80, Math.max(0, backgroundOpacity)) / 100;

  return (
    <div
      id="unified-player-card"
      className="player-liquid-glass relative overflow-hidden text-white select-none flex flex-row items-stretch"
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
        } as React.CSSProperties
      }
    >
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
          className="player-liquid-content flex flex-col justify-between w-full h-full p-5"
        >
          {/* Top Row: Mini Info */}
          <div className="flex items-center gap-3.5 w-full">
            <motion.div 
              layoutId="album-art"
              className="w-[52px] h-[52px] rounded-xl overflow-hidden shadow-md flex-shrink-0"
              animate={{ scale: isPlaying ? 1.04 : 0.96 }}
              transition={{ duration: 0.5 }}
            >
              {song.coverUrl && (
                <img
                  src={song.coverUrl}
                  alt={song.title}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover select-none pointer-events-none"
                />
              )}
            </motion.div>
            
            <div className="flex-1 min-w-0 pr-1">
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
            <div 
              ref={progressBarRef}
              onClick={handleProgressClick}
              onMouseMove={handleProgressDrag}
              onMouseEnter={() => setIsHoveringProgress(true)}
              onMouseLeave={() => setIsHoveringProgress(false)}
              className="relative flex-1 h-4 flex items-center cursor-pointer group"
            >
              <div className="absolute left-0 right-0 h-[4px] bg-white/12 rounded-full" />
              <div 
                className="absolute left-0 h-[4px] bg-white/80 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
              <motion.div 
                className="absolute w-[8px] h-[8px] bg-white rounded-full shadow-sm"
                style={{ left: `calc(${progressPercent}% - 4px)` }}
                animate={{ scale: isHoveringProgress ? 1.4 : 0 }}
                transition={{ duration: 0.15 }}
              />
            </div>
            <span className="w-8 text-left">{formatTime(song.duration)}</span>
          </div>

          {/* Bottom Row: Compact Controls */}
          <div className="flex items-center justify-between mt-1 px-1">
            <div className="flex items-center gap-1.5">
              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onToggleFavorite}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isFavorited ? 'text-yellow-300 bg-white/10' : 'text-white/60 hover:text-white'
                }`}
                title="Favorite"
              >
                <Star size={15} fill={isFavorited ? "currentColor" : "none"} />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={() => onToggleLayout('vertical')}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white transition-colors cursor-pointer"
                title="Expand to Full Player"
              >
                <Maximize2 size={15} />
              </motion.button>
            </div>

            <div className="flex items-center gap-5">
              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onPrev}
                className="text-white/70 hover:text-white p-1 cursor-pointer"
              >
                <SkipBack size={18} fill="currentColor" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onPlayPause}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white text-slate-900 shadow-sm cursor-pointer"
              >
                {isPlaying ? (
                  <Pause size={16} fill="currentColor" strokeWidth={1} />
                ) : (
                  <Play size={16} fill="currentColor" className="ml-0.5" strokeWidth={1} />
                )}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onNext}
                className="text-white/70 hover:text-white p-1 cursor-pointer"
              >
                <SkipForward size={18} fill="currentColor" />
              </motion.button>
            </div>

            <motion.button
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              onClick={onShowQueueToggle}
              className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                isShowQueue ? 'text-white bg-white/12' : 'text-white/60 hover:text-white'
              }`}
            >
              <ListMusic size={16} />
            </motion.button>
          </div>
        </motion.div>
      )}

      {/* ========================================================= */}
      {/* 2. VERTICAL & LYRICS EXPANDED LAYOUT */}
      {/* ========================================================= */}
      {layout !== 'mini' && (
        <>
          {/* LEFT PLAYER PANEL (Vertical Control Card) */}
          <div
            data-tauri-drag-region
            className="player-liquid-content w-[360px] h-full p-7 flex flex-col justify-between flex-shrink-0 rounded-l-[20px] overflow-hidden"
          >
            {/* Main Cover Art */}
            <motion.div 
              layoutId="album-art"
              className="relative w-full h-[320px] rounded-[24px] overflow-hidden group shadow-lg"
            >
              {song.coverUrl && (
                <>
                  <motion.img
                    key={song.id}
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

            {/* Meta Info Section */}
            <div className="flex flex-col gap-5 mt-4">
              <div className="flex items-center justify-between w-full">
                <div className="flex-1 min-w-0 pr-4 text-left">
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

                <div className="flex items-center gap-2.5 flex-shrink-0">
                  <motion.button
                    whileHover={{ scale: 1.06, backgroundColor: 'rgba(255, 255, 255, 0.18)' }}
                    whileTap={{ scale: 0.94 }}
                    onClick={onToggleFavorite}
                    className={`liquid-glass-control w-9 h-9 rounded-full flex items-center justify-center transition-colors border border-white/5 cursor-pointer ${
                      isFavorited ? 'bg-white/20 text-yellow-300' : 'bg-white/8 text-white/80'
                    }`}
                  >
                    <Star size={17} fill={isFavorited ? "currentColor" : "none"} />
                  </motion.button>

                  <motion.button
                    whileHover={{ scale: 1.06, backgroundColor: 'rgba(255, 255, 255, 0.18)' }}
                    whileTap={{ scale: 0.94 }}
                    className="liquid-glass-control w-9 h-9 rounded-full flex items-center justify-center bg-white/8 text-white/80 border border-white/5 cursor-pointer"
                  >
                    <MoreHorizontal size={17} />
                  </motion.button>
                </div>
              </div>

              {/* Progress Track */}
              <div className="flex flex-col gap-2">
                <div 
                  ref={progressBarRef}
                  onClick={handleProgressClick}
                  onMouseMove={handleProgressDrag}
                  onMouseEnter={() => setIsHoveringProgress(true)}
                  onMouseLeave={() => setIsHoveringProgress(false)}
                  className="relative h-6 flex items-center cursor-pointer group"
                >
                  <div className="absolute left-0 right-0 h-[5px] bg-white/15 rounded-full" />
                  <div 
                    className="absolute left-0 h-[5px] bg-white rounded-full"
                    style={{ width: `${progressPercent}%` }}
                  />
                  <motion.div 
                    className="absolute w-[10px] h-[10px] bg-white rounded-full shadow-md"
                    style={{ left: `calc(${progressPercent}% - 5px)` }}
                    animate={{ scale: isHoveringProgress ? 1.4 : 0 }}
                    transition={{ duration: 0.15 }}
                  />
                </div>

                <div className="flex items-center justify-between text-[11px] font-semibold text-white/50 tracking-wider font-mono">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(song.duration)}</span>
                </div>
              </div>
            </div>

            {/* Controls: play-mode | prev | play/pause | next | queue */}
            <div className="flex items-center justify-center gap-5 mt-1 mb-2">
              {/* Play-mode toggle (single button, cycles: sequence → list → one → shuffle) */}
              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onCyclePlayMode}
                title={
                  playMode === "shuffle" ? "随机播放"
                  : playMode === "one" ? "单曲循环"
                  : playMode === "list" ? "列表循环"
                  : "顺序播放"
                }
                className={`liquid-glass-control p-2 rounded-full transition-colors cursor-pointer ${
                  playMode !== "sequence" ? "text-white bg-white/10" : "text-white/45 hover:text-white/85"
                }`}
              >
                {playMode === "shuffle" ? (
                  <Shuffle size={20} />
                ) : playMode === "one" ? (
                  <Repeat1 size={20} />
                ) : (
                  <Repeat size={20} />
                )}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onPrev}
                className="p-2 text-white/85 hover:text-white transition-colors cursor-pointer"
              >
                <SkipBack size={26} fill="currentColor" />
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.08 }}
                whileTap={{ scale: 0.92 }}
                onClick={onPlayPause}
                className="w-16 h-16 rounded-full flex items-center justify-center bg-white text-slate-950 shadow-md cursor-pointer"
              >
                {isPlaying ? (
                  <Pause size={28} fill="currentColor" strokeWidth={1} />
                ) : (
                  <Play size={28} fill="currentColor" className="ml-1" strokeWidth={1} />
                )}
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onNext}
                className="p-2 text-white/85 hover:text-white transition-colors cursor-pointer"
              >
                <SkipForward size={26} fill="currentColor" />
              </motion.button>

              {/* Queue toggle */}
              <motion.button
                whileHover={{ scale: 1.12 }}
                whileTap={{ scale: 0.88 }}
                onClick={onShowQueueToggle}
                title="播放列表"
                className={`liquid-glass-control p-2 rounded-full transition-colors cursor-pointer ${
                  isShowQueue ? "text-white bg-white/10" : "text-white/45 hover:text-white/85"
                }`}
              >
                <ListMusic size={20} />
              </motion.button>
            </div>
          </div>

          {/* SLIDING LYRICS DRAWER PANEL */}
          <AnimatePresence>
            {layout === 'lyrics' && (
              <motion.div
                key="lyrics-drawer"
                data-tauri-drag-region
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', damping: 26, stiffness: 130 }}
                className="player-liquid-content group h-full flex-1 min-w-0 flex flex-col justify-between p-7 rounded-r-[20px] overflow-hidden text-left before:absolute before:left-0 before:top-7 before:bottom-7 before:w-px before:bg-white/6 before:pointer-events-none"
              >
                {/* Window controls (minimize / close) — top-right, only on hover */}
                <div className="absolute top-3 right-3 z-40 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  <button
                    onClick={onOpenSettings}
                    title="设置"
                    className="grid place-items-center w-8 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Settings size={14} />
                  </button>
                  <button
                    onClick={onMinimize}
                    title="最小化"
                    className="grid place-items-center w-8 h-7 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
                  >
                    <Minus size={14} />
                  </button>
                  <button
                    onClick={onClose}
                    title="关闭"
                    className="grid place-items-center w-8 h-7 rounded-md text-white/60 hover:text-white hover:bg-red-500/80 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                {/* Synced Lyrics Rail */}
                <div
                  className="relative flex-1 overflow-hidden pr-2 pb-24 pt-20"
                  style={{
                    maskImage: 'linear-gradient(to bottom, transparent 0%, white 14%, white 82%, transparent 100%)',
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, white 14%, white 82%, transparent 100%)'
                  }}
                >
                  <div className="absolute left-0 right-2 top-1/2 h-[460px] -translate-y-1/2">
                    <AnimatePresence initial={false}>
                      {visibleLyricItems.map(({ line, index, offset }) => {
                        const isActive = index === activeLyricIndex;
                        const distance = Math.abs(offset);
                        const isPassed = offset < 0;
                        const isTypewriter = lyricMotionStyle === 'typewriter';
                        const isBeam = lyricMotionStyle === 'beam';
                        const isDialogue = lyricMotionStyle === 'dialogue';
                        const isPoster = lyricMotionStyle === 'poster';
                        const isTilt = lyricMotionStyle === 'tilt';
                        const isRipple = lyricMotionStyle === 'ripple';
                        const isFloat = lyricMotionStyle === 'float';
                        const isStagger = lyricMotionStyle === 'stagger';
                        const dialogueSide = index % 2 === 0 ? 'left' : 'right';
                        let rowGap = 68;
                        if (lyricMotionStyle === 'focus') rowGap = 76;
                        else if (lyricMotionStyle === 'cascade') rowGap = 64;
                        else if (isTypewriter) rowGap = 72;
                        else if (isBeam) rowGap = 70;
                        else if (isDialogue) rowGap = 82;
                        else if (isPoster) rowGap = 88;
                        else if (isTilt) rowGap = 72;
                        else if (isRipple) rowGap = 76;
                        else if (isFloat) rowGap = 78;
                        else if (isStagger) rowGap = 70;

                        const y = offset * rowGap;
                        let x = 0;
                        if (lyricMotionStyle === 'cascade' && !isActive) x = (offset % 2 === 0 ? 22 : -12) + offset * 4;
                        else if (isBeam && isActive) x = 8;
                        else if (isDialogue) x = dialogueSide === 'right' ? (isActive ? 74 : 92) : (isActive ? 4 : -10);
                        else if (isPoster) x = isActive ? 0 : offset * 10;
                        else if (isTilt) x = offset * 18;
                        else if (isRipple && isActive) x = 4;
                        else if (isFloat) x = isActive ? 0 : Math.sin(index * 1.7) * 18 + offset * 2;
                        else if (isStagger) x = isActive ? 0 : (offset % 2 === 0 ? 34 : -28) + offset * 8;

                        let rotate = 0;
                        if (lyricMotionStyle === 'cascade' && !isActive) rotate = Math.max(-5, Math.min(5, offset * -1.2));
                        else if (isPoster && !isActive) rotate = Math.max(-2.5, Math.min(2.5, offset * 0.7));
                        else if (isTilt) rotate = Math.max(-7, Math.min(7, offset * -2.2 + (isActive ? -2 : 0)));
                        else if (isFloat && !isActive) rotate = Math.sin(index * 1.2) * 1.8;
                        else if (isStagger) rotate = Math.max(-8, Math.min(8, offset * -2.8 + (offset % 2 === 0 ? 1.2 : -1.2)));

                        let scale = 1;
                        if (isActive) {
                          if (lyricMotionStyle === 'focus') scale = 1.08;
                          else if (lyricMotionStyle === 'cascade') scale = 1.03;
                          else if (isTypewriter || isDialogue) scale = 1.02;
                          else if (isBeam || isStagger) scale = 1.04;
                          else if (isPoster) scale = 1.12;
                          else if (isTilt || isFloat) scale = 1.05;
                          else if (isRipple) scale = 1.06;
                        } else {
                          const minScale = lyricMotionStyle === 'focus'
                            ? 0.78
                            : isPoster || isStagger
                              ? 0.76
                              : isFloat
                                ? 0.82
                                : 0.86;
                          let relaxedScale = 0.96 - distance * 0.035;
                          if (lyricMotionStyle === 'cascade') relaxedScale = 0.98 - distance * 0.052;
                          else if (isTypewriter) relaxedScale = 0.95 - distance * 0.04;
                          else if (isDialogue) relaxedScale = 0.92 - distance * 0.03;
                          else if (isPoster) relaxedScale = 0.88 - distance * 0.05;
                          else if (isTilt) relaxedScale = 0.96 - distance * 0.045;
                          else if (isRipple) relaxedScale = 0.92 - distance * 0.04;
                          else if (isFloat) relaxedScale = 0.94 - distance * 0.052;
                          else if (isStagger) relaxedScale = 0.9 - distance * 0.058;
                          scale = Math.max(minScale, relaxedScale);
                        }
                        const opacity = isActive
                          ? 1
                          : isPassed
                            ? Math.max(0.1, (lyricMotionStyle === 'focus' || isPoster || isStagger ? 0.36 : 0.46) - distance * 0.1)
                            : Math.max(0.16, (lyricMotionStyle === 'focus' || isPoster || isFloat ? 0.7 : 0.62) - distance * 0.11);
                        const blur = isActive ? 0 : Math.min(lyricMotionStyle === 'focus' || isPoster || isFloat ? 3.4 : 2.2, 0.35 + distance * 0.38);
                        const rowClassName = lyricMotionStyle === 'cascade'
                          ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[22px] font-extrabold leading-relaxed tracking-tight'
                          : lyricMotionStyle === 'focus'
                            ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[24px] font-extrabold leading-relaxed tracking-tight'
                            : isTypewriter
                              ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[22px] font-extrabold leading-relaxed tracking-tight'
                              : isBeam
                                ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[23px] font-extrabold leading-relaxed tracking-tight'
                                : isDialogue
                                  ? `absolute top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none rounded-3xl border px-4 py-3 text-left font-sans text-[18px] font-extrabold leading-relaxed tracking-tight backdrop-blur-xl ${dialogueSide === 'right' ? 'right-0 max-w-[82%] rounded-br-md' : 'left-0 max-w-[82%] rounded-bl-md'}`
                                  : isPoster
                                    ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-3 pl-6 text-left font-sans text-[26px] font-black leading-tight tracking-tight'
                                    : isTilt
                                      ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[24px] font-black leading-relaxed tracking-tight'
                                      : isRipple
                                        ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[23px] font-extrabold leading-relaxed tracking-tight'
                                        : isFloat
                                          ? 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[24px] font-extrabold leading-relaxed tracking-tight'
                                          : isStagger
                                            ? 'absolute left-0 right-0 top-1/2 block origin-center -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[22px] font-black leading-relaxed tracking-tight'
                            : 'absolute left-0 right-0 top-1/2 block origin-left -translate-y-1/2 cursor-pointer select-none py-2 text-left font-sans text-[22px] font-extrabold leading-relaxed tracking-tight';
                        const activeTextColor = lyricMotionStyle === 'focus'
                          ? 'rgba(255,255,255,0.3)'
                          : isTypewriter
                            ? 'rgba(255,255,255,0.2)'
                            : isBeam
                              ? 'rgba(255,255,255,0.34)'
                              : isDialogue
                                ? 'rgba(255,255,255,0.92)'
                              : isPoster
                                ? 'rgba(255,255,255,0.26)'
                                : isTilt
                                  ? 'rgba(255,255,255,0.34)'
                                  : isRipple
                                    ? 'rgba(255,255,255,0.38)'
                                    : isFloat
                                      ? 'rgba(255,255,255,0.32)'
                                      : isStagger
                                        ? 'rgba(255,255,255,0.28)'
                          : 'rgba(255,255,255,0.42)';
                        const activeRevealText = isTypewriter ? getTypewriterText(line.text) : line.text;

                        return (
                          <motion.button
                            type="button"
                            key={`${index}-${line.time}-${line.text}`}
                            onClick={() => onSeek(line.time)}
                            initial={{ opacity: 0, x, y: y + 22, rotate, scale: scale * 0.98, filter: `blur(${blur + 1}px)` }}
                            animate={{ opacity, x, y, rotate, scale, filter: `blur(${blur}px)` }}
                            exit={{ opacity: 0, x, y: y - 18, rotate, scale: scale * 0.98, filter: 'blur(3px)' }}
                            transition={{
                              y: { type: 'spring', stiffness: 148, damping: 30, mass: 0.82 },
                              x: { type: 'spring', stiffness: 136, damping: 28, mass: 0.8 },
                              rotate: { type: 'spring', stiffness: 150, damping: 28, mass: 0.72 },
                              scale: { type: 'spring', stiffness: 170, damping: 30, mass: 0.78 },
                              opacity: { duration: 0.28, ease: [0.32, 0.72, 0, 1] },
                              filter: { duration: 0.32, ease: [0.32, 0.72, 0, 1] },
                            }}
                            className={rowClassName}
                            style={{
                              color: isActive ? activeTextColor : 'rgba(255,255,255,0.64)',
                              transformOrigin: isTilt ? '0% 55%' : isStagger ? '50% 55%' : undefined,
                              background: isDialogue
                                ? isActive
                                  ? dialogueSide === 'right'
                                    ? 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(255,255,255,0.08))'
                                    : 'linear-gradient(135deg, rgba(255,255,255,0.12), rgba(255,255,255,0.06))'
                                  : 'rgba(255,255,255,0.045)'
                                : undefined,
                              borderColor: isDialogue
                                ? isActive ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)'
                                : undefined,
                              textShadow: isActive
                                ? lyricMotionStyle === 'focus'
                                  ? '0 0 34px rgba(255,255,255,0.3), 0 16px 48px rgba(255,255,255,0.16), 0 1px 18px rgba(0,0,0,0.42)'
                                  : isBeam
                                    ? '0 0 22px rgba(255,255,255,0.28), 0 10px 32px rgba(255,255,255,0.16), 0 1px 18px rgba(0,0,0,0.42)'
                                    : isDialogue
                                      ? '0 10px 28px rgba(0,0,0,0.42)'
                                    : isPoster
                                      ? '0 18px 50px rgba(255,255,255,0.14), 0 2px 18px rgba(0,0,0,0.5)'
                                      : isTilt
                                        ? '10px 12px 0 rgba(255,255,255,0.06), 0 14px 42px rgba(0,0,0,0.5)'
                                        : isRipple
                                          ? '0 0 28px rgba(255,255,255,0.24), 0 14px 42px rgba(0,0,0,0.46)'
                                          : isFloat
                                            ? '0 0 34px rgba(255,255,255,0.24), 0 18px 50px rgba(255,255,255,0.12), 0 1px 18px rgba(0,0,0,0.44)'
                                            : isStagger
                                              ? '0 18px 0 rgba(255,255,255,0.05), 0 18px 46px rgba(0,0,0,0.52)'
                                  : '0 10px 36px rgba(255,255,255,0.18), 0 1px 18px rgba(0,0,0,0.42)'
                                : '0 1px 14px rgba(0,0,0,0.28)',
                            }}
                          >
                            <span className="relative inline-block">
                              {isTilt && (
                                <>
                                  <span
                                    aria-hidden
                                    className="absolute inset-0 translate-x-2 translate-y-1 text-white/12"
                                  >
                                    {line.text}
                                  </span>
                                  {isActive && (
                                    <motion.span
                                      aria-hidden
                                      className="absolute inset-0 -translate-x-2 text-white/20"
                                      animate={{ x: [-2, 2, -2] }}
                                      transition={{ duration: 2.1, repeat: Infinity, ease: 'easeInOut' }}
                                    >
                                      {line.text}
                                    </motion.span>
                                  )}
                                </>
                              )}
                              {isDialogue && (
                                <span
                                  aria-hidden
                                  className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border border-white/15 ${
                                    dialogueSide === 'right' ? '-right-9' : '-left-9'
                                  } ${isActive ? 'bg-white/80 shadow-[0_0_24px_rgba(255,255,255,0.35)]' : 'bg-white/10'}`}
                                />
                              )}
                              {isPoster && (
                                <>
                                  <span
                                    aria-hidden
                                    className={`absolute -left-6 top-1 bottom-1 w-px rounded-full ${
                                      isActive ? 'bg-white/75 shadow-[0_0_18px_rgba(255,255,255,0.4)]' : 'bg-white/18'
                                    }`}
                                  />
                                  <span className="absolute -left-6 -top-4 font-mono text-[10px] font-bold text-white/35">
                                    {String(index + 1).padStart(2, '0')}
                                  </span>
                                </>
                              )}
                              {lyricMotionStyle === 'cascade' && (
                                <span
                                  aria-hidden
                                  className={`absolute -left-5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full transition-colors ${
                                    isActive ? 'bg-white/85 shadow-[0_0_18px_rgba(255,255,255,0.45)]' : 'bg-white/18'
                                  }`}
                                />
                              )}
                              {lyricMotionStyle === 'focus' && isActive && (
                                <motion.span
                                  aria-hidden
                                  className="absolute -inset-x-7 -inset-y-3 rounded-full bg-white/10 blur-xl"
                                  animate={{ opacity: [0.34, 0.72, 0.34], scale: [0.94, 1.08, 0.94] }}
                                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                                />
                              )}
                              {isBeam && isActive && (
                                <motion.span
                                  aria-hidden
                                  className="absolute -inset-x-8 top-1/2 h-12 -translate-y-1/2 rounded-full bg-gradient-to-r from-transparent via-white/18 to-transparent blur-md"
                                  initial={{ x: -120, opacity: 0 }}
                                  animate={{ x: 120, opacity: [0, 0.92, 0] }}
                                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                                />
                              )}
                              {isPoster && isActive && (
                                <motion.span
                                  aria-hidden
                                  className="absolute -inset-x-5 -inset-y-4 rounded-sm bg-gradient-to-r from-white/10 via-transparent to-transparent"
                                  initial={{ opacity: 0, scaleX: 0.82 }}
                                  animate={{ opacity: [0.18, 0.44, 0.18], scaleX: [0.92, 1.04, 0.92] }}
                                  transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
                                />
                              )}
                              {isRipple && isActive && (
                                <>
                                  <motion.span
                                    aria-hidden
                                    className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35"
                                    initial={{ scale: 0.3, opacity: 0.68 }}
                                    animate={{ scale: 5.2, opacity: 0 }}
                                    transition={{ duration: 1.35, repeat: Infinity, ease: 'easeOut' }}
                                  />
                                  <motion.span
                                    aria-hidden
                                    className="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/18"
                                    initial={{ scale: 0.2, opacity: 0.42 }}
                                    animate={{ scale: 4.4, opacity: 0 }}
                                    transition={{ duration: 1.35, repeat: Infinity, ease: 'easeOut', delay: 0.42 }}
                                  />
                                </>
                              )}
                              {isFloat && isActive && (
                                <motion.span
                                  aria-hidden
                                  className="absolute -inset-x-10 -inset-y-5 rounded-full bg-gradient-to-r from-transparent via-white/14 to-transparent blur-xl"
                                  animate={{ opacity: [0.22, 0.58, 0.22], scale: [0.94, 1.1, 0.94], y: [4, -6, 4] }}
                                  transition={{ duration: 3.1, repeat: Infinity, ease: 'easeInOut' }}
                                />
                              )}
                              {isStagger && isActive && (
                                <>
                                  <motion.span
                                    aria-hidden
                                    className="absolute -left-7 top-1 h-2 w-8 rounded-full bg-white/24 blur-[1px]"
                                    animate={{ opacity: [0.16, 0.72, 0.16], x: [-6, 3, -6] }}
                                    transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
                                  />
                                  <motion.span
                                    aria-hidden
                                    className="absolute -right-8 bottom-1 h-2 w-10 rounded-full bg-white/18 blur-[1px]"
                                    animate={{ opacity: [0.12, 0.62, 0.12], x: [5, -4, 5] }}
                                    transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                                  />
                                  <motion.span
                                    aria-hidden
                                    className="absolute -right-3 -top-3 h-2 w-2 rounded-full bg-white/70 shadow-[0_0_16px_rgba(255,255,255,0.45)]"
                                    animate={{ opacity: [0.28, 1, 0.28], scale: [0.7, 1.25, 0.7] }}
                                    transition={{ duration: 1.55, repeat: Infinity, ease: 'easeInOut' }}
                                  />
                                </>
                              )}
                              {line.text}
                              {isActive && (
                                <>
                                  <motion.span
                                    aria-hidden
                                    className="absolute inset-0 overflow-hidden text-white"
                                    initial={{ clipPath: isTypewriter ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)', opacity: 0 }}
                                    animate={{
                                      clipPath: isTypewriter
                                        ? 'inset(0 0 0 0)'
                                        : `inset(0 ${Math.max(0, 100 - activeLyricProgress * 100)}% 0 0)`,
                                      opacity: 1,
                                    }}
                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                  >
                                    {activeRevealText}
                                    {isTypewriter && (
                                      <motion.span
                                        aria-hidden
                                        className="ml-1 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] rounded-full bg-white/85"
                                        animate={{ opacity: [0.2, 1, 0.2] }}
                                        transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}
                                      />
                                    )}
                                  </motion.span>
                                  <motion.span
                                    aria-hidden
                                    className={`absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full ${
                                      isBeam
                                        ? 'bg-gradient-to-r from-white/20 via-white to-white/20 shadow-[0_0_18px_rgba(255,255,255,0.32)]'
                                        : isRipple
                                          ? 'bg-white/90 shadow-[0_0_22px_rgba(255,255,255,0.5)]'
                                          : isFloat
                                            ? 'bg-gradient-to-r from-white/30 via-white/90 to-transparent shadow-[0_0_24px_rgba(255,255,255,0.28)]'
                                            : isStagger
                                              ? 'bg-white/90 shadow-[0_0_18px_rgba(255,255,255,0.38)]'
                                        : 'bg-white/80'
                                    }`}
                                    initial={{ scaleX: 0, opacity: 0 }}
                                    animate={{ scaleX: activeLyricProgress, opacity: 0.86 }}
                                    transition={{ duration: 0.18, ease: 'easeOut' }}
                                  />
                                </>
                              )}
                            </span>
                          </motion.button>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Drawer Footer Controls — hidden until hovering the lyrics panel */}
                <div className="absolute bottom-6 left-6 right-6 flex items-center justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                  {/* Playback speed slider button */}
                  <div className="flex items-center gap-3 bg-white/8 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/5 shadow-md text-[11px] font-bold text-white/90">
                    <button 
                      onClick={decreaseSpeed}
                      className="p-1 text-white/50 hover:text-white cursor-pointer"
                    >
                      <Minus size={12} className="stroke-[2.5px]" />
                    </button>
                    <span className="min-w-[70px] text-center font-mono">
                      Speed {speed.toFixed(2)}x
                    </span>
                    <button 
                      onClick={increaseSpeed}
                      className="p-1 text-white/50 hover:text-white cursor-pointer"
                    >
                      <Plus size={12} className="stroke-[2.5px]" />
                    </button>
                  </div>

                  {/* Volume slider proxy inside drawer */}
                  <div className="flex items-center gap-2 bg-white/8 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5 shadow-md">
                    <Volume1 size={13} className="text-white/50" />
                    <div 
                      onClick={handleVolumeClick}
                      className="relative w-16 h-3 flex items-center cursor-pointer group"
                    >
                      <div className="absolute left-0 right-0 h-[3px] bg-white/20 rounded-full" />
                      <div 
                        className="absolute left-0 h-[3px] bg-white/80 rounded-full"
                        style={{ width: `${volume * 100}%` }}
                      />
                    </div>
                    <Volume2 size={13} className="text-white/50" />
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
