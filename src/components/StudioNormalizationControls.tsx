import { useState } from "react";
import type { StudioNormalizationOptions, StudioTrack } from "../studio/types";
import { DEFAULT_NORMALIZATION } from "../lib/studioNormalization";

export function StudioNormalizationControls({ track, onApply, onCancel }: { track: StudioTrack; onApply: (options: StudioNormalizationOptions) => void; onCancel: () => void }) {
  const [options, setOptions] = useState<StudioNormalizationOptions>(track.normalization ?? DEFAULT_NORMALIZATION);
  const report = track.normalization;
  return <div className="space-y-3">
    <p className="text-xs font-bold text-white/75">音轨响度匹配</p>
    <p className="text-[11px] leading-5 text-white/45">让不同录音听起来更接近。可直接分析并应用，再用音量推子决定这条轨道在混音中的轻重。</p>
    <p className="text-[10px] text-white/40">当前方案：{options.mode === "average" ? "平均响度匹配" : "峰值归一化"}</p>
    <details className="rounded-lg bg-white/[0.025] p-3 text-[11px] text-white/50"><summary className="cursor-pointer rounded focus-visible:outline focus-visible:outline-1 focus-visible:outline-lime-200">高级响度设置</summary><div className="mt-3 space-y-3">
    <div className="grid grid-cols-2 gap-2">{([["average", "平均响度匹配"], ["peak", "峰值归一化"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={options.mode === mode} onClick={() => setOptions({ ...options, mode, targetDb: mode === "average" ? -18 : -3 })} className={`rounded-lg px-3 py-2 text-xs ${options.mode === mode ? "bg-lime-200/15 text-lime-100" : "bg-white/5 text-white/45"}`}>{label}</button>)}</div>
    <div className="grid grid-cols-2 gap-3">{([["targetDb", options.mode === "average" ? "目标 RMS dBFS" : "目标峰值 dBFS", -30, -1], ["ceilingDb", "峰值上限 dBFS", -18, -1]] as const).map(([key, label, min, max]) => <label key={key} className="space-y-1 text-[10px] text-white/45"><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step="1" value={options[key]} onChange={event => setOptions({ ...options, [key]: Math.min(max, Math.max(min, Number(event.target.value) || min)) })} className="w-full rounded-lg bg-white/8 px-2 py-1.5 font-mono text-xs text-white" /></label>)}</div>
    <p className="text-[11px] leading-5 text-white/40">平均方式测量有效声音的 RMS，排除静音和明显较弱片段，让不同录音更接近相同电平；这是整体增益调整，不压缩句内起伏，也不等同于 LUFS。最高提升 18 dB，预留峰值余量。</p>
    </div></details>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={!track.clips.length} onClick={() => onApply(options)} className="rounded-xl bg-lime-200/15 px-3 py-2 text-xs font-bold text-lime-100 disabled:opacity-40">{track.normalizationGain != null ? "重新分析并应用" : "分析并应用"}</button>{track.normalizationGain != null && <button type="button" onClick={onCancel} className="rounded-xl bg-white/5 px-3 py-2 text-xs text-white/60">取消归一化</button>}</div>
    {track.normalizationGain != null && <div role="status" className="space-y-1 rounded-lg bg-white/5 p-3 text-[11px] leading-5 text-white/55"><p>已应用 {20 * Math.log10(track.normalizationGain) >= 0 ? "+" : ""}{(20 * Math.log10(track.normalizationGain)).toFixed(1)} dB</p>{report && <><p>有效 RMS {report.inputRmsDb.toFixed(1)} → {(report.inputRmsDb + report.gainDb).toFixed(1)} dBFS · 峰值 {(report.inputPeakDb + report.gainDb).toFixed(1)} dBFS</p>{report.limited && <p className="text-amber-200/80">受峰值上限或最大提升量限制，尚未达到目标。可先适量压缩动态，再重新分析。</p>}</>}<p className="text-white/35">测量位于音量推子和效果器之前；编辑片段后可重新分析。多轨相加仍需用音量推子保留总线余量。</p></div>}
  </div>;
}
