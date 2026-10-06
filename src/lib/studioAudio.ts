import type { StudioProject, StudioTrack } from "../studio/types";
import { createTrackGraph, type TrackGraph } from "./studioDsp";
import { getClipDuration, getProjectDuration, isTrackAudible } from "./studioSchedule";

type LoadedAsset = { buffer: AudioBuffer; url: string };
type ScheduledSource = { source: AudioBufferSourceNode; trackId: string };

/**
 * Shared realtime transport for a StudioProject. Every clip owns an
 * AudioBufferSourceNode, so takes, offsets and trims have the same semantics
 * as the offline renderer.
 */
export class StudioAudioEngine {
  readonly context = new AudioContext();
  private readonly analyser = this.context.createAnalyser();
  private project: StudioProject | null = null;
  private graphs = new Map<string, TrackGraph>();
  private loaded = new Map<string, LoadedAsset>();
  private sources: ScheduledSource[] = [];
  private loadRevision = 0;
  private structureKey = "";
  private startContextTime = 0;
  private position = 0;
  private playing = false;
  private transportRevision = 0;

  constructor() {
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.connect(this.context.destination);
  }

  get currentTime(): number {
    if (!this.playing) return this.position;
    return Math.max(0, this.position + Math.max(0, this.context.currentTime - this.startContextTime));
  }

  get isPlaying(): boolean { return this.playing; }

