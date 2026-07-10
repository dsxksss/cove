import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearPreload,
  getPreloadedUrls,
  isPreloaded,
  preloadAudioUrl,
} from "./preload";

class FakeAudio {
  static instances: FakeAudio[] = [];
  preload = "";
  src = "";
  load = vi.fn();
  pause = vi.fn();
  removeAttribute = vi.fn((name: string) => {
    if (name === "src") this.src = "";
  });

  constructor() {
    FakeAudio.instances.push(this);
  }
}

describe("preloadAudioUrl", () => {
  afterEach(() => {
    clearPreload();
    FakeAudio.instances = [];
    vi.unstubAllGlobals();
  });

  it("creates a detached Audio element and caches the url", () => {
    FakeAudio.instances = [];
    clearPreload();
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
    expect(preloadAudioUrl("https://cdn.example/a.mp3")).toBe(true);
    expect(isPreloaded("https://cdn.example/a.mp3")).toBe(true);
    expect(getPreloadedUrls()).toEqual(["https://cdn.example/a.mp3"]);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toBe("https://cdn.example/a.mp3");
    expect(FakeAudio.instances[0].load).toHaveBeenCalled();
  });

  it("returns false for empty urls and true for already-cached", () => {
    FakeAudio.instances = [];
    clearPreload();
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
    expect(preloadAudioUrl(null)).toBe(false);
    expect(preloadAudioUrl("")).toBe(false);
    expect(preloadAudioUrl("https://cdn.example/b.mp3")).toBe(true);
    expect(preloadAudioUrl("https://cdn.example/b.mp3")).toBe(true);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it("evicts oldest when exceeding max entries", () => {
    FakeAudio.instances = [];
    clearPreload();
    vi.stubGlobal("Audio", FakeAudio as unknown as typeof Audio);
    preloadAudioUrl("https://cdn.example/1.mp3");
    preloadAudioUrl("https://cdn.example/2.mp3");
    preloadAudioUrl("https://cdn.example/3.mp3");
    const urls = getPreloadedUrls();
    expect(urls).toHaveLength(2);
    expect(urls.includes("https://cdn.example/1.mp3")).toBe(false);
    expect(urls.includes("https://cdn.example/3.mp3")).toBe(true);
  });
});
