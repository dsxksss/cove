import { useEffect, useState } from "react";
import type { StudioPitch, StudioTrack, VocalPresetId } from "../studio/types";
import { normalizePitch } from "../lib/studioPitch";
import { VOCAL_PRESETS } from "../lib/studioVocalPresets";

export function StudioVoiceTools({ track, onPitch, onHarmony, onPreset, onRestore, feedback }: { track: StudioTrack; onPitch: (pitch: StudioPitch) => void; onHarmony: (semitones: number) => void; onPreset: (presetId: VocalPresetId) => void; onRestore: () => void; feedback?: { message: string; error?: boolean } }) {
  const active = normalizePitch(track.pitch);
  const [semitones, setSemitones] = useState(String(active.semitones));
  const [preserveFormants, setPreserveFormants] = useState(active.preserveFormants);
  const [presetId, setPresetId] = useState<VocalPresetId>(track.vocalTreatment?.presetId ?? "natural");
  useEffect(() => { const pitch = normalizePitch(track.pitch); setSemitones(String(pitch.semitones)); setPreserveFormants(pitch.preserveFormants); }, [track.pitch]);
  const draft = normalizePitch({ semitones: Number(semitones), preserveFormants });
  const invalid = semitones.trim() === "" || !Number.isFinite(Number(semitones)) || Math.abs(Number(semitones)) > 24;
  return <div role="tabpanel" aria-label="移调与人声处理" className="space-y-6">
    {feedback && <p role={feedback.error ? "alert" : "status"} className={`rounded-lg p-3 text-[11px] leading-5 ${feedback.error ? "bg-red-400/10 text-red-200" : "bg-lime-200/5 text-lime-100/75"}`}>{feedback.message}</p>}
    <section aria-label="人声快捷处理" className="space-y-3">
      <h3 className="text-xs font-bold text-white/80">一键人声处理</h3>
      {track.kind !== "vocal" ? <p className="text-[11px] text-white/40">请选中人声轨使用人声预设；伴奏和参考轨仍可独立移调。</p> : <>
        <p className="text-[11px] leading-5 text-white/45">先从“自然清晰”开始试听，再按喜欢的风格切换。处理后仍可打开效果器细调。</p>
        <div className="grid grid-cols-3 gap-2">{VOCAL_PRESETS.map(preset => <button key={preset.id} type="button" aria-pressed={presetId === preset.id} onClick={() => setPresetId(preset.id)} className={`rounded-lg px-2 py-2 text-xs ${presetId === preset.id ? "bg-lime-200/15 text-lime-100" : "bg-white/5 text-white/45"}`}>{preset.name}</button>)}</div>
        <p className="text-[11px] leading-5 text-white/45">{VOCAL_PRESETS.find(preset => preset.id === presetId)?.description}</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={!track.clips.length} onClick={() => onPreset(presetId)} className="rounded-xl bg-lime-200/15 px-3 py-2 text-xs font-bold text-lime-100 disabled:opacity-30">一键处理当前人声</button>{track.vocalTreatment && <button type="button" onClick={onRestore} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white/60">恢复处理前</button>}</div>
        <p className="text-[10px] leading-5 text-white/35">只处理当前人声，保留你设置的音量、声像和其他轨道。效果可撤销，原录音始终保留。</p>
        {track.vocalTreatment && <p role="status" className="text-[11px] text-lime-100/75">最近使用：{VOCAL_PRESETS.find(preset => preset.id === track.vocalTreatment?.presetId)?.name}</p>}
        <details className="text-[10px] leading-5 text-white/35"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-lime-200">处理范围与恢复说明</summary><p className="mt-2">组合 EQ、压缩、响度校准和空间效果。音量推子之前以平均 −20 dBFS、采样峰值不高于 −6 dBFS 为目标，多轨相加仍需留余量。处理结果取决于原录音质量；破音、严重噪声和音准问题需要另行处理。“恢复处理前”还原首次应用前的效果和响度，也会还原之后手动修改的这些参数。</p></details>
      </>}
    </section>
    {track.kind === "vocal" && <section aria-label="叠唱副轨" className="space-y-3 border-t border-white/10 pt-4"><h3 className="text-xs font-bold text-white/80">添加高低叠唱</h3><p className="text-[11px] leading-5 text-white/45">保留主唱，另加一条较轻的高音或低音副轨，之后可单独调整。</p><div className="flex flex-wrap gap-2"><button type="button" disabled={!track.clips.length || active.semitones + 12 > 24} onClick={() => onHarmony(12)} className="rounded-lg bg-white/8 px-3 py-2 text-xs text-white/65">高八度叠唱</button><button type="button" disabled={!track.clips.length || active.semitones - 12 < -24} onClick={() => onHarmony(-12)} className="rounded-lg bg-white/8 px-3 py-2 text-xs text-white/65">低八度叠唱</button></div><p className="text-[10px] leading-5 text-white/35">只需要部分高音时，在副轨切分并删除其余片段即可。</p></section>}
    <section aria-label="音轨移调" className="space-y-3 border-t border-white/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-xs font-bold text-white/80">调整本轨音高</h3><span className="font-mono text-[10px] text-lime-100">当前 {active.semitones > 0 ? "+" : ""}{active.semitones} 半音</span></div>
      <p className="text-[11px] leading-5 text-white/40">先选择高低，再点“应用移调”。音频长度和歌词位置保持一致。</p>
      <div className="flex flex-wrap gap-2">{([-12, 0, 12] as const).map(value => <button key={value} type="button" aria-pressed={draft.semitones === value} onClick={() => setSemitones(String(value))} className={`rounded-lg px-3 py-2 text-[11px] ${draft.semitones === value ? "bg-lime-200/15 text-lime-100" : "bg-white/5 text-white/60"}`}>{value === 0 ? "原调" : value === 12 ? "高一个八度" : "低一个八度"}</button>)}</div>
      <input type="range" aria-label="移调半音滑块" min="-24" max="24" step="0.1" value={draft.semitones} onChange={event => setSemitones(event.target.value)} className="w-full accent-lime-200" />
      <p className="text-[10px] text-white/40">待应用 {draft.semitones > 0 ? "+" : ""}{draft.semitones} 半音 · 负数更低，正数更高</p>
      <details className="rounded-lg bg-white/[0.025] p-3 text-[11px] text-white/55"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-lime-200">高级移调设置</summary><div className="mt-3 space-y-3"><label className="flex items-center gap-2">精确移调<input type="number" aria-label="移调半音" min="-24" max="24" step="0.1" value={semitones} onChange={event => setSemitones(event.target.value)} onBlur={() => { if (!invalid) setSemitones(String(draft.semitones)); }} className="w-24 rounded-lg bg-white/10 px-2 py-1.5 text-right font-mono text-white" />半音</label><label className="flex items-center gap-2"><input type="checkbox" checked={preserveFormants} onChange={event => setPreserveFormants(event.target.checked)} className="accent-lime-200" />尽量保留原来的音色（共振峰）</label><p className="text-[10px] leading-5 text-white/35">支持 ±24 半音，±12 为一个八度。较大幅度移调可能产生伪影；固定三度 / 五度和声需按旋律和调式编配。</p></div></details>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!track.clips.length || invalid || (draft.semitones === active.semitones && (draft.semitones === 0 || draft.preserveFormants === active.preserveFormants))} onClick={() => onPitch(draft)} className="rounded-xl bg-lime-200/15 px-3 py-2 text-xs font-bold text-lime-100 disabled:opacity-30">应用移调</button>{active.semitones !== 0 && <button type="button" onClick={() => onPitch({ semitones: 0, preserveFormants: true })} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white/60">恢复原调</button>}</div>
    </section>
  </div>;
}
