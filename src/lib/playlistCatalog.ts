import {
  getAllKugouPlaylistSongs,
  getAllPlaylistSongs,
  getAllQqPlaylistSongs,
} from "./api";
import type { PlaylistSummary } from "./types";

/** One platform router shared by all playlist browsing actions. */
export function loadPlaylistSongs(playlist: PlaylistSummary) {
  switch (playlist.source ?? "netease") {
    case "qq":
      return getAllQqPlaylistSongs(
        playlist.qqDissTid && playlist.qqDissTid > 0 ? playlist.qqDissTid : playlist.id,
        { pagesize: 50 },
      );
    case "kugou":
      return getAllKugouPlaylistSongs(
        playlist.kgListId && playlist.kgListId > 0 ? playlist.kgListId : playlist.id,
        { globalCollectionId: playlist.kgGlobalId || undefined, pagesize: 50 },
      );
    default:
      return getAllPlaylistSongs(playlist.id);
  }
}
