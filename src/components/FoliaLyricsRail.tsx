/**
 * Folia-major lyric rail — 1:1 structural port of MonetLyricsRail scrolling.
 * Modes: monet (莫奈) / fume (浮名) / classic (流光).
 *
 * Word/grapheme timings are synthesized from LRC when true yrc is unavailable
 * (same even-split fallback Folia uses when words are missing).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "motion/react";
import type { LyricsLine, LyricMotionStyle } from "./playerTypes";
import { buildDisplayTokens, type GraphemeTiming } from "../lib/lyricTiming";
import { colorWithAlpha, mixColors } from "./folia/colorMix";
import {
  MONET_GLOW_PASS_TAIL_SECONDS,
  MONET_GLOW_RISE_DURATION_SCALE,
  MONET_AUTO_SCROLL_AFTER,
  MONET_AUTO_SCROLL_BEFORE,
  MONET_SCROLL_AFTER,
  MONET_SCROLL_BEFORE,
  MONET_SCROLL_IDLE_RESET_MS,
  MONET_SCROLL_STEP_PX,
  MONET_SCROLL_TRANSITION,
  MONET_TOUCH_STEP_PX,
  buildPositionedEntries,
  buildScrollableRailEntries,
  clampScrollSteps,
  getScrollDirection,
  measureGraphemeOffsets,
  resolveClampFontPx,
  resolveMonetWordStatus,
  toTimedLines,
  type LineStatus,
  type PositionedMonetLineEntry,
} from "./folia/monetModel";

export interface FoliaLyricsRailProps {
  style: LyricMotionStyle;
  lines: LyricsLine[];
  currentTime: number;
  activeIndex: number;
  anchorIndex: number;
  showTranslation: boolean;
  songDuration: number;
  onSeek: (time: number) => void;
  manualAnchor: number | null;
  onManualStep: (nextIndex: number) => void;
  onResumeAuto: () => void;
}

const FONT_STACK =
  '"Inter", "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

const PASSIVE_FALSE: AddEventListenerOptions = { passive: false };

// ─── Karaoke word sweep (MonetWordSweep) ────────────────────────────────────

function MonetWordSweep({
  text,
  startTime,
  endTime,
  graphemeTimings,
  lineRenderEndTime,
  timeMv,
  lineStatus,
  wordColor,
  baseColor,
  fontPx,
  fontSpec,
}: {
  text: string;
  startTime: number;
  endTime: number;
  graphemeTimings: GraphemeTiming[];
  lineRenderEndTime: number;
  timeMv: ReturnType<typeof useMotionValue<number>>;
  lineStatus: LineStatus;
  wordColor: string;
  baseColor: string;
  fontPx: number;
  fontSpec: string;
}) {
  const isLineActive = lineStatus === "active";
  const canRenderGlow = lineStatus === "active" || lineStatus === "passed";
  const graphemeOffsets = useMemo(
    () => measureGraphemeOffsets(text, fontPx, fontSpec),
    [text, fontPx, fontSpec]
  );

  const fillWidth = useTransform(timeMv, (latest) => {
    const fullWidth = graphemeOffsets[graphemeOffsets.length - 1] ?? 0;
    if (!isLineActive || latest <= startTime) return 0;
    if (latest >= endTime) return fullWidth;

    const timingCount = Math.min(graphemeTimings.length, graphemeOffsets.length - 1);
    if (timingCount > 0) {
      for (let index = 0; index < timingCount; index++) {
        const timing = graphemeTimings[index];
        const timingStart = Math.max(startTime, timing.startTime);
        const timingEnd = Math.max(timingStart, timing.endTime);
        const startWidth = graphemeOffsets[index] ?? 0;
        const endW = graphemeOffsets[index + 1] ?? startWidth;
        if (latest < timingStart) return startWidth;
        if (latest <= timingEnd) {
          const duration = Math.max(0.001, timingEnd - timingStart);
          const progress = (latest - timingStart) / duration;
          return startWidth + (endW - startWidth) * progress;
        }
      }
      return graphemeOffsets[timingCount] ?? fullWidth;
    }

    const progress =
      (latest - startTime) / Math.max(0.001, endTime - startTime);
    if (progress <= 0) return 0;
    if (progress >= 1) return fullWidth;
    const graphemeCount = graphemeOffsets.length - 1;
    const floatIndex = progress * graphemeCount;
    const wholeIndex = Math.floor(floatIndex);
    const fractional = floatIndex - wholeIndex;
    const startWidth =
      graphemeOffsets[Math.min(wholeIndex, graphemeOffsets.length - 1)] ?? 0;
    const endW =
      graphemeOffsets[Math.min(wholeIndex + 1, graphemeOffsets.length - 1)] ??
      startWidth;
    return startWidth + (endW - startWidth) * fractional;
  });

  const maskImage = useTransform(fillWidth, (latest) => {
    const edgeSoftness = Math.max(Math.min(fontPx * 0.45, 16), 6);
    const solidEnd = Math.max(latest - edgeSoftness, 0);
    const featherStart = Math.max(latest - edgeSoftness * 0.55, 0);
    const featherEnd = Math.max(latest, 0);
    return `linear-gradient(90deg, rgba(0,0,0,1) 0px, rgba(0,0,0,1) ${solidEnd}px, rgba(0,0,0,0.92) ${featherStart}px, rgba(0,0,0,0) ${featherEnd}px, rgba(0,0,0,0) 100%)`;
  });

  const wordProgress = useTransform(timeMv, (latest) => {
    if (!isLineActive || latest <= startTime) return 0;
    if (latest >= endTime) return 1;
    return (latest - startTime) / Math.max(0.001, endTime - startTime);
  });

  const fillGradient = useTransform(wordProgress, (progress) => {
    const color = mixColors(baseColor, wordColor, Math.min(progress, 1));
    return `linear-gradient(90deg, ${color} 0%, ${colorWithAlpha(color, 0.92)} 68%, ${colorWithAlpha(color, 0.72)} 100%)`;
  });

  const resolvedBaseColor = useTransform(timeMv, (latest) => {
    if (!isLineActive) {
      return lineStatus === "passed" ? wordColor : baseColor;
    }
    const st = resolveMonetWordStatus(latest, startTime, endTime);
    return st === "passed" ? wordColor : baseColor;
  });

  const glowShadow = useTransform(timeMv, (latest) => {
    if (!canRenderGlow || latest <= startTime) return "none";
    const wordDuration = Math.max(0.001, endTime - startTime);
    const glowRiseDuration = wordDuration * MONET_GLOW_RISE_DURATION_SCALE;
    const glowPeakTime = startTime + glowRiseDuration;
    const glowTailEndTime = Math.max(
      lineRenderEndTime,
      endTime + MONET_GLOW_PASS_TAIL_SECONDS
    );
    let intensity: number;
    if (latest <= glowPeakTime) {
      const progress = Math.min(
        1,
        Math.max(0, (latest - startTime) / glowRiseDuration)
      );
      intensity = progress * progress * (3 - 2 * progress);
    } else {
      const decayDuration = Math.max(0.18, glowTailEndTime - glowPeakTime);
      const decayProgress = Math.min(
        1,
        Math.max(0, (latest - glowPeakTime) / decayDuration)
      );
      const remaining = 1 - decayProgress;
      intensity = remaining * remaining * (3 - 2 * remaining);
    }
    if (intensity <= 0) return "none";
    const radiusOne = Math.round(fontPx * 0.28);
    const radiusTwo = Math.round(fontPx * 0.65);
    const glowColor = mixColors(baseColor, wordColor, intensity, intensity * 0.88);
    return `0 0 ${radiusOne}px ${glowColor}, 0 0 ${radiusTwo}px ${glowColor}`;
  });

  return (
    <span className="relative inline-block whitespace-pre-wrap break-words">
      <motion.span style={{ color: resolvedBaseColor, textShadow: glowShadow }}>
        {text}
      </motion.span>
      {isLineActive ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 block whitespace-pre-wrap break-words"
          style={{
            WebkitMaskImage: maskImage,
            maskImage,
            WebkitMaskSize: "100% 100%",
            maskSize: "100% 100%",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            textShadow: "none",
          }}
        >
          <motion.span
            className="block whitespace-pre-wrap break-words"
            style={{
              color: "transparent",
              WebkitTextFillColor: "transparent",
              backgroundImage: fillGradient,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
            }}
          >
            {text}
          </motion.span>
        </motion.span>
      ) : null}
    </span>
  );
}

function MonetTimedLine({
  entry,
  timeMv,
  fontPx,
  fontStack,
  renderStaticPassed,
  styleName,
}: {
  entry: PositionedMonetLineEntry;
  timeMv: ReturnType<typeof useMotionValue<number>>;
  fontPx: number;
  fontStack: string;
  renderStaticPassed: boolean;
  styleName: LyricMotionStyle;
}) {
  const tokens = useMemo(() => buildDisplayTokens(entry.line), [entry.line]);
  const fontSpec = `${entry.tone.fontWeight} ${fontPx}px ${fontStack}`;
  const accent = "rgba(255,255,255,0.98)";
  const base = entry.tone.baseColor;
  const lineRenderEnd = entry.line.endTime;

  // Fume print-in: hide future graphemes on active line via opacity clip on whole line progress
  if (styleName === "fume" && entry.status === "active") {
    return (
      <FumePrintLine
        text={entry.line.fullText}
        startTime={entry.line.startTime}
        endTime={entry.line.endTime}
        timeMv={timeMv}
        fontPx={fontPx}
        fontWeight={entry.tone.fontWeight}
        baseColor={base}
        accent={accent}
      />
    );
  }

  return (
    <span className="block w-full min-w-0 max-w-full whitespace-pre-wrap break-words">
      {tokens.map((token) =>
        renderStaticPassed ||
        !token.timed ||
        token.startTime == null ||
        token.endTime == null ? (
          <span
            key={token.key}
            style={{
              color:
                token.timed && entry.status === "passed" ? accent : base,
            }}
          >
            {token.text}
          </span>
        ) : (
          <MonetWordSweep
            key={token.key}
            text={token.text}
            startTime={token.startTime}
            endTime={token.endTime}
            graphemeTimings={token.graphemeTimings}
            lineRenderEndTime={lineRenderEnd}
            timeMv={timeMv}
            lineStatus={entry.status}
            wordColor={accent}
            baseColor={base}
            fontPx={fontPx}
            fontSpec={fontSpec}
          />
        )
      )}
    </span>
  );
}

/** Fume-style character print reveal on the active line. */
function FumePrintLine({
  text,
  startTime,
  endTime,
  timeMv,
  fontPx,
  fontWeight,
  baseColor,
  accent,
}: {
  text: string;
  startTime: number;
  endTime: number;
  timeMv: ReturnType<typeof useMotionValue<number>>;
  fontPx: number;
  fontWeight: number;
  baseColor: string;
  accent: string;
}) {
  const graphemes = useMemo(() => Array.from(text), [text]);
  const [now, setNow] = useState(startTime);
  useEffect(() => {
    const unsub = timeMv.on("change", (v) => setNow(v));
    return () => unsub();
  }, [timeMv]);

  const progress =
    now <= startTime
      ? 0
      : now >= endTime
        ? 1
        : (now - startTime) / Math.max(0.001, endTime - startTime);
  const revealed = Math.ceil(progress * graphemes.length);

  return (
    <span
      className="block w-full whitespace-pre-wrap break-words"
      style={{ fontSize: fontPx, fontWeight }}
    >
      {graphemes.map((ch, i) => {
        const on = i < revealed;
        return (
          <span
            key={i}
            style={{
              color: on ? accent : baseColor,
              opacity: on ? 1 : 0.22,
              textShadow: on
                ? `0 0 ${Math.round(fontPx * 0.35)}px rgba(255,255,255,0.45)`
                : "none",
              transition: "opacity 0.08s linear, color 0.08s linear",
            }}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}

// ─── Rail line ──────────────────────────────────────────────────────────────

function MonetRailLine({
  entry,
  timeMv,
  lyricFontPx,
  translationFontPx,
  fontStack,
  glowBufferPx,
  vGlowBufferPx,
  showTranslation,
  styleName,
  disableEntryMotion,
  renderStaticPassed,
  onSeek,
}: {
  entry: PositionedMonetLineEntry;
  timeMv: ReturnType<typeof useMotionValue<number>>;
  lyricFontPx: number;
  translationFontPx: number;
  fontStack: string;
  glowBufferPx: number;
  vGlowBufferPx: number;
  showTranslation: boolean;
  styleName: LyricMotionStyle;
  disableEntryMotion: boolean;
  renderStaticPassed: boolean;
  onSeek: (t: number) => void;
}) {
  const initialOffset = entry.offset >= 0 ? 34 : -34;
  const exitOffset = entry.status === "passed" || entry.offset < 0 ? -38 : 38;
  const isActive = entry.status === "active";

  // Classic: stronger enter/exit blur
  const enterBlur = styleName === "classic" && isActive ? 10 : 5;
  const exitBlur = styleName === "classic" ? 12 : 6;

  return (
    <motion.button
      type="button"
      className="absolute top-0 min-w-0 cursor-pointer select-none text-left will-change-transform"
      initial={
        disableEntryMotion
          ? false
          : {
              opacity: 0,
              y: entry.y + initialOffset,
              scale: entry.tone.scale * 0.98,
              filter: `blur(${enterBlur}px)`,
            }
      }
      animate={{
        opacity: entry.tone.opacity,
        y: entry.y,
        scale:
          styleName === "fume" && isActive
            ? [entry.tone.scale, entry.tone.scale * 1.012, entry.tone.scale]
            : entry.tone.scale,
        filter: `blur(${entry.tone.blurPx}px)`,
      }}
      exit={
        disableEntryMotion
          ? undefined
          : {
              opacity: 0,
              y: entry.y + exitOffset,
              scale: entry.tone.scale * 0.98,
              filter: `blur(${exitBlur}px)`,
              transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
            }
      }
      transition={
        styleName === "fume" && isActive
          ? {
              ...MONET_SCROLL_TRANSITION,
              scale: { duration: 3.2, repeat: Infinity, ease: "easeInOut" },
            }
          : MONET_SCROLL_TRANSITION
      }
      style={{
        left: glowBufferPx,
        right: glowBufferPx,
        height: entry.layout.visualHeightPx,
        transformOrigin: "left top",
        zIndex: entry.tone.zIndex,
      }}
      title={`点击跳转到 ${entry.line.startTime.toFixed(1)} 秒`}
      onClick={() => onSeek(entry.line.startTime)}
    >
      {styleName === "fume" && isActive && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-2xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            background:
              "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.03) 52%, transparent 78%)",
            filter: "blur(12px)",
          }}
        />
      )}

      <div
        className="min-w-0 overflow-hidden"
        style={{
          marginLeft: `-${glowBufferPx}px`,
          marginRight: `-${glowBufferPx}px`,
          paddingLeft: `${glowBufferPx}px`,
          paddingRight: `${glowBufferPx}px`,
          marginTop: `-${vGlowBufferPx}px`,
          marginBottom: `-${vGlowBufferPx}px`,
          paddingTop: `${entry.layout.textPaddingTopPx + vGlowBufferPx}px`,
          paddingBottom: `${entry.layout.textPaddingBottomPx + vGlowBufferPx}px`,
          height: `${entry.layout.textHeightPx + vGlowBufferPx * 2}px`,
          boxSizing: "border-box",
          fontFamily: fontStack,
          fontSize: lyricFontPx,
          fontWeight: entry.tone.fontWeight,
          lineHeight: `${entry.layout.lineHeightPx}px`,
          letterSpacing: 0,
          textShadow:
            entry.status === "active"
              ? "0 14px 34px rgba(0,0,0,0.22)"
              : "none",
        }}
      >
        <MonetTimedLine
          entry={entry}
          timeMv={timeMv}
          fontPx={lyricFontPx}
          fontStack={fontStack}
          renderStaticPassed={renderStaticPassed}
          styleName={styleName}
        />
      </div>

      {showTranslation && isActive && entry.line.translation ? (
        <motion.div
          className="min-w-0 overflow-hidden whitespace-pre-wrap break-words"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
          style={{
            marginLeft: `-${glowBufferPx}px`,
            marginRight: `-${glowBufferPx}px`,
            paddingLeft: `${glowBufferPx}px`,
            paddingRight: `${glowBufferPx}px`,
            height: entry.layout.translationHeightPx,
            paddingTop: entry.layout.translationPaddingTopPx,
            paddingBottom: entry.layout.translationPaddingBottomPx,
            boxSizing: "border-box",
            color: "rgba(255,255,255,0.55)",
            fontFamily: fontStack,
            fontSize: translationFontPx,
            fontWeight: 500,
            lineHeight: `${entry.layout.translationLineHeightPx}px`,
          }}
        >
          {entry.line.translation}
        </motion.div>
      ) : null}
    </motion.button>
  );
}

// ─── Main rail ──────────────────────────────────────────────────────────────

export default function FoliaLyricsRail({
  style,
  lines,
  currentTime,
  activeIndex,
  anchorIndex,
  showTranslation,
  songDuration,
  onSeek,
  manualAnchor,
  onManualStep,
  onResumeAuto,
}: FoliaLyricsRailProps) {
  const railRef = useRef<HTMLDivElement>(null);
  const [railSize, setRailSize] = useState({ width: 0, height: 0 });
  const wheelAccRef = useRef(0);
  const wheelDirRef = useRef(0);
  const touchLastYRef = useRef<number | null>(null);
  const touchAccRef = useRef(0);
  const touchDirRef = useRef(0);
  const idleTimerRef = useRef<number | null>(null);

  const timeMv = useMotionValue(currentTime);
  const edgeY = useMotionValue(0);
  const edgeAnimationRef = useRef<ReturnType<typeof animate> | null>(null);
  useEffect(() => {
    timeMv.set(currentTime);
  }, [currentTime, timeMv]);

  const styleName: LyricMotionStyle =
    style === "fume" || style === "classic" || style === "monet"
      ? style
      : "monet";

  const fontScale = styleName === "fume" ? 1.08 : styleName === "classic" ? 1.04 : 1;
  const lyricFontPx = resolveClampFontPx(1.34, 2.75, 2.28) * fontScale;
  const inactiveFontPx = resolveClampFontPx(1.08, 2, 1.48) * fontScale;
  const translationFontPx = resolveClampFontPx(0.94, 1.28, 1.14) * fontScale;
  const glowBufferPx = Math.round(lyricFontPx * 1.2);
  const vGlowBufferPx = Math.round(lyricFontPx * 1.2);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    const update = () =>
      setRailSize({
        width: Math.round(node.clientWidth),
        height: Math.round(node.clientHeight),
      });
    update();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(node);
    return () => ro?.disconnect();
  }, []);

  const timedLines = useMemo(
    () => toTimedLines(lines, songDuration),
    [lines, songDuration]
  );

  const focusIndex =
    manualAnchor != null ? manualAnchor : Math.max(0, anchorIndex);
  const isManualScrolling = manualAnchor != null;

  // Wider window than Folia poster (2/2) so the tall desktop lyrics pane shows
  // more context above/below the focus line.
  const visibleEntries = useMemo(
    () =>
      buildScrollableRailEntries(
        timedLines,
        lines,
        focusIndex,
        activeIndex,
        isManualScrolling ? MONET_SCROLL_BEFORE : MONET_AUTO_SCROLL_BEFORE,
        isManualScrolling ? MONET_SCROLL_AFTER : MONET_AUTO_SCROLL_AFTER
      ),
    [timedLines, lines, focusIndex, activeIndex, isManualScrolling]
  );

  const positioned = useMemo(
    () =>
      buildPositionedEntries(
        visibleEntries,
        railSize.height || 340,
        railSize.width || 680,
        styleName,
        lyricFontPx,
        inactiveFontPx,
        translationFontPx,
        FONT_STACK,
        glowBufferPx,
        showTranslation
      ),
    [
      visibleEntries,
      railSize,
      styleName,
      lyricFontPx,
      inactiveFontPx,
      translationFontPx,
      glowBufferPx,
      showTranslation,
    ]
  );

  const clearIdle = () => {
    if (idleTimerRef.current != null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const bumpIdle = useCallback(() => {
    clearIdle();
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      wheelAccRef.current = 0;
      wheelDirRef.current = 0;
      touchAccRef.current = 0;
      touchDirRef.current = 0;
    }, MONET_SCROLL_IDLE_RESET_MS);
  }, []);

  useEffect(() => () => clearIdle(), []);

  useEffect(() => {
    return () => edgeAnimationRef.current?.stop();
  }, []);

  const stepManual = useCallback(
    (steps: number) => {
      if (lines.length === 0 || steps === 0) return;
      const base =
        manualAnchor != null ? manualAnchor : Math.max(0, anchorIndex);
      const next = Math.max(0, Math.min(lines.length - 1, base + steps));
      if (next === base) {
        edgeAnimationRef.current?.stop();
        edgeY.set(steps < 0 ? 8 : -8);
        edgeAnimationRef.current = animate(edgeY, 0, {
          type: "spring",
          stiffness: 310,
          damping: 19,
          mass: 0.55,
        });
        bumpIdle();
        return;
      }
      onManualStep(next);
      bumpIdle();
    },
    [anchorIndex, bumpIdle, edgeY, lines.length, manualAnchor, onManualStep]
  );

  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const onWheel = (event: WheelEvent) => {
      if (lines.length === 0) return;
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      const direction = getScrollDirection(event.deltaY);
      if (
        direction !== 0 &&
        wheelDirRef.current !== 0 &&
        direction !== wheelDirRef.current
      ) {
        wheelAccRef.current = 0;
      }
      wheelDirRef.current = direction || wheelDirRef.current;
      wheelAccRef.current += event.deltaY;
      const steps = clampScrollSteps(
        Math.trunc(wheelAccRef.current / MONET_SCROLL_STEP_PX)
      );
      if (steps !== 0) {
        wheelAccRef.current = 0;
        stepManual(steps);
      } else {
        bumpIdle();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      if (lines.length === 0) return;
      event.stopPropagation();
      touchLastYRef.current = event.touches[0]?.clientY ?? null;
      touchAccRef.current = 0;
      touchDirRef.current = 0;
      bumpIdle();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (lines.length === 0 || touchLastYRef.current == null) return;
      event.stopPropagation();
      const nextY = event.touches[0]?.clientY;
      if (typeof nextY !== "number") return;
      const deltaY = touchLastYRef.current - nextY;
      touchLastYRef.current = nextY;
      const direction = getScrollDirection(deltaY);
      if (
        direction !== 0 &&
        touchDirRef.current !== 0 &&
        direction !== touchDirRef.current
      ) {
        touchAccRef.current = 0;
      }
      touchDirRef.current = direction || touchDirRef.current;
      touchAccRef.current += deltaY;
      const steps = clampScrollSteps(
        Math.trunc(touchAccRef.current / MONET_TOUCH_STEP_PX)
      );
      if (steps !== 0) {
        touchAccRef.current = 0;
        stepManual(steps);
      } else {
        bumpIdle();
      }
    };

    const onTouchEnd = () => {
      touchLastYRef.current = null;
      touchDirRef.current = 0;
      touchAccRef.current = 0;
      bumpIdle();
    };

    rail.addEventListener("wheel", onWheel, PASSIVE_FALSE);
    rail.addEventListener("touchstart", onTouchStart, PASSIVE_FALSE);
    rail.addEventListener("touchmove", onTouchMove, PASSIVE_FALSE);
    rail.addEventListener("touchend", onTouchEnd, PASSIVE_FALSE);
    rail.addEventListener("touchcancel", onTouchEnd, PASSIVE_FALSE);
    return () => {
      rail.removeEventListener("wheel", onWheel, PASSIVE_FALSE);
      rail.removeEventListener("touchstart", onTouchStart, PASSIVE_FALSE);
      rail.removeEventListener("touchmove", onTouchMove, PASSIVE_FALSE);
      rail.removeEventListener("touchend", onTouchEnd, PASSIVE_FALSE);
      rail.removeEventListener("touchcancel", onTouchEnd, PASSIVE_FALSE);
    };
  }, [bumpIdle, lines.length, stepManual]);

  const handleSeek = useCallback(
    (t: number) => {
      clearIdle();
      onResumeAuto();
      onSeek(t);
    },
    [onResumeAuto, onSeek]
  );

  if (lines.length === 0) {
    return (
      <div
        ref={railRef}
        className="relative flex-1 min-h-0 flex items-center text-white/40 text-sm"
      >
        暂无歌词
      </div>
    );
  }

  return (
    <motion.div
      ref={railRef}
      className="relative h-full min-h-0 w-full max-w-full select-none overflow-hidden"
      style={{
        marginLeft: `-${glowBufferPx}px`,
        marginRight: `-${glowBufferPx}px`,
        paddingLeft: `${glowBufferPx}px`,
        paddingRight: `${glowBufferPx}px`,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        y: edgeY,
        // Softer edge fade so more lines stay readable near top/bottom
        WebkitMaskImage:
          "linear-gradient(to bottom, transparent 0%, black 5%, black 93%, transparent 100%)",
        maskImage:
          "linear-gradient(to bottom, transparent 0%, black 5%, black 93%, transparent 100%)",
      }}
    >
      <AnimatePresence initial={false}>
        {positioned.map((entry) => (
          <MonetRailLine
            key={entry.key}
            entry={entry}
            timeMv={timeMv}
            lyricFontPx={lyricFontPx}
            translationFontPx={translationFontPx}
            fontStack={FONT_STACK}
            glowBufferPx={glowBufferPx}
            vGlowBufferPx={vGlowBufferPx}
            showTranslation={showTranslation}
            styleName={styleName}
            disableEntryMotion={isManualScrolling}
            renderStaticPassed={
              isManualScrolling && entry.index !== activeIndex
            }
            onSeek={handleSeek}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
