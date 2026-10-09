import { useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCcw, Volume2, X } from "lucide-react";
import { StudioPanKnob } from "./StudioPanKnob";
import type { StudioTrack } from "../studio/types";

export function trapStudioDialogTab(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]')].filter((node) => !node.closest("fieldset:disabled"));
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); return; }
  if (event.shiftKey && (document.activeElement === first || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || !controls.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
}

export function SignedMilliseconds({ label, value, onChange, limit = 30000, disabled = false, unit = "ms" }: { label: string; value: number; onChange: (value: number) => void; limit?: number; disabled?: boolean; unit?: string }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(value)); }, [value, focused]);
  const commit = () => { const next = Math.round(Math.max(-limit, Math.min(limit, Number(draft) || 0))); onChange(next); setDraft(String(next)); setFocused(false); };
  return <label className="flex items-center gap-2 text-xs text-white/50"><span>{label}</span><input type="text" inputMode="text" aria-label={label} disabled={disabled} value={draft} onFocus={() => setFocused(true)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} onChange={(event) => {
    const text = event.target.value;
    if (!/^-?\d*$/.test(text)) return;
    setDraft(text);
    if (text !== "" && text !== "-") onChange(Math.max(-limit, Math.min(limit, Number(text))));
  }} className="no-drag w-20 rounded-lg bg-white/10 px-2 py-1.5 text-right font-mono text-white outline-none focus:ring-1 focus:ring-lime-200/60" /><span>{unit}</span></label>;
}

