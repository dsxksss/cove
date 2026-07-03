import React, { useRef, useState, useEffect } from 'react';
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
import { Song, PlayerLayout } from './playerTypes';

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
  useCoverBackground,
  onMinimize,
  onClose,
  playMode,
  onCyclePlayMode,
}: GlassPlayerProps) {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const lyricLineRefs = useRef<(HTMLDivElement | null)[]>([]);

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
  }, 0);

  // Scroll active lyric into center
  useEffect(() => {
    if (layout === 'lyrics' && activeLyricIndex !== -1 && lyricLineRefs.current[activeLyricIndex] && lyricsContainerRef.current) {
      const activeElement = lyricLineRefs.current[activeLyricIndex];
      const container = lyricsContainerRef.current;

      const elementOffsetTop = activeElement.offsetTop;
      const elementHeight = activeElement.offsetHeight;
      const containerHeight = container.offsetHeight;

      container.scrollTo({
        top: elementOffsetTop - containerHeight / 2 + elementHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [activeLyricIndex, layout]);

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
                {/* Synced Lyrics Scrollable Container */}
                <div 
                  ref={lyricsContainerRef}
                  className="flex-1 overflow-y-auto pr-2 flex flex-col gap-6 scrollbar-none pb-24 pt-20"
                  style={{ 
                    maskImage: 'linear-gradient(to bottom, transparent 0%, white 15%, white 85%, transparent 100%)', 
                    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, white 15%, white 85%, transparent 100%)' 
                  }}
                >
                  {song.lyrics.map((line, idx) => {
                    const isActive = idx === activeLyricIndex;
                    return (
                      <div
                        key={idx}
                        ref={el => lyricLineRefs.current[idx] = el}
                        onClick={() => onSeek(line.time)}
                        className={`transition-all duration-700 ease-out cursor-pointer text-left py-1 origin-left select-none text-[21px] font-bold font-sans tracking-tight leading-relaxed
                          ${isActive 
                            ? 'text-white scale-100 opacity-100 filter blur-0 translate-x-0' 
                            : 'text-white/30 scale-[0.96] opacity-65 filter blur-[0.4px] hover:text-white/60 hover:opacity-90'
                          }`}
                      >
                        {line.text}
                      </div>
                    );
                  })}
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
