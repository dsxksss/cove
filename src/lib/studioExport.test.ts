import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStudioProject, createVocalTrack, type StudioTrack } from "../studio/types";
import { normalizationGain, renderStudioMix } from "./studioExport";

class AudioNodeStub {
  gain = { value: 1 }; pan = { value: 0 }; frequency = { value: 0 }; Q = { value: 0 };
  threshold = { value: 0 }; ratio = { value: 1 }; attack = { value: 0 }; release = { value: 0 }; delayTime = { value: 0 };
  buffer: unknown;
  starts: number[][] = [];
  connect<T>(target: T): T { return target; }
  disconnect() {}
  start(...args: number[]) { this.starts.push(args); }
}

class AudioBufferStub {
  readonly channels: Float32Array[];
  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() { return this.length / this.sampleRate; }
  getChannelData(channel: number) { return this.channels[channel]; }
}

class OfflineContextStub {
  static rendered: OfflineContextStub[] = [];
  destination = new AudioNodeStub();
  sources: AudioNodeStub[] = [];
  constructor(readonly channels: number, readonly length: number, readonly sampleRate: number) {}
  createGain() { return new AudioNodeStub(); }
  createBiquadFilter() { return new AudioNodeStub(); }
  createDynamicsCompressor() { return new AudioNodeStub(); }
  createConvolver() { return new AudioNodeStub(); }
  createDelay() { return new AudioNodeStub(); }
  createStereoPanner() { return new AudioNodeStub(); }
  createBuffer(channels: number, length: number, sampleRate: number) { return new AudioBufferStub(channels, length, sampleRate); }
  async decodeAudioData(bytes: ArrayBuffer) { return { duration: new DataView(bytes).getFloat64(0, true) }; }
  createBufferSource() { const source = new AudioNodeStub(); this.sources.push(source); return source; }
  async startRendering() {
    OfflineContextStub.rendered.push(this);
    const buffer = new AudioBufferStub(this.channels, this.length, this.sampleRate);
    // Model source scheduling only; DSP itself has a separate real-WebAudio
    // regression. This lets the export tests inspect real encoded WAV frames.
    for (const source of this.sources) for (const [start, , duration] of source.starts) {
      for (const channel of buffer.channels) channel.fill(0.25, Math.round(start * this.sampleRate), Math.round((start + duration) * this.sampleRate));
    }
    return buffer;
  }
}

const originalOfflineContext = globalThis.OfflineAudioContext;
const originalFetch = globalThis.fetch;
const decodedDurations = new Map<string, number>();
const requestedUrls: string[] = [];

function addAudio(track: StudioTrack, duration = 4, actualDuration = duration) {
  const id = `asset-${track.id}`;
  const url = `blob:${id}`;
  decodedDurations.set(url, actualDuration);
  track.assets = [{ id, url, name: `${id}.wav`, durationSec: duration, mimeType: "audio/wav" }];
  track.clips = [{ id: `clip-${track.id}`, assetId: id, startSec: 0, offsetSec: 0, durationSec: duration }];
}

function project() {
  const value = createStudioProject({ songId: "song", title: "Song", artist: "Singer", coverUrl: "", durationSec: 10, lyrics: [] });
  addAudio(value.tracks[0]);
  return value;
}

async function wavFrames(value: ReturnType<typeof project>) {
  const wav = new DataView(await (await renderStudioMix(value)).arrayBuffer());
  expect(wav.getUint32(24, true)).toBe(48000);
  expect(wav.getUint16(34, true)).toBe(24);
  return { wav, frames: wav.getUint32(40, true) / 6, context: OfflineContextStub.rendered[0] };
}

