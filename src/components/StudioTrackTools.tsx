import { useEffect, useState } from "react";
import type { StudioTrack } from "../studio/types";

export function trapStudioDialogTab(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter((node) => !node.closest("fieldset:disabled"));
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
}

export function SignedMilliseconds({ label, value, onChange, limit = 30000 }: { label: string; value: number; onChange: (value: number) => void; limit?: number }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const commit = () => { const next = Math.round(Math.max(-limit, Math.min(limit, Number(draft) || 0))); onChange(next); setDraft(String(next)); setFocused(false); };
  return <label className="flex items-center gap-2 text-xs text-white/50"><span>{label}</span><input type="text" inputMode="text" aria-label={label} value={draft} onFocus={() => setFocused(true)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} onChange={(event) => {
    const text = event.target.value;
    if (!/^-?\d*$/.test(text)) return;
    setDraft(text);
    if (text !== "" && text !== "-") onChange(Math.max(-limit, Math.min(limit, Number(text))));
  }} className="no-drag w-20 rounded-lg bg-white/10 px-2 py-1.5 text-right font-mono text-white outline-none focus:ring-1 focus:ring-lime-200/60" /><span>ms</span></label>;
}

export function StudioTrackTools({ track, busy, onClose, onPan, onOffset, onNormalize, onDenoise, onRestore }: {
  track: StudioTrack; busy: boolean; onClose: () => void; onPan: (pan: number) => void; onOffset: (offset: number) => void;
  onNormalize: () => void; onDenoise: (strength: number) => void; onRestore: () => void;
}) {
  const [strength, setStrength] = useState(2);
  return <div className="absolute inset-0 z-[220] grid place-items-center bg-black/60 p-6 backdrop-blur-sm" onKeyDown={(event) => { trapStudioDialogTab(event); if (event.key === "Escape" && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-label="音轨调整" className="max-h-full w-full max-w-md space-y-5 overflow-y-auto rounded-2xl border border-white/15 bg-slate-900 p-6 shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="text-sm font-bold">{track.name} · 音轨调整</h2><button autoFocus disabled={busy} onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-white/60 hover:bg-white/10">完成</button></div>
      <fieldset disabled={busy} className="space-y-5 disabled:opacity-50">
        <div><div className="mb-2 flex items-center justify-between text-xs text-white/60"><span>左右声像</span><button onClick={() => onPan(0)} className="rounded px-2 py-1 hover:bg-white/10">{track.mixer.pan === 0 ? "居中" : `${track.mixer.pan < 0 ? "左" : "右"} ${Math.round(Math.abs(track.mixer.pan) * 100)}%`} · 重置</button></div><div className="flex items-center gap-3 text-xs text-white/40"><span>左</span><input aria-label="音轨声像" type="range" min="-1" max="1" step="0.01" value={track.mixer.pan} onChange={(event) => onPan(Number(event.target.value))} className="min-w-0 flex-1 accent-lime-200" /><span>右</span></div></div>
        <div><SignedMilliseconds label="音轨偏移" value={track.offsetMs ?? 0} onChange={onOffset} /><p className="mt-2 text-[11px] text-white/40">负数提前，正数延后；不改变原始音频。范围 ±30,000 ms。</p></div>
        <div className="border-t border-white/10 pt-4"><button disabled={!track.clips.length} onClick={onNormalize} className="rounded-xl bg-lime-200/15 px-3 py-2 text-xs font-bold text-lime-100 disabled:opacity-40">{track.normalizationGain != null ? "取消归一化" : "声音归一化"}</button><p className="mt-2 text-[11px] text-white/40">将片段合成后的输入峰值调整至 −1 dB，音量推子和效果器仍可独立调整。</p></div>
        <div className="space-y-3 border-t border-white/10 pt-4"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-white/60">录音降噪</span>{["轻度", "标准", "较强"].map((label, index) => <button key={label} aria-pressed={strength === index + 1} onClick={() => setStrength(index + 1)} className={`rounded-lg px-2.5 py-1.5 text-xs ${strength === index + 1 ? "bg-white/20 text-white" : "bg-white/5 text-white/45"}`}>{label}</button>)}</div><div className="flex gap-2"><button disabled={!track.clips.length} onClick={() => onDenoise(strength)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">应用降噪</button>{track.denoiseOriginalAssets && <button onClick={onRestore} className="rounded-xl px-3 py-2 text-xs text-white/60 hover:bg-white/10">恢复降噪前</button>}</div><p className="text-[11px] leading-relaxed text-white/40">用于减少持续底噪。较强处理可能影响气声和细节，原始音频会保留以供恢复。</p></div>
      </fieldset>
      {busy && <p role="status" className="animate-pulse text-xs text-lime-200">正在处理音轨，请稍候…</p>}
    </section>
  </div>;
}
