import type { StudioEffects } from "../studio/types";
import { createTrackGraph, type TrackGraph } from "./studioDsp";

type Channel = { element: HTMLAudioElement; startSec: number; graph: TrackGraph };
export class StudioAudioEngine {
  readonly context = new AudioContext();
  private readonly analyser = this.context.createAnalyser();
  private channels = new Map<string, Channel>();
  constructor() {
    this.analyser.fftSize = 512;
    this.analyser.smoothingTimeConstant = 0.82;
    this.analyser.connect(this.context.destination);
  }
  attach(id: string, element: HTMLAudioElement, startSec = 0): void {
    if (this.channels.has(id)) return;
    const graph = createTrackGraph(this.context, this.analyser);
    this.channels.set(id, { element, startSec: Math.max(0, startSec), graph });
    this.context.createMediaElementSource(element).connect(graph.input);
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
    const resume = this.context.resume();
    const pending: Promise<void>[] = [];
    for (const c of this.channels.values()) {
      if (time < c.startSec) {
        c.element.pause();
      } else {
        c.element.currentTime = Math.max(0, time - c.startSec);
        pending.push(c.element.play().catch(() => undefined));
      }
    }
    await resume;
    await Promise.all(pending);
  }
  pause(): void { for (const c of this.channels.values()) c.element.pause(); }
  seek(time: number): void { for (const c of this.channels.values()) { if (time < c.startSec) c.element.pause(); else c.element.currentTime = Math.max(0, time - c.startSec); } }
  waveform(): Uint8Array {
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteTimeDomainData(data);
    return data;
  }
  dispose(): void { this.pause(); for (const c of this.channels.values()) c.graph.dispose(); this.analyser.disconnect(); void this.context.close(); this.channels.clear(); }
}
