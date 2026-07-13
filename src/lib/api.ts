import type { PlaylistSummary, Song, SongJson, SongUrl } from "./types";
import { invokeNative } from "./native";

/** Desktop-only typed client for Cove's built-in Tauri backend. */

/** Normalize the various artist-field shapes the API can return. */
function pickArtist(raw: unknown): string {
  if (!raw) return "未知歌手";
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const names = raw
      .map((a) => (a && typeof a === "object" && "name" in a ? (a as any).name : String(a)))
      .filter(Boolean);
    return names.join(", ") || "未知歌手";
  }
  if (typeof raw === "object" && "name" in raw) return String((raw as any).name);
  return String(raw);
}

interface SearchEnvelope {
  status?: number;
  success?: boolean;
  data?: any[] | { songs?: any[] };
  result?: { songs?: any[] };
}

/** Search tracks. Returns normalized Song[]. */
export async function search(
  keyword: string,
  limit = 30,
  _signal?: AbortSignal
): Promise<Song[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const env = await invokeNative<SearchEnvelope>("netease_search", {
    args: { keyword: kw, limit },
  });
  const list: any[] =
    env.data && Array.isArray(env.data)
      ? env.data
      : env.data && Array.isArray((env.data as any).songs)
      ? (env.data as any).songs
      : env.result && Array.isArray(env.result.songs)
      ? env.result.songs
      : [];
  return list.map((s) => ({
    id: Number(s.id ?? s.songId),
    name: String(s.name ?? "未知歌曲"),
    artist: pickArtist(s.artists ?? s.ar ?? s.artist),
    album: s.album?.name ?? s.al?.name ?? s.album ?? s.al_name,
    pic: s.picUrl ?? s.pic ?? s.album?.picUrl ?? s.al?.picUrl,
    duration: Number(s.duration ?? s.dt ?? 0) || undefined,
  }));
}

interface SongUrlEnvelope {
  data?: Partial<SongUrl> & { url?: string | null; id?: number };
}
/** Resolve a playable audio URL. Returns null when restricted/unavailable. */
export async function getSongUrl(
  id: number,
  level = "exhigh",
  _signal?: AbortSignal
): Promise<string | null> {
  const env = await invokeNative<SongUrlEnvelope>("netease_song_url", {
    args: { id, level },
  });
  return env.data?.url ?? null;
}

interface PlaylistEnvelope {
  data?: {
    playlist?: {
      tracks?: any[];
      trackTotal?: number;
      trackOffset?: number;
      trackLimit?: number;
    };
  } & Record<string, any>;
}

interface UserPlaylistsEnvelope {
  data?: {
    playlists?: any[];
    more?: boolean;
  };
  playlist?: any[];
  more?: boolean;
}

interface PlaylistPage {
  songs: Song[];
  total: number;
  offset: number;
}

export type { PlaylistSummary };

function mapTracks(tracks: any[]): Song[] {
  return tracks.map((t: any) => ({
    id: Number(t.id ?? t.songId),
    name: String(t.name ?? "未知歌曲"),
    artist: pickArtist(t.ar ?? t.artists ?? t.artist),
    album: t.al?.name ?? t.album?.name ?? t.album ?? t.al_name,
    pic: t.al?.picUrl ?? t.album?.picUrl ?? t.picUrl ?? t.pic,
    duration: Number(t.dt ?? t.duration ?? 0) || undefined,
  }));
}

/** Fetch a playlist page (limit/offset). Server-side pagination is far faster
 *  than fetching all tracks of a large playlist (1786 songs ~12s → 1.4s for 100).
 *  Returns {songs, total, offset}. */
export async function getPlaylistPage(
  id: number,
  limit: number,
  offset: number,
  _signal?: AbortSignal
): Promise<PlaylistPage> {
  const env = await invokeNative<PlaylistEnvelope>("netease_playlist_page", {
    args: { id, limit, offset },
  });
  const pl = env.data?.playlist;
  const tracks = pl?.tracks ?? (Array.isArray(env.data) ? env.data : []);
  return {
    songs: mapTracks(tracks),
    total: pl?.trackTotal ?? tracks.length,
    offset: pl?.trackOffset ?? offset,
  };
}

