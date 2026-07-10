import type { PlaylistSummary, Song, SongJson, SongUrl } from "./types";

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
const LOCAL_FALLBACK_BASES = ["http://localhost:5000", "http://127.0.0.1:5000"];

function normalizeBase(base: string): string {
  return base.trim().replace(/\/+$/, "");
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function usesBuiltInNeteaseApi(): boolean {
  return isTauriRuntime();
}

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauriRuntime()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function getApiBase(): string {
  try {
    return normalizeBase(localStorage.getItem(STORAGE_KEY) || DEFAULT_BASE) || DEFAULT_BASE;
  } catch {
    return DEFAULT_BASE;
  }
}

export function setApiBase(base: string) {
  try {
    localStorage.setItem(STORAGE_KEY, normalizeBase(base));
  } catch {
    /* ignore */
  }
}

export function getApiBaseCandidates(): string[] {
  const seen = new Set<string>();
  return [getApiBase(), ...LOCAL_FALLBACK_BASES].filter((base) => {
    const normalized = normalizeBase(base);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function shouldTryNextBase(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  const err = e as { name?: string; message?: string };
  const message = err?.message ?? String(e);
  return (
    err?.name === "AbortError" ||
    e instanceof TypeError ||
    /failed to fetch|networkerror|load failed|fetch/i.test(message)
  );
}

function formatApiError(path: string, base: string, e: unknown): Error {
  const err = e as { name?: string; message?: string };
  if (err?.name === "AbortError") {
    return new Error(`API 请求超时：${base}${path}`);
  }
  if (e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(err?.message ?? "")) {
    return new Error(`无法连接 API：${base}${path}`);
  }
  return e instanceof Error ? e : new Error(String(e));
}

async function getJson<T>(
  path: string,
  signal?: AbortSignal,
  timeoutMs = 12000
): Promise<T> {
  const bases = getApiBaseCandidates();
  let lastBase = bases[0] ?? DEFAULT_BASE;
  let lastErr: unknown;

  for (const base of bases) {
    lastBase = base;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const abort = () => ctrl.abort();
    if (signal) signal.addEventListener("abort", abort, { once: true });

    try {
      const res = await fetch(`${base}${path}`, {
        signal: ctrl.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (e) {
      lastErr = e;
      if (!shouldTryNextBase(e, signal) || base === bases[bases.length - 1]) {
        throw formatApiError(path, base, e);
      }
    } finally {
      clearTimeout(t);
      if (signal) signal.removeEventListener("abort", abort);
    }
  }

  throw formatApiError(path, lastBase, lastErr);
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
  const env =
    (await invokeNative<SearchEnvelope>("netease_search", { args: { keyword: kw, limit } })) ??
    (await getJson<SearchEnvelope>(
      `/search?keyword=${encodeURIComponent(kw)}&limit=${limit}&type=1`,
      signal
    ));
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
  const env =
    (await invokeNative<SongUrlEnvelope>("netease_song_url", { args: { id, level } })) ??
    (await getJson<SongUrlEnvelope>(
      `/song?id=${id}&level=${level}&type=url`,
      signal
    ));
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
  signal?: AbortSignal
): Promise<PlaylistPage> {
  const env =
    (await invokeNative<PlaylistEnvelope>("netease_playlist_page", { args: { id, limit, offset } })) ??
    (await withRetry(
      (sig) =>
        getJson<PlaylistEnvelope>(
          `/playlist?id=${id}&limit=${limit}&offset=${offset}`,
          sig,
          30000
        ),
      2,
      signal
    ));
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
  signal?: AbortSignal
): Promise<PlaylistSummary[]> {
  const env =
    (await invokeNative<UserPlaylistsEnvelope>("netease_user_playlists", {
      args: { uid, limit, offset },
    })) ??
    (await getJson<UserPlaylistsEnvelope>(
      `/user/playlist?uid=${uid}&limit=${limit}&offset=${offset}`,
      signal,
      30000
    ));
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
  const native = await invokeNative<QrKey>("netease_qr_key");
  if (native) return native;
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
  const native = await invokeNative<QrStatus>("netease_qr_check", { unikey });
  if (native) return native;
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
  const native = await invokeNative<LoginStatus>("netease_login_status");
  if (native) return native;
  const env = await getJson<{ data: LoginStatus }>("/login/status", signal);
  return env.data!;
}

/** Log out the current NetEase account on the API server. */
export async function logout(signal?: AbortSignal): Promise<void> {
  // Rust unit commands serialize to `null`, so checking the returned value
  // cannot distinguish a successful native call from the web fallback path.
  // Branch on the runtime first or desktop logout would also call /logout.
  if (isTauriRuntime()) {
    await invokeNative<void>("netease_logout");
    return;
  }
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
  const env =
    (await invokeNative<SongJsonEnvelope>("netease_song_json", { id })) ??
    (await getJson<SongJsonEnvelope>(
      `/song?id=${id}&type=json`,
      signal
    ));
  return (env.data as SongJson) ?? null;
}
