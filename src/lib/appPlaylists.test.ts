import {
  addSongToAppPlaylist,
  APP_PLAYLISTS_STORAGE_KEY,
  createAppPlaylist,
  deleteAppPlaylist,
  moveSongInAppPlaylist,
  normalizeAppPlaylists,
  persistAppPlaylistsWith,
  removeSongFromAppPlaylist,
  renameAppPlaylist,
  type AppPlaylist,
} from "./appPlaylists";
import { getSongKey } from "./musicSources";
import type { Song } from "./types";
import { beforeEach, describe, expect, it } from "vitest";

const netease: Song = { id: 1, name: "N", artist: "A", source: "netease" };
const qq: Song = { id: 1, name: "Q", artist: "B", source: "qq", qqMid: "qq-1" };

describe("app playlists", () => {
  beforeEach(() => localStorage.clear());

  it("creates and renames a local playlist", () => {
    const created = createAppPlaylist([], "  混合 歌单  ", 10);
    expect(created.playlist?.name).toBe("混合 歌单");
    const renamed = renameAppPlaylist(created.playlists, created.playlist!.id, "通勤", 20);
    expect(renamed[0].name).toBe("通勤");
    expect(renamed[0].updatedAt).toBe(20);
  });

  it("stores songs from different platforms and rejects duplicates", () => {
    const base: AppPlaylist = {
      id: "app-1",
      name: "混合",
      songs: [],
      createdAt: 1,
      updatedAt: 1,
    };
    const first = addSongToAppPlaylist([base], base.id, netease, 2);
    const second = addSongToAppPlaylist(first.playlists, base.id, qq, 3);
    const duplicate = addSongToAppPlaylist(second.playlists, base.id, qq, 4);
    expect(second.playlists[0].songs).toEqual([netease, qq]);
    expect(duplicate.added).toBe(false);
  });

  it("uses stable cross-platform keys", () => {
    expect(getSongKey(netease)).toBe("netease:1");
    expect(getSongKey(qq)).toBe("qq:qq-1");
    expect(getSongKey({ ...qq, id: 999 })).toBe("qq:qq-1");
  });

  it("normalizes migrated data and drops invalid entries", () => {
    const normalized = normalizeAppPlaylists([
      { id: "app-1", name: "  通勤  ", songs: [netease, null] },
      { id: "", name: "无效", songs: [] },
    ]);
    expect(normalized).toHaveLength(1);
    expect(normalized[0].id).toBe("app-1");
    expect(normalized[0].name).toBe("通勤");
    expect(normalized[0].songs).toEqual([netease]);
  });

  it("removes the migration journal only after native save succeeds", async () => {
    const playlist = createAppPlaylist([], "迁移", 10).playlists;
    await persistAppPlaylistsWith(playlist, async () => undefined);
    expect(localStorage.getItem(APP_PLAYLISTS_STORAGE_KEY)).toBe(null);
  });

  it("keeps the migration journal when native save fails", async () => {
    const playlist = createAppPlaylist([], "恢复", 10).playlists;
    let rejected = false;
    try {
      await persistAppPlaylistsWith(playlist, async () => {
        throw new Error("disk full");
      });
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
    expect(localStorage.getItem(APP_PLAYLISTS_STORAGE_KEY)).toBe(JSON.stringify(playlist));
  });

  it("moves, removes and deletes", () => {
    const base: AppPlaylist = {
      id: "app-1",
      name: "混合",
      songs: [netease, qq],
      createdAt: 1,
      updatedAt: 1,
    };
    const moved = moveSongInAppPlaylist([base], base.id, 1, 0, 2);
    expect(moved[0].songs).toEqual([qq, netease]);
    const removed = removeSongFromAppPlaylist(moved, base.id, 0, 3);
    expect(removed[0].songs).toEqual([netease]);
    expect(deleteAppPlaylist(removed, base.id)).toEqual([]);
  });
});
