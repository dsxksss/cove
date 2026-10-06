import { describe, expect, it } from "vitest";
import { StudioRecorder } from "./studioRecorder";

class FakePort {
  static emitAudio = true;
  onmessage: ((event: { data: any }) => void) | null = null;
  postMessage(message: any) {
    if (message.type === "start") queueMicrotask(() => this.onmessage?.({ data: { type: "started", frame: message.frame } }));
    if (message.type === "stop") {
      queueMicrotask(() => {
        if (FakePort.emitAudio) this.onmessage?.({ data: { type: "pcm", pcm: new Float32Array([0.25, -0.25, 0.5, -0.5]) } });
        this.onmessage?.({ data: { type: "stopped", frame: message.frame, frames: FakePort.emitAudio ? 4 : 0 } });
      });
    }
  }
  close() {}
}

class FakeNode {
  connect<T>(node: T): T { return node; }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = { value: 1 };
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(target: Float32Array) {
    target.fill(0);
    target[0] = 0.5;
    target[1] = -1;
  }
}

class FakeTrack {
  readyState = "live";
  muted = false;
  enabled = true;
  onended: (() => void) | null = null;
  stop() { this.readyState = "ended"; }
}

class FakeStream {
  readonly track = new FakeTrack();
  getAudioTracks() { return [this.track]; }
  getTracks() { return [this.track]; }
}

class FakeAudioContext {
  currentTime = 10;
  sampleRate = 48000;
  state = "running";
  addModuleCalls = 0;
  audioWorklet = { addModule: async () => { this.addModuleCalls += 1; } };
  async resume() { this.state = "running"; }
  createMediaStreamSource() { return new FakeNode(); }
  createGain() { return new FakeGain(); }
  createAnalyser() { return new FakeAnalyser(); }
}

describe("StudioRecorder", () => {
  function install(context: FakeAudioContext, stream = new FakeStream()) {
    FakePort.emitAudio = true;
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
    Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, writable: true, value: class {
      port = new FakePort();
      onprocessorerror: (() => void) | null = null;
      constructor() {}
      connect<T>(node: T): T { return node; }
      disconnect() {}
    } });
    return stream;
  }

  it("loads one worklet module per context and reports the real input level", async () => {
    const context = new FakeAudioContext();
    install(context);
    const first = new StudioRecorder(context as unknown as AudioContext);
    const second = new StudioRecorder(context as unknown as AudioContext);
    await Promise.all([first.prepare("default", 1, false), second.prepare("default", 1, false)]);
    expect(context.addModuleCalls).toBe(1);
    const level = first.getLevel();
    expect(level.peak).toBe(1);
    expect(level.clipping).toBe(true);
    expect(level.rms).toBeGreaterThan(0);
    first.dispose();
    second.dispose();
  });

  it("keeps the actual scheduled frame and returns a complete take", async () => {
    const context = new FakeAudioContext();
    install(context);
    const recorder = new StudioRecorder(context as unknown as AudioContext);
    await recorder.prepare("default", 1, false);
    const actual = recorder.start(9);
    expect(actual).toBe(10);
    const blob = await recorder.stop();
    expect(blob.type).toBe("audio/wav");
    recorder.dispose();
  });

  it("rejects an acknowledged but empty take", async () => {
    const context = new FakeAudioContext();
    install(context);
    FakePort.emitAudio = false;
    const recorder = new StudioRecorder(context as unknown as AudioContext);
    await recorder.prepare("default", 1, false);
    recorder.start(context.currentTime);
    let rejected = false;
    try { await recorder.stop(); } catch (error) { rejected = error instanceof Error && error.message.includes("未录到音频"); }
    expect(rejected).toBe(true);
    recorder.dispose();
  });

  it("reports cancellation when an old prepare resolves after dispose", async () => {
    const context = new FakeAudioContext();
    let resolveStream: ((stream: FakeStream) => void) | null = null;
    const stream = new FakeStream();
    Object.defineProperty(globalThis, "navigator", { configurable: true, writable: true, value: { mediaDevices: { getUserMedia: () => new Promise<FakeStream>(resolve => { resolveStream = resolve; }) } } });
    Object.defineProperty(globalThis, "AudioWorkletNode", { configurable: true, writable: true, value: class {
      port = new FakePort();
      onprocessorerror: (() => void) | null = null;
      connect<T>(node: T): T { return node; }
      disconnect() {}
    } });
    const recorder = new StudioRecorder(context as unknown as AudioContext);
    const pending = recorder.prepare("default", 1, false);
    for (let i = 0; i < 8 && !resolveStream; i += 1) await Promise.resolve();
    recorder.dispose();
    resolveStream?.(stream);
    let rejected = false;
    try { await pending; } catch (error) { rejected = error instanceof DOMException && error.name === "AbortError"; }
    expect(rejected).toBe(true);
    expect(stream.track.readyState).toBe("ended");
  });
});
