import { describe, expect, it } from "vitest";
import { createStudioProject, createVocalTrack } from "../studio/types";
import { getClipDuration, getProjectDuration, hasAudibleClips, isTrackAudible } from "./studioSchedule";

function project() {
  const value = createStudioProject({ songId: "1", title: "Song", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] });
  const track = createVocalTrack(1);
  track.assets = [{ id: "take-a", name: "a.wav", url: "blob:a", mimeType: "audio/wav", durationSec: 4 }];
  track.clips = [{ id: "clip-a", assetId: "take-a", startSec: 12, offsetSec: 1, durationSec: 8 }];
  value.tracks.push(track);
  return value;
}

describe("studio scheduling", () => {
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
