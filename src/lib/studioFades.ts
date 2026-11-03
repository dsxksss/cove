import type { StudioClip } from "../studio/types";

/** Scale intersecting fades together so a short clip has one continuous envelope. */
export function getClipFades(clip: Pick<StudioClip, "fadeInSec" | "fadeOutSec">, durationSec: number) {
  const duration = Number.isFinite(durationSec) ? Math.max(0, durationSec) : 0;
  const clamp = (value = 0) => Number.isFinite(value) ? Math.max(0, Math.min(duration, value)) : 0;
  let fadeInSec = clamp(clip.fadeInSec), fadeOutSec = clamp(clip.fadeOutSec);
  const total = fadeInSec + fadeOutSec;
  if (total > duration) { fadeInSec *= duration / total; fadeOutSec *= duration / total; }
  return { fadeInSec, fadeOutSec };
}

export function clipEnvelopeGain(duration: number, fadeIn: number, fadeOut: number, elapsed: number): number {
  const time = Math.max(0, Math.min(duration, elapsed));
  return Math.max(0, Math.min(1, fadeIn > 0 ? time / fadeIn : 1, fadeOut > 0 ? (duration - time) / fadeOut : 1));
}

/** Shared by playback and export. Elapsed includes seeks and audio before song time zero. */
export function createClipEnvelope(context: BaseAudioContext, destination: AudioNode, clip: StudioClip, duration: number, when: number, elapsed = 0): GainNode | null {
  const { fadeInSec, fadeOutSec } = getClipFades(clip, duration);
  if (fadeInSec === 0 && fadeOutSec === 0) return null;
  const node = context.createGain();
  const gain = (time: number) => clipEnvelopeGain(duration, fadeInSec, fadeOutSec, time);
  node.gain.setValueAtTime(gain(elapsed), when);
  for (const point of [...new Set([fadeInSec, duration - fadeOutSec, duration])].sort((a, b) => a - b)) {
    if (point > elapsed) node.gain.linearRampToValueAtTime(gain(point), when + point - elapsed);
  }
  node.connect(destination);
  return node;
}
