import { describe, expect, it } from "vitest";
import { createReferenceTrack, createStudioProject, createVocalTrack } from "./types";

describe("studio project model", () => {
  it("keeps the source song metadata and creates an instrumental lane", () => {
    const project = createStudioProject({
      songId: "42",
      title: "测试歌曲",
      artist: "测试歌手",
      coverUrl: "https://example.test/cover.jpg",
      durationSec: 180,
      lyrics: [{ time: 0, text: "第一句" }],
    });
    expect(project.songId).toBe("42");
    expect(project.coverUrl).toContain("cover.jpg");
    expect(project.tracks).toHaveLength(1);
    expect(project.tracks[0].kind).toBe("instrumental");
  });

  it("creates independent vocal lanes with takes and effect defaults", () => {
    const first = createVocalTrack(1);
    const second = createVocalTrack(2);
    expect(first.id).not.toBe(second.id);
    expect(first.kind).toBe("vocal");
    expect(first.effects.eq.midDb).toBe(0);
    expect(first.mixer.armed).toBe(false);
  });

  it("creates a muted original reference lane", () => {
    const reference = createReferenceTrack();
    expect(reference.kind).toBe("reference");
    expect(reference.name).toBe("原曲参考");
    expect(reference.mixer.mute).toBe(true);
  });
});
