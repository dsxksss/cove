import { create } from "zustand";
import type { StudioEffects, StudioProject, StudioTrack, StudioAsset, StudioTake, StudioClip } from "./types";
import { createReferenceTrack, createVocalTrack, DEFAULT_EFFECTS } from "./types";

type StudioState = {
  project: StudioProject | null;
  currentTime: number;
  isPlaying: boolean;
  inputDeviceId: string;
  monitorInput: boolean;
  recordingTrackId: string | null;
  effectsClipboard: { sourceName: string; effects: StudioEffects } | null;
  setProject: (project: StudioProject | null) => void;
  setCurrentTime: (time: number) => void;
  setPlaying: (playing: boolean) => void;
  setInputDeviceId: (id: string) => void;
  setMonitorInput: (enabled: boolean) => void;
  setRecordingTrackId: (id: string | null) => void;
  updateProjectTitle: (title: string) => void;
  addVocalTrack: () => void;
  addReferenceTrack: (stem?: "original" | "vocals") => string | null;
  updateTrack: (id: string, patch: Partial<StudioTrack>) => void;
  renameTrack: (id: string, name: string) => void;
  updateMixer: (id: string, patch: Partial<StudioTrack["mixer"]>) => void;
  updateEffects: (id: string, effects: Partial<StudioEffects>) => void;
  copyEffects: (id: string) => void;
  pasteEffects: (id: string) => void;
  resetEffects: (id: string) => void;
  updateClip: (trackId: string, clipId: string, patch: Partial<StudioClip>) => void;
  removeClip: (trackId: string, clipId: string) => void;
  addAssetToTrack: (trackId: string, asset: StudioAsset, take?: StudioTake, startSec?: number) => void;
  replaceAssetOnTrack: (trackId: string, asset: StudioAsset, startSec?: number) => void;
  removeTrack: (id: string) => void;
  updateLatency: (value: number) => void;
};

function touch(project: StudioProject): StudioProject {
  return { ...project, updatedAt: new Date().toISOString() };
}

