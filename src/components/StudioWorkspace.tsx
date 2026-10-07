import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Disc3, Download, Headphones, Pause, Pencil, Play, Plus, RotateCcw, Save, SlidersHorizontal, Square, Trash2, Upload, Volume2 } from "lucide-react";
import { StudioInputControls } from "./StudioInputControls";
import { SignedMilliseconds, StudioTrackTools, trapStudioDialogTab } from "./StudioTrackTools";
import type { LyricsLine } from "./playerTypes";
import { invokeNative } from "../lib/native";
import { StudioAudioEngine } from "../lib/studioAudio";
import { normalizationGain, renderStudioMix } from "../lib/studioExport";
import { StudioRecorder, type StudioInputLevel } from "../lib/studioRecorder";
import { useStudioStore } from "../studio/studioStore";
import { downloadStudioOriginal, resolveStudioSourceUrl } from "../studio/source";
import type { StudioAsset, StudioClip, StudioEffects, StudioProject, StudioTrack } from "../studio/types";
import { getProjectDuration, hasAudibleClips, scheduledClip } from "../lib/studioSchedule";

type Props = {
  project: StudioProject;
  onBack: (project?: StudioProject) => void;
  onPlayInPlayer: (audioUrl: string, project: StudioProject) => Promise<void> | void;
};

function formatTime(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  return `${Math.floor(safe / 60)}:${Math.floor(safe % 60).toString().padStart(2, "0")}`;
}

function activeLyric(lines: LyricsLine[], time: number) {
  let active = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].time <= time) active = index;
    else break;
  }
  return active;
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}
function readBlobAsBase64(blob: Blob): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(reader.error ?? new Error("读取混音失败")); reader.onload = () => { const value = String(reader.result ?? ""); resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value); }; reader.readAsDataURL(blob); }); }
function base64Url(value: string, mimeType: string) { const bytes = Uint8Array.from(atob(value), ch => ch.charCodeAt(0)); return URL.createObjectURL(new Blob([bytes], { type: mimeType })); }

const RECORD_COUNTDOWN_KEY = "cove.studio.record-countdown";

function loadRecordCountdown() {
  try { return localStorage.getItem(RECORD_COUNTDOWN_KEY) !== "0"; } catch { return true; }
}

function assetFromFile(file: File, durationSec: number): StudioAsset {
  return { id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, url: URL.createObjectURL(file), mimeType: file.type || "audio/wav", durationSec };
}

function lastAsset(assets: StudioAsset[]): StudioAsset | undefined {
  return assets.length > 0 ? assets[assets.length - 1] : undefined;
}

