import type { StudioEq, StudioEqBand } from "../studio/types";

export const EQ_COLORS = ["#ef7f91", "#f5b86a", "#e7d869", "#a3d989", "#6ed6cf", "#7da7ef", "#bc96ee"];
export const EQ_TYPES: Array<[StudioEqBand["type"], string]> = [["peaking", "钟形"], ["lowshelf", "低搁架"], ["highshelf", "高搁架"], ["highpass", "高通"], ["lowpass", "低通"], ["notch", "陷波"], ["bandpass", "带通"]];
export const eqClamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
export const frequencyToUnit = (frequency: number) => Math.log(eqClamp(frequency, 20, 20000) / 20) / Math.log(1000);
export const unitToFrequency = (unit: number) => 20 * Math.pow(1000, eqClamp(unit, 0, 1));
export const usesEqGain = (type: StudioEqBand["type"]) => ["peaking", "lowshelf", "highshelf"].includes(type);
export function defaultEqBands(): StudioEqBand[] {
  return [60, 150, 400, 1000, 2500, 6000, 12000].map((frequency, index) => ({ type: index === 0 ? "lowshelf" : index === 6 ? "highshelf" : "peaking", frequency, gainDb: 0, q: 1, enabled: true }));
}
/** Legacy three-band EQ retains its original frequencies, Q, and gain exactly. */
export function getEqBands(eq: StudioEq): StudioEqBand[] {
  const defaults = defaultEqBands();
  if (!Array.isArray(eq.bands)) {
    defaults[0] = { ...defaults[0], frequency: 120, gainDb: eq.lowDb };
    defaults[3] = { ...defaults[3], gainDb: eq.midDb, q: 0.8 };
    defaults[6] = { ...defaults[6], frequency: 8000, gainDb: eq.highDb };
  }
  return defaults.map((fallback, index) => {
    const band = eq.bands?.[index] ?? fallback;
    return { type: EQ_TYPES.some(([type]) => type === band.type) ? band.type : fallback.type, frequency: eqClamp(band.frequency, 20, 20000), gainDb: eqClamp(band.gainDb, -24, 24), q: eqClamp(band.q, 0.1, 18), enabled: band.enabled !== false };
  });
}
export function isEqBandActive(band: StudioEqBand): boolean { return band.enabled && (!usesEqGain(band.type) || band.gainDb !== 0); }
export function configureEqFilter(filter: BiquadFilterNode, band: StudioEqBand, sampleRate: number) {
  filter.type = band.type;
  filter.frequency.value = Math.min(band.frequency, sampleRate * 0.49);
  filter.gain.value = band.gainDb;
  // WebAudio uses dB resonance for high/low-pass; present a conventional Q.
  filter.Q.value = band.type === "highpass" || band.type === "lowpass" ? 20 * Math.log10(band.q) : band.q;
}
