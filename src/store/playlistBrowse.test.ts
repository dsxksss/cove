import { afterEach, describe, expect, it, vi } from "vitest";
import type { MusicSource, PlaylistSummary } from "../lib/types";

const playlist = (source: MusicSource, id: number): PlaylistSummary => ({
  id, source, name: source, trackCount: 1, playCount: 0, createTime: 0,
  updateTime: 0, subscribed: false, creatorUid: 0, creatorName: "", createdByAccount: true,
});
const page = (id: number) => ({ data: { playlist: { tracks: [{ id, name: `song-${id}`, artist: "artist" }], trackTotal: 1 } } });

describe("playlist browsing ownership", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ignores a late NetEase response after switching to QQ with the same ID", async () => {
    vi.stubGlobal("Audio", class { volume = 0.8; });
    let finishNetease!: (value: unknown) => void;
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke: (command: string) => {
      if (command === "netease_playlist_page") return new Promise((resolve) => { finishNetease = resolve; });
      if (command === "qq_playlist_page") return Promise.resolve(page(2));
      throw new Error(`Unexpected command: ${command}`);
    } } });
    const { usePlayerStore: store } = await import("./playerStore");
    store.getState().clearBrowse();
    const old = store.getState().browsePlaylist(playlist("netease", 10));
    await store.getState().browsePlaylist(playlist("qq", 10));
    finishNetease(page(1));
    await old;
    expect(store.getState().browseSource).toBe("qq");
    expect(store.getState().browseList[0].id).toBe(2);
    expect(store.getState().queue).toHaveLength(0);
  });

  it("deduplicates a loading playlist and drops its result after clearing browse", async () => {
    vi.stubGlobal("Audio", class { volume = 0.8; });
    let finish!: (value: unknown) => void;
    const invoke = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const { usePlayerStore: store } = await import("./playerStore");
    store.getState().clearBrowse();
    const pending = store.getState().browsePlaylist(playlist("netease", 10));
    await store.getState().browsePlaylist(playlist("netease", 10));
    expect(invoke).toHaveBeenCalledTimes(1);
    store.getState().clearBrowse();
    finish(page(1));
    await pending;
    expect(store.getState().browseList).toHaveLength(0);
    expect(store.getState().browseLoadingMore).toBe(false);
  });
});
