import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Disc3, Download, Headphones, Mic2, Pause, Pencil, Play, Plus, Save, SlidersHorizontal, Square, Trash2, Upload, Volume2 } from "lucide-react";
import type { LyricsLine } from "./playerTypes";
import { invokeNative } from "../lib/native";
import { StudioAudioEngine } from "../lib/studioAudio";
import { renderStudioMix } from "../lib/studioExport";
import { StudioRecorder } from "../lib/studioRecorder";
import { useStudioStore } from "../studio/studioStore";
import type { StudioAsset, StudioEffects, StudioProject, StudioTrack } from "../studio/types";

type Props = {
  project: StudioProject;
  onBack: () => void;
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

function TrackRow({ track, selected, onSelect, onMixer, onDelete }: { track: StudioTrack; selected: boolean; onSelect: () => void; onMixer: (patch: Partial<StudioTrack["mixer"]>) => void; onDelete: () => void }) {
  const asset = lastAsset(track.assets);
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(); } }} className={`group flex min-h-24 w-full flex-col gap-2 rounded-2xl border p-3 text-left transition ${selected ? "border-white/30 bg-white/10" : "border-white/8 bg-white/[0.035] hover:bg-white/[0.07]"}`}>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full" style={{ background: track.color }} />
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-white/85">{track.name}</span>
        <span className="text-[10px] text-white/35">{track.kind === "instrumental" ? "伴奏" : track.kind === "reference" ? "参考" : `${track.takes.length} takes`}</span>
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

