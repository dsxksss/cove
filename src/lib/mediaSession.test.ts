import { describe, expect, it, vi } from "vitest";
import {
  applyMediaSession,
  buildMediaMetadata,
  isMediaSessionSupported,
  setMediaPlaybackState,
  setMediaPositionState,
} from "./mediaSession";

describe("buildMediaMetadata", () => {
  it("fills defaults and expands artwork sizes from cover url", () => {
    const meta = buildMediaMetadata({
      title: "  Song  ",
      artist: " Artist ",
      album: "LP",
      artworkUrl: "https://cdn.example/cover.jpg",
    });
    expect(meta.title).toBe("Song");
    expect(meta.artist).toBe("Artist");
    expect(meta.album).toBe("LP");
    expect(meta.artwork.length).toBeGreaterThanOrEqual(4);
    expect(meta.artwork.every((a) => a.src === "https://cdn.example/cover.jpg")).toBe(true);
  });

  it("uses fallbacks when title/artist empty and no artwork", () => {
    const meta = buildMediaMetadata({ title: "  ", artist: "" });
    expect(meta.title).toBe("未知歌曲");
    expect(meta.artist).toBe("未知歌手");
    expect(meta.artwork).toEqual([]);
  });
});

describe("applyMediaSession", () => {
  it("returns false when mediaSession is unavailable", () => {
    const ok = applyMediaSession(
      { title: "a", artist: "b" },
      { play: () => {} },
      { navigator: {} }
    );
    expect(ok).toBe(false);
  });

  it("sets metadata and wires action handlers on a real session double", () => {
    const handlers = new Map<string, ((d: any) => void) | null>();
    const session = {
      metadata: null as unknown,
      setActionHandler: (action: string, handler: ((d: any) => void) | null) => {
        handlers.set(action, handler);
      },
      playbackState: "none" as "none" | "paused" | "playing",
    };
    const play = vi.fn();
    const next = vi.fn();

    const ok = applyMediaSession(
      { title: "T", artist: "A", artworkUrl: "https://x/y.jpg" },
      { play, nexttrack: next },
      {
        navigator: { mediaSession: session },
        MediaMetadata: class {
          title: string;
          artist: string;
          album: string;
          artwork: unknown[];
          constructor(init: any) {
            this.title = init.title;
            this.artist = init.artist;
            this.album = init.album;
            this.artwork = init.artwork;
          }
        },
      }
    );

    expect(ok).toBe(true);
    expect((session.metadata as any).title).toBe("T");
    expect(handlers.get("play")).toBeTypeOf("function");
    handlers.get("play")?.({});
    expect(play).toHaveBeenCalledTimes(1);
    handlers.get("nexttrack")?.({});
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("isMediaSessionSupported / playback helpers", () => {
  it("detects presence of mediaSession", () => {
    expect(isMediaSessionSupported({ navigator: {} })).toBe(false);
    expect(isMediaSessionSupported({ navigator: { mediaSession: {} } })).toBe(true);
  });

  it("setMediaPlaybackState updates session when available", () => {
    const session = { playbackState: "none" as const };
    setMediaPlaybackState("playing", { navigator: { mediaSession: session } });
    expect(session.playbackState).toBe("playing");
  });

  it("setMediaPositionState clamps position and skips invalid duration", () => {
    const calls: unknown[] = [];
    const session = {
      setPositionState: (state?: unknown) => {
        calls.push(state);
      },
    };
    setMediaPositionState(
      { duration: 100, playbackRate: 1, position: 150 },
      { navigator: { mediaSession: session } }
    );
    expect(calls[0]).toEqual({ duration: 100, playbackRate: 1, position: 100 });

    setMediaPositionState(
      { duration: 0, playbackRate: 1, position: 1 },
      { navigator: { mediaSession: session } }
    );
    expect(calls[1]).toBeUndefined();
  });
});
