import { DEFAULT_EFFECTS, type StudioEffects, type StudioProject, type StudioTrack, type VocalPresetId } from "../studio/types";
import { defaultEqBands } from "./studioEq";
import { analyzeTrackNormalization, renderStudioAudio } from "./studioExport";
import { measureNormalization } from "./studioNormalization";

export const VOCAL_PRESETS: Array<{ id: VocalPresetId; name: string; description: string }> = [
  { id: "natural", name: "自然清晰", description: "轻压缩、削减低频浑浊，保留人声起伏，少量房间感。" },
  { id: "lead", name: "流行主唱", description: "更稳定的动态、突出清晰度，搭配短混响与少量延迟。" },
  { id: "space", name: "柔和空间", description: "柔和高频和较宽松动态，加入更多空间与延迟。" },
];

export function vocalPresetEffects(id: VocalPresetId): StudioEffects {
  const effects = structuredClone(DEFAULT_EFFECTS), bands = defaultEqBands();
  const lead = id === "lead", space = id === "space";
  bands[0] = { ...bands[0], type: "highpass", frequency: lead ? 100 : 75, q: Math.SQRT1_2 };
  bands[1] = { ...bands[1], frequency: 250, gainDb: lead ? -3 : -1.5, q: 0.85 };
  bands[4] = { ...bands[4], frequency: 3200, gainDb: space ? 0.5 : lead ? 2.5 : 1.5, q: 0.8 };
  bands[6] = { ...bands[6], frequency: 8500, gainDb: space ? -1.5 : 1 };
  effects.eq = { lowDb: 0, midDb: 0, highDb: 0, bands, outputDb: 0, bypass: false };
  effects.compressor = { thresholdDb: lead ? -24 : -22, ratio: lead ? 3 : 2, attackMs: lead ? 8 : 15, releaseMs: space ? 180 : 120 };
  effects.reverb = { mix: space ? 0.16 : lead ? 0.08 : 0.05, decaySec: space ? 2 : lead ? 1.3 : 0.8 };
  effects.delay = { mix: space ? 0.06 : lead ? 0.025 : 0, timeMs: space ? 230 : 110, feedback: 0.15 };
  effects.outputDb = 0;
  return effects;
}

/** Calibrate the actual processed track, while preserving the user's mixer and pitch. */
export async function prepareVocalPreset(project: StudioProject, trackId: string, presetId: VocalPresetId): Promise<Partial<StudioTrack>> {
  const source = project.tracks.find(track => track.id === trackId);
  if (!source || source.kind !== "vocal" || !source.clips.length) throw new Error("请先选择有录音的人声音轨");
  if (!VOCAL_PRESETS.some(preset => preset.id === presetId)) throw new Error("未知的人声预设");
  const { gain: inputGain, ...normalization } = await analyzeTrackNormalization(project, trackId, { mode: "average", targetDb: -18, ceilingDb: -3 });
  const effects = vocalPresetEffects(presetId);
  const track = structuredClone(source); track.normalizationGain = inputGain; track.effects = effects;
  track.mixer = { ...track.mixer, gain: 1, pan: 0, mute: false, solo: false };
  const rendered = await renderStudioAudio({ ...project, tracks: [track] });
  const output = measureNormalization(Array.from({ length: rendered.numberOfChannels }, (_, channel) => rendered.getChannelData(channel)), rendered.sampleRate, { mode: "average", targetDb: -20, ceilingDb: -6 });
  effects.outputDb = Math.max(-60, Math.min(18, output.gainDb));
  return {
    effects, effectsVersion: 1, normalizationGain: inputGain, normalization,
    vocalTreatment: { presetId, before: structuredClone(source.vocalTreatment?.before ?? { effects: source.effects, normalizationGain: source.normalizationGain, normalization: source.normalization }) },
  };
}
