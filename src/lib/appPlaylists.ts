import type { Song } from "./types";
import { sameSong } from "./musicSources";
import { invokeNative } from "./native";

export const APP_PLAYLISTS_STORAGE_KEY = "nmp.appPlaylists.v1";

export interface AppPlaylist {
  id: string;
  name: string;
  songs: Song[];
  createdAt: number;
  updatedAt: number;
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ").slice(0, 40);
}

function isSong(value: unknown): value is Song {
  if (!value || typeof value !== "object") return false;
  const song = value as Partial<Song>;
  return (
    typeof song.id === "number" &&
    Number.isFinite(song.id) &&
    typeof song.name === "string" &&
    typeof song.artist === "string" &&
    (song.source == null ||
      song.source === "netease" ||
      song.source === "qq" ||
      song.source === "kugou")
  );
}

function normalizePlaylist(value: unknown): AppPlaylist | null {
  if (!value || typeof value !== "object") return null;
  const playlist = value as Partial<AppPlaylist>;
  const name = cleanName(typeof playlist.name === "string" ? playlist.name : "");
  if (!name || typeof playlist.id !== "string" || !playlist.id) return null;
  const createdAt = Number.isFinite(playlist.createdAt) ? Number(playlist.createdAt) : Date.now();
  const updatedAt = Number.isFinite(playlist.updatedAt) ? Number(playlist.updatedAt) : createdAt;
  const songs = Array.isArray(playlist.songs) ? playlist.songs.filter(isSong) : [];
  return { id: playlist.id, name, songs, createdAt, updatedAt };
}

export function normalizeAppPlaylists(value: unknown): AppPlaylist[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizePlaylist)
    .filter((item): item is AppPlaylist => item != null);
}

export function loadAppPlaylists(): AppPlaylist[] {
  try {
    const raw = localStorage.getItem(APP_PLAYLISTS_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    return normalizeAppPlaylists(value);
  } catch {
    return [];
  }
}

export function saveAppPlaylists(playlists: AppPlaylist[]): void {
  try {
    localStorage.setItem(APP_PLAYLISTS_STORAGE_KEY, JSON.stringify(playlists));
  } catch {
    /* local persistence is best-effort */
  }
}

export async function loadNativeAppPlaylists(): Promise<{
  exists: boolean;
  playlists: AppPlaylist[];
}> {
  const result = await invokeNative<{ exists: boolean; playlists: unknown }>(
    "load_app_playlists",
  );
  return {
    exists: result.exists,
    playlists: normalizeAppPlaylists(result.playlists),
  };
}

let nativePlaylistWriteTail: Promise<void> = Promise.resolve();

export async function persistAppPlaylists(playlists: AppPlaylist[]): Promise<void> {
  // Journal immediately, then serialize native writes so an older disk write
  // can never finish after a newer edit and overwrite it.
  saveAppPlaylists(playlists);
  const write = nativePlaylistWriteTail
    .catch(() => undefined)
    .then(async () => {
      await invokeNative<void>("save_app_playlists", { args: { playlists } });
      removeMigrationJournalIfCurrent(playlists);
    });
  nativePlaylistWriteTail = write;
  return write;
}

export async function persistAppPlaylistsWith(
  playlists: AppPlaylist[],
  saveNative: (playlists: AppPlaylist[]) => Promise<void>,
): Promise<void> {
  // Keep a synchronous migration journal until the atomic native write succeeds.
  saveAppPlaylists(playlists);
  await saveNative(playlists);
  removeMigrationJournalIfCurrent(playlists);
}

function removeMigrationJournalIfCurrent(playlists: AppPlaylist[]): void {
  try {
    const current = localStorage.getItem(APP_PLAYLISTS_STORAGE_KEY);
    if (current === JSON.stringify(playlists)) {
      localStorage.removeItem(APP_PLAYLISTS_STORAGE_KEY);
    }
  } catch {
    /* native file is already durable */
  }
}

export function createAppPlaylist(
  playlists: AppPlaylist[],
  name: string,
  now = Date.now(),
): { playlists: AppPlaylist[]; playlist: AppPlaylist | null } {
  const nextName = cleanName(name);
  if (!nextName) return { playlists, playlist: null };
  const playlist: AppPlaylist = {
    id: `app-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: nextName,
    songs: [],
    createdAt: now,
    updatedAt: now,
  };
  return { playlists: [playlist, ...playlists], playlist };
}

export function renameAppPlaylist(
  playlists: AppPlaylist[],
  id: string,
  name: string,
  now = Date.now(),
): AppPlaylist[] {
  const nextName = cleanName(name);
  if (!nextName) return playlists;
  return playlists.map((playlist) =>
    playlist.id === id ? { ...playlist, name: nextName, updatedAt: now } : playlist,
  );
}

export function deleteAppPlaylist(playlists: AppPlaylist[], id: string): AppPlaylist[] {
  return playlists.filter((playlist) => playlist.id !== id);
}

export function addSongToAppPlaylist(
  playlists: AppPlaylist[],
  id: string,
  song: Song,
  now = Date.now(),
): { playlists: AppPlaylist[]; added: boolean } {
  let added = false;
  const next = playlists.map((playlist) => {
    if (playlist.id !== id || playlist.songs.some((item) => sameSong(item, song))) {
      return playlist;
    }
    added = true;
    return { ...playlist, songs: [...playlist.songs, song], updatedAt: now };
  });
  return { playlists: added ? next : playlists, added };
}

export function removeSongFromAppPlaylist(
  playlists: AppPlaylist[],
  id: string,
  index: number,
  now = Date.now(),
): AppPlaylist[] {
  return playlists.map((playlist) => {
    if (playlist.id !== id || index < 0 || index >= playlist.songs.length) return playlist;
    const songs = playlist.songs.slice();
    songs.splice(index, 1);
    return { ...playlist, songs, updatedAt: now };
  });
}

export function moveSongInAppPlaylist(
  playlists: AppPlaylist[],
  id: string,
  from: number,
  to: number,
  now = Date.now(),
): AppPlaylist[] {
  return playlists.map((playlist) => {
    if (
      playlist.id !== id ||
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= playlist.songs.length ||
      to >= playlist.songs.length
    ) {
      return playlist;
    }
    const songs = playlist.songs.slice();
    const [song] = songs.splice(from, 1);
    songs.splice(to, 0, song);
    return { ...playlist, songs, updatedAt: now };
  });
}
