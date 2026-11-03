import { describe, expect, it } from "vitest";
import { DEFAULT_NORMALIZATION, measureNormalization } from "./studioNormalization";

describe("active RMS normalization", () => {
  it("matches recordings of different levels, independent of leading/trailing silence", () => {
    const active = new Float32Array(1600).fill(0.1), padded = new Float32Array(8000);
    padded.set(new Float32Array(1600).fill(0.02), 3200);
    const first = measureNormalization([active], 1000, DEFAULT_NORMALIZATION);
    const second = measureNormalization([padded], 1000, DEFAULT_NORMALIZATION);
    expect(first.inputRmsDb + first.gainDb).toBeCloseTo(-18, 5);
    expect(second.inputRmsDb + second.gainDb).toBeCloseTo(-18, 5);
    expect(second.gainDb - first.gainDb).toBeCloseTo(20 * Math.log10(5), 5);
  });
  it("respects transient peaks and reports when average target cannot be reached", () => {
    const samples = new Float32Array(1600).fill(0.05); samples[700] = 0.95;
    const result = measureNormalization([samples], 1000, DEFAULT_NORMALIZATION);
    expect(result.limited).toBe(true);
    expect(result.inputPeakDb + result.gainDb).toBeCloseTo(-3, 5);
    expect(result.inputRmsDb + result.gainDb).toBeLessThan(-18);
  });
  it("caps amplification, keeps stereo energy, and rejects silence", () => {
    const quiet = new Float32Array(800).fill(0.002);
    expect(measureNormalization([quiet, quiet], 1000, DEFAULT_NORMALIZATION).gainDb).toBe(18);
    let failed = false;
    try { measureNormalization([new Float32Array(800)], 1000, DEFAULT_NORMALIZATION); } catch { failed = true; }
    expect(failed).toBe(true);
  });
  it("offers peak mode without changing intra-recording dynamics", () => {
    const result = measureNormalization([new Float32Array([0, 0.1, -0.5, 0.2])], 1000, { mode: "peak", targetDb: -3, ceilingDb: -3 });
    expect(result.gain * 0.5).toBeCloseTo(Math.pow(10, -3 / 20), 6);
    expect(result.limited).toBe(false);
  });
});