function mapPlaylist(raw: any, ownerUid: number): PlaylistSummary {
  const creatorUid = Number(raw.creatorUid ?? raw.creator?.userId ?? 0);
  return {
    id: Number(raw.id),
    name: String(raw.name ?? "未命名歌单"),
    coverImgUrl: raw.coverImgUrl ?? raw.cover ?? raw.pic,
    trackCount: Number(raw.trackCount ?? raw.track_count ?? 0),
    playCount: Number(raw.playCount ?? raw.play_count ?? 0),
    createTime: Number(raw.createTime ?? raw.create_time ?? 0),
    updateTime: Number(raw.updateTime ?? raw.update_time ?? 0),
    subscribed: Boolean(raw.subscribed),
    creatorUid,
    creatorName: String(raw.creatorName ?? raw.creator?.nickname ?? ""),
    createdByAccount: raw.createdByAccount === undefined ? creatorUid === ownerUid : Boolean(raw.createdByAccount),
    source: raw.source === "kugou" || raw.source === "qq" ? raw.source : "netease",
    kgListId: raw.kgListId != null ? Number(raw.kgListId) : undefined,
    kgGlobalId: raw.kgGlobalId ? String(raw.kgGlobalId) : undefined,
    qqDissTid: raw.qqDissTid != null ? Number(raw.qqDissTid) : undefined,
  };
}

export async function getUserPlaylists(
  uid: number,
  limit = 200,
  offset = 0,
  _signal?: AbortSignal
): Promise<PlaylistSummary[]> {
  const env = await invokeNative<UserPlaylistsEnvelope>("netease_user_playlists", {
    args: { uid, limit, offset },
  });
  const list = env.data?.playlists ?? env.playlist ?? [];
  return list
    .map((item) => mapPlaylist(item, uid))
    .filter((playlist) => Number.isFinite(playlist.id) && playlist.id > 0)
    .map((p) => ({ ...p, source: "netease" as const }));
}

/** Kugou account playlists (requires kugou QR login session). */
export async function getKugouUserPlaylists(): Promise<PlaylistSummary[]> {
  const env = await invokeNative<UserPlaylistsEnvelope>("kugou_user_playlists");
  if (!env) throw new Error("酷狗歌单需要桌面端");
  const list = env.data?.playlists ?? [];
  return list
    .map((item) => mapPlaylist(item, Number(item.creatorUid ?? 0)))
    .filter((p) => Number.isFinite(p.id))
    .map((p) => ({ ...p, source: "kugou" as const, createdByAccount: true }));
}

/** Page of tracks from a Kugou playlist. */
export async function getKugouPlaylistPage(
  listid: number,
  opts?: { globalCollectionId?: string; page?: number; pagesize?: number }
): Promise<PlaylistPage> {
  const page = opts?.page ?? 1;
  const pagesize = opts?.pagesize ?? 50;
  const env = await invokeNative<PlaylistEnvelope>("kugou_playlist_page", {
    args: {
      listid,
      global_collection_id: opts?.globalCollectionId,
      page,
      pagesize,
    },
  });
  if (!env) throw new Error("酷狗歌单需要桌面端");
  const pl = env.data?.playlist;
  const tracks = pl?.tracks ?? [];
  const songs = mapTracks(tracks).map((s, i) => {
    const raw = tracks[i] as any;
    return {
      ...s,
      source: "kugou" as const,
      kgHash: raw?.kgHash ? String(raw.kgHash) : s.kgHash,
      kgHqHash: raw?.kgHqHash ? String(raw.kgHqHash) : undefined,
      kgSqHash: raw?.kgSqHash ? String(raw.kgSqHash) : undefined,
    };
  });
  return {
    songs,
    total: pl?.trackTotal ?? songs.length,
    offset: pl?.trackOffset ?? (page - 1) * pagesize,
  };
}

