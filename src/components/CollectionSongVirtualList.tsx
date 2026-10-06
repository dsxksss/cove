import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SongThumbnail } from "./SongThumbnail";
import { GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import type { Song } from "../lib/types";
import { AUTH_PLATFORM_LABEL } from "../lib/auth";
import { getSongKey, sameSong } from "../lib/musicSources";
import { getBufferedVirtualListRange, getVirtualListRange } from "../lib/virtualList";

const ROW_HEIGHT = 58;
const ROW_OVERSCAN = 8;

const CollectionSongRow = memo(function CollectionSongRow({
  song,
  index,
  active,
  reorderable,
  dragging,
  dragIndex,
  onPlay,
  onOpenActions,
  onRemove,
  onMove,
  onDragStateChange,
}: {
  song: Song;
  index: number;
  active: boolean;
  reorderable: boolean;
  dragging: boolean;
  dragIndex: number | null;
  onPlay: (song: Song, index: number) => void;
  onOpenActions: (song: Song) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onDragStateChange: (index: number | null) => void;
}) {
  const handleDragStart = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!reorderable) return;
      onDragStateChange(index);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(index));
    },
    [index, onDragStateChange, reorderable],
  );
  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const transferIndex = Number.parseInt(event.dataTransfer.getData("text/plain"), 10);
      const from = dragIndex ?? (Number.isFinite(transferIndex) ? transferIndex : null);
      if (from != null && from !== index) onMove(from, index);
      onDragStateChange(null);
    },
    [dragIndex, index, onDragStateChange, onMove],
  );

  return (
    <div
      key={`${getSongKey(song)}:${index}`}
      style={{ position: "absolute", top: index * ROW_HEIGHT, left: 0, right: 0 }}
      draggable={false}
      onDragOver={reorderable ? (event) => event.preventDefault() : undefined}
      onDrop={reorderable ? handleDrop : undefined}
      onDragEnd={reorderable ? () => onDragStateChange(null) : undefined}
      className={`intent-surface app-liquid-row h-[58px] w-full flex items-center gap-2 rounded-2xl px-2 py-2 text-left transition-colors ${
        active ? "is-active" : ""
      } ${dragging ? "opacity-45" : ""} motion-off`}
    >
      <span
        draggable={reorderable}
        onDragStart={reorderable ? handleDragStart : undefined}
        className={`grid h-8 w-6 shrink-0 place-items-center ${
          reorderable
            ? "intent-hint cursor-grab text-white/45 active:cursor-grabbing"
            : "text-white/20"
        }`}
        title={reorderable ? "拖动调整顺序" : undefined}
      >
        {reorderable ? (
          <GripVertical size={14} />
        ) : (
          <span className="text-[10px]">{index + 1}</span>
        )}
      </span>
      <button
        type="button"
        onClick={() => onPlay(song, index)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
      >
        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-white/5 ring-1 ring-white/10">
          <SongThumbnail src={song.pic} />
          {active && (
            <span className="absolute inset-0 grid place-items-center bg-black/25">
              <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-sm ${
              active ? "font-medium text-white" : "text-white/80"
            }`}
          >
            {song.name}
          </span>
          <span className="block truncate text-xs text-white/40">
            {song.artist} · {AUTH_PLATFORM_LABEL[song.source ?? "netease"]}
          </span>
        </span>
      </button>
      <div className="intent-controls flex shrink-0 items-center">
        <button
          type="button"
          onClick={() => onOpenActions(song)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/35 hover:bg-white/10 hover:text-white"
          aria-label={`更多操作 ${song.name}`}
        >
          <MoreHorizontal size={15} />
        </button>
        {reorderable && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-white/30 hover:bg-red-500/15 hover:text-red-200"
            aria-label={`删除 ${song.name}`}
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
});

/**
 * Fixed-height queue/list window. Folia uses react-window for this exact
 * pattern: the scroll container owns a single fixed-height inner surface and
 * only a small absolute-positioned row window is mounted. Keeping scroll state
 * inside this memoized component prevents every header/control in the drawer
 * from re-rendering while the pointer is crossing rows.
 */
export const CollectionSongVirtualList = memo(function CollectionSongVirtualList({
  open,
  mode,
  list,
  queue,
  activeIndex,
  isBrowsing,
  isAppBrowsing,
  browseLoadingMore,
  scrollRef,
  resetKey,
  dragIndex,
  onPlay,
  onOpenActions,
  onRemove,
  onMove,
  onDragStateChange,
  listTotal,
  listLoadingMore,
  showLoadMoreFooter,
}: {
  open: boolean;
  mode: "queue" | "playlists";
  list: Song[];
  queue: Song[];
  activeIndex: number;
  isBrowsing: boolean;
  isAppBrowsing: boolean;
  browseLoadingMore: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  resetKey: string;
  dragIndex: number | null;
  onPlay: (song: Song, index: number) => void;
  onOpenActions: (song: Song) => void;
  onRemove: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onDragStateChange: (index: number | null) => void;
  listTotal: number;
  listLoadingMore: boolean;
  showLoadMoreFooter: boolean;
}) {
  const viewportHeightRef = useRef(560);
  const [windowRange, setWindowRange] = useState(() =>
    getVirtualListRange(list.length, 0, 560, ROW_HEIGHT, ROW_OVERSCAN),
  );
  const windowRangeRef = useRef(windowRange);
  const frameRef = useRef<number | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const scrollingRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const updateWindow = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const previous = windowRangeRef.current;
    const top = element.scrollTop;
    const fast = Math.abs(top - lastScrollTopRef.current) >= ROW_HEIGHT;
    lastScrollTopRef.current = top;
    // During a fling, spread entering-row mounts across frames instead of
    // accumulating a large batch. Slow scrolls reuse the buffered window.
    const next = fast
      ? getVirtualListRange(list.length, top, viewportHeightRef.current, ROW_HEIGHT, ROW_OVERSCAN)
      : getBufferedVirtualListRange(
          list.length, top, viewportHeightRef.current, ROW_HEIGHT, ROW_OVERSCAN, previous,
        );
    if (next.start === previous.start && next.end === previous.end && next.bottomHeight === previous.bottomHeight) return;
    windowRangeRef.current = next;
    setWindowRange(next);
  }, [list.length, scrollRef]);

  useLayoutEffect(() => {
    if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    lastScrollTopRef.current = 0;
    const next = getVirtualListRange(list.length, 0, viewportHeightRef.current, ROW_HEIGHT, ROW_OVERSCAN);
    windowRangeRef.current = next;
    setWindowRange(next);
    // Data arrivals should reconcile below without resetting a user's scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, resetKey, scrollRef]);

  useLayoutEffect(() => {
    updateWindow();
    return () => {
      // A pending frame captured the old item count. Never apply it after a
      // list shrinks or is replaced during a fling.
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [updateWindow, open, resetKey]);

  useLayoutEffect(() => {
    if (!open) return;
    const element = scrollRef.current;
    if (!element) return;
    const updateHeight = () => {
      viewportHeightRef.current = element.clientHeight || 560;
      updateWindow();
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, resetKey, scrollRef, updateWindow]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current);
    };
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (!scrollingRef.current) {
      scrollingRef.current = true;
      element.classList.add("is-scrolling");
    }
    if (idleTimerRef.current != null) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      scrollingRef.current = false;
      scrollRef.current?.classList.remove("is-scrolling");
    }, 160);
    if (frameRef.current == null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        updateWindow();
      });
    }
  }, [scrollRef, updateWindow]);

  const { start: first, end: last } = windowRange;
  const liveSong = queue[activeIndex];

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={`player-liquid-content min-h-0 flex-1 overflow-y-auto px-3 py-3 no-drag ${
        mode === "queue" ? "queue-mode" : ""
      }`}
      style={{
        contain: "layout style",
        overscrollBehavior: "contain",
        overflowAnchor: "none",
      }}
    >
      {list.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-white/35">
          {mode === "playlists"
            ? isBrowsing
              ? isAppBrowsing
                ? "自建歌单为空，可从搜索或歌曲菜单中添加"
                : browseLoadingMore
                  ? "正在读取歌单…"
                  : "歌单为空或读取失败"
              : "请选择一个歌单查看歌曲"
            : "队列为空"}
        </p>
      )}
      {list.length > 0 && (
        <div
          aria-label={mode === "playlists" ? "歌单歌曲" : "播放队列"}
          style={{ position: "relative", height: list.length * ROW_HEIGHT }}
        >
          {list.slice(first, last).map((song, visibleIndex) => {
            const index = first + visibleIndex;
            const active = isBrowsing
              ? !!liveSong && sameSong(liveSong, song)
              : index === activeIndex;
            const reorderable = isAppBrowsing || mode === "queue";
            return (
              <CollectionSongRow
                key={`${getSongKey(song)}:${index}`}
                song={song}
                index={index}
                active={active}
                reorderable={reorderable}
                dragging={dragIndex === index}
                dragIndex={dragIndex}
                onPlay={onPlay}
                onOpenActions={onOpenActions}
                onRemove={onRemove}
                onMove={onMove}
                onDragStateChange={onDragStateChange}
              />
            );
          })}
        </div>
      )}
      {showLoadMoreFooter && (
        <div className="py-4 text-center text-xs text-white/30">
          {listLoadingMore
            ? "加载中…"
            : `已加载 ${list.length} / ${listTotal}，向下滚动加载更多`}
        </div>
      )}
    </div>
  );
});
