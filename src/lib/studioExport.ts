import type { StudioProject } from "../studio/types";
import { createTrackGraph } from "./studioDsp";
import { encodePcmWav } from "./studioWav";

async function decodeAsset(context: BaseAudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url); if (!response.ok) throw new Error(`无法读取音频资产：${response.status}`);
  return context.decodeAudioData((await response.arrayBuffer()).slice(0));
}

export async function renderStudioMix(project: StudioProject): Promise<Blob> {
  const duration = Math.max(1, project.durationSec || 1);
  const sampleRate = 48000;
  const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
  const hasSolo = project.tracks.some(t => t.mixer.solo);
  for (const track of project.tracks) {
    const graph = createTrackGraph(offline, offline.destination);
    graph.update(track, hasSolo);
    for (const clip of track.clips) {
      const asset = track.assets.find(a => a.id === clip.assetId) ?? track.assets[track.assets.length - 1];
      if (!asset) continue;
      const source = offline.createBufferSource(); source.buffer = await decodeAsset(offline, asset.url); source.connect(graph.input);
      const offset = Math.min(source.buffer.duration, Math.max(0, clip.offsetSec));
      const length = Math.max(0.001, Math.min(source.buffer.duration - offset, clip.durationSec));
      source.start(Math.max(0, clip.startSec), offset, length);
    }
  }
  const rendered = await offline.startRendering();
  return encodePcmWav([rendered.getChannelData(0), rendered.getChannelData(1)], sampleRate, 24);
}
