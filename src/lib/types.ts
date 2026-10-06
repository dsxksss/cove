/** Shared types mirroring the Netease_url API responses. */

/** Streaming / catalog music provider. */
export type MusicSource = "netease" | "qq" | "kugou";

export interface Song {
  id: number;
  name: string;
  /** primary artist display string */
  artist: string;
  album?: string;
  /** cover url */
  pic?: string;
  /** duration in ms (may be absent until playback) */
  duration?: number;
  /** catalog source; default netease for backward compatibility */
  source?: MusicSource;
  /** QQ Music songmid (required for QQ stream + lyrics) */
  qqMid?: string;
  /** QQ media mid (for lossless/flac filename) */
  qqMediaMid?: string;
  /** Kugou file hash (required for Kugou stream + lyrics) */
  kgHash?: string;
  /** Kugou HQ (≈320k) hash */
  kgHqHash?: string;
  /** Kugou SQ (flac) hash */
  kgSqHash?: string;
  /** Kugou hi-res hash */
  kgResHash?: string;
  /** optional album mid / extra ids */
  albumId?: string;
  /** Local rendered audio used by the cover studio's player handoff. */
  localAudioUrl?: string;
  /** Keep the studio timeline lyrics when a rendered mix is played locally. */
  localLyrics?: LyricLine[];
}

export interface PlaylistSummary {
  id: number;
  name: string;
  coverImgUrl?: string;
  trackCount: number;
  playCount: number;
  createTime: number;
  updateTime: number;
  subscribed: boolean;
  creatorUid: number;
  creatorName: string;
  createdByAccount: boolean;
  /** Catalog source; default netease */
  source?: MusicSource;
  /** Kugou listid (may differ from synthetic id) */
  kgListId?: number;
  /** Kugou global_collection_id for public playlist track API */
  kgGlobalId?: string;
  /** QQ Music diss tid / disstid */
  qqDissTid?: number;
}

export interface SongJson {
  name: string;
  ar_name: string;
  al_name: string;
  pic: string;
  lyric: string;
  tlyric: string;
  /** netease | qq | kugou | amll:ncm | … */
  lyric_source?: string;
  url: string | null;
  level: string;
  quality_name: string;
  size: number;
  type: string;
}

export interface SongUrl {
  id: number;
  url: string | null;
  level: string;
  quality_name: string;
  size: number;
  size_formatted: string;
  type: string;
  bitrate: number;
}

export interface LyricLine {
  /** seconds */
  time: number;
  text: string;
  /** translated text (optional) */
  tr?: string;
}

export type RepeatMode = "off" | "all" | "one";

/** RGB color triple 0-255 from cover-art analysis. */
export interface AccentColor {
  r: number;
  g: number;
  b: number;
}