function EffectPanel({ track, onChange }: { track: StudioTrack; onChange: (effects: Partial<StudioEffects>) => void }) {
  const setEq = (key: keyof StudioEffects["eq"], value: number) => onChange({ eq: { ...track.effects.eq, [key]: value } });
  return <div className="space-y-2 rounded-2xl border border-white/8 bg-white/[0.025] p-3">
    <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-xs font-bold text-white/75"><SlidersHorizontal size={14} /> {track.name} 效果器</div><span className="rounded-full bg-white/8 px-2 py-0.5 text-[9px] text-white/35">实时</span></div>
    <div className="grid grid-cols-3 gap-2">{(["lowDb", "midDb", "highDb"] as const).map((key) => <label key={key} className="min-w-0 text-[10px] text-white/45"><span className="flex justify-between"><span>{key === "lowDb" ? "低频" : key === "midDb" ? "中频" : "高频"}</span><span className="font-mono text-white/30">{track.effects.eq[key].toFixed(1)}</span></span><input aria-label={key} type="range" min="-12" max="12" step="0.5" value={track.effects.eq[key]} onChange={(event) => setEq(key, Number(event.target.value))} className="w-full accent-lime-200" /></label>)}</div>
    <div className="grid grid-cols-3 gap-2 border-t border-white/8 pt-2"><label className="min-w-0 text-[10px] text-white/45">压缩 <input aria-label="压缩比例" type="range" min="1" max="12" step="0.5" value={track.effects.compressor.ratio} onChange={(event) => onChange({ compressor: { ...track.effects.compressor, ratio: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{track.effects.compressor.ratio.toFixed(1)}:1</span></label><label className="min-w-0 text-[10px] text-white/45">混响 <input aria-label="混响" type="range" min="0" max="1" step="0.01" value={track.effects.reverb.mix} onChange={(event) => onChange({ reverb: { ...track.effects.reverb, mix: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{Math.round(track.effects.reverb.mix * 100)}%</span></label><label className="min-w-0 text-[10px] text-white/45">延迟 <input aria-label="延迟" type="range" min="0" max="1" step="0.01" value={track.effects.delay.mix} onChange={(event) => onChange({ delay: { ...track.effects.delay, mix: Number(event.target.value) } })} className="w-full accent-lime-200" /><span className="block text-right font-mono text-white/30">{Math.round(track.effects.delay.mix * 100)}%</span></label></div>
  </div>;
}

export default function StudioWorkspace({ project, onBack, onPlayInPlayer }: Props) {
  const currentProject = useStudioStore((state) => state.project) ?? project;
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
  const addVocalTrack = useStudioStore((state) => state.addVocalTrack);
  const addReferenceTrack = useStudioStore((state) => state.addReferenceTrack);
  const updateMixer = useStudioStore((state) => state.updateMixer);
  const updateEffects = useStudioStore((state) => state.updateEffects);
  const addAssetToTrack = useStudioStore((state) => state.addAssetToTrack);
  const replaceAssetOnTrack = useStudioStore((state) => state.replaceAssetOnTrack);
  const removeTrack = useStudioStore((state) => state.removeTrack);
  const updateLatency = useStudioStore((state) => state.updateLatency);
  const engineRef = useRef<StudioAudioEngine | null>(null);
  const audioRefs = useRef(new Map<string, HTMLAudioElement>());
  const audioStartRefs = useRef(new Map<string, number>());
  const recorderRef = useRef<StudioRecorder | null>(null);
  const recordStartRef = useRef(0);
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
  const waveformRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const timelineDraggingRef = useRef(false);
  const [timelineDragging, setTimelineDragging] = useState(false);
  const [renamingProject, setRenamingProject] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState(project.title);

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
    useStudioStore.getState().setProject(project);
    engineRef.current = new StudioAudioEngine();
    return () => engineRef.current?.dispose();
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
    try {
      const loaded = await invokeNative<StudioProject>("studio_load_project", { projectId: id });
      for (const track of loaded.tracks) for (const asset of track.assets) {
        const encoded = await invokeNative<string>("studio_read_asset", { projectId: loaded.id, assetId: asset.id });
        asset.url = base64Url(encoded, asset.mimeType);
      }
      persistedProjectIdsRef.current.add(loaded.id);
      setProject(loaded); setSelectedTrackId("instrumental"); setProjectMenuOpen(false); setNcmStatus("已打开本地工程");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "无法打开工程"); }
  };
  const deleteSavedProject = async (id: string) => {
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

  const attachAudio = useCallback((id: string, element: HTMLAudioElement | null, startSec = 0) => {
    if (!element) return;
    audioRefs.current.set(id, element);
    audioStartRefs.current.set(id, startSec);
    engineRef.current?.attach(id, element, startSec);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (engine) {
      for (const [id, element] of audioRefs.current) engine.attach(id, element, audioStartRefs.current.get(id) ?? 0);
    }
    engine?.updateAll(currentProject.tracks);
  }, [currentProject.tracks]);

  useEffect(() => {
    if (!persistedProjectIdsRef.current.has(currentProject.id)) return;
    const timer = window.setTimeout(() => {
      try { localStorage.setItem(`cove.studio.${currentProject.id}`, JSON.stringify(currentProject)); } catch { /* storage quota is non-fatal */ }
      void invokeNative("studio_save_project", { project: currentProject }).catch(() => undefined);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [currentProject]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const clock = audioRefs.current.get("instrumental")?.currentTime ?? currentTime;
      setCurrentTime(clock);
      if (clock >= currentProject.durationSec && currentProject.durationSec > 0) { engineRef.current?.pause(); setPlaying(false); }
    }, 50);
    return () => window.clearInterval(timer);
  }, [currentProject.durationSec, currentTime, isPlaying, setCurrentTime, setPlaying]);

  const seekTimelineFromPointer = useCallback((clientX: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = Math.min(1, Math.max(0, (clientX - bounds.left) / bounds.width));
    const value = ratio * Math.max(currentProject.durationSec, 1);
    engineRef.current?.seek(value);
    setCurrentTime(Math.min(value, currentProject.durationSec || value));
  }, [currentProject.durationSec, setCurrentTime]);

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

  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const canvas = waveformRef.current;
      if (canvas) {
        const bounds = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const width = Math.max(1, Math.round(bounds.width * dpr));
        const height = Math.max(1, Math.round(bounds.height * dpr));
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, width, height);
          const samples = engineRef.current?.waveform() ?? new Uint8Array(0);
          const bars = Math.max(36, Math.floor(bounds.width / 7));
          const barWidth = width / bars;
          const phase = performance.now() / 900;
          for (let i = 0; i < bars; i += 1) {
            const sample = samples.length ? Math.abs(samples[Math.floor(i / bars * samples.length)] - 128) / 128 : 0.12 + Math.abs(Math.sin(phase + i * 0.32)) * 0.12;
            const motion = isPlaying ? 1 + Math.abs(Math.sin(phase * 2 + i * 0.18)) * 0.35 : 0.72;
            const barHeight = Math.max(3 * dpr, sample * height * 1.5 * motion);
            const progress = currentProject.durationSec ? currentTime / currentProject.durationSec : 0;
            const played = i / bars <= progress;
            ctx.fillStyle = played ? "rgba(190,242,100,.82)" : "rgba(255,255,255,.20)";
            ctx.beginPath(); ctx.roundRect(i * barWidth + 1, (height - barHeight) / 2, Math.max(1, barWidth - 2), barHeight, 2 * dpr); ctx.fill();
          }
        }
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [currentProject.durationSec, currentTime, isPlaying]);

  const togglePlayback = async () => {
    if (isPlaying) { engineRef.current?.pause(); setPlaying(false); return; }
    engineRef.current?.seek(currentTime);
    await engineRef.current?.play(currentTime);
    setPlaying(true);
  };

  const importAudio = async (file: File, trackId = "instrumental", startSec = 0) => {
    const probe = document.createElement("audio");
    probe.src = URL.createObjectURL(file);
    await new Promise<void>((resolve) => { probe.onloadedmetadata = () => resolve(); probe.onerror = () => resolve(); });
    const durationSec = Number.isFinite(probe.duration) ? probe.duration : currentProject.durationSec;
    const asset = assetFromFile(file, durationSec);
    const targetTrack = currentProject.tracks.find((track) => track.id === trackId);
    if (trackId === "instrumental" || targetTrack?.kind === "reference" || trackId.startsWith("reference-")) replaceAssetOnTrack(trackId, asset, startSec);
    else addAssetToTrack(trackId, asset, undefined, startSec);
    void readFileAsBase64(file).then((inputBase64) => invokeNative("studio_write_asset", { projectId: currentProject.id, assetId: asset.id, inputBase64 })).catch(() => undefined);
    if (trackId === "instrumental" && durationSec > 0 && currentProject.durationSec === 0) setProject({ ...useStudioStore.getState().project!, durationSec });
    setSelectedTrackId(trackId);
  };

  const importOriginalFile = async (file: File) => {
    const trackId = addReferenceTrack();
    if (!trackId) { setNcmStatus("无法创建原曲参考音轨"); return; }
    try {
      await importAudio(file, trackId);
      setSelectedTrackId(trackId);
      setNcmStatus("原曲已导入参考音轨（默认静音）");
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
    setNcmStatus("正在下载当前歌曲原曲…");
    try {
      let sourceUrl = currentProject.sourceUrl;
      if (!sourceUrl || !sourceUrl.startsWith("https://")) {
        const result = await invokeNative<{ data?: { url?: string | null } }>("netease_song_url", { args: { id: Number(currentProject.songId), level: "exhigh" } });
        sourceUrl = result.data?.url ?? undefined;
      }
      if (!sourceUrl) throw new Error("当前歌曲没有可用的原曲下载地址");
      const fileName = `${currentProject.title.replace(/[\\/:*?"<>|]/g, "_")}.mp3`;
      const audio = await invokeNative<{ name?: string; mimeType?: string; base64?: string }>("studio_download_source", { sourceUrl, fileName });
      if (!audio.base64) throw new Error("原曲下载内容为空");
      const bytes = Uint8Array.from(atob(audio.base64), (char) => char.charCodeAt(0));
      await importAudio(new File([bytes], audio.name || fileName, { type: audio.mimeType || "audio/mpeg" }), trackId);
      setSelectedTrackId(trackId);
      setNcmStatus("当前原曲已导入参考音轨（默认静音）");
    } catch (error) {
      setNcmStatus(error instanceof Error ? error.message : "下载原曲失败，请选择本地原曲文件");
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !engineRef.current) { setNcmStatus("当前 WebView 不支持麦克风录音"); return; }
    try {
      countdownAbortRef.current = false;
      const recorder = new StudioRecorder(engineRef.current.context);
      await recorder.prepare(inputDeviceId, 1, monitorInput);
      recorder.onDeviceLost(() => { setNcmStatus("麦克风已断开"); setRecordingTrackId(null); });
      recorderRef.current = recorder;
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
          if (countdownAbortRef.current) {
            recorder.dispose();
            recorderRef.current = null;
            setCountdownValue(null);
            return;
          }
        }
        setCountdownValue(null);
      }
    recordStartRef.current = currentTime;
    recorder.start((engineRef.current.context.currentTime ?? 0) + 0.05);
    setPlaying(true);
    await engineRef.current?.play(currentTime);
    setNcmStatus("正在录音，再次点击停止");
    } catch (error) {
      setNcmStatus(error instanceof Error ? error.message : "无法访问麦克风");
      setRecordingTrackId(null);
    }
  };

  const stopRecording = () => {
    if (!recorderRef.current && recordingTrackId) {
      countdownAbortRef.current = true;
      setRecordingTrackId(null);
      setNcmStatus("已取消录音准备");
      return;
    }
    if (countdownValue !== null) {
      countdownAbortRef.current = true;
      recorderRef.current?.dispose();
      recorderRef.current = null;
      setCountdownValue(null);
      setRecordingTrackId(null);
      setNcmStatus("已取消录音倒计时");
      return;
    }
    const recorder = recorderRef.current; recorderRef.current = null; engineRef.current?.pause(); setPlaying(false); setNcmStatus("正在保存录音 take…");
    if (recorder) void recorder.stop().then(async (blob) => { const file = new File([blob], `${currentProject.title}-${Date.now()}.wav`, { type: "audio/wav" }); await importAudio(file, recordingTrackId ?? selectedTrackId, Math.max(0, recordStartRef.current - currentProject.inputLatencyMs / 1000)); setRecordingTrackId(null); }).catch((error) => { setRecordingTrackId(null); setNcmStatus(error instanceof Error ? error.message : "保存录音失败"); });
  };

  const startStemJob = (input: { inputBase64?: string; sourceUrl?: string; fileName: string }) => new Promise<void>((resolve, reject) => {
    setNcmStatus("准备伴奏任务…");
    setStemStage("准备文件");
    setStemProgress(0.02);
    setStemIndeterminate(false);
    void (async () => {
      try {
        const started = await invokeNative<{ jobId: string }>("studio_prepare_instrumental", { args: { ...input, title: currentProject.title } });
        setJobId(started.jobId);
        const poll = async () => {
          try {
            const status = await invokeNative<{ state: string; stage: string; progress: number; outputPath?: string; error?: string; message?: string; elapsedSec?: number; indeterminate?: boolean }>("studio_job_status", { jobId: started.jobId });
            setStemStage(status.stage);
            setStemProgress(Math.max(0, Math.min(1, status.progress)));
            setStemIndeterminate(Boolean(status.indeterminate));
            const elapsed = typeof status.elapsedSec === "number" ? ` · 已用时 ${Math.floor(status.elapsedSec / 60)}:${String(Math.floor(status.elapsedSec % 60)).padStart(2, "0")}` : "";
            setNcmStatus(`${status.message ?? `${status.stage} ${Math.round(status.progress * 100)}%`}${elapsed}`);
            if (status.state === "running" || status.state === "queued") { window.setTimeout(() => void poll(), 800); return; }
            setJobId(null);
            if (status.state === "completed") {
              try {
                const audio = await invokeNative<{ name: string; base64: string }>("studio_job_audio", { jobId: started.jobId });
                const bytes = Uint8Array.from(atob(audio.base64), (char) => char.charCodeAt(0));
                await importAudio(new File([bytes], audio.name, { type: audio.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav" }));
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
                setStemProgress(1); setStemIndeterminate(false);
                setNcmStatus("伴奏已生成并缓存");
                resolve();
              } catch (error) { reject(error instanceof Error ? error : new Error(`伴奏已生成：${status.outputPath ?? "请导入输出文件"}`)); }
            } else reject(new Error(status.error ?? "伴奏任务失败"));
          } catch (error) { setJobId(null); reject(error instanceof Error ? error : new Error("伴奏任务状态读取失败")); }
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
      let sourceUrl = currentProject.sourceUrl;
      if (!sourceUrl) {
        const result = await invokeNative<{ data?: { url?: string | null } }>("netease_song_url", { args: { id: Number(currentProject.songId), level: "exhigh" } });
        sourceUrl = result.data?.url ?? undefined;
      }
      if (!sourceUrl) throw new Error("当前歌曲没有可用的网易云音频地址，请确认已登录且歌曲可播放");
      const fileName = `${currentProject.title.replace(/[\\/:*?"<>|]/g, "_")}.mp3`;
      await startStemJob({ sourceUrl, fileName });
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "无法获取当前歌曲"); }
  };

  const restoreCachedInstrumental = async (): Promise<boolean> => {
    const cached = await invokeNative<{ name?: string; mimeType?: string; base64?: string } | null>("studio_cache_read", {
      cacheId: instrumentalCacheId(currentProject),
    });
    if (!cached?.base64) return false;
    const bytes = Uint8Array.from(atob(cached.base64), (char) => char.charCodeAt(0));
    const file = new File([bytes], cached.name || `${currentProject.title}-伴奏.wav`, { type: cached.mimeType || "audio/wav" });
    await importAudio(file);
    setStemProgress(1);
    setNcmStatus("已使用缓存伴奏");
    return true;
  };

  useEffect(() => {
    if (autoPrepareRef.current === currentProject.id || lastAsset(currentProject.tracks.find((track) => track.id === "instrumental")?.assets ?? [])) return;
    autoPrepareRef.current = currentProject.id;
    let cancelled = false;
    void (async () => {
      try {
        if (await restoreCachedInstrumental() || cancelled) return;
      } catch {
        // A stale or unreadable cache falls through to a fresh preparation.
      }
      if (cancelled) return;
      if ((currentProject.source ?? "netease") !== "netease") {
        setNcmStatus("当前歌曲不是网易云来源，请导入本地伴奏");
        return;
      }
      await handleCurrentSong();
    })();
    return () => { cancelled = true; };
  }, [currentProject.id]);

  const cancelNcm = async () => {
    if (!jobId) return;
    try {
      await invokeNative("studio_cancel_job", { jobId });
      setNcmStatus("已取消伴奏任务");
      setJobId(null);
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "取消任务失败"); }
  };

  const saveProject = () => {
    persistedProjectIdsRef.current.add(currentProject.id);
    localStorage.setItem(`cove.studio.${currentProject.id}`, JSON.stringify(currentProject));
    setSavedProjects((items) => {
      const next = { id: currentProject.id, title: currentProject.title, artist: currentProject.artist };
      return [next, ...items.filter((item) => item.id !== next.id)];
    });
    void invokeNative("studio_save_project", { project: currentProject }).then(() => setNcmStatus("工程已保存到本地"), () => setNcmStatus("工程已保存到当前会话；本地工程目录不可用"));
  };
  const exportFile = async (extension: "wav" | "mp3" | "cove-studio") => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(true);
    setExportMenuOpen(false);
    const snapshot = currentProject;
    try {
      let encoded: string;
      if (extension === "cove-studio") {
        setNcmStatus("正在打包工程…");
        persistedProjectIdsRef.current.add(snapshot.id);
        setSavedProjects((items) => [{ id: snapshot.id, title: snapshot.title, artist: snapshot.artist }, ...items.filter((item) => item.id !== snapshot.id)]);
        await invokeNative("studio_save_project", { project: snapshot });
        encoded = await invokeNative<string>("studio_export_package", { projectId: snapshot.id });
      } else {
        setNcmStatus(extension === "mp3" ? "正在渲染 320 kbps MP3…" : "正在离线渲染混音…");
        const wav = await renderStudioMix(snapshot);
        encoded = await readBlobAsBase64(wav);
        if (extension === "mp3") encoded = await invokeNative<string>("studio_encode_mp3", { projectId: snapshot.id, inputBase64: encoded });
      }
      setNcmStatus("请选择导出文件夹和文件名…");
      const path = await invokeNative<string | null>("studio_save_export", {
        fileName: `${snapshot.title}${extension === "cove-studio" ? "" : "-翻唱"}.${extension}`,
        extension,
        inputBase64: encoded,
      });
      setNcmStatus(path ? `已导出到：${path}` : "已取消导出");
    } catch (error) { setNcmStatus(error instanceof Error ? error.message : "导出失败"); }
    finally { exportBusyRef.current = false; setExporting(false); }
  };

  const playMixInPlayer = async () => {
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

  const timelineProgress = Math.min(100, Math.max(0, (currentTime / Math.max(currentProject.durationSec, 1)) * 100));
  const playheadLeft = `clamp(8px, ${timelineProgress}%, calc(100% - 8px))`;
  const hasRenderableAudio = currentProject.tracks.some((track) => track.clips.some((clip) => track.assets.some((asset) => asset.id === clip.assetId)));

  return <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950/90 text-white">
    <header ref={headerMenuRef} data-tauri-drag-region className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
      <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white" aria-label="返回播放器"><ArrowLeft size={18} /></button>
      {currentProject.coverUrl ? <img src={currentProject.coverUrl} alt="" className="h-10 w-10 rounded-xl object-cover" /> : <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10"><Disc3 size={18} /></div>}
      <div className="min-w-0 flex-1">{renamingProject ? <input autoFocus value={projectTitleDraft} onChange={(event) => setProjectTitleDraft(event.target.value)} onBlur={commitProjectRename} onKeyDown={(event) => { if (event.key === "Enter") commitProjectRename(); if (event.key === "Escape") { setProjectTitleDraft(currentProject.title); setRenamingProject(false); } }} aria-label="工程名称" className="no-drag w-full max-w-xs rounded-lg bg-white/10 px-2 py-1 text-sm font-bold text-white outline-none ring-1 ring-lime-200/50" /> : <div className="flex min-w-0 items-center gap-1"><h1 className="truncate text-sm font-bold">{currentProject.title}</h1><button type="button" onClick={() => { setProjectTitleDraft(currentProject.title); setRenamingProject(true); }} className="no-drag shrink-0 rounded p-1 text-white/35 transition hover:bg-white/10 hover:text-white/80" aria-label="重命名工程" title="重命名工程"><Pencil size={12} /></button></div>}<p className="truncate text-xs text-white/45">{currentProject.artist} · 翻唱工作室</p></div>
      <label className="hidden items-center gap-2 text-xs text-white/45 lg:flex">输入延迟 <input type="text" inputMode="decimal" aria-label="输入延迟毫秒" value={currentProject.inputLatencyMs} onChange={(event) => { const value = event.target.value.replace(/[^0-9.-]/g, ""); if (value === "" || value === "-" || value === "." || /^-?\d*\.?\d*$/.test(value)) updateLatency(value === "" || value === "-" || value === "." ? 0 : Number(value)); }} className="studio-latency-input no-drag w-16 rounded-lg bg-white/8 px-2 py-1 text-right font-mono text-white outline-none transition focus:bg-white/12 focus:ring-1 focus:ring-lime-200/60" /> ms</label>
      <button type="button" onClick={saveProject} className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold hover:bg-white/15"><Save size={14} />保存</button>
      <div className="relative no-drag">
        <button type="button" aria-haspopup="menu" aria-expanded={projectMenuOpen} onClick={() => { setProjectMenuOpen((open) => !open); setMicMenuOpen(false); setExportMenuOpen(false); }} className="flex items-center justify-between gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/75 transition hover:bg-white/15"><span>工程</span><ChevronDown size={14} className={`transition-transform ${projectMenuOpen ? "rotate-180" : ""}`} /></button>
        {projectMenuOpen && <div role="menu" className="absolute right-0 top-full z-[100] mt-2 max-h-60 w-64 overflow-y-auto rounded-xl border border-white/12 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
          <p className="px-3 pt-2 text-[10px] text-white/35">打开本地工程</p>
          <p className="px-3 pb-2 text-[10px] leading-relaxed text-white/25">新工程点击“保存”后才会出现在这里</p>
          {savedProjects.length === 0 ? <div className="px-3 py-3 text-xs text-white/40">暂无已保存工程</div> : savedProjects.map((item) => <div key={item.id} className="group flex items-center gap-1 rounded-lg transition hover:bg-white/10"><button type="button" role="menuitem" onClick={() => void openSavedProject(item.id)} className="flex min-w-0 flex-1 flex-col items-start px-3 py-2 text-left"><span className="w-full truncate text-xs font-bold text-white/80">{item.title}</span><span className="w-full truncate text-[10px] text-white/40">{item.artist}</span></button><button type="button" onClick={() => void deleteSavedProject(item.id)} className="mr-1 rounded p-1.5 text-white/25 opacity-0 transition hover:bg-red-400/15 hover:text-red-200 group-hover:opacity-100" aria-label={`删除工程 ${item.title}`} title="删除工程"><Trash2 size={13} /></button></div>)}
          <div className="mt-1 border-t border-white/10 pt-1"><button type="button" role="menuitem" onClick={() => { setProjectMenuOpen(false); void deleteCurrentProject(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-red-200/80 hover:bg-red-400/10"><Trash2 size={13} />删除当前工程</button></div>
        </div>}
      </div>
      <div className="relative no-drag">
        <button type="button" disabled={exporting} aria-haspopup="menu" aria-expanded={exportMenuOpen} onClick={() => { setExportMenuOpen((open) => !open); setProjectMenuOpen(false); setMicMenuOpen(false); }} className="flex items-center gap-2 rounded-xl bg-lime-200 px-3 py-2 text-xs font-bold text-slate-950 transition hover:bg-lime-100 disabled:cursor-wait disabled:opacity-60"><Download size={14} />{exporting ? "正在导出…" : "导出"}<ChevronDown size={14} /></button>
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
        <div className="space-y-2">{currentProject.tracks.map((track) => <TrackRow key={track.id} track={track} selected={track.id === selectedTrackId} onSelect={() => setSelectedTrackId(track.id)} onMixer={(patch) => updateMixer(track.id, patch)} onDelete={() => removeTrack(track.id)} />)}</div>
        <div className="mt-auto space-y-2 rounded-2xl border border-white/8 bg-white/[0.035] p-3">
          <p className="text-[10px] font-black tracking-[0.15em] text-white/35">伴奏输入</p>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/15"><Upload size={14} />导入音频<input type="file" accept="audio/*,.wav,.mp3,.flac" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importAudio(file); event.currentTarget.value = ""; }} /></label>
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 px-3 py-2 text-xs font-bold text-white/55 hover:bg-white/8"><Upload size={14} />选择 .ncm 生成伴奏<input type="file" accept=".ncm" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void handleNcm(file); event.currentTarget.value = ""; }} /></label>
          {lastAsset(currentProject.tracks.find((track) => track.id === "instrumental")?.assets ?? []) && currentProject.source === "netease" && <button type="button" disabled={Boolean(jobId)} onClick={() => void handleCurrentSong()} className="flex w-full items-center justify-center rounded-xl border border-white/10 px-3 py-1.5 text-[11px] font-bold text-white/45 transition hover:bg-white/8 hover:text-white/75 disabled:cursor-wait disabled:opacity-40">重新生成伴奏</button>}
          {ncmStatus && <div className="space-y-2 rounded-xl border border-white/8 bg-black/15 p-2.5"><div className="flex items-start gap-2"><p className="min-w-0 flex-1 break-words text-[10px] leading-relaxed text-white/55">{ncmStatus}{jobId ? ` · ${stemStage}` : ""}</p>{jobId && <button type="button" onClick={() => void cancelNcm()} className="shrink-0 rounded bg-white/8 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/15">取消</button>}</div><div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="伴奏准备进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stemProgress * 100)}><div className={`h-full rounded-full bg-lime-200 transition-[width] duration-500 ${stemIndeterminate ? "animate-pulse" : ""}`} style={{ width: `${Math.max(2, stemProgress * 100)}%` }} /></div></div>}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col p-5">
          <div ref={timelineRef} role="slider" tabIndex={0} aria-label="时间线播放头" aria-valuemin={0} aria-valuemax={Math.max(currentProject.durationSec, 1)} aria-valuenow={Math.round(currentTime * 100) / 100} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; timelineDraggingRef.current = true; setTimelineDragging(true); seekTimelineFromPointer(event.clientX); }} onKeyDown={(event) => { const step = event.shiftKey ? 10 : 1; if (event.key === "ArrowLeft") { event.preventDefault(); seekTimelineFromPointer((timelineRef.current?.getBoundingClientRect().left ?? 0) + ((currentTime - step) / Math.max(currentProject.durationSec, 1)) * (timelineRef.current?.getBoundingClientRect().width ?? 0)); } if (event.key === "ArrowRight") { event.preventDefault(); seekTimelineFromPointer((timelineRef.current?.getBoundingClientRect().left ?? 0) + ((currentTime + step) / Math.max(currentProject.durationSec, 1)) * (timelineRef.current?.getBoundingClientRect().width ?? 0)); } }} className={`relative min-h-72 flex-1 overflow-hidden rounded-3xl border border-white/10 bg-black/20 ${timelineDragging ? "cursor-grabbing" : "cursor-crosshair"}`}>
            <div className="absolute inset-0 bg-[linear-gradient(90deg,transparent_0,transparent_calc(25%-1px),rgba(255,255,255,.05)_25%,transparent_calc(25%+1px),transparent_calc(50%-1px),rgba(255,255,255,.05)_50%,transparent_calc(50%+1px),transparent_calc(75%-1px),rgba(255,255,255,.05)_75%,transparent_calc(75%+1px),transparent_100%)]" />
            <div className="absolute inset-x-0 top-4 flex justify-between px-4 text-[10px] font-mono text-white/25"><span>0:00</span><span>{formatTime(currentProject.durationSec / 2)}</span><span>{formatTime(currentProject.durationSec)}</span></div>
            <canvas ref={waveformRef} aria-label="音频声波可视化" className="pointer-events-none absolute inset-x-4 top-10 h-24 w-[calc(100%-2rem)] opacity-90" />
            <div className="absolute bottom-6 left-0 right-0 space-y-3 px-4">{currentProject.tracks.map((track) => <div key={track.id} className="relative h-14 rounded-xl bg-white/[0.035]" onClick={() => setSelectedTrackId(track.id)}><div className="absolute inset-y-0 left-2 flex items-center text-[10px] font-bold text-white/35">{track.name}</div>{track.clips.map((clip) => <div key={clip.id} className="absolute inset-y-2 rounded-lg border border-white/15 bg-white/10" style={{ left: `${(clip.startSec / Math.max(currentProject.durationSec, 1)) * 100}%`, width: `${Math.max(2, (clip.durationSec / Math.max(currentProject.durationSec, 1)) * 100)}%` }} />)}</div>)}</div>
            <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px -translate-x-1/2 bg-lime-200/85" style={{ left: playheadLeft }} />
            <button type="button" aria-label="拖拽时间线播放头" onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); timelineDraggingRef.current = true; setTimelineDragging(true); seekTimelineFromPointer(event.clientX); }} className={`absolute top-3 z-20 h-3 w-3 -translate-x-1/2 rounded-full border border-lime-100/90 bg-lime-200 transition-transform hover:scale-110 ${timelineDragging ? "scale-110 cursor-grabbing" : "cursor-grab"}`} style={{ left: playheadLeft }} />
          </div>
          <div className="mt-4 flex items-center gap-3"><button type="button" onClick={() => void togglePlayback()} className="grid h-11 w-11 place-items-center rounded-full bg-white text-slate-950">{isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}</button><button type="button" onClick={() => { engineRef.current?.seek(0); setCurrentTime(0); }} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white/70 hover:bg-white/15" aria-label="回到开头"><Square size={13} /></button><span className="font-mono text-xs text-white/55">{formatTime(currentTime)} / {formatTime(currentProject.durationSec)}</span><div className="flex-1"><input aria-label="工作室进度" type="range" min="0" max={Math.max(currentProject.durationSec, 1)} step="0.01" value={Math.min(currentTime, currentProject.durationSec || 1)} onChange={(event) => { const value = Number(event.target.value); engineRef.current?.seek(value); setCurrentTime(value); }} style={{ "--studio-progress": `${Math.min(100, (currentTime / Math.max(currentProject.durationSec, 1)) * 100)}%` } as React.CSSProperties} className="studio-progress-slider w-full" /></div><span className="flex items-center gap-1 text-xs text-white/40"><Headphones size={14} />耳机监听</span><input type="checkbox" checked={monitorInput} onChange={(event) => setMonitorInput(event.target.checked)} className="accent-lime-200" /></div>
        </div>
        <div className="flex min-h-32 shrink-0 gap-5 border-t border-white/10 px-5 py-4">
          <section className="flex min-h-[190px] min-w-0 flex-1 flex-col rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-3" aria-label="同步歌词">
            <div className="mb-2 flex items-center justify-between gap-2 text-[10px] font-black tracking-[0.15em] text-white/35">
              <span>同步歌词</span>
              <span className="font-mono tracking-normal text-white/25">{lyricIndex >= 0 ? `${lyricIndex + 1}/${currentProject.lyrics.length}` : "等待播放"}</span>
            </div>
            {lyricRows.length > 0 ? <div className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
              {lyricRows.map(({ line, index }) => {
                const active = index === lyricIndex;
                return <button key={`${index}-${line.time}`} type="button" onClick={() => { engineRef.current?.seek(line.time); setCurrentTime(line.time); }} className={`group w-full rounded-xl px-3 py-2 text-left transition ${active ? "bg-lime-200/10 ring-1 ring-lime-200/25" : "hover:bg-white/[0.04]"}`}>
                  <div className={`truncate text-sm font-bold leading-5 ${active ? "text-lime-100" : index < lyricIndex ? "text-white/35" : "text-white/60"}`}>{line.text || "♪"}</div>
                  {line.tr && <div className={`mt-0.5 truncate text-[11px] leading-4 ${active ? "text-lime-100/55" : "text-white/25"}`}>{line.tr}</div>}
                  <span className="sr-only">{formatTime(line.time)}</span>
                </button>;
              })}
            </div> : <div className="flex flex-1 items-center rounded-xl bg-white/[0.035] px-4 text-sm font-bold text-white/45">导入伴奏后开始录制，歌词会跟随原曲时间线</div>}
          </section>
          <div className="w-80 space-y-3">{selectedTrack && <EffectPanel track={selectedTrack} onChange={(effects) => updateEffects(selectedTrack.id, effects)} />}<div className="flex items-center gap-2"><div className="relative min-w-0 flex-1"><button type="button" aria-label="麦克风设备" aria-haspopup="menu" aria-expanded={micMenuOpen} onClick={() => { setMicMenuOpen((open) => !open); setProjectMenuOpen(false); }} className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/8 px-2 py-1.5 text-left text-[11px] text-white/70 outline-none transition hover:bg-white/12"><span className="truncate">{micLabel}</span><ChevronDown size={13} className={`shrink-0 transition-transform ${micMenuOpen ? "rotate-180" : ""}`} /></button>{micMenuOpen && <div role="menu" className="absolute bottom-full left-0 z-[100] mb-2 w-full rounded-xl border border-white/12 bg-slate-900/95 p-1.5 shadow-2xl backdrop-blur-xl"><button type="button" role="menuitem" onClick={() => { setInputDeviceId("default"); setMicMenuOpen(false); }} className={`w-full rounded-lg px-3 py-2 text-left text-[11px] transition hover:bg-white/10 ${inputDeviceId === "default" ? "bg-white/10 text-white" : "text-white/65"}`}>默认麦克风</button>{devices.map((device) => <button type="button" role="menuitem" key={device.deviceId} onClick={() => { setInputDeviceId(device.deviceId); setMicMenuOpen(false); }} className={`w-full truncate rounded-lg px-3 py-2 text-left text-[11px] transition hover:bg-white/10 ${inputDeviceId === device.deviceId ? "bg-white/10 text-white" : "text-white/65"}`}>{device.label || `麦克风 ${device.deviceId.slice(0, 5)}`}</button>)}</div>}</div><button type="button" role="switch" aria-checked={countdownEnabled} onClick={() => { const next = !countdownEnabled; setCountdownEnabled(next); try { localStorage.setItem(RECORD_COUNTDOWN_KEY, next ? "1" : "0"); } catch { /* storage is optional */ } }} className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-[10px] font-bold transition ${countdownEnabled ? "bg-lime-200/15 text-lime-100" : "bg-white/8 text-white/45 hover:bg-white/12"}`} title="录音前显示 3 秒倒计时"><span className={`relative h-3.5 w-6 rounded-full transition ${countdownEnabled ? "bg-lime-200/70" : "bg-white/20"}`}><span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition ${countdownEnabled ? "left-3" : "left-0.5"}`} /></span>倒计时</button><button type="button" onClick={() => { if (recordingTrackId) stopRecording(); else if (selectedTrack?.kind === "vocal") { setRecordingTrackId(selectedTrack.id); void startRecording(); } else setNcmStatus("请先添加并选择人声轨"); }} className={`grid h-8 w-8 place-items-center rounded-full ${recordingTrackId ? "bg-red-400 text-white" : "bg-white/10 text-white/65 hover:bg-white/15"}`} aria-label={recordingTrackId ? "停止录音" : "准备录音"}>{recordingTrackId ? <Square size={13} fill="currentColor" /> : <Mic2 size={15} />}</button>{recordingTrackId && <button type="button" onClick={stopRecording} className="rounded-lg bg-red-400/20 px-2 py-1 text-[10px] font-bold text-red-100">停止</button>}</div></div>
        </div>
      </main>
    </div>
    {countdownValue !== null && <div className="pointer-events-none absolute inset-0 z-[200] grid place-items-center bg-slate-950/45 backdrop-blur-[2px]" role="status" aria-live="assertive"><div className="flex flex-col items-center gap-3"><div className="grid h-32 w-32 place-items-center rounded-full border border-lime-200/50 bg-slate-950/80 text-7xl font-black text-lime-100 shadow-[0_0_70px_rgba(190,242,100,.25)] animate-pulse">{countdownValue}</div><span className="rounded-full bg-black/40 px-4 py-1.5 text-xs font-bold tracking-[0.2em] text-white/70">准备录音</span></div></div>}
    <div className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden">{currentProject.tracks.map((track) => { const asset = lastAsset(track.assets); if (!asset) return null; const clip = track.clips.length > 0 ? track.clips[track.clips.length - 1] : undefined; return <audio key={`${track.id}:${asset.id}`} ref={(element) => attachAudio(track.id, element, clip?.startSec ?? 0)} src={asset.url} preload="auto" />; })}</div>
  </div>;
}