  /** Loads a project and its assets. A newer call invalidates older decode work. */
  async setProject(project: StudioProject): Promise<void> {
    const wasPlaying = this.playing;
    const resumeAt = this.currentTime;
    const previousProjectId = this.project?.id;
    const nextKey = projectStructureKey(project);
    const sameStructure = this.project?.id === project.id && this.structureKey === nextKey;
    this.project = project;
    if (sameStructure) {
      this.updateAll(project.tracks);
      return;
    }

    const revision = ++this.loadRevision;
    this.pause();
    const pauseRevision = this.transportRevision;
    this.clearGraphs();
    if (previousProjectId !== project.id) this.loaded.clear();
    const requestedUrls = new Map(project.tracks.flatMap((track) => track.assets.map((asset) => [asset.id, asset.url] as const)));
    for (const [id, loaded] of this.loaded) if (requestedUrls.get(id) !== loaded.url) this.loaded.delete(id);
    this.structureKey = nextKey;
    this.updateGraphs(project.tracks);

    const requested = new Map<string, { id: string; url: string }>();
    for (const track of project.tracks) {
      for (const asset of track.assets) {
        if (!asset.url || requested.has(asset.id)) continue;
        requested.set(asset.id, { id: asset.id, url: asset.url });
      }
    }
    await Promise.all([...requested.values()].map(async ({ id, url }) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`无法读取音频资产：${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await this.context.decodeAudioData(arrayBuffer.slice(0));
        if (revision === this.loadRevision && this.project?.id === project.id) this.loaded.set(id, { buffer, url });
      } catch {
        // Missing assets are skipped deliberately. Never substitute another
        // asset from the same track, since that makes takes play incorrectly.
      }
    }));
    if (revision !== this.loadRevision || this.project?.id !== project.id) return;
    this.position = Math.min(this.position, getProjectDuration(project));
    if (wasPlaying && pauseRevision === this.transportRevision) await this.play(Math.min(resumeAt, getProjectDuration(project)), true);
  }

  /** Applies mixer/effect changes without rebuilding scheduled sources. */
  updateAll(tracks: Array<Pick<StudioTrack, "id" | "mixer" | "effects">>): void {
    const hasSolo = tracks.some((track) => track.mixer.solo);
    for (const track of tracks) this.graphs.get(track.id)?.update(track as StudioTrack, hasSolo);
  }

  private updateGraphs(tracks: StudioTrack[]): void {
    const hasSolo = tracks.some((track) => track.mixer.solo);
    const ids = new Set(tracks.map((track) => track.id));
    for (const [id, graph] of this.graphs) {
      if (!ids.has(id)) { graph.dispose(); this.graphs.delete(id); }
    }
    for (const track of tracks) {
      const graph = this.graphs.get(track.id) ?? createTrackGraph(this.context, this.analyser);
      this.graphs.set(track.id, graph);
      graph.update(track, hasSolo);
    }
  }

  private clearGraphs(): void {
    for (const graph of this.graphs.values()) graph.dispose();
    this.graphs.clear();
  }

  private clearSources(): void {
    for (const item of this.sources) {
      try { item.source.stop(); } catch { /* already stopped */ }
      item.source.disconnect();
    }
    this.sources = [];
  }

  async play(time: number, allowEmpty = false): Promise<void> {
    this.pause();
    const transportRevision = this.transportRevision;
    const startPosition = Number.isFinite(time) ? Math.max(0, time) : 0;
    const project = this.project;
    if (!project) {
      if (!allowEmpty) throw new Error("音频尚未准备好，请等待导入完成");
      this.position = startPosition;
      this.startContextTime = this.context.currentTime;
      this.playing = true;
      await this.context.resume();
      if (transportRevision !== this.transportRevision) return;
      return;
    }
    const hasSolo = project.tracks.some((track) => track.mixer.solo);
    const scheduled = this.buildSources(project, startPosition, hasSolo);
    if (!allowEmpty && scheduled.length === 0) throw new Error("音频尚未准备好，请等待导入完成");
    this.position = startPosition;
    const resume = this.context.resume();
    const origin = this.context.currentTime + 0.015;
    this.startContextTime = origin;
    this.playing = true;
    try {
      await resume;
      if (transportRevision !== this.transportRevision || !this.playing) {
        for (const item of scheduled) {
          try { item.source.stop(); } catch { /* not started */ }
          item.source.disconnect();
        }
        return;
      }
      for (const item of scheduled) {
        item.source.start(item.when, item.offset, item.duration);
        this.sources.push({ source: item.source, trackId: item.trackId });
      }
    } catch (error) {
      this.pause();
      throw error;
    }
  }

  private buildSources(project: StudioProject, time: number, hasSolo: boolean): Array<{ source: AudioBufferSourceNode; trackId: string; when: number; offset: number; duration: number }> {
    const result: Array<{ source: AudioBufferSourceNode; trackId: string; when: number; offset: number; duration: number }> = [];
    const origin = this.context.currentTime + 0.015;
    for (const track of project.tracks) {
      if (!isTrackAudible(track, hasSolo)) continue;
      const graph = this.graphs.get(track.id);
      if (!graph) continue;
      for (const clip of track.clips) {
        const asset = track.assets.find((candidate) => candidate.id === clip.assetId);
        const loaded = asset ? this.loaded.get(asset.id) : undefined;
        if (!asset || !loaded) continue;
        const clipStart = Math.max(0, Number.isFinite(clip.startSec) ? clip.startSec : 0);
        const offset = Math.max(0, Number.isFinite(clip.offsetSec) ? clip.offsetSec : 0);
        const duration = getClipDuration(clip, { durationSec: loaded.buffer.duration });
        if (duration <= 0 || clipStart + duration <= time) continue;
        const elapsed = Math.max(0, time - clipStart);
        const source = this.context.createBufferSource();
        source.buffer = loaded.buffer;
        source.connect(graph.input);
        result.push({ source, trackId: track.id, when: origin + Math.max(0, clipStart - time), offset: Math.min(loaded.buffer.duration, offset + elapsed), duration: Math.max(0.001, duration - elapsed) });
      }
    }
    return result;
  }

  pause(): void {
    this.transportRevision += 1;
    if (this.playing) this.position = this.currentTime;
    this.playing = false;
    this.clearSources();
  }

  seek(time: number): void {
    const next = Math.max(0, Number.isFinite(time) ? time : 0);
    if (this.playing) { void this.play(next, true).catch(() => undefined); return; }
    this.position = next;
  }

  waveform(): Uint8Array {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }

  dispose(): void {
    ++this.loadRevision;
    this.pause();
    this.clearGraphs();
    this.loaded.clear();
    this.project = null;
    this.analyser.disconnect();
    void this.context.close();
  }
}

function projectStructureKey(project: StudioProject): string {
  return JSON.stringify(project.tracks.map((track) => ({
    id: track.id,
    assets: track.assets.map((asset) => [asset.id, asset.url]),
    clips: track.clips.map((clip) => [clip.id, clip.assetId, clip.startSec, clip.offsetSec, clip.durationSec]),
  })));
}
