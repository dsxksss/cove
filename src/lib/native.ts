import { invoke } from "@tauri-apps/api/core";

export type NativeCommand =
  | "auth_logout_all"
  | "auth_status"
  | "http_proxy"
  | "kugou_logout"
  | "kugou_playlist_page"
  | "kugou_qr_check"
  | "kugou_qr_key"
  | "kugou_search"
  | "kugou_song_play"
  | "kugou_user_playlists"
  | "load_app_playlists"
  | "netease_login_status"
  | "netease_logout"
  | "netease_playlist_page"
  | "netease_qr_check"
  | "netease_qr_key"
  | "netease_search"
  | "netease_song_metadata"
  | "netease_song_url"
  | "netease_user_playlists"
  | "qq_logout"
  | "qq_playlist_page"
  | "qq_qr_check"
  | "qq_qr_key"
  | "qq_search"
  | "qq_song_play"
  | "qq_user_playlists"
  | "save_app_playlists";

/** Typed entry point for Cove's desktop-only Tauri command surface. */
export function invokeNative<T = void>(
  command: NativeCommand,
  args?: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}
