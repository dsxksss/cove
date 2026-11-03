import type { StudioNormalization, StudioNormalizationOptions } from "../studio/types";

export const DEFAULT_NORMALIZATION: StudioNormalizationOptions = { mode: "average", targetDb: -18, ceilingDb: -3 };
const db = (gain: number) => 20 * Math.log10(Math.max(1e-12, gain));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

/** Gated active RMS, explicitly not LUFS. Silence does not lower the target level. */
export function measureNormalization(channels: Float32Array[], sampleRate: number, options: StudioNormalizationOptions): StudioNormalization & { gain: number } {
  const mode = options.mode === "peak" ? "peak" : "average";
  const targetDb = clamp(options.targetDb, -30, -1);
  const ceilingDb = clamp(options.ceilingDb, -18, -1);
  const frames = channels[0]?.length ?? 0;
  // Short windows avoid diluting word boundaries with a long silent lead-in.
  const blockSize = Math.max(1, Math.round(sampleRate * 0.02));
  const blocks: Array<{ energy: number; frames: number }> = [];
  let peak = 0;
  for (let offset = 0; offset < frames; offset += blockSize) {
    const count = Math.min(blockSize, frames - offset);
    let energy = 0;
    for (const channel of channels) for (let i = offset; i < offset + count; i++) {
      const value = Number.isFinite(channel[i]) ? channel[i] : 0;
      peak = Math.max(peak, Math.abs(value)); energy += value * value;
    }
    blocks.push({ energy: energy / channels.length, frames: count });
  }
  if (peak < 0.00001) throw new Error("音轨没有可归一化的有效声音");
  const maxEnergy = blocks.reduce((max, block) => Math.max(max, block.energy / block.frames), 0);
  const gate = Math.max(Math.pow(10, -55 / 10), maxEnergy * 0.01);
  const active = blocks.filter(block => block.energy / block.frames >= gate);
  if (!active.length && mode === "average") throw new Error("有效声音太弱，无法可靠匹配响度，请检查录音或使用峰值方式");
  const activeFrames = active.reduce((total, block) => total + block.frames, 0);
  const rms = Math.sqrt(active.reduce((total, block) => total + block.energy, 0) / Math.max(1, activeFrames));
  const desiredDb = targetDb - (mode === "peak" ? db(peak) : db(rms));
  const gainDb = Math.min(desiredDb, ceilingDb - db(peak), 18);
  return { mode, targetDb, ceilingDb, inputRmsDb: db(rms), inputPeakDb: db(peak), gainDb, gain: Math.pow(10, gainDb / 20), limited: gainDb < desiredDb - 0.05 };
}
