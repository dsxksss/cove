import type { Song, SongJson, SongUrl } from "./types";

/**
 * Thin client for Suxiaoqinx/Netease_url (self-hosted Flask server).
 *
 * Default base: http://localhost:5000 (override via setApiBase() → persisted in
 * localStorage key "nmp.apiBase").
 *
 * Verified endpoints (from main.py / README):
 *   GET /search?keyword=&limit=&offset=&type=1   -> {data:[{id,name,artists,album,...}]}
 *   GET /song?id=&level=exhigh&type=url          -> {data:{id,url,level,...}}
 *   GET /song?id=&type=json                      -> {data:{name,ar_name,al_name,pic,lyric,tlyric,url,...}}
 *
 * The server sets Access-Control-Allow-Origin: *, so the webview can call it
 * directly without a Rust proxy.
 */

const STORAGE_KEY = "nmp.apiBase";
const DEFAULT_BASE = "http://localhost:5000";

export function getApiBase(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export function setApiBase(base: string) {
  try {
    localStorage.setItem(STORAGE_KEY, base.replace(/\/+$/, ""));
  } catch {
    /* ignore */
  }
}

async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  timeoutMs = 12000
): Promise<T> {
  const base = getApiBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // chain external abort
  if (signal) signal.addEventListener("abort", () => ctrl.abort());
  try {
    const res = await fetch(`${base}${path}`, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

/** Retry wrapper: transient network/timeout errors shouldn't kill a load.
 *  Aborts (caller-initiated) are NOT retried. */
async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  retries = 2,
  signal?: AbortSignal
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn(signal);
    } catch (e: any) {
      lastErr = e;
      if (e?.name === "AbortError" && signal?.aborted) throw e; // caller aborted
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); // backoff
      }
    }
  }
  throw lastErr;
}

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
  signal?: AbortSignal
): Promise<Song[]> {
  const kw = keyword.trim();
  if (!kw) return [];
  const env = await getJson<SearchEnvelope>(
    `/search?keyword=${encodeURIComponent(kw)}&limit=${limit}&type=1`,
    signal
  );
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
  signal?: AbortSignal
): Promise<string | null> {
  const env = await getJson<SongUrlEnvelope>(
    `/song?id=${id}&level=${level}&type=url`,
    signal
  );
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

interface PlaylistPage {
  songs: Song[];
  total: number;
  offset: number;
}

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
  signal?: AbortSignal
): Promise<PlaylistPage> {
  const env = await withRetry(
    (sig) =>
      getJson<PlaylistEnvelope>(
        `/playlist?id=${id}&limit=${limit}&offset=${offset}`,
        sig,
        30000
      ),
    2,
    signal
  );
  const pl = env.data?.playlist;
  const tracks = pl?.tracks ?? (Array.isArray(env.data) ? env.data : []);
  return {
    songs: mapTracks(tracks),
    total: pl?.trackTotal ?? tracks.length,
    offset: pl?.trackOffset ?? offset,
  };
}

/** Fetch ALL of a playlist's tracks (no pagination). Kept for compatibility,
 *  but prefer getPlaylistPage for large playlists. */
export async function getPlaylist(
  id: number,
  signal?: AbortSignal
): Promise<Song[]> {
  const env = await withRetry(
    (sig) => getJson<PlaylistEnvelope>(`/playlist?id=${id}`, sig, 30000),
    2,
    signal
  );
  const tracks =
    env.data?.playlist?.tracks ??
    env.data?.tracks ??
    (Array.isArray(env.data) ? env.data : []);
  return mapTracks(tracks);
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
export async function getQrKey(signal?: AbortSignal): Promise<QrKey> {
  const env = await getJson<{ data: QrKey }>("/qr/key", signal);
  return env.data!;
}

export interface QrStatus {
  /** 800=expired 801=waiting 802=scanned 803=success */
  code: number;
  status: "waiting" | "scanned" | "success" | "expired" | "unknown";
  saved?: boolean;
}
/** Poll QR login status. On 803 the server writes cookie.txt. */
export async function checkQrLogin(unikey: string, signal?: AbortSignal): Promise<QrStatus> {
  const env = await getJson<{ data: QrStatus }>(
    `/qr/check?unikey=${encodeURIComponent(unikey)}`,
    signal
  );
  return env.data!;
}

export interface LoginStatus {
  logged_in: boolean;
  nickname?: string;
  vip_type?: number;
  uid?: number;
}
/** Whether cookie.txt corresponds to a logged-in account. */
export async function getLoginStatus(signal?: AbortSignal): Promise<LoginStatus> {
  const env = await getJson<{ data: LoginStatus }>("/login/status", signal);
  return env.data!;
}

/** Log out the current NetEase account on the API server. */
export async function logout(signal?: AbortSignal): Promise<void> {
  await getJson<unknown>("/logout", signal);
}


interface SongJsonEnvelope {
  data?: Partial<SongJson>;
}
/** Fetch full track info: cover, lyrics, translation, and url in one call. */
export async function getSongJson(
  id: number,
  signal?: AbortSignal
): Promise<SongJson | null> {
  const env = await getJson<SongJsonEnvelope>(
    `/song?id=${id}&type=json`,
    signal
  );
  return (env.data as SongJson) ?? null;
}
