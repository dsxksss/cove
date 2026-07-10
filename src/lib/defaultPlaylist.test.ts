import { describe, expect, it } from "vitest";
import { pickQqFavoritesPlaylist } from "./defaultPlaylist";
import type { PlaylistSummary } from "./types";

function playlist(
  id: number,
  name: string,
  source: PlaylistSummary["source"] = "qq"
): PlaylistSummary {
  return {
    id,
    name,
    source,
    trackCount: 1,
    playCount: 0,
    createTime: 0,
    updateTime: 0,
    subscribed: false,
    creatorUid: 1,
    creatorName: "",
    createdByAccount: true,
  };
}

describe("pickQqFavoritesPlaylist", () => {
  it("prefers the exact QQ favorites playlist", () => {
    const result = pickQqFavoritesPlaylist([
      playlist(1, "普通歌单"),
      playlist(2, " 我喜欢的音乐 "),
    ]);
    expect(result?.id).toBe(2);
  });

  it("accepts account-specific favorites names", () => {
    const result = pickQqFavoritesPlaylist([
      playlist(1, "收藏"),
      playlist(2, "我喜欢 · 2026"),
    ]);
    expect(result?.id).toBe(2);
  });

  it("ignores other platforms and falls back to QQ account order", () => {
    const result = pickQqFavoritesPlaylist([
      playlist(9, "我喜欢的音乐", "netease"),
      playlist(3, "QQ 默认歌单"),
    ]);
    expect(result?.id).toBe(3);
  });
});
