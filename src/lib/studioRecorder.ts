import { encodePcmWav } from "./studioWav";

export type StudioInputLevel = { rms: number; peak: number; clipping: boolean };

// A context owns its processor registry. Sharing the pending load also prevents
// concurrent microphone preparations from registering the same processor twice.
const moduleLoads = new WeakMap<AudioContext, Promise<void>>();
function loadRecorderModule(context: AudioContext): Promise<void> {
  let pending = moduleLoads.get(context);
  if (!pending) {
    pending = context.audioWorklet.addModule("/studio-recorder.worklet.js").catch((error) => {
      moduleLoads.delete(context);
      throw error;
    });
    moduleLoads.set(context, pending);
  }
  return pending;
}

const cancelled = () => new DOMException("录音准备已取消", "AbortError");
const safeGain = (gain: number) => Math.max(0, Math.min(4, Number.isFinite(gain) ? gain : 1));

export class StudioRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private inputGain: GainNode | null = null;
  private monitor: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private levelSamples = new Float32Array(0);
  private chunks: Float32Array[] = [];
  private finish: ((error?: Error, frames?: number) => void) | null = null;
  private stopPromise: Promise<Blob> | null = null;
  private generation = 0;
  private recording = false;
  private startTime: number | null = null;
  private deviceLost: (() => void) | null = null;

  constructor(private context: AudioContext) {}

  get sampleRate(): number { return this.context.sampleRate; }
  get startedAt(): number | null { return this.startTime; }
  get isReady(): boolean {
    return Boolean(this.node && this.context.state !== "closed" && this.stream?.getAudioTracks().some(track => track.readyState === "live"));
  }
  get isInputMuted(): boolean {
    return !this.stream?.getAudioTracks().some(track => track.readyState === "live" && !track.muted && track.enabled);
  }

  async prepare(deviceId: string, gain: number, monitor: boolean): Promise<void> {
    this.dispose();
    const generation = this.generation;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("当前环境不支持麦克风录音");
      await this.context.resume();
      if (generation !== this.generation) throw cancelled();
      await loadRecorderModule(this.context);
      if (generation !== this.generation) throw cancelled();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: {
        ...(deviceId === "default" ? {} : { deviceId: { exact: deviceId } }),
        echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1,
      } });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        throw cancelled();
      }
      this.stream = stream;
      if (!stream.getAudioTracks().some(track => track.readyState === "live")) throw new Error("麦克风未提供可用音频输入");
      stream.getAudioTracks().forEach(track => { track.onended = () => this.deviceLost?.(); });
      this.source = this.context.createMediaStreamSource(stream);
      this.inputGain = this.context.createGain();
      this.inputGain.gain.value = safeGain(gain);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.levelSamples = new Float32Array(this.analyser.fftSize);
      this.node = new AudioWorkletNode(this.context, "cove-pcm-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      // The worklet's output is silence; the separate monitor is the only route
      // that can send microphone sound to the speakers.
      this.source.connect(this.inputGain).connect(this.analyser).connect(this.node).connect(this.context.destination);
      this.monitor = this.context.createGain();
      this.monitor.gain.value = monitor ? 1 : 0;
      this.inputGain.connect(this.monitor).connect(this.context.destination);
      this.node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data.type === "pcm" && data.pcm instanceof Float32Array) this.chunks.push(data.pcm);
        if (data.type === "started" && Number.isFinite(data.frame)) this.startTime = data.frame / this.sampleRate;
        if (data.type === "stopped") this.finish?.(undefined, data.frames);
      };
      this.node.onprocessorerror = () => {
        this.finish?.(new Error("录音处理器异常，无法保存完整录音"));
        this.deviceLost?.();
        this.dispose();
      };
    } catch (error) {
      // An obsolete request must never dispose a newer, successful preparation.
      if (generation === this.generation) this.dispose();
      throw error;
    }
  }

  start(at: number): number {
    if (!this.isReady || !this.node) throw new Error("麦克风尚未准备好");
    if (this.recording || this.stopPromise) throw new Error("录音已开始");
    this.chunks = [];
    const frame = Math.ceil(Math.max(this.context.currentTime, Number.isFinite(at) ? at : this.context.currentTime) * this.sampleRate);
    this.startTime = frame / this.sampleRate;
    this.recording = true;
    this.node.port.postMessage({ type: "start", frame });
    return this.startTime;
  }

  update(gain: number, monitor: boolean): void {
    if (this.inputGain) this.inputGain.gain.value = safeGain(gain);
    if (this.monitor) this.monitor.gain.value = monitor ? 1 : 0;
  }

  getLevel(): StudioInputLevel {
    if (!this.analyser || !this.isReady || this.isInputMuted || this.context.state !== "running") return { rms: 0, peak: 0, clipping: false };
    this.analyser.getFloatTimeDomainData(this.levelSamples);
    let sum = 0;
    let peak = 0;
    for (const sample of this.levelSamples) {
      const value = Number.isFinite(sample) ? sample : 0;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    return { rms: Math.sqrt(sum / this.levelSamples.length), peak, clipping: peak >= 0.99 };
  }

  onDeviceLost(callback: () => void): void { this.deviceLost = callback; }

  stop(): Promise<Blob> {
    if (this.stopPromise) return this.stopPromise;
    const node = this.node;
    if (!node || !this.recording) return Promise.reject(new Error("尚未开始录音"));
    const generation = this.generation;
    this.stopPromise = (async () => {
      try {
        const capturedFrames = await new Promise<number | undefined>((resolve, reject) => {
          const timer = setTimeout(() => this.finish?.(new Error("录音结束确认超时，未导出不完整音频，请重新录制")), 2000);
          this.finish = (error, frames) => {
            clearTimeout(timer);
            this.finish = null;
            if (error) reject(error); else resolve(frames);
          };
          node.port.postMessage({ type: "stop", frame: Math.ceil(this.context.currentTime * this.sampleRate) });
        });
        const frames = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        if (!frames) throw new Error("未录到音频，请检查麦克风后重新录制");
        if (capturedFrames !== undefined && capturedFrames !== frames) throw new Error("录音数据不完整，请重新录制");
        const result = new Float32Array(frames);
        let index = 0;
        for (const chunk of this.chunks) { result.set(chunk, index); index += chunk.length; }
        return encodePcmWav([result], this.sampleRate, 24);
      } finally {
        if (generation === this.generation) this.dispose();
      }
    })();
    return this.stopPromise;
  }

  dispose(): void {
    this.generation += 1;
    this.finish?.(cancelled());
    this.source?.disconnect(); this.node?.disconnect(); this.monitor?.disconnect(); this.inputGain?.disconnect(); this.analyser?.disconnect();
    if (this.node) { this.node.port.onmessage = null; this.node.onprocessorerror = null; this.node.port.close(); }
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    this.stream = null; this.source = null; this.node = null; this.monitor = null; this.inputGain = null; this.analyser = null;
    this.finish = null; this.stopPromise = null; this.recording = false; this.startTime = null;
    this.chunks = []; this.levelSamples = new Float32Array(0);
  }
}
