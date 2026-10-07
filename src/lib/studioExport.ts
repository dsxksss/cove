import type { StudioProject } from "../studio/types";
import { createTrackGraph } from "./studioDsp";
import { encodePcmWav } from "./studioWav";
import { getClipDuration, getProjectDuration, hasAudibleClips, isTrackAudible } from "./studioSchedule";
import { decodeStudioAsset } from "./studioAssetAudio";

export async function renderStudioMix(project: StudioProject): Promise<Blob> {
  if (!hasAudibleClips(project)) throw new Error("没有可导出的音频，请检查音轨是否静音或尚未导入音频");
  const duration = Math.max(1, getProjectDuration(project));
  const sampleRate = 48000;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const hasSolo = project.tracks.some((track) => track.mixer.solo);
  const decoded = new Map<string, AudioBuffer>();
  for (const track of project.tracks) {
    if (!isTrackAudible(track, hasSolo)) continue;
    const graph = createTrackGraph(offline, offline.destination);
    graph.update(track, hasSolo);
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
      const offset = Math.min(buffer.duration, Math.max(0, clip.offsetSec));
      const length = Math.min(getClipDuration(clip, { durationSec: buffer.duration }), buffer.duration - offset);
      if (length <= 0) continue;
      const source = offline.createBufferSource();
      source.buffer = buffer;
      source.connect(graph.input);
      source.start(Math.max(0, clip.startSec), offset, length);
    }
  }
  const rendered = await offline.startRendering();
  return encodePcmWav([rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate, 24);
}
