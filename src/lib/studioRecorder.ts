import { encodePcmWav } from "./studioWav";

export class StudioRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private inputGain: GainNode | null = null;
  private monitor: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private finish: (() => void) | null = null;
  private moduleLoaded = false;
  constructor(private context: AudioContext) {}
  async prepare(deviceId: string, gain: number, monitor: boolean) {
    this.dispose();
    if (!this.moduleLoaded) { await this.context.audioWorklet.addModule("/studio-recorder.worklet.js"); this.moduleLoaded = true; }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId === "default" ? {} : { deviceId: { exact: deviceId } }), echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
    this.source = this.context.createMediaStreamSource(this.stream);
    this.inputGain = this.context.createGain(); this.inputGain.gain.value = gain;
    this.node = new AudioWorkletNode(this.context, "cove-pcm-recorder", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    this.source.connect(this.inputGain).connect(this.node).connect(this.context.destination);
    this.monitor = this.context.createGain(); this.monitor.gain.value = monitor ? 1 : 0;
    this.inputGain.connect(this.monitor).connect(this.context.destination);
    this.chunks = [];
    this.node.port.onmessage = ({ data }) => {
      if (data.type === "pcm") this.chunks.push(data.pcm);
      if (data.type === "stopped") this.finish?.();
    };
  }
  start(at: number) { this.node?.port.postMessage({ type: "start", frame: Math.round(at * this.context.sampleRate) }); }
  update(gain: number, monitor: boolean) { if (this.inputGain) this.inputGain.gain.value = gain; if (this.monitor) this.monitor.gain.value = monitor ? 1 : 0; }
  onDeviceLost(callback: () => void) { this.stream?.getAudioTracks().forEach(track => { track.onended = callback; }); }
  async stop(): Promise<Blob> {
    if (!this.node) throw new Error("尚未开始录音");
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      this.finish = () => { clearTimeout(timer); resolve(); };
      timer = setTimeout(resolve, 500);
      this.node!.port.postMessage({ type: "stop", frame: Math.round(this.context.currentTime * this.context.sampleRate) });
    });
    const result = new Float32Array(this.chunks.reduce((sum, c) => sum + c.length, 0));
    let index = 0; for (const c of this.chunks) { result.set(c, index); index += c.length; }
    const blob = encodePcmWav([result], this.context.sampleRate, 24);
    this.dispose();
    return blob;
  }
  dispose() {
    this.source?.disconnect(); this.node?.disconnect(); this.monitor?.disconnect(); this.inputGain?.disconnect();
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.source = null; this.node = null; this.monitor = null; this.inputGain = null; this.finish = null;
  }
}
