import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StudioAudioEngine } from "./studioAudio";
import { createStudioProject } from "../studio/types";

class Node {
  gain = { value: 1 }; pan = { value: 0 }; frequency = { value: 0 }; Q = { value: 0 };
  threshold = { value: 0 }; ratio = { value: 1 }; attack = { value: 0 }; release = { value: 0 }; delayTime = { value: 0 };
  buffer: unknown; fftSize = 512; smoothingTimeConstant = 0;
  starts: number[][] = []; stopped = false;
  connect<T>(target: T): T { return target; }
  disconnect() {}
  start(...args: number[]) { this.starts.push(args); }
  stop() { this.stopped = true; }
}
class Context {
  currentTime = 5; sampleRate = 100; destination = new Node();
  sources: Node[] = []; decodes = 0;
  resume: () => Promise<void> = async () => {};
  createAnalyser() { return new Node(); }
  createGain() { return new Node(); }
  createBiquadFilter() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createConvolver() { return new Node(); }
  createDelay() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createBuffer(_channels: number, frames: number) { return { getChannelData: () => new Float32Array(frames) }; }
  async decodeAudioData() { this.decodes++; return { duration: 60 }; }
  createBufferSource() { const node = new Node(); this.sources.push(node); return node; }
  async close() {}
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const originalContext = globalThis.AudioContext;
const originalFetch = globalThis.fetch;
function project() {
  const value = createStudioProject({ songId: "test", title: "Test", artist: "Test", coverUrl: "", durationSec: 60, lyrics: [] });
  value.tracks[0].assets = [{ id: "audio", url: "blob:audio", name: "audio.wav", durationSec: 60, mimeType: "audio/wav" }];
  value.tracks[0].clips = [{ id: "clip", assetId: "audio", startSec: 0, offsetSec: 0, durationSec: 60 }];
  return value;
}

describe("studio transport state", () => {
  beforeEach(() => {
    globalThis.AudioContext = Context as unknown as typeof AudioContext;
    globalThis.fetch = (async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })) as typeof fetch;
  });
  afterEach(() => { globalThis.AudioContext = originalContext; globalThis.fetch = originalFetch; });

  it("keeps a pause authoritative when resume finishes later", async () => {
    const engine = new StudioAudioEngine(); const context = engine.context as unknown as Context;
    await engine.setProject(project());
    const pending = deferred(); context.resume = () => pending.promise;
    const states: boolean[] = []; engine.subscribePlayback((playing) => states.push(playing));
    const playback = engine.play(8);
    engine.pause(); pending.resolve(); await playback;
    expect(engine.isPlaying).toBe(false);
    expect(states[states.length - 1]).toBe(false);
    expect(context.sources.length).toBe(0);
    expect(engine.currentTime).toBe(8);
    engine.dispose();
  });

  it("ignores an old resume failure after a newer seek has started", async () => {
    const engine = new StudioAudioEngine(); const context = engine.context as unknown as Context;
    await engine.setProject(project());
    const old = deferred(); context.resume = () => old.promise;
    const first = engine.play(2);
    context.resume = async () => {};
    await engine.play(20);
    old.reject(new Error("old resume failed")); await first;
    expect(engine.isPlaying).toBe(true);
    expect(engine.currentTime).toBe(20);
    expect(context.sources[0].stopped).toBe(false);
    engine.dispose();
  });

  it("keeps paused seeks silent and schedules the most recent playing seek", async () => {
    const engine = new StudioAudioEngine(); const context = engine.context as unknown as Context;
    await engine.setProject(project());
    engine.seek(60); engine.seek(5);
    expect(engine.isPlaying).toBe(false);
    expect(context.sources.length).toBe(0);
    await engine.play(5);
    engine.seek(50); engine.seek(12);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(engine.isPlaying).toBe(true);
    expect(engine.currentTime).toBe(12);
    const active = context.sources.filter((source) => !source.stopped);
    expect(active.length).toBe(1);
    expect(active[0].starts[0][1]).toBe(12);
    engine.dispose();
  });

  it("preserves play intent across rapid clip edits without decoding the same asset again", async () => {
    const engine = new StudioAudioEngine(); const context = engine.context as unknown as Context;
    const value = project(); await engine.setProject(value); await engine.play(2);
    const a = structuredClone(value); a.tracks[0].clips[0].startSec = 4;
    const b = structuredClone(value); b.tracks[0].clips[0].startSec = 6;
    await Promise.all([engine.setProject(a), engine.setProject(b)]);
    expect(engine.isPlaying).toBe(true);
    expect(context.decodes).toBe(1);
    expect(context.sources.filter((source) => !source.stopped).length).toBe(1);
    engine.dispose();
  });

  it("schedules muted tracks so mixer changes do not require seeking", async () => {
    const engine = new StudioAudioEngine(); const context = engine.context as unknown as Context;
    const value = project(); value.tracks[0].mixer.mute = true;
    await engine.setProject(value); await engine.play(0);
    expect(context.sources.length).toBe(1);
    const unmuted = structuredClone(value); unmuted.tracks[0].mixer.mute = false;
    await engine.setProject(unmuted);
    expect(context.sources.length).toBe(1);
    expect(context.sources[0].stopped).toBe(false);
    engine.dispose();
  });

  it("publishes paused state when the latest playback request fails", async () => {
    const engine = new StudioAudioEngine();
    let playing = false; engine.subscribePlayback((value) => { playing = value; });
    let failed = false;
    try { await engine.play(0); } catch { failed = true; }
    expect(failed).toBe(true); expect(playing).toBe(false); expect(engine.isPlaying).toBe(false);
    engine.dispose();
  });
});