export const useStudioStore = create<StudioState>((set, get) => ({
  project: null,
  currentTime: 0,
  isPlaying: false,
  inputDeviceId: "default",
  monitorInput: false,
  recordingTrackId: null,
  effectsClipboard: null,
  setProject: (project) => set({ project, currentTime: 0, isPlaying: false, recordingTrackId: null }),
  setCurrentTime: (currentTime) => set({ currentTime: Math.max(0, currentTime) }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setInputDeviceId: (inputDeviceId) => set({ inputDeviceId }),
  setMonitorInput: (monitorInput) => set({ monitorInput }),
  setRecordingTrackId: (recordingTrackId) => set({ recordingTrackId }),
  updateProjectTitle: (title) => set((state) => state.project ? { project: touch({ ...state.project, title: title.trim() || state.project.title }) } : state),
  addVocalTrack: () => set((state) => {
    if (!state.project) return state;
    const nextIndex = state.project.tracks.filter((track) => track.kind === "vocal").length + 1;
    return { project: touch({ ...state.project, tracks: [...state.project.tracks, createVocalTrack(nextIndex)] }) };
  }),
  addReferenceTrack: (stem = "original") => {
    const project = get().project;
    if (!project) return null;
    const existing = project.tracks.find((track) => track.kind === "reference" && (track.referenceStem ?? "original") === stem);
    if (existing) return existing.id;
    const track = createReferenceTrack(stem);
    set({ project: touch({ ...project, tracks: [...project.tracks, track] }) });
    return track.id;
  },
  updateTrack: (id, patch) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => track.id === id ? { ...track, ...patch } : track) }) };
  }),
  renameTrack: (id, name) => set((state) => {
    if (!state.project) return state;
    const nextName = name.trim();
    if (!nextName) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => track.id === id ? { ...track, name: nextName } : track) }) };
  }),
  updateMixer: (id, patch) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => {
      if (track.id !== id) return track;
      const mixer = { ...track.mixer, ...patch };
      if (patch.solo === true) mixer.mute = false;
      if (patch.mute === true) mixer.solo = false;
      return { ...track, mixer };
    }) }) };
  }),
  updateEffects: (id, effects) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => track.id === id ? { ...track, effects: { ...track.effects, ...effects, eq: { ...track.effects.eq, ...effects.eq }, compressor: { ...track.effects.compressor, ...effects.compressor }, reverb: { ...track.effects.reverb, ...effects.reverb }, delay: { ...track.effects.delay, ...effects.delay } } } : track) }) };
  }),
  resetEffects: (id) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => track.id === id ? { ...track, effects: structuredClone(DEFAULT_EFFECTS) } : track) }) };
  }),
  copyEffects: (id) => set((state) => {
    const track = state.project?.tracks.find((item) => item.id === id);
    return track ? { effectsClipboard: { sourceName: track.name, effects: structuredClone(track.effects) } } : state;
  }),
  pasteEffects: (id) => set((state) => {
    const { project, effectsClipboard } = state;
    if (!project || !effectsClipboard || !project.tracks.some((track) => track.id === id)) return state;
    return { project: touch({ ...project, tracks: project.tracks.map((track) => track.id === id ? { ...track, effects: structuredClone(effectsClipboard.effects) } : track) }) };
  }),
  updateClip: (trackId, clipId, patch) => set((state) => {
    if (!state.project) return state;
    return { project: touch({
      ...state.project,
      tracks: state.project.tracks.map((track) => {
        if (track.id !== trackId) return track;
        return { ...track, clips: track.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const next = { ...clip, ...patch };
          const asset = track.assets.find((item) => item.id === next.assetId);
          const maxDuration = asset?.durationSec ?? next.durationSec;
          const offset = Math.max(0, Math.min(next.offsetSec, Math.max(0, maxDuration - 0.05)));
          const duration = Math.max(0.05, Math.min(next.durationSec, maxDuration - offset));
          const start = Math.max(0, next.startSec);
          return { ...next, startSec: start, offsetSec: offset, durationSec: duration };
        }) };
      }),
    }) };
  }),
  removeClip: (trackId, clipId) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.map((track) => track.id === trackId ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) } : track) }) };
  }),
  addAssetToTrack: (trackId, asset, take, startSec = 0) => set((state) => {
    if (!state.project) return state;
    return { project: touch({ ...state.project, instrumental: trackId === "instrumental" ? asset : state.project.instrumental, tracks: state.project.tracks.map((track) => {
      if (track.id !== trackId) return track;
      const nextTake = take ?? { id: `take-${Date.now()}`, assetId: asset.id, createdAt: new Date().toISOString(), label: `Take ${track.takes.length + 1}` };
      // Advancing a recording across song time zero must trim its audible
      // head, not silently discard the compensation. Keep the full take.
      const offsetSec = Math.min(asset.durationSec, Math.max(0, -startSec));
      return { ...track, assets: [...track.assets, asset], takes: track.kind === "vocal" ? [...track.takes, nextTake] : track.takes, clips: [...track.clips, { id: `clip-${Date.now()}`, assetId: asset.id, startSec: Math.max(0, startSec), offsetSec, durationSec: Math.max(0, asset.durationSec - offsetSec) }] };
    }) }) };
  }),
  replaceAssetOnTrack: (trackId, asset, startSec = 0) => set((state) => {
    if (!state.project) return state;
    return { project: touch({
      ...state.project,
      instrumental: trackId === "instrumental" ? asset : state.project.instrumental,
      tracks: state.project.tracks.map((track) => track.id !== trackId ? track : {
        ...track,
        assets: [asset],
        denoiseOriginalAssets: undefined,
        normalizationGain: undefined,
        clips: [{ id: `clip-${Date.now()}`, assetId: asset.id, startSec: Math.max(0, startSec), offsetSec: 0, durationSec: asset.durationSec }],
        takes: track.kind === "instrumental" ? [] : track.takes,
      }),
    }) };
  }),
  removeTrack: (id) => set((state) => {
    if (!state.project || id === "instrumental") return state;
    return { project: touch({ ...state.project, tracks: state.project.tracks.filter((track) => track.id !== id) }) };
  }),
  updateLatency: (inputLatencyMs) => set((state) => state.project ? { project: touch({ ...state.project, inputLatencyMs }) } : state),
}));
