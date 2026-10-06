class CovePcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity;
    this.stopFrame = Infinity;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") { this.startFrame = data.frame; this.stopFrame = Infinity; }
      if (data.type === "stop") this.stopFrame = data.frame;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0];
    // Always silent; monitoring uses a separate gain node and is off by default.
    for (const channel of outputs[0] || []) channel.fill(0);
    if (currentFrame >= this.stopFrame) {
      this.port.postMessage({ type: "stopped", frame: this.stopFrame });
      this.startFrame = Infinity; this.stopFrame = Infinity;
    }
    if (!input?.length || currentFrame + 128 <= this.startFrame) return true;
    const from = Math.max(0, this.startFrame - currentFrame);
    const to = Math.min(input[0].length, this.stopFrame - currentFrame);
    if (to > from) {
      const pcm = input[0].slice(from, to);
      this.port.postMessage({ type: "pcm", pcm }, [pcm.buffer]);
    }
    return true;
  }
}
registerProcessor("cove-pcm-recorder", CovePcmRecorder);
