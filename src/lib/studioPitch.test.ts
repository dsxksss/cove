import { describe, expect, it } from "vitest";
import { normalizePitch, studioAssetPlaybackKey } from "./studioPitch";
import { restoreStudioAssetUrl } from "./studioAssetAudio";
import { createStudioProject, createVocalTrack } from "../studio/types";

describe("studio pitch identity", () => {
  it("separates two pitches sharing the same original asset without changing legacy keys", () => {
    const asset = { id: "audio", url: "blob:original" };
    expect(studioAssetPlaybackKey(asset)).toBe(studioAssetPlaybackKey(asset, { semitones: 0, preserveFormants: false }));
    expect(studioAssetPlaybackKey(asset, { semitones: 12, preserveFormants: true })).not.toBe(studioAssetPlaybackKey(asset));
    expect(studioAssetPlaybackKey(asset, { semitones: -12, preserveFormants: true })).not.toBe(studioAssetPlaybackKey(asset, { semitones: 12, preserveFormants: true }));
    expect(normalizePitch({ semitones: 99, preserveFormants: false }).semitones).toBe(24);
    expect(normalizePitch({ semitones: NaN, preserveFormants: true }).semitones).toBe(0);
  });
  it("restores the URL of every shared recording when loading a harmony project", () => {
    const project = createStudioProject({ songId: "test", title: "Test", artist: "Test", coverUrl: "", durationSec: 4, lyrics: [] });
    const asset = { id: "shared", name: "take.wav", url: "blob:expired", durationSec: 4, mimeType: "audio/wav" };
    project.tracks[0].assets = [structuredClone(asset)];
    const vocal = createVocalTrack(1); vocal.assets = [structuredClone(asset)]; project.tracks.push(vocal);
    project.instrumental = structuredClone(asset);
    restoreStudioAssetUrl(project, "shared", "blob:restored");
    expect(project.tracks.map(track => track.assets[0].url)).toEqual(["blob:restored", "blob:restored"]);
    expect(project.instrumental.url).toBe("blob:restored");
  });
});
