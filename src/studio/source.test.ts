import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadStudioOriginal, resolveStudioSourceUrl } from "./source";
import { createStudioProject } from "./types";

describe("studio source identity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("resolves the second song by ID even when its stored URL points at the first song", async () => {
    const invoke = vi.fn(() => Promise.resolve({ data: { url: "http://m1.music.126.net/second.mp3" } }));
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const project = createStudioProject({ songId: "222", sourceUrl: "https://m1.music.126.net/first.mp3", title: "Second", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] });
    expect(await resolveStudioSourceUrl(project)).toContain("second.mp3");
    expect(invoke.mock.calls[0]).toEqual(["netease_song_url", { args: { id: 222, level: "exhigh" } }, undefined]);
  });

  it("downloads original audio using the nested Rust args and preserves the bytes", async () => {
    const invoke = vi.fn((command: string) => Promise.resolve(command === "netease_song_url"
      ? { data: { url: "http://m1.music.126.net/original.mp3" } }
      : { name: "original.mp3", mimeType: "audio/mpeg", base64: "AQID" }));
    vi.stubGlobal("window", { __TAURI_INTERNALS__: { invoke } });
    const project = createStudioProject({ songId: "222", title: "Second", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] });
    const file = await downloadStudioOriginal(project);
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual([1, 2, 3]);
    expect(invoke.mock.calls[1]).toEqual(["studio_download_source", { args: { sourceUrl: "https://m1.music.126.net/original.mp3", fileName: "Second.mp3" } }, undefined]);
  });
});
