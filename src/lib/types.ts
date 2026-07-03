/** Shared types mirroring the Netease_url API responses. */

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
}

export interface SongJson {
  name: string;
  ar_name: string;
  al_name: string;
  pic: string;
  lyric: string;
  tlyric: string;
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
