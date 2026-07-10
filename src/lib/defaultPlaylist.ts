import type { PlaylistSummary } from "./types";

function normalizePlaylistName(name: string): string {
  return name.replace(/\s+/g, "").toLocaleLowerCase("zh-CN");
}

/** Pick QQ Music's built-in favorites playlist, with account order as fallback. */
export function pickQqFavoritesPlaylist(
  playlists: PlaylistSummary[]
): PlaylistSummary | undefined {
  const qqPlaylists = playlists.filter((playlist) => playlist.source === "qq");
  return (
    qqPlaylists.find((playlist) => {
      const name = normalizePlaylistName(playlist.name);
      return name === "我喜欢" || name === "我喜欢的音乐";
    }) ??
    qqPlaylists.find((playlist) =>
      normalizePlaylistName(playlist.name).includes("我喜欢")
    ) ??
    qqPlaylists[0]
  );
}