/** QQ Music account playlists (requires QQ QR → y.qq.com session). */
export async function getQqUserPlaylists(): Promise<PlaylistSummary[]> {
  const env = await invokeNative<UserPlaylistsEnvelope>("qq_user_playlists");
  if (!env) throw new Error("QQ 歌单需要桌面端");
  const list = env.data?.playlists ?? [];
  return list
    .map((item) => mapPlaylist(item, Number(item.creatorUid ?? 0)))
    .filter((p) => Number.isFinite(p.id))
    .map((p) => ({
      ...p,
      source: "qq" as const,
      createdByAccount: true,
      qqDissTid: p.qqDissTid && p.qqDissTid > 0 ? p.qqDissTid : p.id,
    }));
}

/** Page of tracks from a QQ Music playlist (disstid). */
export async function getQqPlaylistPage(
  disstid: number,
  opts?: { page?: number; pagesize?: number }
): Promise<PlaylistPage> {
  const page = opts?.page ?? 1;
  const pagesize = opts?.pagesize ?? 50;
  const env = await invokeNative<PlaylistEnvelope>("qq_playlist_page", {
    args: { disstid, page, pagesize },
  });
  if (!env) throw new Error("QQ 歌单需要桌面端");
  const pl = env.data?.playlist;
  const tracks = pl?.tracks ?? [];
  const songs = mapTracks(tracks).map((s, i) => {
    const raw = tracks[i] as any;
    return {
      ...s,
      source: "qq" as const,
      qqMid: raw?.qqMid ? String(raw.qqMid) : s.qqMid,
      qqMediaMid: raw?.qqMediaMid ? String(raw.qqMediaMid) : undefined,
      albumId: raw?.albumId ? String(raw.albumId) : s.albumId,
    };
  });
  return {
    songs,
    total: pl?.trackTotal ?? songs.length,
    offset: pl?.trackOffset ?? (page - 1) * pagesize,
  };
}

/** Stable key to avoid ID collisions across platforms. */
export function playlistKey(p: Pick<PlaylistSummary, "id" | "source">): string {
  return `${p.source ?? "netease"}:${p.id}`;
}

/** The user's "My Favorites" (我喜欢) playlist. Configurable in SettingsModal
 *  via localStorage "nmp.favPlaylistId". */
export function getFavPlaylistId(): number {
  try {
    const v = localStorage.getItem("nmp.favPlaylistId");
    if (v) return Number(v);
  } catch {
    /* ignore */
  }
  return 0;
}
export function setFavPlaylistId(id: number) {
  try {
    localStorage.setItem("nmp.favPlaylistId", String(id));
  } catch {
    /* ignore */
  }
}

// ───── QR login (Netease_url server-side endpoints) ─────

export interface QrKey {
  unikey: string;
  url: string;
}
/** Generate a QR login key + the URL to encode into a QR image. */
export async function getQrKey(_signal?: AbortSignal): Promise<QrKey> {
  return invokeNative<QrKey>("netease_qr_key");
}

export interface QrStatus {
  /** 800=expired 801=waiting 802=scanned 803=success */
  code: number;
  status: "waiting" | "scanned" | "success" | "expired" | "unknown";
  saved?: boolean;
}
/** Poll QR login status. On 803 the server writes cookie.txt. */
export async function checkQrLogin(unikey: string, signal?: AbortSignal): Promise<QrStatus> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return invokeNative<QrStatus>("netease_qr_check", { unikey });
}

export interface LoginStatus {
  logged_in: boolean;
  nickname?: string;
  vip_type?: number;
  uid?: number;
}
/** Whether cookie.txt corresponds to a logged-in account. */
export async function getLoginStatus(_signal?: AbortSignal): Promise<LoginStatus> {
  return invokeNative<LoginStatus>("netease_login_status");
}

/** Log out the current NetEase account on the API server. */
export async function logout(_signal?: AbortSignal): Promise<void> {
  await invokeNative<void>("netease_logout");
}


interface SongJsonEnvelope {
  data?: Partial<SongJson>;
}
/** Fetch full track info: cover, lyrics, translation, and url in one call. */
export async function getSongMetadata(
  id: number,
  _signal?: AbortSignal
): Promise<SongJson | null> {
  const env = await invokeNative<SongJsonEnvelope>("netease_song_metadata", { id });
  return (env.data as SongJson) ?? null;
}
