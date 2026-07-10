/**
 * Multi-source music catalog + streaming (NetEase / QQ / Kugou).
 * Routes search & play URL resolution by MusicSource.
 */

import type { MusicSource, Song, SongJson } from "./types";
import {
  getSongJson as neteaseSongJson,
  getSongUrl as neteaseSongUrl,
  search as neteaseSearch,
} from "./api";

export const MUSIC_SOURCE_OPTIONS: Array<{ value: MusicSource; label: string }> = [
  { value: "netease", label: "网易云音乐" },
  { value: "qq", label: "QQ音乐" },
  { value: "kugou", label: "酷狗音乐" },
];

const MUSIC_SOURCE_KEY = "nmp.musicSource";

export function loadMusicSource(): MusicSource {
  try {
    const v = localStorage.getItem(MUSIC_SOURCE_KEY);
    if (v === "netease" || v === "qq" || v === "kugou") return v;
  } catch {
    /* ignore */
  }
  return "netease";
}

export function saveMusicSource(source: MusicSource) {
  try {
    localStorage.setItem(MUSIC_SOURCE_KEY, source);
  } catch {
    /* ignore */
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invokeNative<T>(
  command: string,
  args?: Record<string, unknown>
): Promise<T> {
  if (!isTauriRuntime()) {
    throw new Error("QQ / 酷狗流媒体需要桌面端（Tauri）运行");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

function songKey(s: Pick<Song, "id" | "source" | "qqMid" | "kgHash">): string {
  const src = s.source ?? "netease";
  if (src === "qq") return `qq:${s.qqMid ?? s.id}`;
  if (src === "kugou") return `kugou:${s.kgHash ?? s.id}`;
  return `netease:${s.id}`;
}

export function sameSong(a: Song, b: Song): boolean {
  return songKey(a) === songKey(b);
}

/** Search tracks from the selected music source. */
export async function searchMusic(
  keyword: string,
  source: MusicSource = loadMusicSource(),
  limit = 40,
  signal?: AbortSignal
): Promise<Song[]> {
  const kw = keyword.trim();
  if (!kw) return [];

  if (source === "netease") {
    const list = await neteaseSearch(kw, limit, signal);
    return list.map((s) => ({ ...s, source: "netease" as const }));
  }

  if (source === "qq") {
    const env = await invokeNative<{ data?: any[] }>("qq_search", {
      args: { keyword: kw, limit },
    });
    return (env.data ?? []).map((s) => ({
      id: Number(s.id),
      name: String(s.name ?? "未知歌曲"),
      artist: String(s.artist ?? "未知歌手"),
      album: s.album ? String(s.album) : undefined,
      pic: s.pic ? String(s.pic) : undefined,
      duration: Number(s.duration) || undefined,
      source: "qq" as const,
      qqMid: s.qqMid ? String(s.qqMid) : undefined,
      qqMediaMid: s.qqMediaMid ? String(s.qqMediaMid) : undefined,
      albumId: s.albumId ? String(s.albumId) : undefined,
    }));
  }

  // kugou
  const env = await invokeNative<{ data?: any[] }>("kugou_search", {
    args: { keyword: kw, limit },
  });
  return (env.data ?? []).map((s) => ({
    id: Number(s.id),
    name: String(s.name ?? "未知歌曲"),
    artist: String(s.artist ?? "未知歌手"),
    album: s.album ? String(s.album) : undefined,
    pic: s.pic && s.pic !== "null" ? String(s.pic) : undefined,
    duration: Number(s.duration) || undefined,
    source: "kugou" as const,
    kgHash: s.kgHash ? String(s.kgHash) : undefined,
    kgHqHash: s.kgHqHash ? String(s.kgHqHash) : undefined,
    kgSqHash: s.kgSqHash ? String(s.kgSqHash) : undefined,
    kgResHash: s.kgResHash ? String(s.kgResHash) : undefined,
    albumId: s.albumId != null ? String(s.albumId) : undefined,
  }));
}

/** Pick Kugou file hash for the requested quality (fallback downward). */
function pickKugouHash(song: Song, level: string): string | undefined {
  const std = song.kgHash;
  const hq = song.kgHqHash || std;
  const sq = song.kgSqHash || hq;
  const res = song.kgResHash || sq;
  switch (level) {
    case "hires":
    case "jyeffect":
    case "sky":
    case "jymaster":
      return res || sq || hq || std;
    case "lossless":
      return sq || hq || std;
    case "exhigh":
    case "higher":
      return hq || std;
    case "standard":
    default:
      return std;
  }
}

/** Resolve playable URL + metadata for any source. */
export async function resolvePlayback(song: Song, level = "exhigh"): Promise<{
  url: string | null;
  meta: Partial<SongJson> & {
    name?: string;
    ar_name?: string;
    al_name?: string;
    pic?: string;
    lyric?: string;
    tlyric?: string;
    lyric_source?: string;
  };
}> {
  const source = song.source ?? "netease";

  if (source === "netease") {
    const json = await neteaseSongJson(song.id);
    // Always prefer URL at the user-selected quality (song_json defaults to 320k).
    const leveled = await neteaseSongUrl(song.id, level);
    const url = leveled ?? json?.url ?? null;
    return {
      url,
      meta: {
        ...(json ?? {}),
        level,
        quality_name: level,
      },
    };
  }

  if (source === "qq") {
    if (!song.qqMid) throw new Error("QQ 歌曲缺少 songmid");
    const env = await invokeNative<{
      data?: {
        url?: string | null;
        level?: string;
        quality_name?: string;
        error?: string;
      };
    }>("qq_song_play", {
      args: {
        songmid: song.qqMid,
        media_mid: song.qqMediaMid,
        level,
      },
    });
    const url = env.data?.url ?? null;
    // Surface VIP / cookie hints when stream is missing.
    if (!url && env.data?.error) {
      throw new Error(env.data.error);
    }
    // Lyrics via existing multi-source matcher in playSong path
    return {
      url,
      meta: {
        name: song.name,
        ar_name: song.artist,
        al_name: song.album,
        pic: song.pic,
        lyric: "",
        tlyric: "",
        lyric_source: "qq",
        level: env.data?.level ?? level,
        quality_name: env.data?.quality_name ?? level,
      },
    };
  }

  // kugou
  const hash = pickKugouHash(song, level);
  if (!hash) throw new Error("酷狗歌曲缺少 hash");
  const env = await invokeNative<{
    data?: {
      url?: string | null;
      pic?: string;
      name?: string;
      artist?: string;
      level?: string;
      quality_name?: string;
      error?: string;
      preview?: boolean;
    };
  }>("kugou_song_play", {
    args: {
      hash,
      album_audio_id: song.id,
      album_id: song.albumId,
      level,
      // Pass alternate hashes so backend can step down if HQ fails
      hash_std: song.kgHash,
      hash_hq: song.kgHqHash,
      hash_sq: song.kgSqHash,
      hash_res: song.kgResHash,
    },
  });
  const url = env.data?.url ?? null;
  if (!url && env.data?.error) {
    throw new Error(env.data.error);
  }
  return {
    url,
    meta: {
      name: env.data?.name ?? song.name,
      ar_name: env.data?.artist ?? song.artist,
      al_name: song.album,
      pic: env.data?.pic ?? song.pic,
      lyric: "",
      tlyric: "",
      lyric_source: "kugou",
      level: env.data?.level ?? level,
      quality_name: env.data?.quality_name ?? level,
    },
  };
}
