import { getClipDuration, scheduledClip, trackOffsetSeconds } from "../lib/studioSchedule";
import type { StudioClip, StudioTrack } from "./types";

export const MIN_STUDIO_CLIP_DURATION_SEC = 0.05;
const TIME_EPSILON = 1e-9;

/**
 * Split in song time, while storing each half in the track's original time.
 * The returned right half needs a new ID before inserting it into a project.
 */
export function splitStudioClipAt(track: StudioTrack, clip: StudioClip, timeSec: number): { left: StudioClip; right: StudioClip } | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(clip.startSec) || clip.startSec < 0
    || !Number.isFinite(clip.offsetSec) || clip.offsetSec < 0
    || !Number.isFinite(clip.durationSec) || clip.durationSec <= 0) return null;
  const asset = track.assets.find((item) => item.id === clip.assetId);
  if (!asset) return null;
  const placed = scheduledClip(clip, asset, track);
  const leftAudibleDuration = timeSec - placed.startSec;
  const rightAudibleDuration = placed.startSec + placed.durationSec - timeSec;
  if (leftAudibleDuration + TIME_EPSILON < MIN_STUDIO_CLIP_DURATION_SEC
    || rightAudibleDuration + TIME_EPSILON < MIN_STUDIO_CLIP_DURATION_SEC) return null;

  const delta = timeSec - clip.startSec - trackOffsetSeconds(track);
  const usableDuration = getClipDuration(clip, asset);
  return {
    left: { ...clip, durationSec: delta },
    right: {
      ...clip,
      startSec: clip.startSec + delta,
      offsetSec: clip.offsetSec + delta,
      durationSec: usableDuration - delta,
    },
  };
}

export function canSplitStudioClip(track: StudioTrack, clip: StudioClip, timeSec: number): boolean {
  return splitStudioClipAt(track, clip, timeSec) !== null;
}
