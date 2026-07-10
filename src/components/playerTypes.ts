export type AudioBadge = 'Lossless' | 'Dolby Atmos';

export interface LyricsLine {
  time: number; // in seconds
  text: string;
  /** optional translated line shown beneath the original */
  tr?: string;
}

export interface Song {
  id: string;
  title: string;
  artist: string;
  coverUrl: string;
  backgroundUrl: string;
  duration: number; // in seconds
  badge: AudioBadge;
  lyrics: LyricsLine[];
  themeColor: string; // Tailwind tint class (e.g. 'rgba(59, 130, 246, 0.2)')
  textColor: string;
}

export type PlayerLayout = 'vertical' | 'mini' | 'lyrics';

/**
 * Lyric motion presets.
 * Folia-major ports: monet (莫奈), fume (浮名), classic (流光).
 * Lightweight: rail (默认滚动), dialogue (对话).
 */
export type LyricMotionStyle =
  | 'monet'
  | 'fume'
  | 'classic'
  | 'rail'
  | 'dialogue';
