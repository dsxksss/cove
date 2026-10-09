import { afterEach, describe, expect, it } from "vitest";
import { createReferenceTrack, createStudioProject, createVocalTrack, DEFAULT_EFFECTS } from "./types";
import { migrateStudioEffectDefaults } from "./effectDefaults";
import { useStudioStore } from "./studioStore";

function project() { return createStudioProject({ songId: "1", title: "Song", artist: "Artist", coverUrl: "", durationSec: 10, lyrics: [] }); }
function legacyEffects() { return { ...structuredClone(DEFAULT_EFFECTS), compressor: { ...DEFAULT_EFFECTS.compressor, ratio: 3 }, reverb: { mix: 0.12, decaySec: 1.8 } }; }

describe("opt-in studio effects", () => {
  afterEach(() => { useStudioStore.getState().setProject(null); useStudioStore.setState({ effectsClipboard: null }); });

  it("creates every kind of track dry and resets back to dry", () => {
    const value = project();
    value.tracks.push(createVocalTrack(1), createReferenceTrack(), createReferenceTrack("vocals"));
    for (const track of value.tracks) {
      expect(track.effects.eq).toEqual({ lowDb: 0, midDb: 0, highDb: 0 });
      expect(track.effects.compressor.ratio).toBe(1);
      expect(track.effects.reverb.mix).toBe(0);
      expect(track.effects.delay.mix).toBe(0);
    }
    useStudioStore.getState().setProject(value);
    useStudioStore.getState().updateEffects("instrumental", legacyEffects());
    useStudioStore.getState().resetEffects("instrumental");
    expect(useStudioStore.getState().project!.tracks[0].effects).toEqual(DEFAULT_EFFECTS);
  });

  it("migrates only the exact unmarked legacy preset without touching audio or edits", () => {
    const value = project();
    value.tracks[0].effects = legacyEffects(); delete value.tracks[0].effectsVersion;
    const custom = createVocalTrack(1); custom.effects = legacyEffects(); custom.effects.eq.lowDb = 2; delete custom.effectsVersion;
    value.tracks.push(custom);
    const before = structuredClone(value);
    const migrated = migrateStudioEffectDefaults(value);
    expect(migrated.tracks[0].effects).toEqual(DEFAULT_EFFECTS);
    expect(migrated.tracks[0].clips).toBe(value.tracks[0].clips);
    expect(migrated.tracks[1].effects).toBe(custom.effects);
    expect(migrated.updatedAt).toBe(value.updatedAt);
    expect(value).toEqual(before);
    expect(migrateStudioEffectDefaults(migrated)).toBe(migrated);
  });

  it("retains actively selected and pasted legacy-equivalent parameters after save/reopen", () => {
    const value = project(); value.tracks.push(createVocalTrack(1));
    useStudioStore.getState().setProject(value);
    const store = useStudioStore.getState();
    store.updateEffects("instrumental", legacyEffects());
    store.copyEffects("instrumental"); store.pasteEffects(value.tracks[1].id);
    store.setProject(JSON.parse(JSON.stringify(useStudioStore.getState().project)));
    for (const track of useStudioStore.getState().project!.tracks) {
      expect(track.effectsVersion).toBe(1);
      expect(track.effects).toEqual(legacyEffects());
    }
  });
});
