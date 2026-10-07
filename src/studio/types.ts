import type { LyricsLine } from "../components/playerTypes";

export type StudioAsset = {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  durationSec: number;
};

export type StudioTake = {
  id: string;
  assetId: string;
  createdAt: string;
  label: string;
};

export type StudioClip = {
  id: string;
  assetId: string;
  startSec: number;
  offsetSec: number;
  durationSec: number;
};

export type StudioEffects = {
  eq: { lowDb: number; midDb: number; highDb: number };
  compressor: {
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
  };
  reverb: { mix: number; decaySec: number };
  delay: { mix: number; timeMs: number; feedback: number };
};

export type StudioTrack = {
  id: string;
  name: string;
  kind: "instrumental" | "vocal" | "reference";
  referenceStem?: "original" | "vocals";
  offsetMs?: number;
  normalizationGain?: number;
  denoiseOriginalAssets?: Record<string, string>;
  color: string;
  clips: StudioClip[];
  takes: StudioTake[];
  assets: StudioAsset[];
  mixer: { gain: number; pan: number; mute: boolean; solo: boolean; armed: boolean; channelMode?: "stereo" | "mono" };
  effects: StudioEffects;
};

export type StudioProject = {
  id: string;
  songId: string;
  source: "netease" | "qq" | "kugou";
  sourceUrl?: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl: string;
  durationSec: number;
  lyrics: LyricsLine[];
  inputLatencyMs: number;
  instrumental: StudioAsset | null;
  tracks: StudioTrack[];
  createdAt: string;
  updatedAt: string;
  version: 1;
};

export const DEFAULT_EFFECTS: StudioEffects = {
  eq: { lowDb: 0, midDb: 0, highDb: 0 },
  compressor: { thresholdDb: -18, ratio: 3, attackMs: 10, releaseMs: 120 },
  reverb: { mix: 0.12, decaySec: 1.8 },
  delay: { mix: 0, timeMs: 180, feedback: 0.2 },
};

export function createStudioProject(input: {
  songId: string;
  source?: "netease" | "qq" | "kugou";
  sourceUrl?: string;
  title: string;
  artist: string;
  album?: string;
  coverUrl: string;
  durationSec: number;
  lyrics: LyricsLine[];
}): StudioProject {
  const now = new Date().toISOString();
  return {
    id: `studio-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    songId: input.songId,
    source: input.source ?? "netease",
    sourceUrl: input.sourceUrl,
    title: input.title,
    artist: input.artist,
    album: input.album,
    coverUrl: input.coverUrl,
    durationSec: Math.max(0, input.durationSec),
    lyrics: input.lyrics,
    inputLatencyMs: 0,
    instrumental: null,
    tracks: [
      {
        id: "instrumental",
        name: "伴奏",
        kind: "instrumental",
        color: "#a7f3d0",
        clips: [],
        takes: [],
        assets: [],
        mixer: { gain: 1, pan: 0, mute: false, solo: false, armed: false },
        effects: structuredClone(DEFAULT_EFFECTS),
      },
    ],
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

export function createVocalTrack(index: number): StudioTrack {
  return {
    id: `vocal-${Date.now()}-${index}`,
    name: `人声 ${index}`,
    kind: "vocal",
    color: ["#fda4af", "#93c5fd", "#c4b5fd", "#fcd34d"][index % 4],
    clips: [],
    takes: [],
    assets: [],
    mixer: { gain: 1, pan: 0, mute: false, solo: false, armed: false },
    effects: structuredClone(DEFAULT_EFFECTS),
  };
}

export function createReferenceTrack(stem: "original" | "vocals" = "original"): StudioTrack {
  return {
    id: `reference-${stem}-${Date.now()}`,
    name: stem === "vocals" ? "原曲人声参考" : "原曲参考",
    kind: "reference",
    referenceStem: stem,
    color: "#fbbf24",
    clips: [],
    takes: [],
    assets: [],
    // Reference audio is for comparison and must not enter a finished mix by
    // default. The user can unmute or solo it when needed.
    mixer: { gain: 1, pan: 0, mute: true, solo: false, armed: false },
    effects: structuredClone(DEFAULT_EFFECTS),
  };
}
