import type { StudioProject } from "../studio/types";
import { createTrackGraph } from "./studioDsp";
import { encodePcmWav } from "./studioWav";
import { getProjectDuration, hasAudibleClips, isTrackAudible, scheduledClip } from "./studioSchedule";
import { decodeStudioAsset } from "./studioAssetAudio";

async function renderStudioAudio(project: StudioProject, dryInput = false): Promise<AudioBuffer> {
  if (!hasAudibleClips(project)) throw new Error("没有可导出的音频，请检查音轨是否静音或尚未导入音频");
  const duration = Math.max(1, getProjectDuration(project));
  const sampleRate = 48000;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const hasSolo = project.tracks.some((track) => track.mixer.solo);
  const decoded = new Map<string, AudioBuffer>();
  for (const track of project.tracks) {
    if (!isTrackAudible(track, hasSolo)) continue;
    // Peak normalization measures the source sum before effects, pan and fader.
    // A neutral compressor still has a lookahead/filter path and is not unity.
    const graph = dryInput ? { input: offline.createGain() } : createTrackGraph(offline, offline.destination);
    if ("update" in graph) graph.update(track, hasSolo);
    else graph.input.connect(offline.destination);
    for (const clip of track.clips) {
      // A clip must reference its own asset. Falling back to the last asset
      // silently rendered the wrong take after a re-recording.
      const asset = track.assets.find((candidate) => candidate.id === clip.assetId);
      if (!asset) continue;
      let buffer = decoded.get(asset.id);
      if (!buffer) {
        buffer = await decodeStudioAsset(offline, asset);
        decoded.set(asset.id, buffer);
      }
      const scheduled = scheduledClip(clip, { durationSec: buffer.duration }, track);
      const offset = Math.min(buffer.duration, scheduled.offsetSec);
      const length = scheduled.durationSec;
      if (length <= 0) continue;
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(graph.input);
      source.start(scheduled.startSec, offset, length);
    }
  }
  return offline.startRendering();
}

export async function renderStudioMix(project: StudioProject): Promise<Blob> {
  const rendered = await renderStudioAudio(project);
  return encodePcmWav([rendered.getChannelData(0), rendered.getChannelData(1)], rendered.sampleRate, 24);
}

/** Measure the actual summed clips before effects, pan and the user's fader. */
export async function normalizationGain(project: StudioProject, trackId: string): Promise<number> {
  const source = project.tracks.find((track) => track.id === trackId);
  if (!source) throw new Error("音轨不存在");
  const track = structuredClone(source);
  track.normalizationGain = 1;
  track.mixer = { ...track.mixer, gain: 1, pan: 0, mute: false, solo: false };
  track.effects.eq = { lowDb: 0, midDb: 0, highDb: 0 };
  track.effects.compressor.ratio = 1;
  track.effects.reverb.mix = 0; track.effects.delay.mix = 0;
  const rendered = await renderStudioAudio({ ...project, durationSec: 0, tracks: [track] }, true);
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel++) {
    for (const value of rendered.getChannelData(channel)) peak = Math.max(peak, Math.abs(value));
  }
  if (peak < 0.00001) throw new Error("音轨没有可归一化的有效声音");
  return Math.min(100, Math.pow(10, -1 / 20) / peak);
}