export function StudioTrackTools({ track, busy, onClose, onMixer, onRename, onOffset, onNormalize, onDenoise, onRestore, effects, rename = false, initialTab = "channel" }: {
  track: StudioTrack; busy: boolean; onClose: () => void; onMixer: (patch: Partial<StudioTrack["mixer"]>) => void; onRename: (name: string) => void; onOffset: (offset: number) => void;
  onNormalize: () => void; onDenoise: (strength: number) => void; onRestore: () => void; effects: ReactNode; rename?: boolean; initialTab?: "channel" | "effects" | "audio";
}) {
  const [strength, setStrength] = useState(2);
  const [tab, setTab] = useState(initialTab);
  const [name, setName] = useState(track.name);
  const nameRef = useRef<HTMLInputElement>(null);
  const cancelNameRef = useRef(false);
  useEffect(() => { if (rename) { nameRef.current?.focus(); nameRef.current?.select(); } }, [rename]);
  const db = track.mixer.gain > 0 ? Math.max(-60, 20 * Math.log10(track.mixer.gain)) : -60;
  const gainLabel = track.mixer.gain === 0 ? "−∞ dB" : `${db > 0 ? "+" : ""}${db.toFixed(1)} dB`;
  const commitName = () => { if (cancelNameRef.current) { cancelNameRef.current = false; return; } const next = name.trim() || track.name; if (next !== track.name) onRename(next); setName(next); };
  return <div className="absolute inset-0 z-[220] grid place-items-center bg-black/60 p-5 backdrop-blur-sm" onKeyDown={(event) => { trapStudioDialogTab(event); if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
    <section role="dialog" aria-modal="true" aria-label="音轨调整" className="flex h-[min(620px,calc(100vh-40px))] min-h-0 max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900 shadow-2xl">
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-5 py-4">
        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: track.color }} />
        <div className="min-w-0 flex-1"><p className="mb-1 text-[10px] tracking-widest text-white/35">音轨设置 · {track.kind === "vocal" ? "人声" : track.kind === "reference" ? "参考" : "伴奏"}</p><input ref={nameRef} aria-label="详细音轨名称" disabled={busy} value={name} onChange={event => setName(event.target.value)} onBlur={commitName} onKeyDown={event => { if (event.key === "Enter") { commitName(); event.currentTarget.blur(); } if (event.key === "Escape") { event.stopPropagation(); cancelNameRef.current = true; setName(track.name); event.currentTarget.blur(); } }} className="w-full rounded bg-transparent px-1 py-0.5 text-sm font-bold text-white outline-none focus:bg-white/10 focus:ring-1 focus:ring-lime-200/50" /></div>
        <button type="button" autoFocus={!rename} disabled={busy} onClick={onClose} aria-label="完成" className="rounded-lg p-2 text-white/50 hover:bg-white/10 disabled:opacity-30" title="完成"><X size={17} /></button>
      </div>
      <fieldset disabled={busy} className="flex h-0 min-h-0 min-w-0 flex-1 overflow-hidden disabled:opacity-50">
        <aside aria-label="音量控制" className="flex min-h-0 w-28 shrink-0 flex-col items-center gap-3 overflow-y-auto overscroll-y-contain border-r border-white/10 bg-black/10 px-3 py-5 [scrollbar-width:thin]">
          <div className="flex items-center gap-2 text-[11px] font-bold text-white/55"><Volume2 size={14} />音量</div>
          <div className="relative flex h-52 w-20 shrink-0 justify-end">
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-1 left-0 flex flex-col justify-between font-mono text-[9px] text-white/30"><span>+6</span><span>−12</span><span>−30</span><span>−48</span><span>−∞</span></div>
            <input aria-label="音轨音量" aria-valuetext={gainLabel} type="range" min="-60" max="6.02" step="0.01" value={db} onChange={event => { const value = Number(event.target.value); onMixer({ gain: value <= -60 ? 0 : Math.min(2, Math.pow(10, value / 20)) }); }} onDoubleClick={() => onMixer({ gain: 1 })} className="studio-volume-fader" title="音量推子，双击恢复 0 dB" />
          </div>
          <button type="button" title="恢复 0 dB" onClick={() => onMixer({ gain: 1 })} className="w-full rounded-lg bg-white/5 py-1.5 font-mono text-xs text-lime-100 hover:bg-white/10">{gainLabel}</button>
          <div className="flex gap-1.5"><button type="button" aria-label="音轨静音" aria-pressed={track.mixer.mute} onClick={() => onMixer({ mute: !track.mixer.mute })} className={`rounded-lg px-3 py-2 text-xs font-bold ${track.mixer.mute ? "bg-red-400/20 text-red-100" : "bg-white/5 text-white/50"}`}>M</button><button type="button" aria-label="音轨独奏" aria-pressed={track.mixer.solo} onClick={() => onMixer({ solo: !track.mixer.solo })} className={`rounded-lg px-3 py-2 text-xs font-bold ${track.mixer.solo ? "bg-amber-300/20 text-amber-100" : "bg-white/5 text-white/50"}`}>S</button></div>
          <p className="text-[9px] text-white/30">静音 / 独奏</p>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-5">
          <div role="tablist" aria-label="音轨设置分组" className="mb-5 flex shrink-0 gap-1 rounded-lg bg-black/20 p-1">{([["channel", "通道"], ["effects", "效果器"], ["audio", "音频处理"]] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-md px-2 py-1.5 text-xs ${tab === id ? "bg-white/10 font-bold text-white" : "text-white/40 hover:text-white/70"}`}>{label}</button>)}</div>
          <div aria-label="音轨设置内容" className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-width:thin]">
          {tab === "channel" && <div role="tabpanel" aria-label="通道" className="space-y-5">
            <div className="flex flex-wrap items-center gap-5 rounded-xl border border-white/8 bg-white/[0.025] p-4"><StudioPanKnob value={track.mixer.pan} onChange={pan => onMixer({ pan })} /><div className="space-y-2"><p className="text-xs font-bold text-white/70">左右声像</p><SignedMilliseconds label="声像" value={Math.round(track.mixer.pan * 100)} onChange={value => onMixer({ pan: value / 100 })} limit={100} unit="%" /><p className="text-[10px] text-white/35">负数偏左，正数偏右 · 双击旋钮居中</p></div></div>
            <div><p className="mb-2 text-xs text-white/60">声道模式</p><div className="flex gap-2">{([["stereo", "立体声"], ["mono", "单声道"]] as const).map(([mode, label]) => <button key={mode} type="button" aria-pressed={(track.mixer.channelMode ?? "stereo") === mode} onClick={() => onMixer({ channelMode: mode })} className={`rounded-lg px-4 py-2 text-xs ${(track.mixer.channelMode ?? "stereo") === mode ? "bg-lime-200/15 text-lime-100" : "bg-white/5 text-white/45"}`}>{label}</button>)}</div><p className="mt-2 text-[10px] leading-5 text-white/35">单声道合并左右声道，再按声像分配；原始录音不变。</p></div>
            <div className="border-t border-white/10 pt-4"><div className="flex flex-wrap items-center justify-between gap-2"><SignedMilliseconds label="音轨偏移" value={track.offsetMs ?? 0} onChange={onOffset} /><button type="button" onClick={() => onOffset(0)} title="重置音轨偏移" aria-label="重置音轨偏移" className="rounded p-1.5 text-white/40 hover:bg-white/10"><RotateCcw size={13} /></button></div><p className="mt-2 text-[10px] leading-5 text-white/35">负数提前，正数延后 · ±30,000 ms</p></div>
          </div>}
          {tab === "effects" && <div role="tabpanel" aria-label="效果器">{effects}<p className="mt-4 text-[11px] text-white/35">参数实时生效，播放和导出使用相同设置。</p></div>}
          {tab === "audio" && <div role="tabpanel" aria-label="音频处理" className="space-y-5">
            <div><button type="button" disabled={!track.clips.length} onClick={onNormalize} className="rounded-xl bg-lime-200/15 px-3 py-2 text-xs font-bold text-lime-100 disabled:opacity-40">{track.normalizationGain != null ? "取消归一化" : "声音归一化"}</button><p className="mt-2 text-[11px] leading-5 text-white/40">输入峰值调整至 −1 dB，音量推子和效果器仍可独立调整。</p></div>
            <div className="space-y-3 border-t border-white/10 pt-4"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-xs text-white/60">录音降噪</span>{["轻度", "标准", "较强"].map((label, index) => <button type="button" key={label} aria-pressed={strength === index + 1} onClick={() => setStrength(index + 1)} className={`rounded-lg px-2.5 py-1.5 text-xs ${strength === index + 1 ? "bg-white/20 text-white" : "bg-white/5 text-white/45"}`}>{label}</button>)}</div><div className="flex gap-2"><button type="button" disabled={!track.clips.length} onClick={() => onDenoise(strength)} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold disabled:opacity-40">应用降噪</button>{track.denoiseOriginalAssets && <button type="button" onClick={onRestore} className="rounded-xl px-3 py-2 text-xs text-white/60 hover:bg-white/10">恢复降噪前</button>}</div><p className="text-[11px] leading-5 text-white/40">减少持续底噪。较强处理可能影响气声和细节，原始音频会保留以供恢复。</p></div>
          </div>}
          </div>
        </div>
      </fieldset>
      {busy && <p role="status" className="shrink-0 px-5 pb-4 text-xs text-lime-200">正在处理音轨，请稍候…</p>}
    </section>
  </div>;
}