function instrumentalCacheId(project: Pick<StudioProject, "source" | "songId">): string {
  return `${project.source}-${project.songId}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 110);
}

function TrackRow({ track, selected, onSelect, onMixer, onDelete, onRename }: { track: StudioTrack; selected: boolean; onSelect: () => void; onMixer: (patch: Partial<StudioTrack["mixer"]>) => void; onDelete: () => void; onRename: (name: string) => void }) {
  const asset = track.assets.find((item) => item.id === track.clips[track.clips.length - 1]?.assetId) ?? lastAsset(track.assets);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  const commit = () => { const next = draft.trim(); if (next) onRename(next); else setDraft(track.name); setEditing(false); };
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.target === event.currentTarget && event.key === "Enter") { event.preventDefault(); onSelect(); } }} className={`group flex min-h-24 w-full flex-col gap-2 rounded-2xl border p-3 text-left transition ${selected ? "border-white/30 bg-white/10" : "border-white/8 bg-white/[0.035] hover:bg-white/[0.07]"}`}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: track.color }} />
        {editing ? <input autoFocus aria-label="音轨名称" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { setDraft(track.name); setEditing(false); } }} onClick={(event) => event.stopPropagation()} className="no-drag min-w-0 flex-1 rounded bg-white/10 px-1.5 py-0.5 text-xs font-bold text-white outline-none ring-1 ring-lime-200/50" /> : <span className="min-w-0 flex-1 truncate text-xs font-bold text-white/85">{track.name}</span>}
        <span className="text-[10px] text-white/35">{track.kind === "instrumental" ? "伴奏" : track.kind === "reference" ? "参考" : `${track.takes.length} takes`}</span>
        <button type="button" onClick={(event) => { event.stopPropagation(); setDraft(track.name); setEditing(true); }} className="rounded p-1 text-white/25 hover:bg-white/10 hover:text-white/80" aria-label={`重命名 ${track.name}`} title="重命名音轨"><Pencil size={12} /></button>
        {track.kind !== "instrumental" && <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="rounded p-1 text-white/30 hover:bg-red-400/15 hover:text-red-200" aria-label={`删除 ${track.name}`}><Trash2 size={13} /></button>}
      </div>
      <div className="h-8 overflow-hidden rounded-lg bg-black/20">
        {asset ? <div className="flex h-full items-center gap-1 px-2 opacity-80"><span className="h-3 w-1 rounded-full bg-white/60" /><span className="h-5 w-1 rounded-full bg-white/35" /><span className="h-4 w-1 rounded-full bg-white/55" /><span className="h-6 w-1 rounded-full bg-white/30" /><span className="h-3 w-1 rounded-full bg-white/50" /><span className="text-[10px] text-white/35">{asset.name}</span></div> : <div className="grid h-full place-items-center text-[10px] text-white/25">{track.kind === "instrumental" ? "导入伴奏或生成伴奏" : track.kind === "reference" ? "导入原曲作为参考" : "准备后录音"}</div>}
      </div>
      <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => onMixer({ mute: !track.mixer.mute })} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${track.mixer.mute ? "bg-red-400/25 text-red-100" : "text-white/45 hover:bg-white/10"}`}>M</button>
        <button type="button" onClick={() => onMixer({ solo: !track.mixer.solo })} className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${track.mixer.solo ? "bg-amber-300/25 text-amber-100" : "text-white/45 hover:bg-white/10"}`}>S</button>
        <Volume2 size={12} className="ml-auto text-white/35" />
        <input aria-label={`${track.name} 音量`} type="range" min="0" max="1.4" step="0.01" value={track.mixer.gain} onChange={(event) => onMixer({ gain: Number(event.target.value) })} className="w-24 accent-white" />
      </div>
    </div>
  );
}

function EffectPanel({ track, onChange, onReset }: { track: StudioTrack; onChange: (effects: Partial<StudioEffects>) => void; onReset: () => void }) {
  const setEq = (key: keyof StudioEffects["eq"], value: number) => onChange({ eq: { ...track.effects.eq, [key]: value } });
  return <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
    <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold text-white/75"><SlidersHorizontal size={14} /> {track.name} 效果器</div><div className="flex items-center gap-1"><button type="button" onClick={onReset} className="flex items-center gap-1 rounded-lg bg-white/8 px-1.5 py-1 text-[9px] text-white/50 hover:bg-white/15 hover:text-white/80" title="恢复默认效果"><RotateCcw size={11} />默认</button><span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/35">实时</span></div></div>
    <div className="grid grid-cols-3 gap-2">{(["lowDb", "midDb", "highDb"] as const).map((key) => <label key={key} className="min-w-0 text-[10px] text-white/45"><span className="flex justify-between"><span>{key === "lowDb" ? "低频" : key === "midDb" ? "中频" : "高频"}</span><span className="font-mono text-white/30">{track.effects.eq[key].toFixed(1)}</span></span><input aria-label={key} type="range" min="-12" max="12" step="0.5" value={track.effects.eq[key]} onChange={(event) => setEq(key, Number(event.target.value))} className="w-full accent-lime-200" /></label>)}</div>
    <div className="grid grid-cols-3 gap-2 border-t border-white/8 pt-2"><label className="min-w-0 text-[10px] text-white/45">压缩 <input aria-label="压缩比例" type="range" min="1" max="12" step="0.5" value={track.effects.compressor.ratio} onChange={(event) => onChange({ compressor: { ...track.effects.compressor, ratio: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{track.effects.compressor.ratio.toFixed(1)}:1</span></label><label className="min-w-0 text-[10px] text-white/45">混响 <input aria-label="混响" type="range" min="0" max="1" step="0.01" value={track.effects.reverb.mix} onChange={(event) => onChange({ reverb: { ...track.effects.reverb, mix: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{Math.round(track.effects.reverb.mix * 100)}%</span></label><label className="min-w-0 text-[10px] text-white/45">延迟 <input aria-label="延迟" type="range" min="0" max="1" step="0.01" value={track.effects.delay.mix} onChange={(event) => onChange({ delay: { ...track.effects.delay, mix: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{Math.round(track.effects.delay.mix * 100)}%</span></label></div>
  </div>;
}

export default function StudioWorkspace({ project, onBack, onPlayInPlayer }: Props) {
  const sessionProjectIdRef = useRef(project.id);
  const savedSnapshotRef = useRef(structuredClone(project));
  const [exitPromptOpen, setExitPromptOpen] = useState(false);
  const [savingProject, setSavingProject] = useState(false);
  const [exitError, setExitError] = useState<string | null>(null);
  const [trackToolsOpen, setTrackToolsOpen] = useState(false);
  const [processingTrack, setProcessingTrack] = useState(false);
  const [loadingVocals, setLoadingVocals] = useState(false);
  const storedProject = useStudioStore((state) => state.project);
  const currentProject = storedProject?.id === sessionProjectIdRef.current ? storedProject : project;
  const projectDuration = getProjectDuration(currentProject);
  const currentTime = useStudioStore((state) => state.currentTime);
  const isPlaying = useStudioStore((state) => state.isPlaying);
  const recordingTrackId = useStudioStore((state) => state.recordingTrackId);
  const monitorInput = useStudioStore((state) => state.monitorInput);
  const inputDeviceId = useStudioStore((state) => state.inputDeviceId);
  const setProject = useStudioStore((state) => state.setProject);
  const setCurrentTime = useStudioStore((state) => state.setCurrentTime);
  const setPlaying = useStudioStore((state) => state.setPlaying);
  const setMonitorInput = useStudioStore((state) => state.setMonitorInput);
  const setInputDeviceId = useStudioStore((state) => state.setInputDeviceId);
  const setRecordingTrackId = useStudioStore((state) => state.setRecordingTrackId);
  const updateProjectTitle = useStudioStore((state) => state.updateProjectTitle);
  const updateTrack = useStudioStore((state) => state.updateTrack);
  const renameTrack = useStudioStore((state) => state.renameTrack);
  const addVocalTrack = useStudioStore((state) => state.addVocalTrack);
  const addReferenceTrack = useStudioStore((state) => state.addReferenceTrack);
  const updateMixer = useStudioStore((state) => state.updateMixer);
  const updateEffects = useStudioStore((state) => state.updateEffects);
  const resetEffects = useStudioStore((state) => state.resetEffects);
  const updateClip = useStudioStore((state) => state.updateClip);
  const removeClip = useStudioStore((state) => state.removeClip);
  const addAssetToTrack = useStudioStore((state) => state.addAssetToTrack);
  const replaceAssetOnTrack = useStudioStore((state) => state.replaceAssetOnTrack);
  const removeTrack = useStudioStore((state) => state.removeTrack);
  const updateLatency = useStudioStore((state) => state.updateLatency);
  const engineRef = useRef<StudioAudioEngine | null>(null);
  const recorderRef = useRef<StudioRecorder | null>(null);
  const recordStartRef = useRef(0);
  const recordingSessionRef = useRef(0);
  const recordSavingRef = useRef(false);
  const [savingRecording, setSavingRecording] = useState(false);
  const countdownAbortRef = useRef(false);
  const [selectedTrackId, setSelectedTrackId] = useState("instrumental");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [ncmStatus, setNcmStatus] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [stemProgress, setStemProgress] = useState(0);
  const [stemStage, setStemStage] = useState("准备文件");
  const [stemIndeterminate, setStemIndeterminate] = useState(false);
  const [savedProjects, setSavedProjects] = useState<Array<{ id: string; title: string; artist: string }>>([]);
  const persistedProjectIdsRef = useRef(new Set<string>());
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportBusyRef = useRef(false);
  const headerMenuRef = useRef<HTMLElement | null>(null);
  const [micMenuOpen, setMicMenuOpen] = useState(false);
  const [countdownEnabled, setCountdownEnabled] = useState(loadRecordCountdown);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const autoPrepareRef = useRef<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const scrubRef = useRef<{ resume: boolean; projectId: string } | null>(null);
  const [scrubPlaying, setScrubPlaying] = useState(false);
  const timelineDraggingRef = useRef(false);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const clipDragRef = useRef<{ trackId: string; clip: StudioClip; mode: "move" | "left" | "right"; originX: number; startSec: number; offsetSec: number; durationSec: number; secondsPerPixel: number } | null>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState(project.title);
  const [micLevel, setMicLevel] = useState<StudioInputLevel>({ rms: 0, peak: 0, clipping: false });
  const inputGain = 1;
  const assetWritesRef = useRef(new Map<string, Promise<unknown>>());
  const mountedRef = useRef(false);
  const stemJobRef = useRef<string | null>(null);
  const isCurrentProject = (id: string) => mountedRef.current && useStudioStore.getState().project?.id === id;

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!headerMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
        setProjectMenuOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setExportMenuOpen(false); setProjectMenuOpen(false); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    useStudioStore.getState().setProject(project);
    engineRef.current ??= new StudioAudioEngine();
    const unsubscribe = engineRef.current.subscribePlayback(setPlaying);
    return () => {
      unsubscribe();
      mountedRef.current = false;
      countdownAbortRef.current = true;
      recordingSessionRef.current += 1;
      recordSavingRef.current = false;
      recorderRef.current?.dispose();
      recorderRef.current = null;
      useStudioStore.getState().setRecordingTrackId(null);
      if (stemJobRef.current) void invokeNative("studio_cancel_job", { jobId: stemJobRef.current }).catch(() => undefined);
      // StrictMode replays effects synchronously; keep the context for that replay.
      queueMicrotask(() => {
        if (!mountedRef.current) engineRef.current?.dispose();
      });
    };
  }, [project]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((device) => device.kind === "audioinput"));
  }, []);

  useEffect(() => { void refreshDevices(); }, [refreshDevices]);
  useEffect(() => {
    void invokeNative<Array<{ id: string; title: string; artist: string }>>("studio_list_projects").then((items) => {
      persistedProjectIdsRef.current = new Set(items.map((item) => item.id));
      setSavedProjects(items);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setProjectTitleDraft(currentProject.title);
    setRenamingProject(false);
  }, [currentProject.id]);

  const openSavedProject = async (id: string) => {
    if (savingProject || exporting || processingTrack || recordingTrackId) return;
    const previousId = currentProject.id;
    try {
      const loaded = await invokeNative<StudioProject>("studio_load_project", { projectId: id });
      for (const track of loaded.tracks) for (const asset of track.assets) {
        const encoded = await invokeNative<string>("studio_read_asset", { projectId: loaded.id, assetId: asset.id });
        asset.url = base64Url(encoded, asset.mimeType);
      }
      if (!isCurrentProject(previousId)) return;
      engineRef.current?.pause();
      if (stemJobRef.current) void invokeNative("studio_cancel_job", { jobId: stemJobRef.current }).catch(() => undefined);
      stemJobRef.current = null;
      setJobId(null);
      sessionProjectIdRef.current = loaded.id;
      persistedProjectIdsRef.current.add(loaded.id);
      savedSnapshotRef.current = structuredClone(loaded);
      setProject(loaded); setSelectedTrackId("instrumental"); setProjectMenuOpen(false); setNcmStatus("已打开本地工程");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "无法打开工程"); }
  };
  const importProjectPackage = async () => {
    if (savingProject || exporting || processingTrack || recordingTrackId) return;
    try {
      const loaded = await invokeNative<StudioProject | null>("studio_import_package");
      if (!loaded || !isCurrentProject(currentProject.id)) return;
      for (const track of loaded.tracks) for (const asset of track.assets) {
        const encoded = await invokeNative<string>("studio_read_asset", { projectId: loaded.id, assetId: asset.id });
        asset.url = base64Url(encoded, asset.mimeType);
      }
      sessionProjectIdRef.current = loaded.id;
      persistedProjectIdsRef.current.add(loaded.id);
      setProject(loaded);
      savedSnapshotRef.current = structuredClone(loaded);
      setSelectedTrackId("instrumental");
      setProjectMenuOpen(false);
      setNcmStatus("工程包已导入");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "工程包导入失败"); }
  };
  const deleteSavedProject = async (id: string) => {
    if (savingProject || exporting || processingTrack || recordingTrackId) return;
    try {
      await invokeNative("studio_delete_project", { projectId: id });
      persistedProjectIdsRef.current.delete(id);
      setSavedProjects((items) => items.filter((item) => item.id !== id));
      if (id === currentProject.id) setNcmStatus("工程已删除");
    } catch { setNcmStatus("删除工程失败"); }
  };
  const deleteCurrentProject = async () => { await deleteSavedProject(currentProject.id); };
  const selectedMic = devices.find((device) => device.deviceId === inputDeviceId);
  const micLabel = inputDeviceId === "default" ? "默认麦克风" : selectedMic?.label || `麦克风 ${inputDeviceId.slice(0, 5)}`;

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    void engine.setProject(currentProject).catch((error) => setNcmStatus(error instanceof Error ? error.message : "音频载入失败"));
  }, [currentProject.id, currentProject.tracks]);

  useEffect(() => {
    if (!persistedProjectIdsRef.current.has(currentProject.id)) return;
    const timer = window.setTimeout(() => {
      // Recovery drafts must never overwrite a formally saved project before
      // the user chooses Save in the exit confirmation.
      try { localStorage.setItem(`cove.studio.draft.${currentProject.id}`, JSON.stringify(currentProject)); } catch { /* storage quota is non-fatal */ }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [currentProject]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const clock = engineRef.current?.currentTime ?? currentTime;
      setCurrentTime(clock);
      if (!scrubRef.current && clock >= projectDuration && projectDuration > 0) { engineRef.current?.pause(); setPlaying(false); }
    }, 50);
    return () => window.clearInterval(timer);
  }, [projectDuration, isPlaying, setCurrentTime, setPlaying]);

  useEffect(() => {
    if (!recordingTrackId) { setMicLevel({ rms: 0, peak: 0, clipping: false }); return; }
    const timer = window.setInterval(() => setMicLevel(recorderRef.current?.getLevel() ?? { rms: 0, peak: 0, clipping: false }), 100);
    return () => window.clearInterval(timer);
  }, [recordingTrackId]);

  useEffect(() => { recorderRef.current?.update(inputGain, monitorInput); }, [inputGain, monitorInput]);

  useEffect(() => {
    if (recordingTrackId) { setProjectMenuOpen(false); setExportMenuOpen(false); }
  }, [recordingTrackId]);

  const beginScrub = useCallback(() => {
    if (scrubRef.current || useStudioStore.getState().recordingTrackId) return;
    const resume = engineRef.current?.isPlaying ?? false;
    scrubRef.current = { resume, projectId: useStudioStore.getState().project?.id ?? "" };
    setScrubPlaying(resume);
    engineRef.current?.pause();
  }, []);

  const finishScrub = useCallback(() => {
    const scrub = scrubRef.current;
    scrubRef.current = null;
    clipDragRef.current = null;
    setScrubPlaying(false);
    timelineDraggingRef.current = false;
    setTimelineDragging(false);
    const state = useStudioStore.getState();
    if (!scrub || scrub.projectId !== state.project?.id) return;
    const duration = getProjectDuration(state.project);
    if (scrub.resume && state.currentTime < duration) {
      void engineRef.current?.play(state.currentTime, true).catch((error) => setNcmStatus(error instanceof Error ? error.message : "音频播放失败"));
    }
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", finishScrub);
    window.addEventListener("pointercancel", finishScrub);
    window.addEventListener("blur", finishScrub);
    return () => {
      window.removeEventListener("pointerup", finishScrub);
      window.removeEventListener("pointercancel", finishScrub);
      window.removeEventListener("blur", finishScrub);
    };
  }, [finishScrub]);

  const seekTo = useCallback((value: number) => {
    if (useStudioStore.getState().recordingTrackId) return;
    const next = Math.min(projectDuration, Math.max(0, value));
    engineRef.current?.seek(next);
    setCurrentTime(next);
  }, [projectDuration, setCurrentTime]);

  const seekTimelineFromPointer = useCallback((clientX: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const value = ratio * Math.max(projectDuration, 1);
    seekTo(value);
  }, [projectDuration, seekTo]);

  useEffect(() => {
    if (!timelineDragging) return;
    const move = (event: PointerEvent) => seekTimelineFromPointer(event.clientX);
    const end = () => {
      timelineDraggingRef.current = false;
      setTimelineDragging(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
  }, [seekTimelineFromPointer, timelineDragging]);

  const beginClipDrag = useCallback((trackId: string, clip: StudioClip, mode: "move" | "left" | "right", clientX: number) => {
    if (useStudioStore.getState().recordingTrackId) return;
    beginScrub();
    clipDragRef.current = { trackId, clip, mode, originX: clientX, startSec: clip.startSec, offsetSec: clip.offsetSec, durationSec: clip.durationSec, secondsPerPixel: Math.max(projectDuration, 1) / Math.max(1, timelineRef.current?.clientWidth ?? 1) };
    setSelectedTrackId(trackId);
  }, [beginScrub, projectDuration]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = clipDragRef.current;
      const bounds = timelineRef.current?.getBoundingClientRect();
      if (!drag || !bounds || bounds.width <= 0) return;
      const delta = (event.clientX - drag.originX) * drag.secondsPerPixel;
      if (drag.mode === "move") {
        updateClip(drag.trackId, drag.clip.id, { startSec: drag.startSec + delta });
      } else if (drag.mode === "left") {
        const nextDelta = Math.max(-Math.min(drag.offsetSec, drag.startSec), Math.min(drag.durationSec - 0.05, delta));
        updateClip(drag.trackId, drag.clip.id, { startSec: drag.startSec + nextDelta, offsetSec: drag.offsetSec + nextDelta, durationSec: drag.durationSec - nextDelta });
      } else {
        updateClip(drag.trackId, drag.clip.id, { durationSec: drag.durationSec + delta });
      }
    };
    const end = () => { clipDragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
  }, [projectDuration, updateClip]);

  const selectedTrack = currentProject.tracks.find((track) => track.id === selectedTrackId) ?? currentProject.tracks[0];
  const lyricIndex = useMemo(() => activeLyric(currentProject.lyrics, currentTime), [currentProject.lyrics, currentTime]);
  const lyricRows = useMemo(() => {
    if (currentProject.lyrics.length === 0) return [];
    const center = lyricIndex >= 0 ? lyricIndex : 0;
    const start = Math.max(0, Math.min(center - 1, currentProject.lyrics.length - 3));
    return currentProject.lyrics.slice(start, start + 3).map((line, offset) => ({
      line,
      index: start + offset,
    }));
  }, [currentProject.lyrics, lyricIndex]);

  const togglePlayback = useCallback(async () => {
    if (scrubRef.current || recordingTrackId) return;
    if (engineRef.current?.isPlaying) { engineRef.current.pause(); return; }
    try {
      const start = currentTime >= projectDuration ? 0 : currentTime;
      setCurrentTime(start);
      await engineRef.current?.play(start);
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "音频播放失败"); }
  }, [currentTime, projectDuration, recordingTrackId, setCurrentTime]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (exitPromptOpen || trackToolsOpen) return;
      if (event.key !== " " && event.code !== "Space") return;
      if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // Preserve typing and native controls. A focused play button already
      // activates on Space keyup; handling it here as well would toggle twice.
      if (target?.closest('input:not([type="range"]), textarea, select, button, summary, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      if (!event.repeat) void togglePlayback();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlayback, exitPromptOpen, trackToolsOpen]);

  const importAudio = async (file: File, trackId = "instrumental", startSec = 0) => {
    const projectId = currentProject.id;
    const probe = document.createElement("audio");
    const probeUrl = URL.createObjectURL(file);
    let durationSec: number;
    try {
      await new Promise<void>((resolve, reject) => {
        probe.onloadedmetadata = () => resolve();
        probe.onerror = () => reject(new Error("音频格式不受支持或文件已损坏"));
        probe.src = probeUrl;
      });
      durationSec = Number.isFinite(probe.duration) ? probe.duration : currentProject.durationSec;
    } finally { probe.removeAttribute("src"); probe.load(); URL.revokeObjectURL(probeUrl); }
    if (!isCurrentProject(projectId)) return;
    const asset = assetFromFile(file, durationSec);
    const targetTrack = useStudioStore.getState().project?.tracks.find((track) => track.id === trackId);
    engineRef.current?.pause();
    setPlaying(false);
    if (trackId === "instrumental" || targetTrack?.kind === "reference" || trackId.startsWith("reference-")) replaceAssetOnTrack(trackId, asset, startSec);
    else addAssetToTrack(trackId, asset, undefined, startSec);
    const assetWrite = readFileAsBase64(file).then((inputBase64) => invokeNative("studio_write_asset", { projectId: currentProject.id, assetId: asset.id, inputBase64 }));
    const assetKey = `${currentProject.id}:${asset.id}`;
    assetWritesRef.current.set(assetKey, assetWrite);
    void assetWrite.then(() => { if (assetWritesRef.current.get(assetKey) === assetWrite) assetWritesRef.current.delete(assetKey); }).catch(() => undefined);
    if (trackId === "instrumental" && durationSec > 0 && currentProject.durationSec === 0) setProject({ ...useStudioStore.getState().project!, durationSec });
    setSelectedTrackId(trackId);
  };

  const importOriginalFile = async (file: File) => {
    const trackId = addReferenceTrack();
    if (!trackId) { setNcmStatus("无法创建原曲参考音轨"); return; }
    try {
      await importAudio(file, trackId);
      setSelectedTrackId(trackId);
      if (isCurrentProject(currentProject.id)) setNcmStatus("原曲已导入，点击原曲轨的 S 独奏试听，或关闭 M 与伴奏一起播放");
    } catch (error) {
      setNcmStatus(error instanceof Error ? error.message : "导入原曲失败");
    }
  };

  const importOriginalCurrentSong = async () => {
    const trackId = addReferenceTrack();
    if (!trackId) { setNcmStatus("无法创建原曲参考音轨"); return; }
    if ((currentProject.source ?? "netease") !== "netease") {
      setNcmStatus("当前平台暂不支持自动下载原曲，请选择本地原曲文件");
      return;
    }
    const projectId = currentProject.id;
    setNcmStatus("正在下载当前歌曲原曲…");
    try {
      const file = await downloadStudioOriginal(currentProject);
      if (!isCurrentProject(projectId)) return;
      await importAudio(file, trackId);
      if (!isCurrentProject(projectId)) return;
      setSelectedTrackId(trackId);
      setNcmStatus("原曲已导入，点击原曲轨的 S 独奏试听，或关闭 M 与伴奏一起播放");
    } catch (error) {
      if (isCurrentProject(projectId)) setNcmStatus(error instanceof Error ? error.message : "下载原曲失败，请选择本地原曲文件");
    }
  };

  const startRecording = async () => {
    if (recordSavingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || !engineRef.current) { setNcmStatus("当前 WebView 不支持麦克风录音"); setRecordingTrackId(null); return; }
    const recorder = new StudioRecorder(engineRef.current.context);
    const projectId = currentProject.id;
    recordingSessionRef.current += 1;
    recorderRef.current = recorder;
    try {
      countdownAbortRef.current = false;
      await recorder.prepare(inputDeviceId, inputGain, monitorInput);
      if (!isCurrentProject(projectId) || recorderRef.current !== recorder) { recorder.dispose(); return; }
      recorder.onDeviceLost(() => {
        if (recorderRef.current !== recorder) return;
        recorder.dispose();
        recorderRef.current = null;
        countdownAbortRef.current = true;
        setCountdownValue(null);
        engineRef.current?.pause();
        setPlaying(false);
        setMicLevel({ rms: 0, peak: 0, clipping: false });
        setNcmStatus("麦克风已断开，录音已停止");
        setRecordingTrackId(null);
      });
      if (countdownAbortRef.current) {
        recorder.dispose();
        recorderRef.current = null;
        setRecordingTrackId(null);
        return;
      }
      if (countdownEnabled) {
        for (let value = 3; value >= 1; value -= 1) {
          setCountdownValue(value);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 800));
          if (countdownAbortRef.current || recorderRef.current !== recorder || !isCurrentProject(projectId)) {
            recorder.dispose();
            return;
          }
        }
        setCountdownValue(null);
      }
      const scheduleAt = (engineRef.current?.context.currentTime ?? 0) + 0.015;
      // AudioContext time measures the lifetime of the device; clips use the
      // song playhead, which can be reset or seeked independently.
      recordStartRef.current = useStudioStore.getState().currentTime;
      recorder.start(scheduleAt);
      await engineRef.current?.play(recordStartRef.current, true);
      if (recorderRef.current !== recorder || !isCurrentProject(projectId)) return;
      setNcmStatus("正在录音，再次点击停止");
    } catch (error) {
      recorder.dispose();
      if (recorderRef.current !== recorder || !isCurrentProject(projectId)) return;
      recorderRef.current = null;
      setCountdownValue(null);
      engineRef.current?.pause();
      setPlaying(false);
      setMicLevel({ rms: 0, peak: 0, clipping: false });
      setNcmStatus(error instanceof Error ? error.message : "无法访问麦克风");
      setRecordingTrackId(null);
    }
  };

  const stopRecording = () => {
    if (recordSavingRef.current) return;
    if (!recorderRef.current || recorderRef.current.startedAt === null) {
      countdownAbortRef.current = true;
      recorderRef.current?.dispose();
      recorderRef.current = null;
      setCountdownValue(null);
      setRecordingTrackId(null);
      setNcmStatus("已取消录音准备");
      return;
    }
    const recorder = recorderRef.current;
    const projectId = currentProject.id;
    const session = recordingSessionRef.current;
    const trackId = recordingTrackId ?? selectedTrackId;
    const startSec = Math.max(0, recordStartRef.current - currentProject.inputLatencyMs / 1000);
    recorderRef.current = null;
    recordSavingRef.current = true;
    setSavingRecording(true);
    engineRef.current?.pause(); setPlaying(false); setNcmStatus("正在保存录音 take…");
    const isCurrentSession = () => isCurrentProject(projectId) && session === recordingSessionRef.current;
    void recorder.stop().then(async (blob) => {
      if (!isCurrentSession()) return;
      const file = new File([blob], `${currentProject.title}-${Date.now()}.wav`, { type: "audio/wav" });
      await importAudio(file, trackId, startSec);
      if (isCurrentSession()) setNcmStatus("录音已添加到音轨");
    }).catch((error) => {
      if (isCurrentSession()) setNcmStatus(error instanceof Error ? error.message : "保存录音失败");
    }).finally(() => {
      if (!isCurrentSession()) return;
      recordSavingRef.current = false; setSavingRecording(false); setRecordingTrackId(null);
    });
  };

  const startStemJob = (input: { inputBase64?: string; sourceUrl?: string; fileName: string }, target: "instrumental" | "vocals" = "instrumental") => new Promise<void>((resolve, reject) => {
    const projectId = currentProject.id;
    if (!isCurrentProject(projectId)) { resolve(); return; }
    setNcmStatus("准备伴奏任务…");
    setStemStage("准备文件");
    setStemProgress(0.02);
    setStemIndeterminate(false);
    void (async () => {
      try {
        const started = await invokeNative<{ jobId: string }>("studio_prepare_instrumental", { args: { ...input, title: currentProject.title } });
        if (!isCurrentProject(projectId)) {
          void invokeNative("studio_cancel_job", { jobId: started.jobId }).catch(() => undefined);
          resolve(); return;
        }
        stemJobRef.current = started.jobId;
        setJobId(started.jobId);
        const poll = async () => {
          try {
            if (!isCurrentProject(projectId)) { resolve(); return; }
            const status = await invokeNative<{ state: string; stage: string; progress: number; outputPath?: string; vocalOutputPath?: string; error?: string; message?: string; elapsedSec?: number; indeterminate?: boolean }>("studio_job_status", { jobId: started.jobId });
            if (!isCurrentProject(projectId)) { resolve(); return; }
            setStemStage(status.stage);
            setStemProgress(Math.max(0, Math.min(1, status.progress)));
            setStemIndeterminate(Boolean(status.indeterminate));
            const elapsed = typeof status.elapsedSec === "number" ? ` · 已用时 ${Math.floor(status.elapsedSec / 60)}:${String(Math.floor(status.elapsedSec % 60)).padStart(2, "0")}` : "";
            setNcmStatus(`${status.message ?? `${status.stage} ${Math.round(status.progress * 100)}%`}${elapsed}`);
            if (status.state === "running" || status.state === "queued") { window.setTimeout(() => void poll(), 800); return; }
            if (status.state === "completed") {
              try {
                const audio = await invokeNative<{ name: string; base64: string }>("studio_job_audio", { jobId: started.jobId });
                if (!isCurrentProject(projectId)) { resolve(); return; }
                const bytes = Uint8Array.from(atob(audio.base64), (char) => char.charCodeAt(0));
                if (target === "instrumental") await importAudio(new File([bytes], audio.name, { type: audio.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav" }));
                if (!isCurrentProject(projectId)) { resolve(); return; }
                try {
                  await invokeNative("studio_cache_write", {
                    cacheId: instrumentalCacheId(currentProject),
                    name: audio.name,
                    mimeType: audio.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
                    inputBase64: audio.base64,
                  });
                } catch {
                  // The generated accompaniment is still usable in this
                  // project when the optional shared cache cannot be written.
                }
                if (!isCurrentProject(projectId)) { resolve(); return; }
                if (status.vocalOutputPath) {
                  const vocals = await invokeNative<{ name: string; base64: string }>("studio_job_audio", { jobId: started.jobId, stem: "vocals" });
                  if (!isCurrentProject(projectId)) { resolve(); return; }
                  try { await invokeNative("studio_cache_write", { cacheId: instrumentalCacheId(currentProject), stem: "vocals", name: vocals.name, mimeType: "audio/wav", inputBase64: vocals.base64 }); } catch { /* importing remains possible without a shared cache */ }
                  if (!isCurrentProject(projectId)) { resolve(); return; }
                  if (target === "vocals") {
                    const trackId = addReferenceTrack("vocals");
                    if (trackId) await importAudio(new File([Uint8Array.from(atob(vocals.base64), ch => ch.charCodeAt(0))], vocals.name, { type: "audio/wav" }), trackId);
                  }
                } else if (target === "vocals") throw new Error("运行包未输出人声，请先安装本次人声分离脚本补丁后重试");
                setStemProgress(1); setStemIndeterminate(false);
                setNcmStatus(target === "vocals" ? "原曲人声已导入参考轨，点击 S 独奏试听" : "伴奏已生成并缓存");
                resolve();
              } catch (error) { reject(error instanceof Error ? error : new Error(`伴奏已生成：${status.outputPath ?? "请导入输出文件"}`)); }
              finally { if (isCurrentProject(projectId)) { setJobId(null); stemJobRef.current = null; } }
            } else { setJobId(null); stemJobRef.current = null; reject(new Error(status.error ?? "伴奏任务失败")); }
          } catch (error) { if (!isCurrentProject(projectId)) { resolve(); return; } stemJobRef.current = null; setJobId(null); reject(error instanceof Error ? error : new Error("伴奏任务状态读取失败")); }
        };
        void poll();
      } catch (error) { reject(error instanceof Error ? error : new Error("伴奏任务不可用，请确认已安装本地运行包")); }
    })();
  });

  const handleNcm = async (file: File) => {
    try { await startStemJob({ inputBase64: await readFileAsBase64(file), fileName: file.name }); }
    catch (error) { setNcmStatus(error instanceof Error ? error.message : "读取 .ncm 文件失败"); }
  };

  const handleCurrentSong = async () => {
    if ((currentProject.source ?? "netease") !== "netease") { setNcmStatus("当前歌曲来自其他平台，请使用“导入音频”选择本地伴奏"); return; }
    setNcmStatus("正在获取当前歌曲下载地址…");
    try {
      const sourceUrl = await resolveStudioSourceUrl(currentProject);
      if (!isCurrentProject(currentProject.id)) return;
      const fileName = `${currentProject.title.replace(/[\\/:*?"<>|]/g, "_")}.mp3`;
      await startStemJob({ sourceUrl, fileName });
    } catch (error) { if (isCurrentProject(currentProject.id)) setNcmStatus(error instanceof Error ? error.message : "无法获取当前歌曲"); }
  };

  const restoreCachedInstrumental = async (): Promise<boolean> => {
    const cached = await invokeNative<{ name?: string; mimeType?: string; base64?: string } | null>("studio_cache_read", {
      cacheId: instrumentalCacheId(currentProject),
    });
    if (!isCurrentProject(currentProject.id)) return true;
    if (!cached?.base64) return false;
    const bytes = Uint8Array.from(atob(cached.base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], cached.name || `${currentProject.title}-伴奏.wav`, { type: cached.mimeType || "audio/wav" });
    await importAudio(file);
    if (!isCurrentProject(currentProject.id)) return true;
    setStemProgress(1);
    setNcmStatus("已使用缓存伴奏");
    return true;
  };

  const importVocalReference = async (file?: File) => {
    if (loadingVocals || jobId) return;
    setLoadingVocals(true);
    const projectId = currentProject.id;
    try {
      if (!file) {
        const cached = await invokeNative<{ name: string; mimeType: string; base64: string } | null>("studio_cache_read", { cacheId: instrumentalCacheId(currentProject), stem: "vocals" });
        if (!isCurrentProject(projectId)) return;
        if (cached?.base64) {
          const trackId = addReferenceTrack("vocals");
          if (trackId) await importAudio(new File([Uint8Array.from(atob(cached.base64), ch => ch.charCodeAt(0))], cached.name, { type: cached.mimeType }), trackId);
          setNcmStatus("已导入缓存原曲人声，默认静音，点击 S 独奏试听");
          return;
        }
        if (currentProject.source !== "netease") throw new Error("尚无人声缓存，请点击“本地提取”选择对应的原曲文件");
        setNcmStatus("旧缓存仅有伴奏，正在提取原曲人声…");
        const sourceUrl = await resolveStudioSourceUrl(currentProject);
        if (!isCurrentProject(projectId)) return;
        await startStemJob({ sourceUrl, fileName: `${currentProject.title.replace(/[\\/:*?"<>|]/g, "_")}.mp3` }, "vocals");
      } else {
        await startStemJob({ inputBase64: await readFileAsBase64(file), fileName: file.name }, "vocals");
      }
    } catch (error) { if (isCurrentProject(projectId)) setNcmStatus(error instanceof Error ? error.message : "无法提取原曲人声"); }
    finally { setLoadingVocals(false); }
  };

  useEffect(() => {
    if (autoPrepareRef.current === currentProject.id || lastAsset(currentProject.tracks.find((track) => track.id === "instrumental")?.assets ?? [])) return;
    autoPrepareRef.current = currentProject.id;
    void (async () => {
      try {
        if (await restoreCachedInstrumental()) return;
      } catch {
        // A stale or unreadable cache falls through to a fresh preparation.
      }
      if (!isCurrentProject(currentProject.id)) return;
      if ((currentProject.source ?? "netease") !== "netease") {
        setNcmStatus("当前歌曲不是网易云来源，请导入本地伴奏");
        return;
      }
      await handleCurrentSong();
    })();
  }, [currentProject.id]);

  const cancelNcm = async () => {
    if (!jobId) return;
    try {
      await invokeNative("studio_cancel_job", { jobId });
      setNcmStatus("已取消伴奏任务");
      setJobId(null);
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "取消任务失败"); }
  };

  const waitForAssetWrites = async (projectId: string) => {
    const writes = [...assetWritesRef.current.entries()].filter(([key]) => key.startsWith(`${projectId}:`)).map(([, promise]) => promise);
    if (writes.length) await Promise.all(writes);
  };
  const normalizeSelectedTrack = async () => {
    if (!selectedTrack || processingTrack) return;
    if (selectedTrack.normalizationGain != null) { updateTrack(selectedTrack.id, { normalizationGain: undefined }); return; }
    const snapshot = currentProject, track = selectedTrack;
    setProcessingTrack(true);
    try {
      const gain = await normalizationGain(snapshot, track.id);
      if (isCurrentProject(snapshot.id)) { updateTrack(track.id, { normalizationGain: gain }); setNcmStatus(`${track.name} 已归一化至 −1 dB 输入峰值`); }
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "归一化失败"); }
    finally { setProcessingTrack(false); }
  };
  const denoiseSelectedTrack = async (strength: number) => {
    if (!selectedTrack || processingTrack) return;
    const snapshot = currentProject, track = selectedTrack;
    const originals = track.clips.map((clip) => ({ ...clip, assetId: track.denoiseOriginalAssets?.[clip.assetId] ?? clip.assetId }));
    setProcessingTrack(true); engineRef.current?.pause();
    setNcmStatus("正在降噪，原始音频会保留…");
    try {
      await waitForAssetWrites(snapshot.id);
      const replacements = new Map<string, StudioAsset>();
      for (const assetId of new Set(originals.map((clip) => clip.assetId))) {
        const source = track.assets.find((asset) => asset.id === assetId);
        if (!source) throw new Error("降噪原始音频缺失");
        const encoded = await invokeNative<string>("studio_denoise_asset", { projectId: snapshot.id, assetId, strength });
        if (!isCurrentProject(snapshot.id)) return;
        const file = new File([Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))], `${source.name.replace(/\.[^.]+$/, "")} (降噪).wav`, { type: "audio/wav" });
        const asset = assetFromFile(file, source.durationSec);
        await invokeNative("studio_write_asset", { projectId: snapshot.id, assetId: asset.id, inputBase64: encoded });
        replacements.set(assetId, asset);
      }
      if (!isCurrentProject(snapshot.id)) return;
      updateTrack(track.id, { assets: [...track.assets, ...replacements.values()], denoiseOriginalAssets: Object.fromEntries([...replacements].map(([originalId, processed]) => [processed.id, originalId])), normalizationGain: undefined,
        clips: originals.map((clip) => ({ ...clip, assetId: replacements.get(clip.assetId)!.id })) });
      setNcmStatus("降噪完成，可在音轨调整中恢复降噪前的版本");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "降噪失败"); }
    finally { setProcessingTrack(false); }
  };
  const saveProject = async (): Promise<StudioProject | null> => {
    if (savingProject) return null;
    setSavingProject(true);
    setExitError(null);
    const snapshot = structuredClone(useStudioStore.getState().project ?? currentProject);
    try {
      await waitForAssetWrites(snapshot.id);
      await invokeNative("studio_save_project", { project: snapshot });
      persistedProjectIdsRef.current.add(snapshot.id);
      if (isCurrentProject(snapshot.id)) savedSnapshotRef.current = snapshot;
      try { localStorage.removeItem(`cove.studio.draft.${snapshot.id}`); } catch { /* native project remains authoritative */ }
      setSavedProjects((items) => {
        const next = { id: snapshot.id, title: snapshot.title, artist: snapshot.artist };
        return [next, ...items.filter((item) => item.id !== next.id)];
      });
      setNcmStatus("工程已保存到本地");
      return snapshot;
    } catch (error) { const message = error instanceof Error ? error.message : "工程保存失败，请检查应用数据目录权限"; setNcmStatus(message); setExitError(message); return null; }
    finally { setSavingProject(false); }
  };
  const exportFile = async (extension: "wav" | "mp3" | "cove-studio") => {
    if (useStudioStore.getState().recordingTrackId) { setNcmStatus("请先停止录音，等待音轨保存后再导出"); return; }
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(true);
    setExportMenuOpen(false);
    const snapshot = currentProject;
    try {
      await waitForAssetWrites(snapshot.id);
      let encoded: string | undefined;
      if (extension === "cove-studio") {
        setNcmStatus("正在打包工程…");
        persistedProjectIdsRef.current.add(snapshot.id);
        setSavedProjects((items) => [{ id: snapshot.id, title: snapshot.title, artist: snapshot.artist }, ...items.filter((item) => item.id !== snapshot.id)]);
        await waitForAssetWrites(snapshot.id);
        await invokeNative("studio_save_project", { project: snapshot });
        if (isCurrentProject(snapshot.id)) savedSnapshotRef.current = structuredClone(snapshot);
        const path = await invokeNative<string | null>("studio_export_package_to_file", { projectId: snapshot.id, fileName: `${snapshot.title}.cove-studio` });
        setNcmStatus(path ? `工程包已导出到：${path}` : "已取消导出");
        return;
      } else {
        setNcmStatus(extension === "mp3" ? "正在渲染 320 kbps MP3…" : "正在离线渲染混音…");
        const wav = await renderStudioMix(snapshot);
        encoded = await readBlobAsBase64(wav);
        if (extension === "mp3") encoded = await invokeNative<string>("studio_encode_mp3", { projectId: snapshot.id, inputBase64: encoded });
      }
      if (!encoded) throw new Error("导出数据为空");
      setNcmStatus("请选择导出文件夹和文件名…");
      const path = await invokeNative<string | null>("studio_save_export", {
        fileName: `${snapshot.title}-翻唱.${extension}`,
        extension,
        inputBase64: encoded,
      });
      setNcmStatus(path ? `已导出到：${path}` : "已取消导出");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "导出失败"); }
    finally { exportBusyRef.current = false; setExporting(false); }
  };

  const playMixInPlayer = async () => {
    if (useStudioStore.getState().recordingTrackId) { setNcmStatus("请先停止录音，等待音轨保存后再播放翻唱"); return; }
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(true);
    setExportMenuOpen(false);
    const snapshot = currentProject;
    let audioUrl: string | null = null;
    try {
      engineRef.current?.pause();
      setPlaying(false);
      setNcmStatus("正在准备播放器音频…");
      const wav = await renderStudioMix(snapshot);
      audioUrl = URL.createObjectURL(wav);
      await onPlayInPlayer(audioUrl, snapshot);
      audioUrl = null;
    } catch (error) {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setNcmStatus(error instanceof Error ? error.message : "无法切换到播放器");
    } finally {
      exportBusyRef.current = false;
      setExporting(false);
    }
  };

  const commitProjectRename = () => {
    const next = projectTitleDraft.trim();
    if (next) {
      updateProjectTitle(next);
      if (persistedProjectIdsRef.current.has(currentProject.id)) {
        setSavedProjects((items) => items.map((item) => item.id === currentProject.id ? { ...item, title: next } : item));
      }
    }
    else setProjectTitleDraft(currentProject.title);
    setRenamingProject(false);
  };

  const timelineProgress = Math.min(100, Math.max(0, (currentTime / Math.max(projectDuration, 1)) * 100));
  const playheadLeft = `${timelineProgress}%`;
  const hasRenderableAudio = hasAudibleClips(currentProject);

  return <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950/90 text-white">
    <header ref={headerMenuRef} data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
      <button type="button" disabled={Boolean(recordingTrackId) || processingTrack || exporting} title={recordingTrackId ? "请先停止录音" : "返回播放器"} onClick={() => { engineRef.current?.pause(); setExitError(null); setExitPromptOpen(true); }} className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-40" aria-label="返回播放器"><ArrowLeft size={18} /></button>
      {currentProject.coverUrl ? <img src={currentProject.coverUrl} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Disc3 size={18} /></div>}
      <div className="min-w-0 flex-1">{renamingProject ? <input autoFocus value={projectTitleDraft} onChange={(event) => setProjectTitleDraft(event.target.value)} onBlur={commitProjectRename} onKeyDown={(event) => { if (event.key === "Enter") commitProjectRename(); if (event.key === "Escape") { setProjectTitleDraft(currentProject.title); setRenamingProject(false); } }} aria-label="工程名称" className="no-drag w-full max-w-xs rounded-lg bg-white/10 px-2 py-1 text-sm font-bold text-white outline-none ring-1 ring-lime-200/50" /> : <div className="flex min-w-0 items-center gap-1"><h1 className="truncate text-sm font-bold">{currentProject.title}</h1><button type="button" onClick={() => { setProjectTitleDraft(currentProject.title); setRenamingProject(true); }} className="no-drag shrink-0 rounded p-1 text-white/35 transition hover:bg-white/10 hover:text-white/80" aria-label="重命名工程" title="重命名工程"><Pencil size={12} /></button></div>}<p className="truncate text-xs text-white/45">{currentProject.artist} · 翻唱工作室</p></div>
      <button type="button" disabled={savingProject || Boolean(recordingTrackId)} onClick={() => void saveProject()} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15 disabled:opacity-40"><Save size={14} />{savingProject ? "保存中…" : "保存"}</button>
      <div className="relative no-drag">
        <button type="button" disabled={Boolean(recordingTrackId) || savingProject || exporting || processingTrack} title={recordingTrackId ? "请先停止录音" : undefined} aria-haspopup="menu" aria-expanded={projectMenuOpen} onClick={() => { setProjectMenuOpen((open) => !open); setMicMenuOpen(false); setExportMenuOpen(false); }} className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/75 transition hover:bg-white/15 disabled:opacity-40"><span>工程</span><ChevronDown size={14} className={`transition-transform ${projectMenuOpen ? "rotate-180" : ""}`} /></button>
        {projectMenuOpen && <div role="menu" className="absolute right-0 top-full z-[100] mt-2 max-h-60 w-64 overflow-y-auto rounded-xl border border-white/12 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <p className="px-3 pt-2 text-[10px] text-white/35">打开本地工程</p>
          <button type="button" role="menuitem" onClick={() => void importProjectPackage()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-lime-100/80 hover:bg-lime-200/10"><Upload size={13} />导入 .cove-studio 工程包</button>
          <p className="px-3 pb-2 text-[10px] leading-relaxed text-white/25">新工程点击“保存”后才会出现在这里</p>
          {savedProjects.length === 0 ? <div className="px-3 py-3 text-xs text-white/40">暂无已保存工程</div> : savedProjects.map((item) => <div key={item.id} className="group flex items-center gap-1 rounded-lg transition hover:bg-white/10"><button type="button" role="menuitem" onClick={() => void openSavedProject(item.id)} className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left"><span className="w-full truncate text-xs font-bold text-white/80">{item.title}</span><span className="w-full truncate text-[10px] text-white/40">{item.artist}</span></button><button type="button" onClick={() => void deleteSavedProject(item.id)} className="mr-1 rounded p-1.5 text-white/25 opacity-0 transition hover:bg-red-400/15 hover:text-red-200 group-hover:opacity-100" aria-label={`删除工程 ${item.title}`} title="删除工程"><Trash2 size={13} /></button></div>)}
          <div className="mt-1 border-t border-white/10 pt-1"><button type="button" role="menuitem" onClick={() => { setProjectMenuOpen(false); void deleteCurrentProject(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-200/80 hover:bg-red-400/10"><Trash2 size={13} />删除当前工程</button></div>
        </div>}
      </div>
      <div className="relative no-drag">
        <button type="button" disabled={exporting || Boolean(recordingTrackId)} title={recordingTrackId ? "请先停止录音，等待音轨保存后再导出" : undefined} aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => { setExportMenuOpen((open) => !open); setProjectMenuOpen(false); setMicMenuOpen(false); }} className="flex items-center gap-2 rounded-xl bg-lime-200 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-lime-100 disabled:opacity-60"><Download size={14} />{exporting ? "正在导出…" : "导出"}<ChevronDown size={14} /></button>
        {exportMenuOpen && <div role="menu" aria-label="导出格式" className="absolute right-0 top-full z-[100] mt-2 w-60 rounded-xl border border-white/12 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <button type="button" role="menuitem" disabled={exporting || !hasRenderableAudio} onClick={() => void playMixInPlayer()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-lime-200/10 disabled:cursor-not-allowed disabled:opacity-50"><Play size={14} fill="currentColor" className="text-lime-200" /><span className="min-w-0 flex-1"><span className="block text-xs font-bold text-white/90">在播放器中播放翻唱</span><span className="mt-0.5 block text-[10px] text-white/40">{hasRenderableAudio ? "沿用原歌曲封面、歌名和歌词" : "请先导入伴奏或录音"}</span></span></button>
          <div className="my-1 border-t border-white/10" />
          {([
            ["wav", "WAV 音频", "24-bit · 无损混音"],
            ["mp3", "MP3 音频", "320 kbps · 便于分享"],
            ["cove-studio", "工作室工程包", "包含音轨和效果设置"],
          ] as const).map(([format, label, detail]) => <button type="button" role="menuitem" key={format} onClick={() => void exportFile(format)} className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-white/10"><span className="text-xs font-bold text-white/85">{label}</span><span className="text-[10px] text-white/40">{detail}</span></button>)}
          <p className="mt-1 border-t border-white/10 px-3 pt-2 pb-1 text-[10px] text-white/35">导出时选择保存位置</p>
        </div>}
      </div>
    </header>
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r border-white/10 p-4">
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-black tracking-[0.16em] text-white/35">轨道</span><div className="flex items-center gap-1"><button type="button" onClick={addVocalTrack} className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[11px] font-bold text-white/70 hover:bg-white/15"><Plus size={13} />人声轨</button><button type="button" onClick={() => void importOriginalCurrentSong()} className="rounded-lg bg-amber-300/15 px-2 py-1 text-[11px] font-bold text-amber-100/80 hover:bg-amber-300/25">原曲</button><label className="cursor-pointer rounded-lg bg-white/8 px-2 py-1 text-[11px] font-bold text-white/55 hover:bg-white/15" title="选择本地原曲文件">本地<input type="file" accept="audio/*,.wav,.mp3,.flac" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importOriginalFile(file); event.currentTarget.value = ""; }} /></label></div></div>
        <div className="flex items-center gap-2"><button disabled={loadingVocals || Boolean(jobId) || Boolean(recordingTrackId)} onClick={() => void importVocalReference()} className="flex-1 rounded-lg bg-amber-300/10 px-2 py-1.5 text-[11px] font-bold text-amber-100 disabled:opacity-40">{loadingVocals ? "正在提取人声…" : "原曲人声参考"}</button><label className="cursor-pointer rounded-lg bg-white/8 px-2 py-1.5 text-[11px] text-white/55">本地提取<input disabled={loadingVocals || Boolean(jobId) || Boolean(recordingTrackId)} type="file" accept="audio/*,.ncm,.mp3,.flac,.wav" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importVocalReference(file); event.currentTarget.value = ""; }} /></label></div>
        <div className="space-y-2">{currentProject.tracks.map((track) => <TrackRow key={track.id} track={track} selected={track.id === selectedTrackId} onSelect={() => setSelectedTrackId(track.id)} onMixer={(patch) => updateMixer(track.id, patch)} onRename={(name) => renameTrack(track.id, name)} onDelete={() => removeTrack(track.id)} />)}</div>
        <div className="mt-auto space-y-2 rounded-2xl border border-white/8 bg-white/[0.035] p-3">
          <p className="text-[10px] font-black tracking-[0.15em] text-white/35">伴奏输入</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/15"><Upload size={14} />导入音频<input type="file" accept="audio/*,.wav,.mp3,.flac" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importAudio(file); event.currentTarget.value = ""; }} /></label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs font-bold text-white/55 hover:bg-white/8"><Upload size={14} />选择 .ncm 生成伴奏<input type="file" accept=".ncm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleNcm(file); event.currentTarget.value = ""; }} /></label>
          {(currentProject.source ?? "netease") === "netease" && <button type="button" disabled={Boolean(jobId)} onClick={() => void handleCurrentSong()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-lime-200/20 bg-lime-200/[0.06] px-3 py-1.5 text-[11px] font-bold text-lime-100/70 transition hover:bg-lime-200/10 hover:text-lime-100 disabled:cursor-wait disabled:opacity-40" title="重新下载当前歌曲并生成伴奏"><RotateCcw size={13} className={jobId ? "animate-spin" : ""} />{jobId ? "正在重新转换…" : "重新导入并转换当前歌曲"}</button>}
          {ncmStatus && <div className="space-y-2 rounded-xl border border-white/8 bg-black/15 p-2.5"><div className="flex items-start gap-2"><p className="min-w-0 flex-1 break-words text-[10px] leading-relaxed text-white/55">{ncmStatus}{jobId ? ` · ${stemStage}` : ""}</p>{jobId && <button type="button" onClick={() => void cancelNcm()} className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/15">取消</button>}</div><div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="伴奏准备进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stemProgress * 100)}><div className={`h-full rounded-full bg-lime-200 transition-[width] duration-500 ${stemIndeterminate ? "animate-pulse" : ""}`} style={{ width: `${Math.max(2, stemProgress * 100)}%` }} /></div></div>}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-[328px] flex-1 flex-col p-5">
          <div className="relative min-h-60 flex-1 rounded-3xl border border-white/10 bg-black/20">
            <div ref={timelineRef} role="slider" tabIndex={0} aria-label="时间线播放头" aria-disabled={Boolean(recordingTrackId)}
              aria-valuemin={0} aria-valuemax={Math.max(projectDuration, 1)} aria-valuenow={Math.round(currentTime * 100) / 100}
              onPointerDown={(event) => {
                if (recordingTrackId || event.button !== 0 || (event.target as HTMLElement).closest("button, [role=button]")) return;
                beginScrub(); timelineDraggingRef.current = true; setTimelineDragging(true); seekTimelineFromPointer(event.clientX);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || recordingTrackId) return;
                const step = event.shiftKey ? 10 : 1;
                if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); seekTo(currentTime + (event.key === "ArrowLeft" ? -step : step)); }
              }}
              className={`absolute inset-x-4 inset-y-3 touch-none select-none ${timelineDragging ? "cursor-grabbing" : "cursor-crosshair"}`}>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 top-12 flex justify-between" aria-hidden="true">{[0, 1, 2, 3, 4].map((tick) => <span key={tick} className="w-px bg-white/5" />)}</div>
              <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-between text-[10px] font-mono text-white/30"><span>0:00</span><span>{formatTime(projectDuration / 2)}</span><span>{formatTime(projectDuration)}</span></div>
              <div className="absolute inset-x-0 bottom-0 top-12 space-y-3 overflow-y-auto py-1 [scrollbar-width:thin]" aria-label="音轨片段">
                {currentProject.tracks.map((track) => <div key={track.id} className="space-y-1" onClick={() => setSelectedTrackId(track.id)}>
                  <p className="truncate text-[10px] font-bold text-white/40">{track.name}</p>
                  <div className="relative h-12 rounded-lg bg-white/[0.035]">
                    {track.clips.length === 0 && <span className="pointer-events-none flex h-full items-center px-3 text-[10px] text-white/20">暂无音频</span>}
                    {track.clips.map((clip) => {
                      const asset = track.assets.find((item) => item.id === clip.assetId);
                      const placed = scheduledClip(clip, asset ?? { durationSec: clip.offsetSec + clip.durationSec }, track);
                      const left = (placed.startSec / Math.max(projectDuration, 1)) * 100;
                      const width = (placed.durationSec / Math.max(projectDuration, 1)) * 100;
                      return <div key={clip.id} role="button" tabIndex={0} aria-label={`音频片段 ${track.name}`}
                        title={`${asset?.name ?? "音频片段"} · ${formatTime(clip.startSec)} · ${formatTime(clip.durationSec)}`}
                        onClick={(event) => { event.stopPropagation(); setSelectedTrackId(track.id); }}
                        onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); event.currentTarget.focus(); beginClipDrag(track.id, clip, "move", event.clientX); }}
                        onKeyDown={(event) => { if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (!recordingTrackId) removeClip(track.id, clip.id); } }}
                        className={`group absolute inset-y-1 z-[2] min-w-1 rounded-lg border ${track.id === selectedTrackId ? "border-lime-200/40 bg-slate-800" : "border-white/15 bg-slate-900"} cursor-grab active:cursor-grabbing`}
                        style={{ left: `${left}%`, width: `${width}%` }}>
                        <span className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-2 px-3 text-[10px] text-white/65"><span className="truncate">{asset?.name ?? track.name}</span><span className="shrink-0 font-mono text-white/35">{formatTime(clip.durationSec)}</span></span>
                        <button type="button" aria-label="调整片段起点" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); beginClipDrag(track.id, clip, "left", event.clientX); }} className="absolute inset-y-0 left-0 z-10 w-2 cursor-ew-resize rounded-l-lg bg-lime-200/15 transition hover:bg-lime-200/60" />
                        <button type="button" aria-label="调整片段结尾" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); beginClipDrag(track.id, clip, "right", event.clientX); }} className="absolute inset-y-0 right-0 z-10 w-2 cursor-ew-resize rounded-r-lg bg-lime-200/15 transition hover:bg-lime-200/60" />
                        <button type="button" aria-label="删除片段" disabled={Boolean(recordingTrackId)} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); removeClip(track.id, clip.id); }} className="absolute right-2 top-1 z-20 grid h-5 w-5 place-items-center rounded bg-slate-950 text-red-200 opacity-0 transition group-hover:opacity-100 focus:opacity-100">×</button>
                      </div>;
                    })}
                  </div>
                </div>)}
              </div>
              <div className="pointer-events-none absolute bottom-0 top-2 z-10 w-px -translate-x-1/2 bg-lime-200/75" style={{ left: playheadLeft }} />
              <button type="button" aria-label="拖拽时间线播放头" disabled={Boolean(recordingTrackId)}
                onPointerDown={(event) => { if (event.button !== 0) return; event.stopPropagation(); event.preventDefault(); beginScrub(); timelineDraggingRef.current = true; setTimelineDragging(true); seekTimelineFromPointer(event.clientX); }}
                className={`absolute -top-1 z-20 grid h-6 w-6 -translate-x-1/2 touch-none place-items-center ${timelineDragging ? "cursor-grabbing" : "cursor-grab"}`} style={{ left: playheadLeft }}><span className="h-3 w-3 rounded-full bg-lime-200" /></button>
            </div>
          </div>
          <div className="mt-4 flex shrink-0 flex-wrap items-center gap-3" aria-label="播放控制">
            <button type="button" aria-label={isPlaying || scrubPlaying ? "暂停工作室播放" : "播放工作室"} disabled={Boolean(recordingTrackId)} onClick={() => void togglePlayback()} className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white text-slate-950 disabled:opacity-50">{isPlaying || scrubPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}</button>
            <button type="button" disabled={Boolean(recordingTrackId)} onClick={() => seekTo(0)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/70 hover:bg-white/15 disabled:opacity-50" aria-label="回到开头"><Square size={13} /></button>
            <span className="whitespace-nowrap font-mono text-xs text-white/55">{formatTime(currentTime)} / {formatTime(projectDuration)}</span>
            <input aria-label="工作室进度" disabled={Boolean(recordingTrackId)} type="range" min="0" max={Math.max(projectDuration, 1)} step="0.01" value={Math.min(currentTime, projectDuration || 1)}
              onPointerDown={beginScrub} onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) beginScrub(); }} onKeyUp={finishScrub} onBlur={finishScrub}
              onChange={(event) => seekTo(Number(event.target.value))} style={{ "--studio-progress": `${timelineProgress}%` } as React.CSSProperties} className="studio-progress-slider min-w-24 flex-1" />
            <label className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-white/45"><Headphones size={14} />耳机监听<input type="checkbox" checked={monitorInput} onChange={(event) => setMonitorInput(event.target.checked)} className="accent-lime-200" /></label>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-1 gap-4 border-t border-white/10 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="flex min-h-[190px] min-w-0 flex-1 flex-col rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3" aria-label="同步歌词">
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-black tracking-[0.15em] text-white/35">
              <span>同步歌词</span>
              <span className="font-mono tracking-normal text-white/25">{lyricIndex >= 0 ? `${lyricIndex + 1}/${currentProject.lyrics.length}` : "等待播放"}</span>
            </div>
            {lyricRows.length > 0 ? <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
              {lyricRows.map(({ line, index }) => {
                const active = index === lyricIndex;
                return <button key={`${index}-${line.time}`} type="button" onClick={() => { seekTo(line.time); }} className={`group w-full rounded-xl px-3 py-2 text-left transition ${active ? "bg-lime-200/10 ring-1 ring-lime-200/25" : "hover:bg-white/[0.04]"}`}>
                  <div className={`truncate text-sm font-bold leading-5 ${active ? "text-lime-100" : index < lyricIndex ? "text-white/35" : "text-white/60"}`}>{line.text || "♪"}</div>
                  {line.tr && <div className={`mt-0.5 truncate text-[11px] leading-4 ${active ? "text-lime-100/55" : "text-white/25"}`}>{line.tr}</div>}
                  <span className="sr-only">{formatTime(line.time)}</span>
                </button>;
              })}
            </div> : <div className="flex flex-1 items-center rounded-xl bg-white/[0.035] px-4 text-sm font-bold text-white/45">导入伴奏后开始录制，歌词会跟随原曲时间线</div>}
          </section>
          <div className="min-w-0 space-y-3">
            {selectedTrack && <EffectPanel track={selectedTrack} onChange={(effects) => updateEffects(selectedTrack.id, effects)} onReset={() => resetEffects(selectedTrack.id)} />}
            <StudioInputControls devices={devices} deviceId={inputDeviceId} deviceLabel={micLabel} menuOpen={micMenuOpen}
              onMenuChange={(open) => { setMicMenuOpen(open); if (open) setProjectMenuOpen(false); }} onDeviceChange={setInputDeviceId}
                level={micLevel} countdown={countdownEnabled} recording={Boolean(recordingTrackId)} saving={savingRecording}
              onCountdownChange={() => { const next = !countdownEnabled; setCountdownEnabled(next); try { localStorage.setItem(RECORD_COUNTDOWN_KEY, next ? "1" : "0"); } catch { /* optional preference */ } }}
              onRecord={() => { if (recordingTrackId) stopRecording(); else if (selectedTrack?.kind === "vocal") { setRecordingTrackId(selectedTrack.id); void startRecording(); } else setNcmStatus("请先添加并选择人声轨"); }} />
            <div className="flex items-center justify-between gap-2"><button disabled={!selectedTrack || Boolean(recordingTrackId)} onClick={() => setTrackToolsOpen(true)} className="shrink-0 rounded-lg bg-white/10 px-2.5 py-1.5 text-[11px] font-bold text-lime-100 disabled:opacity-40">音轨调整</button><div title="录音补偿：正数让录音提前，负数让录音延后"><SignedMilliseconds label="输入延迟" value={currentProject.inputLatencyMs} onChange={updateLatency} limit={5000} /></div></div>
          </div>
        </div>
      </main>
    </div>
    {trackToolsOpen && selectedTrack && <StudioTrackTools track={selectedTrack} busy={processingTrack} onClose={() => setTrackToolsOpen(false)} onPan={(pan) => updateMixer(selectedTrack.id, { pan })} onOffset={(offsetMs) => updateTrack(selectedTrack.id, { offsetMs })} onNormalize={() => void normalizeSelectedTrack()} onDenoise={(strength) => void denoiseSelectedTrack(strength)} onRestore={() => updateTrack(selectedTrack.id, { clips: selectedTrack.clips.map((clip) => ({ ...clip, assetId: selectedTrack.denoiseOriginalAssets?.[clip.assetId] ?? clip.assetId })), denoiseOriginalAssets: undefined, normalizationGain: undefined })} />}
    {exitPromptOpen && <div className="absolute inset-0 z-[240] grid place-items-center bg-black/60 p-5 backdrop-blur-sm" onKeyDown={(event) => { trapStudioDialogTab(event); if (event.key === "Escape" && !savingProject) setExitPromptOpen(false); }}><section role="dialog" aria-modal="true" aria-label="保存本次翻唱" className="w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl"><h2 className="text-base font-bold">返回前保存本次翻唱？</h2><p className="text-xs leading-6 text-white/55">保存音轨、效果和时间调整，之后可从“工程”继续编辑。不保存将放弃上次保存后的编辑。</p>{exitError && <p role="alert" className="text-xs text-red-200">{exitError}</p>}<div className="flex flex-wrap justify-end gap-2"><button autoFocus disabled={savingProject} onClick={() => setExitPromptOpen(false)} className="rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/10">取消</button><button disabled={savingProject} onClick={() => { try { localStorage.removeItem(`cove.studio.draft.${currentProject.id}`); } catch { /* optional recovery */ } onBack(structuredClone(savedSnapshotRef.current)); }} className="rounded-lg bg-white/10 px-3 py-2 text-xs">不保存返回</button><button disabled={savingProject} onClick={() => void saveProject().then((saved) => { if (saved) onBack(saved); })} className="rounded-lg bg-lime-200 px-3 py-2 text-xs font-bold text-slate-950">{savingProject ? "正在保存…" : "保存并返回"}</button></div></section></div>}
    {countdownValue !== null && <div className="pointer-events-none absolute inset-0 z-[200] grid place-items-center bg-slate-950/45 backdrop-blur-[2px]" role="status" aria-live="assertive"><div className="flex flex-col items-center gap-3"><div className="grid h-32 w-32 place-items-center rounded-full border border-lime-200/50 bg-slate-950/80 text-7xl font-black text-lime-100 shadow-[0_0_70px_rgba(190,242,100,.25)] animate-pulse">{countdownValue}</div><span className="rounded-full bg-black/40 px-4 py-1.5 text-xs font-bold tracking-[0.2em] text-white/70">准备录音</span></div></div>}
  </div>;
}
