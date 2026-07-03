export type AudioBadge = 'Lossless' | 'Dolby Atmos';

export interface LyricsLine {
  time: number; // in seconds
  text: string;
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

export type LyricMotionStyle =
  | 'rail'
  | 'cascade'
  | 'focus'
  | 'typewriter'
  | 'beam'
  | 'dialogue'
  | 'poster'
  | 'tilt'
  | 'ripple'
  | 'float'
  | 'stagger';
