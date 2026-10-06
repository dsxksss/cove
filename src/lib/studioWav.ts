/** PCM WAV encoder. Input arrays have equal length; output is interleaved little endian. */
export function encodePcmWav(channels: Float32Array[], sampleRate: number, bits: 16 | 24 = 24): Blob {
  if (!channels.length || channels.length > 2 || channels.some(c => c.length !== channels[0].length)) throw new Error("无效的 PCM 声道");
  const frames = channels[0].length;
  const stride = bits / 8;
  const size = frames * channels.length * stride;
  const view = new DataView(new ArrayBuffer(44 + size));
  const text = (at: number, s: string) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + size, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * channels.length * stride, true);
  view.setUint16(32, channels.length * stride, true); view.setUint16(34, bits, true); text(36, "data"); view.setUint32(40, size, true);
  let at = 44;
  const scale = bits === 24 ? 0x800000 : 0x8000;
  for (let i = 0; i < frames; i++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, Number.isFinite(channel[i]) ? channel[i] : 0));
    const signed = Math.round(value * (value < 0 ? scale : scale - 1));
    if (bits === 16) view.setInt16(at, signed, true);
    else { view.setUint8(at, signed & 255); view.setUint8(at + 1, signed >> 8 & 255); view.setUint8(at + 2, signed >> 16 & 255); }
    at += stride;
  }
  return new Blob([view], { type: "audio/wav" });
}
