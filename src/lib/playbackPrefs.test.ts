import { beforeEach, describe, expect, it } from "vitest";
import {
  derivePlayMode,
  loadLevel,
  loadRepeatMode,
  loadShuffle,
  loadSpeed,
  nextPlayMode,
  playModeToFlags,
  saveLevel,
  saveRepeatMode,
  saveShuffle,
  saveSpeed,
  type PlayMode,
} from "./playbackPrefs";

describe("play mode derivation (3 modes only)", () => {
  it("derivePlayMode maps flags correctly", () => {
    expect(derivePlayMode("all", false)).toBe("list");
    expect(derivePlayMode("one", false)).toBe("one");
    expect(derivePlayMode("off", false)).toBe("list"); // legacy → list
    expect(derivePlayMode("off", true)).toBe("shuffle");
    expect(derivePlayMode("all", true)).toBe("shuffle");
    expect(derivePlayMode("one", true)).toBe("shuffle"); // shuffle wins
  });

  it("playModeToFlags is inverse of derivePlayMode for pure modes", () => {
    for (const mode of ["list", "one", "shuffle"] as PlayMode[]) {
      const flags = playModeToFlags(mode);
      expect(derivePlayMode(flags.repeat, flags.shuffle)).toBe(mode);
    }
  });

  it("nextPlayMode cycles list → one → shuffle → list", () => {
    expect(nextPlayMode("all", false)).toBe("one");
    expect(nextPlayMode("one", false)).toBe("shuffle");
    expect(nextPlayMode("all", true)).toBe("list");
    expect(nextPlayMode("off", false)).toBe("one"); // legacy off treated as list
  });

  it("never exposes a sequence / off mode", () => {
    const seen = new Set<PlayMode>();
    let repeat: "off" | "all" | "one" = "all";
    let shuffle = false;
    for (let i = 0; i < 6; i++) {
      const mode = nextPlayMode(repeat, shuffle);
      seen.add(mode);
      const flags = playModeToFlags(mode);
      repeat = flags.repeat;
      shuffle = flags.shuffle;
    }
    expect([...seen].sort()).toEqual(["list", "one", "shuffle"]);
  });
});

describe("playback prefs persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips repeat / shuffle / level / speed via localStorage", () => {
    saveRepeatMode("all");
    saveShuffle(true);
    saveLevel("lossless");
    saveSpeed(1.25);

    expect(loadRepeatMode()).toBe("all");
    expect(loadShuffle()).toBe(true);
    expect(loadLevel()).toBe("lossless");
    expect(loadSpeed()).toBe(1.25);
  });

  it("migrates legacy off to list loop (all)", () => {
    localStorage.setItem("nmp.repeat", "off");
    expect(loadRepeatMode()).toBe("all");
  });

  it("rejects invalid values and falls back", () => {
    localStorage.setItem("nmp.repeat", "nope");
    localStorage.setItem("nmp.level", "banana");
    localStorage.setItem("nmp.speed", "999");
    expect(loadRepeatMode("all")).toBe("all");
    expect(loadLevel("exhigh")).toBe("exhigh");
    // speed clamps to [0.5, 2]
    expect(loadSpeed(1)).toBe(2);
  });
});
