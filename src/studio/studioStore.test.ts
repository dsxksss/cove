import { afterEach, describe, expect, it } from "vitest";
import { createStudioProject, createVocalTrack } from "./types";
import { useStudioStore } from "./studioStore";

function setup() {
  const project = createStudioProject({ songId: "1", title: "Song", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] });
  const vocal = createVocalTrack(1);
  vocal.assets = [{ id: "take-1", name: "take.wav", url: "blob:take", mimeType: "audio/wav", durationSec: 4 }];
  vocal.clips = [{ id: "clip-1", assetId: "take-1", startSec: 0, offsetSec: 0, durationSec: 4 }];
  project.tracks.push(vocal);
  useStudioStore.getState().setProject(project);
  return { project, vocalId: vocal.id };
}

describe("studio editing state", () => {
  afterEach(() => useStudioStore.getState().setProject(null));

  it("clears stale recording locks when opening or closing a project", () => {
    const { project, vocalId } = setup();
    useStudioStore.getState().setRecordingTrackId(vocalId);
    useStudioStore.getState().setProject(project);
    expect(useStudioStore.getState().recordingTrackId).toBe(null);
    useStudioStore.getState().setRecordingTrackId(vocalId);
    useStudioStore.getState().setProject(null);
    expect(useStudioStore.getState().recordingTrackId).toBe(null);
  });

  it("applies mute and solo with deterministic priority", () => {
    const { vocalId } = setup();
    useStudioStore.getState().updateMixer(vocalId, { solo: true });
    let vocal = useStudioStore.getState().project!.tracks.find((track) => track.id === vocalId)!;
    expect(vocal.mixer.solo).toBe(true);
    expect(vocal.mixer.mute).toBe(false);
    useStudioStore.getState().updateMixer(vocalId, { mute: true });
    vocal = useStudioStore.getState().project!.tracks.find((track) => track.id === vocalId)!;
    expect(vocal.mixer.mute).toBe(true);
    expect(vocal.mixer.solo).toBe(false);
  });

  it("renames tracks, resets effects and clamps clip edits to asset bounds", () => {
    const { vocalId } = setup();
    const store = useStudioStore.getState();
    store.renameTrack(vocalId, "主唱");
    store.updateEffects(vocalId, { eq: { midDb: 8 } });
    store.updateClip(vocalId, "clip-1", { startSec: -2, offsetSec: 3, durationSec: 9 });
    let vocal = useStudioStore.getState().project!.tracks.find((track) => track.id === vocalId)!;
    expect(vocal.name).toBe("主唱");
    expect(vocal.clips[0].startSec).toBe(0);
    expect(vocal.clips[0].offsetSec).toBe(3);
    expect(vocal.clips[0].durationSec).toBe(1);
    store.resetEffects(vocalId);
    vocal = useStudioStore.getState().project!.tracks.find((track) => track.id === vocalId)!;
    expect(vocal.effects.eq.midDb).toBe(0);
  });
});
