/**
 * Grapheme / word timing helpers — ported from
 * tmp-folia-major/src/utils/lyrics/graphemeTiming.ts
 * Adapted for our LRC lines (no native word times → even split).
 */

export interface GraphemeTiming {
  char: string;
  startTime: number;
  endTime: number;
}

export interface TimedWord {
  text: string;
  startTime: number;
  endTime: number;
}

export interface TimedLine {
  startTime: number;
  endTime: number;
  fullText: string;
  translation?: string;
  words: TimedWord[];
}

type GraphemeSegmenter = {
  segment: (input: string) => Iterable<{ segment: string }>;
};

const graphemeSegmenter: GraphemeSegmenter | null = (() => {
  try {
    const Ctor = (
      Intl as unknown as {
        Segmenter?: new (
          locales?: unknown,
          options?: { granularity: string }
        ) => GraphemeSegmenter;
      }
    ).Segmenter;
    return Ctor ? new Ctor(undefined, { granularity: "grapheme" }) : null;
  } catch {
    return null;
  }
})();

export function splitLyricGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
  }
  return Array.from(text);
}

export function buildEvenGraphemeTimings(
  text: string,
  startTime: number,
  endTime: number
): GraphemeTiming[] {
  const graphemes = splitLyricGraphemes(text);
  if (graphemes.length === 0) return [];
  const duration = Math.max(endTime - startTime, 0);
  const unit = duration / graphemes.length;
  return graphemes.map((char, index) => ({
    char,
    startTime: startTime + unit * index,
    endTime:
      index === graphemes.length - 1
        ? endTime
        : startTime + unit * (index + 1),
  }));
}

/** Split a lyric line into "words" (CJK = grapheme groups of 1, latin = whitespace tokens). */
export function splitLineIntoWords(text: string): string[] {
  if (!text.trim()) return [];
  const isCjkHeavy = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
  if (isCjkHeavy) {
    // Keep punctuation attached; split by char for CJK run, keep latin runs together
    const parts: string[] = [];
    const re =
      /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]|[A-Za-z0-9]+(?:'[A-Za-z]+)?|[^\s\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]+|\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].trim().length > 0 || m[0] === " ") parts.push(m[0]);
    }
    return parts.length ? parts : [text];
  }
  // Latin: split on spaces but keep spaces as static glue later via fullText index
  return text.split(/(\s+)/).filter((p) => p.length > 0);
}

/**
 * Build timed words + graphemes for a line by even distribution across
 * [startTime, endTime] — same fallback Folia uses when word timings are absent.
 */
export function buildTimedLine(
  text: string,
  startTime: number,
  endTime: number,
  translation?: string
): TimedLine {
  const safeEnd = Math.max(endTime, startTime + 0.2);
  const tokens = splitLineIntoWords(text);
  const timedTokens = tokens.filter((t) => t.trim().length > 0);
  const n = Math.max(timedTokens.length, 1);
  const dur = safeEnd - startTime;
  const unit = dur / n;

  let ti = 0;
  const words: TimedWord[] = timedTokens.map((tok) => {
    const wStart = startTime + unit * ti;
    const wEnd = ti === n - 1 ? safeEnd : startTime + unit * (ti + 1);
    ti += 1;
    return { text: tok, startTime: wStart, endTime: wEnd };
  });

  return {
    startTime,
    endTime: safeEnd,
    fullText: text,
    translation,
    words,
  };
}

export function buildWordGraphemeTimings(word: TimedWord): GraphemeTiming[] {
  return buildEvenGraphemeTimings(word.text, word.startTime, word.endTime);
}

export function buildLineGraphemeTimeline(line: TimedLine): GraphemeTiming[] {
  if (line.words.length === 0) {
    return buildEvenGraphemeTimings(line.fullText, line.startTime, line.endTime);
  }
  // Prefer per-word timings concatenated (Folia maps onto fullText; even split is fine for display sweep)
  return line.words.flatMap((w) => buildWordGraphemeTimings(w));
}

export type DisplayToken = {
  text: string;
  startTime: number | null;
  endTime: number | null;
  key: string;
  timed: boolean;
  graphemeTimings: GraphemeTiming[];
};

/** Build Monet display tokens (timed words + static glue) from a TimedLine. */
export function buildDisplayTokens(line: TimedLine): DisplayToken[] {
  if (line.words.length === 0) {
    return [
      {
        text: line.fullText,
        startTime: line.startTime,
        endTime: line.endTime,
        key: `${line.startTime}-full`,
        timed: true,
        graphemeTimings: buildLineGraphemeTimeline(line),
      },
    ];
  }

  const tokens: DisplayToken[] = [];
  let cursor = 0;
  line.words.forEach((word, index) => {
    const matchIndex = line.fullText.indexOf(word.text, cursor);
    if (matchIndex < 0) return;
    if (matchIndex > cursor) {
      tokens.push({
        text: line.fullText.slice(cursor, matchIndex),
        startTime: null,
        endTime: null,
        key: `${line.startTime}-static-${cursor}`,
        timed: false,
        graphemeTimings: [],
      });
    }
    const endOffset = matchIndex + word.text.length;
    tokens.push({
      text: word.text,
      startTime: word.startTime,
      endTime: word.endTime,
      key: `${line.startTime}-${index}-${word.startTime}`,
      timed: true,
      graphemeTimings: buildWordGraphemeTimings(word),
    });
    cursor = endOffset;
  });
  if (cursor < line.fullText.length) {
    tokens.push({
      text: line.fullText.slice(cursor),
      startTime: null,
      endTime: null,
      key: `${line.startTime}-tail-${cursor}`,
      timed: false,
      graphemeTimings: [],
    });
  }
  return tokens.length > 0
    ? tokens
    : [
        {
          text: line.fullText,
          startTime: line.startTime,
          endTime: line.endTime,
          key: `${line.startTime}-fallback`,
          timed: true,
          graphemeTimings: buildLineGraphemeTimeline(line),
        },
      ];
}
