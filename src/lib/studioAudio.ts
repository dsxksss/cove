import type { StudioAsset, StudioProject, StudioTrack } from "../studio/types";
import { createTrackGraph, type TrackGraph } from "./studioDsp";
import { getProjectDuration, isTrackAudible, scheduledClip, trackOffsetSeconds } from "./studioSchedule";
import { decodeStudioAsset } from "./studioAssetAudio";

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
  private loadErrors = new Map<string, Error>();
  private sources: ScheduledSource[] = [];
  private loadRevision = 0;
  private structureKey = "";
  private startContextTime = 0;
  private position = 0;
  private playing = false;
  private transportRevision = 0;
  private pendingLoad: Promise<unknown> = Promise.resolve();
  private playbackListeners = new Set<(playing: boolean) => void>();

  subscribePlayback(listener: (playing: boolean) => void): () => void {
    this.playbackListeners.add(listener);
    listener(this.playing);
    return () => { this.playbackListeners.delete(listener); };
  }

  private notifyPlayback(): void {
    for (const listener of this.playbackListeners) listener(this.playing);
  }

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
    const previousProjectId = this.project?.id;
    const nextKey = projectStructureKey(project);
    const sameStructure = this.project?.id === project.id && this.structureKey === nextKey;
    this.project = project;
    if (sameStructure) {
      this.updateAll(project.tracks);
      return;
    }

    const revision = ++this.loadRevision;
    this.loadErrors.clear();
    // Editing clips must not erase the user's play intent between rapid edits.
    // A project switch, unlike an edit, always stops and resets the transport.
    if (previousProjectId !== project.id) { this.pause(); this.position = 0; }
    const transportRevision = ++this.transportRevision;
    this.clearSources();
    this.clearGraphs();
    if (previousProjectId !== project.id) this.loaded.clear();
    // Keep original takes for restoration without decoding every old denoise
    // version into RAM. Only clips currently on the timeline need PCM buffers.
    const activeAssets = project.tracks.flatMap((track) => {
      const ids = new Set(track.clips.map((clip) => clip.assetId));
      return track.assets.filter((asset) => ids.has(asset.id));
    });
    const requestedUrls = new Map(activeAssets.map((asset) => [asset.id, asset.url] as const));
    for (const [id, loaded] of this.loaded) if (requestedUrls.get(id) !== loaded.url) this.loaded.delete(id);
    this.structureKey = nextKey;
    this.updateGraphs(project.tracks);

    const requested = new Map<string, StudioAsset>();
    for (const asset of activeAssets) {
        if (requested.has(asset.id) || this.loaded.get(asset.id)?.url === asset.url) continue;
        requested.set(asset.id, asset);
    }
    const loading = Promise.all([...requested.values()].map(async (asset) => {
      const { id, url } = asset;
      try {
        const buffer = await decodeStudioAsset(this.context, asset);
        if (revision === this.loadRevision && this.project?.id === project.id) this.loaded.set(id, { buffer, url });
      } catch (error) {
        if (revision === this.loadRevision && this.project?.id === project.id) {
          this.loadErrors.set(id, error instanceof Error ? error : new Error(String(error)));
        }
      }
    }));
    this.pendingLoad = loading;
    await loading;
    if (revision !== this.loadRevision || this.project?.id !== project.id) return;
    this.position = Math.min(this.position, getProjectDuration(project));
    if (this.playing && transportRevision === this.transportRevision) await this.play(Math.min(this.currentTime, getProjectDuration(project)), true);
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

  async play(time: number, allowEmpty = false, onScheduled?: (contextTime: number) => void): Promise<void> {
    const transportRevision = ++this.transportRevision;
    this.clearSources();
    const startPosition = Number.isFinite(time) ? Math.max(0, time) : 0;
    this.position = startPosition;
    // Freeze the clock while resume/decode is pending. An older completion must
    // never restart playback after a pause or a more recent seek.
    this.startContextTime = Infinity;
    this.playing = true;
    this.notifyPlayback();
    try {
      await Promise.all([this.context.resume(), this.pendingLoad]);
      if (transportRevision !== this.transportRevision || !this.playing) return;
      const hasSolo = this.project?.tracks.some((track) => track.mixer.solo) ?? false;
      for (const track of this.project?.tracks ?? []) {
        if (!isTrackAudible(track, hasSolo)) continue;
        for (const clip of track.clips) {
          const error = this.loadErrors.get(clip.assetId);
          if (error && clip.startSec + trackOffsetSeconds(track) + clip.durationSec > startPosition) throw error;
        }
      }
      const origin = this.context.currentTime + 0.015;
      const scheduled = this.project ? this.buildSources(this.project, startPosition, origin) : [];
      if (!allowEmpty && scheduled.length === 0) throw new Error("此位置没有可播放音频，请先导入音频或回到开头");
      // Start capture only after resume/decode is ready, at the exact same
      // AudioContext timestamp as the accompaniment. Awaiting play after
      // starting the recorder used to add that entire wait to the take.
      onScheduled?.(origin);
      this.startContextTime = origin;
      for (const item of scheduled) {
        item.source.start(item.when, item.offset, item.duration);
        this.sources.push({ source: item.source, trackId: item.trackId });
      }
    } catch (error) {
      if (transportRevision !== this.transportRevision) return;
      this.pause();
      throw error;
    }
  }

  private buildSources(project: StudioProject, time: number, origin: number): Array<{ source: AudioBufferSourceNode; trackId: string; when: number; offset: number; duration: number }> {
    const result: Array<{ source: AudioBufferSourceNode; trackId: string; when: number; offset: number; duration: number }> = [];
    for (const track of project.tracks) {
      // Schedule muted tracks as well so unmuting/solo changes work immediately.
      // The track graph is the sole authority for audibility.
      const graph = this.graphs.get(track.id);
      if (!graph) continue;
      for (const clip of track.clips) {
        const asset = track.assets.find((candidate) => candidate.id === clip.assetId);
        const loaded = asset ? this.loaded.get(asset.id) : undefined;
        if (!asset || !loaded) continue;
        const scheduled = scheduledClip(clip, { durationSec: loaded.buffer.duration }, track);
        const clipStart = scheduled.startSec;
        const offset = scheduled.offsetSec;
        const duration = scheduled.durationSec;
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
    this.notifyPlayback();
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
    this.loadErrors.clear();
    this.project = null;
    this.playbackListeners.clear();
    this.analyser.disconnect();
    void this.context.close();
  }
}

function projectStructureKey(project: StudioProject): string {
  return JSON.stringify(project.tracks.map((track) => ({
    id: track.id,
    assets: track.assets.map((asset) => [asset.id, asset.url]),
    clips: track.clips.map((clip) => [clip.id, clip.assetId, clip.startSec, clip.offsetSec, clip.durationSec]),
    offsetMs: track.offsetMs ?? 0,
  })));
}
