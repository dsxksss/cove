import type { StudioEffects } from "../studio/types";
import { createTrackGraph, type TrackGraph } from "./studioDsp";

type Channel = { element: HTMLAudioElement; startSec: number; source: MediaElementAudioSourceNode; graph: TrackGraph };
export class StudioAudioEngine {
  readonly context = new AudioContext();
  private readonly analyser = this.context.createAnalyser();
  private channels = new Map<string, Channel>();
  private sources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();
  private startTime = 0;
  private position = 0;
  private playing = false;
  private pendingStarts = new Map<string, ReturnType<typeof setTimeout>>();
  constructor() {
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.connect(this.context.destination);
  }
  attach(id: string, element: HTMLAudioElement, startSec = 0): void {
    const previous = this.channels.get(id);
    if (previous?.element === element) { previous.startSec = Math.max(0, startSec); return; }
    this.detach(id);
    const graph = createTrackGraph(this.context, this.analyser);
    const source = this.sources.get(element) ?? this.context.createMediaElementSource(element);
    this.sources.set(element, source);
    this.channels.set(id, { element, startSec: Math.max(0, startSec), source, graph });
    source.connect(graph.input);
  }
  detach(id: string): void {
    const channel = this.channels.get(id);
    if (!channel) return;
    channel.element.pause();
    channel.source.disconnect();
    channel.graph.dispose();
    this.channels.delete(id);
    const timer = this.pendingStarts.get(id);
    if (timer !== undefined) clearTimeout(timer);
    this.pendingStarts.delete(id);
  }
  get currentTime(): number {
    return this.position + (this.playing ? this.context.currentTime - this.startTime : 0);
  }
  update(id: string, mixer: { gain: number; pan: number; mute: boolean; solo?: boolean }, effects: StudioEffects): void {
    const channel = this.channels.get(id); if (!channel) return;
    channel.graph.update({ id, name: id, kind: "vocal", color: "", clips: [], takes: [], assets: [], mixer: { ...mixer, pan: mixer.pan, solo: mixer.solo ?? false, armed: false }, effects }, false);
  }
  updateAll(tracks: Array<{ id: string; mixer: { gain: number; pan: number; mute: boolean; solo: boolean }; effects: StudioEffects }>) {
    const hasSolo = tracks.some(t => t.mixer.solo);
    for (const track of tracks) this.channels.get(track.id)?.graph.update({ id: track.id, name: track.id, kind: "vocal", color: "", clips: [], takes: [], assets: [], mixer: { ...track.mixer, armed: false }, effects: track.effects }, hasSolo);
  }
  async play(time: number): Promise<void> {
    // Start the media elements in the click task before awaiting the context.
    // Waiting for resume first can consume the browser's user-activation and
    // make HTMLMediaElement.play() silently reject on the first click.
    this.pause();
    if (!this.channels.size) throw new Error("音频尚未准备好，请等待导入完成");
    this.position = time;
    this.startTime = this.context.currentTime;
    this.playing = true;
    const resume = this.context.resume();
    const pending: Promise<void>[] = [];
    for (const [id, c] of this.channels) {
      if (time < c.startSec) {
        c.element.pause();
        this.pendingStarts.set(id, setTimeout(() => {
          this.pendingStarts.delete(id);
          if (this.playing && this.channels.get(id) === c) {
            c.element.currentTime = Math.max(0, this.currentTime - c.startSec);
            void c.element.play().catch(() => this.pause());
          }
        }, (c.startSec - time) * 1000));
      } else {
        c.element.currentTime = Math.max(0, time - c.startSec);
        pending.push(c.element.play());
      }
    }
    try { await resume; await Promise.all(pending); }
    catch (error) { this.pause(); throw error; }
  }
  pause(): void {
    this.position = this.currentTime;
    this.playing = false;
    for (const timer of this.pendingStarts.values()) clearTimeout(timer);
    this.pendingStarts.clear();
    for (const c of this.channels.values()) c.element.pause();
  }
  seek(time: number): void {
    if (this.playing) { void this.play(time).catch(() => undefined); return; }
    this.position = time;
    for (const c of this.channels.values()) c.element.currentTime = Math.max(0, time - c.startSec);
  }
  waveform(): Uint8Array {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }
  dispose(): void { this.pause(); for (const id of this.channels.keys()) this.detach(id); this.analyser.disconnect(); void this.context.close(); }
}
