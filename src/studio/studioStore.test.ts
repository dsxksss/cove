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
  afterEach(() => {
    useStudioStore.getState().setProject(null);
    useStudioStore.setState({ effectsClipboard: null });
  });

  it("copies an independent effect snapshot and pastes without changing other track properties", () => {
    const { vocalId } = setup();
    const store = useStudioStore.getState();
    const effects = {
      eq: { lowDb: -3, midDb: 5, highDb: 2 },
      compressor: { thresholdDb: -24, ratio: 4, attackMs: 7, releaseMs: 180 },
      reverb: { mix: 0.3, decaySec: 2.4 },
      delay: { mix: 0.2, timeMs: 240, feedback: 0.4 },
    };
    store.updateEffects("instrumental", effects);
    store.updateTrack(vocalId, { offsetMs: -100, normalizationGain: 2 });
    store.updateMixer(vocalId, { pan: -0.3, gain: 0.6, mute: true });
    const beforeCopy = useStudioStore.getState().project!;
    store.copyEffects("instrumental");
    expect(useStudioStore.getState().project).toBe(beforeCopy);
    const clipboard = useStudioStore.getState().effectsClipboard!;
    expect(clipboard.sourceName).toBe("伴奏");
    store.resetEffects("instrumental");
    expect(clipboard.effects).toEqual(effects);
    store.pasteEffects(vocalId);
    const pasted = useStudioStore.getState().project!.tracks.find(t => t.id === vocalId)!;
    const original = beforeCopy.tracks.find(t => t.id === vocalId)!;
    expect({ ...pasted, effects: original.effects }).toEqual(original);
    expect(pasted.effects).toEqual(effects);
    for (const key of ["eq", "compressor", "reverb", "delay"] as const) {
      expect(clipboard.effects[key] === beforeCopy.tracks[0].effects[key]).toBe(false);
      expect(pasted.effects[key] === clipboard.effects[key]).toBe(false);
    }
    store.updateEffects(vocalId, { eq: { ...effects.eq, midDb: -2 } });
    store.pasteEffects("instrumental");
    expect(useStudioStore.getState().project!.tracks[0].effects).toEqual(effects);
    expect(useStudioStore.getState().project!.tracks.find(t => t.id === vocalId)!.effects.eq.midDb).toBe(-2);
    expect(clipboard.effects).toEqual(effects);
  });

  it("keeps copied effects across projects and saves pasted effects without the clipboard", () => {
    const { vocalId } = setup();
    const store = useStudioStore.getState();
    store.updateEffects(vocalId, { eq: { lowDb: 3, midDb: -4, highDb: 6 } });
    store.copyEffects(vocalId);
    const expected = structuredClone(useStudioStore.getState().effectsClipboard!.effects);
    store.removeTrack(vocalId);
    store.setProject(null);
    setup();
    store.pasteEffects("instrumental");
    const saved = JSON.parse(JSON.stringify(useStudioStore.getState().project));
    expect(saved.effectsClipboard).toBeUndefined();
    store.setProject(null);
    store.setProject(saved);
    expect(useStudioStore.getState().project!.tracks[0].effects).toEqual(expected);
  });

  it("does not mark a project edited when paste has no source or target", () => {
    const { project } = setup();
    const store = useStudioStore.getState();
    store.pasteEffects("instrumental");
    expect(useStudioStore.getState().project).toBe(project);
    store.copyEffects("missing");
    expect(useStudioStore.getState().effectsClipboard).toBe(null);
    store.copyEffects("instrumental");
    store.pasteEffects("missing");
    expect(useStudioStore.getState().project).toBe(project);
  });

  it("applies positive input compensation at zero without altering the full take", () => {
    const { vocalId } = setup();
    const asset = { id: "compensated", name: "vocal.wav", url: "blob:vocal", mimeType: "audio/wav", durationSec: 3 };
    useStudioStore.getState().addAssetToTrack(vocalId, asset, undefined, -0.1);
    const track = useStudioStore.getState().project!.tracks.find(t => t.id === vocalId)!;
    const clip = track.clips[track.clips.length - 1];
    expect(clip.startSec).toBe(0);
    expect(clip.offsetSec).toBe(0.1);
    expect(clip.durationSec).toBe(2.9);
    expect(track.assets[track.assets.length - 1].durationSec).toBe(3);
    expect(track.takes[track.takes.length - 1].assetId).toBe("compensated");
  });

  it("delays a negative-compensated take without trimming, including a short recording", () => {
    const { vocalId } = setup();
    const asset = { id: "delayed", name: "short.wav", url: "blob:short", mimeType: "audio/wav", durationSec: 0.05 };
    useStudioStore.getState().addAssetToTrack(vocalId, asset, undefined, 0.1);
    let track = useStudioStore.getState().project!.tracks.find(t => t.id === vocalId)!;
    expect(track.clips[track.clips.length - 1].startSec).toBe(0.1);
    expect(track.clips[track.clips.length - 1].offsetSec).toBe(0);
    useStudioStore.getState().addAssetToTrack(vocalId, { ...asset, id: "short-advanced" }, undefined, -0.1);
    track = useStudioStore.getState().project!.tracks.find(t => t.id === vocalId)!;
    expect(track.clips[track.clips.length - 1].durationSec).toBe(0);
    expect(track.assets[track.assets.length - 1].durationSec).toBe(0.05);
  });

  it("keeps full-song and vocal reference channels distinct and persists mix adjustments", () => {
    setup();
    const store = useStudioStore.getState();
    const original = store.addReferenceTrack("original")!;
    const vocals = store.addReferenceTrack("vocals")!;
    expect(original === vocals).toBe(false);
    expect(store.addReferenceTrack("vocals")).toBe(vocals);
    store.updateTrack(vocals, { offsetMs: -125, normalizationGain: 2.5 });
    store.updateMixer(vocals, { pan: -0.2 });
    store.updateLatency(-100);
    const saved = JSON.parse(JSON.stringify(useStudioStore.getState().project));
    store.setProject(saved);
    const reopened = useStudioStore.getState().project!;
    const track = reopened.tracks.find((item) => item.id === vocals)!;
    expect(reopened.inputLatencyMs).toBe(-100);
    expect(track.offsetMs).toBe(-125);
    expect(track.normalizationGain).toBe(2.5);
    expect(track.mixer.pan).toBe(-0.2);
    expect(track.referenceStem).toBe("vocals");
  });

  it("clears stale recording locks when opening or closing a project", () => {
    const { project, vocalId } = setup();
    useStudioStore.getState().setRecordingTrackId(vocalId);
    useStudioStore.getState().setProject(project);
    expect(useStudioStore.getState().recordingTrackId).toBe(null);
    useStudioStore.getState().setRecordingTrackId(vocalId);
    useStudioStore.getState().setProject(null);
    expect(useStudioStore.getState().recordingTrackId).toBe(null);
  });

  it("returns the newly added vocal target and protects an active recording until saved", () => {
    setup();
    const store = useStudioStore.getState();
    const target = store.addVocalTrack()!;
    expect(useStudioStore.getState().project!.tracks.find(track => track.id === target)!.kind).toBe("vocal");
    store.setRecordingTrackId(target);
    const locked = useStudioStore.getState().project;
    store.removeTrack(target);
    expect(useStudioStore.getState().project).toBe(locked);
    store.setRecordingTrackId(null);
    store.removeTrack(target);
    expect(useStudioStore.getState().project!.tracks.some(track => track.id === target)).toBe(false);
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
