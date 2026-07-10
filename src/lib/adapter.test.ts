import { describe, expect, it } from "vitest";
import { toDurationMs, toDurationSeconds, toPlayerSong } from "./adapter";
import type { Song } from "./types";

describe("toDurationSeconds", () => {
  it("prefers audio/store seconds when present", () => {
    expect(toDurationSeconds(245.6, 245000)).toBeCloseTo(245.6, 5);
    expect(toDurationSeconds(60, undefined)).toBe(60);
  });

  it("converts catalog milliseconds to seconds", () => {
    expect(toDurationSeconds(0, 245000)).toBe(245);
    expect(toDurationSeconds(null, 180500)).toBe(181);
  });

  it("treats small catalog values as already-seconds", () => {
    expect(toDurationSeconds(0, 240)).toBe(240);
  });

  it("recovers if seconds were mis-routed as huge ms-like values", () => {
    expect(toDurationSeconds(245000, undefined)).toBe(245);
  });

  it("returns 0 for empty input", () => {
    expect(toDurationSeconds(0, 0)).toBe(0);
    expect(toDurationSeconds(undefined, undefined)).toBe(0);
  });
});

describe("toDurationMs", () => {
  it("keeps ms values", () => {
    expect(toDurationMs(245000)).toBe(245000);
  });
  it("promotes seconds to ms", () => {
    expect(toDurationMs(240)).toBe(240000);
  });
});

describe("toPlayerSong duration", () => {
  const base: Song = {
    id: 1,
    name: "Test",
    artist: "A",
    duration: 200000,
  };

  it("uses store seconds over catalog ms", () => {
    const p = toPlayerSong(base, undefined, [], null, 199.4);
    expect(p.duration).toBeCloseTo(199.4, 5);
  });

  it("falls back to catalog ms when store is 0", () => {
    const p = toPlayerSong(base, undefined, [], null, 0);
    expect(p.duration).toBe(200);
  });
});
