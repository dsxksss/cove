import type { StudioAsset, StudioClip, StudioProject, StudioTrack } from "../studio/types";

/** The project clock includes the original song length and every clip tail. */
export function getProjectDuration(project: Pick<StudioProject, "durationSec" | "tracks">): number {
  let duration = Number.isFinite(project.durationSec) ? Math.max(0, project.durationSec) : 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      const start = Number.isFinite(clip.startSec) ? Math.max(0, clip.startSec) : 0;
      const length = Number.isFinite(clip.durationSec) ? Math.max(0, clip.durationSec) : 0;
      duration = Math.max(duration, start + length);
    }
  }
  return duration;
}

/** A solo bus excludes every non-solo track; mute always wins. */
export function isTrackAudible(track: Pick<StudioTrack, "mixer">, hasSolo: boolean): boolean {
  if (track.mixer.mute) return false;
  if (!Number.isFinite(track.mixer.gain) || track.mixer.gain <= 0) return false;
  return !hasSolo || Boolean(track.mixer.solo);
}

/** Returns the usable portion of a clip for an asset. Invalid/missing clips return 0. */
export function getClipDuration(clip: Pick<StudioClip, "offsetSec" | "durationSec">, asset: Pick<StudioAsset, "durationSec">): number {
  const sourceDuration = Number.isFinite(asset.durationSec) ? Math.max(0, asset.durationSec) : 0;
  const offset = Number.isFinite(clip.offsetSec) ? Math.max(0, clip.offsetSec) : 0;
  const requested = Number.isFinite(clip.durationSec) ? Math.max(0, clip.durationSec) : 0;
  return Math.max(0, Math.min(requested, sourceDuration - Math.min(offset, sourceDuration)));
}

/** A project has renderable audio only when a clip references its own asset. */
export function hasAudibleClips(project: Pick<StudioProject, "tracks">): boolean {
  const hasSolo = project.tracks.some((track) => track.mixer.solo);
  return project.tracks.some((track) => {
    if (!isTrackAudible(track, hasSolo)) return false;
    return track.clips.some((clip) => {
      const asset = track.assets.find((candidate) => candidate.id === clip.assetId);
      return Boolean(asset && getClipDuration(clip, asset) > 0);
    });
  });
}
