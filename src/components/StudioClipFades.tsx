import { useEffect, useState } from "react";
import type { StudioClip, StudioTrack } from "../studio/types";
import { getClipFades } from "../lib/studioFades";

function FadeDuration({ label, value, max, onChange, onBegin, onEnd }: { label: string; value: number; max: number; onChange: (value: number) => void; onBegin: () => void; onEnd: () => void }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(value.toFixed(2)); }, [value, focused]);
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-3"><span className="text-xs text-white/70">{label}</span><label className="flex items-center gap-2 text-xs text-white/40"><input type="number" aria-label={`${label}时长（秒）`} min="0" max={max} step="0.01" value={draft} onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)} onBlur={() => { const next = Math.max(0, Math.min(max, Number(draft) || 0)); onChange(next); setDraft(next.toFixed(2)); setFocused(false); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} className="no-drag w-24 rounded-lg bg-white/10 px-2 py-1.5 text-right font-mono text-white outline-none focus:ring-1 focus:ring-lime-200/60" />秒</label></div>
    <input type="range" aria-label={`${label}时长滑块`} min="0" max={max} step="0.01" value={value} onFocus={onBegin} onBlur={onEnd} onChange={event => onChange(Number(event.target.value))} className="w-full accent-lime-200" />
  </div>;
}

export function StudioClipFades({ track, initialClipId, onClip, onBegin, onEnd }: { track: StudioTrack; initialClipId?: string; onClip: (clipId: string, patch: Partial<StudioClip>) => void; onBegin: () => void; onEnd: () => void }) {
  const [selectedId, setSelectedId] = useState(initialClipId ?? track.clips[0]?.id);
  useEffect(() => () => onEnd(), [onEnd]);
  const clip = track.clips.find(item => item.id === selectedId) ?? track.clips[0];
  if (!clip) return <p className="text-xs text-white/40">请先导入音频或录音，再调整片段过渡。</p>;
  const { fadeInSec, fadeOutSec } = getClipFades(clip, clip.durationSec);
  return <div role="tabpanel" aria-label="淡入淡出" className="space-y-5">
    <p className="text-[11px] leading-5 text-white/45">每个片段独立设置。将前后两段稍微重叠，前段淡出、后段淡入，可让多轨衔接更自然。</p>
    <div role="group" aria-label="选择过渡片段" className="flex flex-wrap gap-2">{track.clips.map((item, index) => <button key={item.id} type="button" aria-pressed={item.id === clip.id} onClick={() => setSelectedId(item.id)} title={track.assets.find(asset => asset.id === item.assetId)?.name} className={`rounded-lg px-3 py-1.5 text-xs ${item.id === clip.id ? "bg-lime-200/15 text-lime-100" : "bg-white/5 text-white/45"}`}>片段 {index + 1}</button>)}</div>
    <p className="truncate text-xs text-white/60">{track.assets.find(asset => asset.id === clip.assetId)?.name ?? track.name} · {clip.durationSec.toFixed(2)} 秒</p>
    <FadeDuration label="淡入" value={fadeInSec} max={Math.max(0, clip.durationSec - fadeOutSec)} onChange={fadeInSec => onClip(clip.id, { fadeInSec })} onBegin={onBegin} onEnd={onEnd} />
    <FadeDuration label="淡出" value={fadeOutSec} max={Math.max(0, clip.durationSec - fadeInSec)} onChange={fadeOutSec => onClip(clip.id, { fadeOutSec })} onBegin={onBegin} onEnd={onEnd} />
    <button type="button" disabled={fadeInSec === 0 && fadeOutSec === 0} onClick={() => onClip(clip.id, { fadeInSec: 0, fadeOutSec: 0 })} className="rounded-lg bg-white/5 px-3 py-2 text-xs text-white/60 hover:bg-white/10 disabled:opacity-30">清除片段过渡</button>
    <p className="text-[11px] leading-5 text-white/35">0 秒表示关闭。播放、导出 WAV / MP3 和播放器试听均生效；点击“保存”后随工程保留。</p>
  </div>;
}
