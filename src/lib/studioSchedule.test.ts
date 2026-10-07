import { describe, expect, it } from "vitest";
import { createStudioProject, createVocalTrack } from "../studio/types";
import { getClipDuration, getProjectDuration, hasAudibleClips, isTrackAudible, scheduledClip } from "./studioSchedule";

function project() {
  const value = createStudioProject({ songId: "1", title: "Song", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] });
  const track = createVocalTrack(1);
  track.assets = [{ id: "take-a", name: "a.wav", url: "blob:a", mimeType: "audio/wav", durationSec: 4 }];
  track.clips = [{ id: "clip-a", assetId: "take-a", startSec: 12, offsetSec: 1, durationSec: 8 }];
  value.tracks.push(track);
  return value;
}

describe("studio scheduling", () => {
  it("shifts clips in milliseconds and trims only the audible head before zero", () => {
    const clip = { id: "c", assetId: "a", startSec: 0.1, offsetSec: 0.2, durationSec: 2 };
    const earlier = scheduledClip(clip, { durationSec: 4 }, { offsetMs: -350 });
    expect(earlier.startSec).toBe(0);
    expect(earlier.offsetSec).toBeCloseTo(0.45);
    expect(earlier.durationSec).toBeCloseTo(1.75);
    const later = scheduledClip(clip, { durationSec: 4 }, { offsetMs: 200 });
    expect(later.startSec).toBeCloseTo(0.3);
    expect(later.offsetSec).toBe(0.2);
    expect(clip.startSec).toBe(0.1);
    expect(clip.durationSec).toBe(2);
  });
  it("includes delayed tails and excludes clips shifted wholly before zero", () => {
    const value = project();
    value.tracks[1].offsetMs = 500;
    expect(getProjectDuration(value)).toBe(20.5);
    value.tracks[1].offsetMs = -30000;
    expect(hasAudibleClips(value)).toBe(false);
  });
  it("extends the clock to the end of clips", () => {
    expect(getProjectDuration(project())).toBe(20);
  });
  it("uses the referenced asset duration and never falls back", () => {
    const value = project();
    expect(getClipDuration(value.tracks[1].clips[0], { durationSec: 4 })).toBe(3);
    value.tracks[1].clips[0].assetId = "missing";
    expect(hasAudibleClips(value)).toBe(false);
  });
  it("gives mute priority over solo and filters non-solo tracks", () => {
    const value = project();
    const track = value.tracks[1];
    expect(isTrackAudible(track, false)).toBe(true);
    track.mixer.mute = true;
    expect(isTrackAudible(track, false)).toBe(false);
    track.mixer.mute = false;
    expect(isTrackAudible(track, true)).toBe(false);
    track.mixer.solo = true;
    expect(isTrackAudible(track, true)).toBe(true);
  });
});