describe("studio mix export length", () => {
  beforeEach(() => {
    decodedDurations.clear(); requestedUrls.length = 0; OfflineContextStub.rendered = [];
    globalThis.OfflineAudioContext = OfflineContextStub as unknown as typeof OfflineAudioContext;
    globalThis.fetch = (async (url: string) => {
      requestedUrls.push(url);
      const duration = decodedDurations.get(url);
      if (duration === undefined) throw new Error(`Unexpected asset ${url}`);
      const bytes = new ArrayBuffer(8); new DataView(bytes).setFloat64(0, duration, true);
      return { ok: true, arrayBuffer: async () => bytes };
    }) as typeof fetch;
  });
  afterEach(() => { globalThis.OfflineAudioContext = originalOfflineContext; globalThis.fetch = originalFetch; });

  it("ends at a trimmed clip instead of the original song length or a one-second minimum", async () => {
    const value = project(); value.tracks[0].clips[0].durationSec = 0.25;
    const { frames, wav } = await wavFrames(value);
    expect(frames).toBe(12000);
    expect(wav.getUint8(44 + (frames - 1) * 6 + 2)).toBeGreaterThan(0);
    expect(value.durationSec).toBe(10);
    expect(value.tracks[0].assets[0].durationSec).toBe(4);
  });

  it("keeps leading silence, source trim and a positive millisecond track offset", async () => {
    const value = project();
    const track = value.tracks[0]; track.offsetMs = 250;
    Object.assign(track.clips[0], { startSec: 1, offsetSec: 0.5, durationSec: 0.75 });
    const { frames, wav, context } = await wavFrames(value);
    expect(frames).toBe(96000);
    expect(context.sources[0].starts[0]).toEqual([1.25, 0.5, 0.75]);
    expect(wav.getUint8(44 + 48000 * 6 + 2)).toBe(0);
    expect(wav.getUint8(44 + 60000 * 6 + 2)).toBeGreaterThan(0);
  });

  it("extends past the original song to the latest clip and retains intentional gaps", async () => {
    const value = project(); value.durationSec = 1;
    const track = value.tracks[0];
    Object.assign(track.clips[0], { startSec: 3, durationSec: 1 });
    track.clips.push({ ...track.clips[0], id: "early", startSec: 0, durationSec: 0.5 });
    const { frames, wav } = await wavFrames(value);
    expect(frames).toBe(192000);
    expect(wav.getUint8(44 + 96000 * 6 + 2)).toBe(0);
    expect(wav.getUint8(44 + 168000 * 6 + 2)).toBeGreaterThan(0);
    expect(requestedUrls.length).toBe(1);
  });

  it("excludes muted, zero-gain and non-solo tails without decoding those assets", async () => {
    const value = project(); value.tracks[0].clips[0].durationSec = 0.5;
    value.tracks[0].mixer.solo = true;
    for (let index = 1; index <= 3; index++) {
      const track = createVocalTrack(index); addAudio(track, 8);
      if (index === 1) { track.mixer.mute = true; track.mixer.solo = true; }
      if (index === 2) { track.mixer.gain = 0; track.mixer.solo = true; }
      value.tracks.push(track);
    }
    const { frames, context } = await wavFrames(value);
    expect(frames).toBe(24000);
    expect(context.sources.length).toBe(1);
    expect(requestedUrls).toEqual([value.tracks[0].assets[0].url]);
  });

  it("clamps the final clip against decoded audio duration, not stale asset metadata", async () => {
    const value = project(); addAudio(value.tracks[0], 4, 2);
    Object.assign(value.tracks[0].clips[0], { startSec: 1, offsetSec: 1.5, durationSec: 2 });
    const { frames, context } = await wavFrames(value);
    expect(frames).toBe(72000);
    expect(context.sources[0].starts[0]).toEqual([1, 1.5, 0.5]);
  });

  it("trims only the head before time zero when a track is shifted earlier", async () => {
    const value = project(); const track = value.tracks[0]; track.offsetMs = -500;
    Object.assign(track.clips[0], { startSec: 0.25, offsetSec: 0.5, durationSec: 1 });
    const { frames, context } = await wavFrames(value);
    expect(frames).toBe(36000);
    expect(context.sources[0].starts[0]).toEqual([0, 0.75, 0.75]);
    expect(track.clips[0].durationSec).toBe(1);
    expect(track.clips[0].offsetSec).toBe(0.5);
  });

  it("does not extend for a missing asset, empty clip or clip beyond its decoded source", async () => {
    const value = project(); const track = value.tracks[0]; track.clips[0].durationSec = 0.5;
    track.clips.push({ ...track.clips[0], id: "missing", assetId: "missing", startSec: 7 });
    track.clips.push({ ...track.clips[0], id: "empty", startSec: 8, durationSec: 0 });
    track.clips.push({ ...track.clips[0], id: "past-source", startSec: 9, offsetSec: 4 });
    expect((await wavFrames(value)).frames).toBe(24000);
  });

  it("rejects when decoded source bounds leave no scheduled audio", async () => {
    const value = project(); addAudio(value.tracks[0], 4, 0.5);
    value.tracks[0].clips[0].offsetSec = 1;
    let error = "";
    try { await renderStudioMix(value); } catch (cause) { error = (cause as Error).message; }
    expect(error).toContain("没有可导出的音频");
    expect(OfflineContextStub.rendered.length).toBe(0);
  });

  it("keeps peak normalization on the dry scheduled clips despite the shorter render", async () => {
    const value = project(); const track = value.tracks[0];
    track.clips[0].durationSec = 0.25; track.mixer.mute = true; track.mixer.gain = 0;
    const gain = await normalizationGain(value, track.id);
    expect(gain).toBeCloseTo(Math.pow(10, -1 / 20) / 0.25);
    expect(OfflineContextStub.rendered[0].length).toBe(12000);
    expect(track.mixer.mute).toBe(true);
    expect(track.mixer.gain).toBe(0);
  });
});
