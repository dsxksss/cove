import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Search, X, Loader2, MoreHorizontal } from "lucide-react";
import type { MusicSource, Song } from "../lib/types";
import { SongThumbnail } from "./SongThumbnail";
import { useMusicSearch } from "../hooks/useMusicSearch";
import { getSongKey, loadMusicSource, saveMusicSource, MUSIC_SOURCE_OPTIONS } from "../lib/musicSources";

/** Live multi-source search overlay (NetEase / QQ / Kugou). */
export function SearchOverlay({
  open,
  onClose,
  onPick,
  onOpenSongActions,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (s: Song) => void | Promise<void>;
  onOpenSongActions: (song: Song) => void;
}) {
  const [q, setQ] = useState("");
  const [source, setSource] = useState<MusicSource>(loadMusicSource);
  const [composing, setComposing] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const { results, loading, error: err, retry } = useMusicSearch(q, source, open && !composing);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setComposing(false);
    setSource(loadMusicSource());
  }, [open]);

  useLayoutEffect(() => {
    if (resultsRef.current) resultsRef.current.scrollTop = 0;
  }, [q, source, open]);

  const sourceBadge = (s: Song) => {
    const src = s.source ?? "netease";
    if (src === "qq") return "QQ音乐";
    if (src === "kugou") return "酷狗音乐";
    return "网易云音乐";
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 z-50"
        >
          <motion.div
            initial={{ x: 24, opacity: 0, scale: 0.985 }}
            animate={{ x: 0, opacity: 1, scale: 1 }}
            exit={{ x: 18, opacity: 0, scale: 0.985 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="context-panel context-panel--tab-page player-liquid-glass settings-player-page absolute flex flex-col overflow-hidden text-white"
          >
            <div className="player-liquid-content settings-player-header flex h-16 shrink-0 items-center gap-3 border-b border-white/6 px-7">
              <Search size={20} className="text-white/40 shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.nativeEvent.isComposing || composing || e.keyCode === 229) return;
                  if (e.key === "Enter" && !loading && !err && results[0]) void onPick(results[0]);
                }}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => setComposing(false)}
                placeholder="搜索歌曲、歌手…"
                className="app-liquid-input h-10 min-w-0 flex-1 rounded-full px-4 outline-none text-white placeholder:text-white/35 text-base"
              />
              {loading && <Loader2 size={18} className="animate-spin text-white/40" />}
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-full text-white/50 hover:text-white hover:bg-white/10"
              >
                <X size={16} />
              </button>
            </div>
            <div className="player-liquid-content flex shrink-0 gap-1 border-b border-white/6 px-6 py-2">
              {MUSIC_SOURCE_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setSource(value);
                    saveMusicSource(value);
                  }}
                  className={`h-7 rounded-full px-3 text-[11px] font-bold transition-colors ${
                    source === value
                      ? "bg-white text-slate-950"
                      : "text-white/50 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div ref={resultsRef} className="player-liquid-content min-h-0 flex-1 overflow-y-auto">
              {err && !loading && (
                <div role="alert" className="px-5 py-8 text-center text-sm text-white/45">
                  <p>{err}</p>
                  <button type="button" onClick={retry} className="mt-3 text-white/70">重试搜索</button>
                </div>
              )}
              {!err && !loading && !composing && results.length === 0 && q.trim() && (
                <p role="status" className="px-5 py-8 text-center text-sm text-white/45">没有找到相关歌曲</p>
              )}
              {!err && !loading && results.length === 0 && !q.trim() && (
                <p className="px-5 py-8 text-center text-sm text-white/30">
                  选择音源后输入关键词搜索（需桌面端）
                </p>
              )}
              {results.map((s) => (
                <div
                  key={getSongKey(s)}
                  className="intent-surface app-liquid-row mx-2 my-1 flex w-auto items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors motion-off"
                >
                  <button
                    type="button"
                    onClick={() => void onPick(s)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10">
                      <SongThumbnail src={s.pic} loading="lazy" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{s.name}</span>
                      <span className="block truncate text-xs text-white/45">{s.artist}</span>
                    </span>
                  </button>
                  <span className="shrink-0 rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-bold text-white/45">
                    {sourceBadge(s)}
                  </span>
                  {s.album && (
                    <span className="hidden sm:block truncate text-xs text-white/35 max-w-[120px]">
                      {s.album}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onOpenSongActions(s)}
                    className="intent-controls grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"
                    aria-label={`更多操作 ${s.name}`}
                  >
                    <MoreHorizontal size={15} />
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
