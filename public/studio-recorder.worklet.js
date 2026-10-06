class CovePcmRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.startFrame = Infinity;
    this.stopFrame = Infinity;
    this.capturedFrames = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === "start") {
        this.startFrame = Math.max(currentFrame, Math.round(data.frame));
        this.stopFrame = Infinity;
        this.capturedFrames = 0;
        this.port.postMessage({ type: "started", frame: this.startFrame });
      }
      if (data.type === "stop") this.stopFrame = Math.round(data.frame);
    };
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const blockLength = input?.length || outputs[0]?.[0]?.length || 128;
    // Always silent; monitoring uses a separate gain node and is off by default.
    for (const channel of outputs[0] || []) channel.fill(0);
    const from = Math.max(0, this.startFrame - currentFrame);
    const to = Math.min(blockLength, this.stopFrame - currentFrame);
    if (to > from) {
      // A temporarily muted/disconnected input retains silence on the clock;
      // dropping those frames would pull subsequent vocals earlier in the song.
      const pcm = input ? input.slice(from, to) : new Float32Array(to - from);
      this.capturedFrames += pcm.length;
      this.port.postMessage({ type: "pcm", pcm }, [pcm.buffer]);
    }
    if (Number.isFinite(this.stopFrame) && currentFrame + blockLength >= this.stopFrame) {
      // The ack follows the final partial block on the same ordered port.
      this.port.postMessage({ type: "stopped", frame: this.stopFrame, frames: this.capturedFrames });
      this.startFrame = Infinity;
      this.stopFrame = Infinity;
    }
    return true;
  }
}
registerProcessor("cove-pcm-recorder", CovePcmRecorder);
