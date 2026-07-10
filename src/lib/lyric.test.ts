import { describe, expect, it } from "vitest";
import {
  findActiveIndex,
  mergeTranslation,
  parseLrc,
  parseTimestampToSeconds,
  parseTranslation,
} from "./lyric";

describe("parseLrc", () => {
  it("parses multi-timestamp lines and sorts by time", () => {
    const lines = parseLrc(`
[ti:Demo]
[00:05.00]second
[00:01.50][00:03.00]shared
[00:02.00]middle
`);
    expect(lines.map((l) => [l.time, l.text])).toEqual([
      [1.5, "shared"],
      [2, "middle"],
      [3, "shared"],
      [5, "second"],
    ]);
  });

  it("applies [offset:ms] so positive offset advances lyrics earlier", () => {
    // offset +1000ms → subtract 1s from each timestamp
    const lines = parseLrc(`
[offset:1000]
[00:02.00]hello
[00:03.50]world
`);
    expect(lines).toEqual([
      { time: 1, text: "hello" },
      { time: 2.5, text: "world" },
    ]);
  });

  it("clamps negative-shifted times to 0", () => {
    const lines = parseLrc(`
[offset:5000]
[00:02.00]early
`);
    expect(lines[0]).toEqual({ time: 0, text: "early" });
  });

  it("returns empty for nullish input", () => {
    expect(parseLrc(null)).toEqual([]);
    expect(parseLrc(undefined)).toEqual([]);
    expect(parseLrc("")).toEqual([]);
  });
});

describe("parseTimestampToSeconds", () => {
  it("handles centiseconds and milliseconds", () => {
    expect(parseTimestampToSeconds("1", "02", "50")).toBeCloseTo(62.5, 5);
    expect(parseTimestampToSeconds("0", "00", "123")).toBeCloseTo(0.123, 5);
  });
});

describe("parseTranslation + mergeTranslation", () => {
  it("merges by nearest timestamp within 0.6s (not first match)", () => {
    const lines = parseLrc(`[00:10.00]one\n[00:20.00]two`);
    // deliberately order map so first entry is farther than second
    const tr = parseTranslation(`[00:10.50]一\n[00:19.80]二`);
    const merged = mergeTranslation(lines, tr);
    expect(merged[0].tr).toBe("一");
    expect(merged[1].tr).toBe("二");
  });

  it("prefers exact 0.1s key match", () => {
    const lines = [{ time: 5.0, text: "a" }];
    const tr = new Map<number, string>([
      [5.0, "exact"],
      [5.2, "near"],
    ]);
    expect(mergeTranslation(lines, tr)[0].tr).toBe("exact");
  });
});

describe("findActiveIndex", () => {
  const lines = parseLrc(`
[00:00.00]a
[00:05.00]b
[00:10.00]c
[00:15.00]d
`);

  it("returns -1 before the first line", () => {
    // first line is at 0, so use empty/shifted set
    const later = parseLrc(`[00:02.00]x\n[00:04.00]y`);
    expect(findActiveIndex(later, 0.5)).toBe(-1);
  });

  it("returns last line whose time <= t (binary search)", () => {
    expect(findActiveIndex(lines, 0)).toBe(0);
    expect(findActiveIndex(lines, 4.99)).toBe(0);
    expect(findActiveIndex(lines, 5)).toBe(1);
    expect(findActiveIndex(lines, 12.3)).toBe(2);
    expect(findActiveIndex(lines, 999)).toBe(3);
  });

  it("returns -1 for empty lyrics", () => {
    expect(findActiveIndex([], 1)).toBe(-1);
  });
});
