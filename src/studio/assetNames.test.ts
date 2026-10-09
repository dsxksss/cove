import { afterEach, describe, expect, it } from "vitest";
import { repairStudioAssetNames, studioStemName } from "./assetNames";
import { createReferenceTrack, createStudioProject, createVocalTrack } from "./types";
import { useStudioStore } from "./studioStore";

const legacyName = (value: string) => Array.from(value).map(char => /^[a-zA-Z0-9.\-_ ()]$/.test(char) ? char : "_").join("");
function projectWithStem(title: string, name: string) {
  const project = createStudioProject({ songId: "1", title, artist: "歌手", coverUrl: "cover", durationSec: 10, lyrics: [] });
  const asset = { id: "stem-1", name, url: "blob:audio", mimeType: "audio/wav", durationSec: 10 };
  project.tracks[0].assets = [asset];
  project.tracks[0].clips = [{ id: "clip-1", assetId: asset.id, startSec: 1, offsetSec: 2, durationSec: 3 }];
  project.instrumental = asset;
  return project;
}

describe("studio stem display names", () => {
  afterEach(() => useStudioStore.getState().setProject(null));

  it("preserves song text and uses the generated audio format", () => {
    expect(studioStemName("サンキュー!!", "instrumental", "_______ (__).WAV")).toBe("サンキュー!! (伴奏).wav");
    expect(studioStemName("夜に駆ける / Live!?", "vocals", "vocals.flac")).toBe("夜に駆ける / Live!? (人声).flac");
    expect(studioStemName("晴天", "instrumental", "", "audio/mpeg")).toBe("晴天 (伴奏).mp3");
  });

  it("recovers legacy Unicode names when reopening without touching audio, timing or custom track names", () => {
    const title = "サンキュー!!";
    const project = projectWithStem(title, legacyName(`${title} (伴奏).wav`));
    project.tracks[0].name = "我的伴奏轨";
    const original = structuredClone(project);
    useStudioStore.getState().setProject(project);
    const restored = useStudioStore.getState().project!;
    expect(restored.tracks[0].assets[0].name).toBe(`${title} (伴奏).wav`);
    expect(restored.instrumental!.name).toBe(`${title} (伴奏).wav`);
    expect(restored.tracks[0].clips).toBe(project.tracks[0].clips);
    expect(restored.tracks[0].name).toBe("我的伴奏轨");
    expect(restored.tracks[0].assets[0].url).toBe("blob:audio");
    expect(restored.updatedAt).toBe(project.updatedAt);
    expect(project).toEqual(original);
    const saved = JSON.parse(JSON.stringify(restored));
    useStudioStore.getState().setProject(saved);
    expect(useStudioStore.getState().project).toBe(saved);
  });

  it("repairs original vocal reference names but preserves recordings and local original references", () => {
    const project = projectWithStem("Café 🎵", legacyName("Café 🎵 (伴奏).wav"));
    const reference = createReferenceTrack("vocals");
    const original = createReferenceTrack("original");
    const vocal = createVocalTrack(1);
    for (const track of [reference, original, vocal]) track.assets = [{ ...project.instrumental!, id: track.id, name: legacyName("Café 🎵 (人声).wav") }];
    project.tracks.push(reference, original, vocal);
    const restored = repairStudioAssetNames(project);
    expect(restored.tracks[1].assets[0].name).toBe("Café 🎵 (人声).wav");
    expect(restored.tracks[2]).toBe(original);
    expect(restored.tracks[3]).toBe(vocal);
  });

  it("preserves intentional underscores, imported names and already-correct metadata", () => {
    for (const name of ["my_mix_v2.wav", "自制伴奏.wav", "Other_song (__).wav", "Café (伴奏).wav"]) {
      const project = projectWithStem("Café", name);
      expect(repairStudioAssetNames(project)).toBe(project);
    }
  });

  it("recovers a fully erased title after a project rename without needing another conversion", () => {
    const project = projectWithStem("翻唱练习 第2版", "_____ (__).wav");
    expect(repairStudioAssetNames(project).instrumental!.name).toBe("翻唱练习 第2版 (伴奏).wav");
  });
});
