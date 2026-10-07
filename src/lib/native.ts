import { invoke } from "@tauri-apps/api/core";

export type NativeCommand =
  | "set_desktop_blur"
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
  | "save_app_playlists"
  | "studio_prepare_instrumental"
  | "studio_download_source"
  | "studio_job_status"
  | "studio_cancel_job"
  | "studio_job_audio"
  | "studio_write_asset"
  | "studio_read_asset"
  | "studio_save_project"
  | "studio_load_project"
  | "studio_list_projects"
  | "studio_delete_project"
  | "studio_export_package_to_file"
  | "studio_import_package"
  | "studio_save_export"
  | "studio_encode_mp3"
  | "studio_denoise_asset"
  | "studio_cache_read"
  | "studio_cache_write"
  | "studio_cache_remove";

/** Typed entry point for Cove's desktop-only Tauri command surface. */
export function invokeNative<T = void>(
  command: NativeCommand,
  args?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  // IPC cannot cancel a running Rust command. Stop awaiting it and discard its
  // response; keep a rejection handler attached to the underlying invocation.
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    signal?.addEventListener("abort", abort, { once: true });
    invoke<T>(command, args).then(resolve, (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    }).finally(() => signal?.removeEventListener("abort", abort));
  });
}
