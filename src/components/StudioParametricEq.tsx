import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioEq, StudioEqBand } from "../studio/types";
import { configureEqFilter, defaultEqBands, EQ_COLORS, EQ_TYPES, eqClamp, frequencyToUnit, getEqBands, isEqBandActive, unitToFrequency, usesEqGain } from "../lib/studioEq";

export type StudioSpectrum = { bins: Uint8Array; sampleRate: number } | null;
const W = 800, H = 300, L = 38, R = 18, T = 16, B = 28;
const plotW = W - L - R, plotH = H - T - B;
const xAt = (frequency: number) => L + frequencyToUnit(frequency) * plotW;
const yAt = (db: number) => T + (18 - eqClamp(db, -18, 18)) / 36 * plotH;
const frequencyLabel = (frequency: number) => frequency >= 1000 ? `${(frequency / 1000).toFixed(frequency >= 10000 ? 1 : 2)}k` : `${Math.round(frequency)}`;

function EqNumber({ label, value, min, max, step, disabled, onChange }: { label: string; value: number; min: number; max: number; step: number; disabled?: boolean; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(String(Math.round(value * 100) / 100)); }, [value, focused]);
  return <label className="min-w-0 space-y-1 text-[10px] text-white/40"><span>{label}</span><input type="number" aria-label={label} min={min} max={max} step={step} disabled={disabled} value={draft} onFocus={() => setFocused(true)} onChange={event => setDraft(event.target.value)} onBlur={() => { const next = eqClamp(Number(draft), min, max); if (next !== value) onChange(next); setFocused(false); setDraft(String(next)); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} className="w-full rounded-md bg-white/8 px-2 py-1.5 font-mono text-xs text-white outline-none focus:ring-1 focus:ring-lime-200/50 disabled:opacity-30" /></label>;
}

export function StudioParametricEq({ eq, onChange, onBegin, onEnd, readSpectrum }: { eq: StudioEq; onChange: (eq: StudioEq) => void; onBegin: () => void; onEnd: () => void; readSpectrum?: () => StudioSpectrum }) {
  const [selected, setSelected] = useState(3);
  const [compare, setCompare] = useState<StudioEq | null>(null);
  const bands = getEqBands(eq), band = bands[selected];
  const graphRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ index: number; x: number; y: number; band: StudioEqBand } | null>(null);
  const latest = useRef({ eq, bands, onChange, readSpectrum }); latest.current = { eq, bands, onChange, readSpectrum };
  const analysis = useMemo(() => {
    const context = new OfflineAudioContext(1, 1, 48000);
    return { filters: Array.from({ length: 7 }, () => context.createBiquadFilter()), sampleRate: context.sampleRate };
  }, []);
  const curves = useMemo(() => {
    const frequencies = Float32Array.from({ length: 321 }, (_, i) => unitToFrequency(i / 320));
    const total = new Float32Array(frequencies.length).fill(eq.bypass ? 0 : eq.outputDb ?? 0);
    const individual = new Float32Array(frequencies.length);
    bands.forEach((item, index) => {
      if (eq.bypass || !isEqBandActive(item)) return;
      const filter = analysis.filters[index]; configureEqFilter(filter, item, analysis.sampleRate);
      const magnitudes = new Float32Array(frequencies.length), phases = new Float32Array(frequencies.length);
      filter.getFrequencyResponse(frequencies, magnitudes, phases);
      magnitudes.forEach((magnitude, i) => { const db = 20 * Math.log10(Math.max(1e-8, magnitude)); total[i] += db; if (index === selected) individual[i] = db; });
    });
    const path = (values: Float32Array) => [...values].map((db, i) => `${i ? "L" : "M"}${xAt(frequencies[i]).toFixed(1)},${yAt(db).toFixed(1)}`).join(" ");
    return { total: path(total), individual: path(individual) };
  }, [eq, selected, analysis]);
  useEffect(() => () => onEnd(), [onEnd]);
  useEffect(() => {
    const wheel = (event: WheelEvent) => {
      const target = (event.target as Element).closest("[data-eq-band]");
      if (!target || target.closest("fieldset:disabled")) return;
      event.preventDefault(); event.stopPropagation();
      const index = Number(target.getAttribute("data-eq-band")), current = latest.current;
      if (["lowshelf", "highshelf"].includes(current.bands[index].type)) return;
      const updated = current.bands.map((item, i) => i !== index ? item : { ...item, q: eqClamp(item.q * Math.pow(2, event.deltaY * (event.ctrlKey ? 0.0005 : 0.002)), 0.1, 18) });
      setSelected(index); current.onChange({ ...current.eq, bands: updated });
    };
    const node = graphRef.current; node?.addEventListener("wheel", wheel, { passive: false });
    return () => node?.removeEventListener("wheel", wheel);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current, context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    let frame = 0, previous = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw); if (time - previous < 45) return; previous = time;
      context.clearRect(0, 0, W, H);
      const spectrum = latest.current.readSpectrum?.(); if (!spectrum) return;
      context.beginPath(); context.moveTo(L, H - B);
      for (let i = 0; i <= 240; i++) {
        const frequency = unitToFrequency(i / 240), bin = Math.min(spectrum.bins.length - 1, Math.round(frequency / (spectrum.sampleRate / 2) * spectrum.bins.length));
        context.lineTo(L + i / 240 * plotW, H - B - spectrum.bins[bin] / 255 * plotH * 0.85);
      }
      context.lineTo(W - R, H - B); context.closePath(); context.fillStyle = "rgba(148,163,184,0.2)"; context.fill();
    };
    frame = requestAnimationFrame(draw); return () => cancelAnimationFrame(frame);
  }, []);
  const updateBand = (patch: Partial<StudioEqBand>) => onChange({ ...eq, bands: bands.map((item, index) => index === selected ? { ...item, ...patch } : item) });
  const resetBand = (index: number) => onChange({ ...eq, bands: bands.map((item, i) => i === index ? defaultEqBands()[i] : item) });
  return <section aria-label="七段参数均衡器" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold text-white/80">PARAMETRIC EQ · 7</span><div className="flex flex-wrap gap-1.5">
      <button type="button" aria-pressed={Boolean(eq.bypass)} onClick={() => onChange({ ...eq, bypass: !eq.bypass })} className={`rounded px-2 py-1 text-[10px] ${eq.bypass ? "bg-amber-300/15 text-amber-100" : "bg-white/8 text-white/55"}`}>旁通 EQ</button>
      <button type="button" onClick={() => setCompare(structuredClone(eq))} className="rounded bg-white/8 px-2 py-1 text-[10px] text-white/55">存入 A/B</button>
      <button type="button" disabled={!compare} onClick={() => { if (compare) { setCompare(structuredClone(eq)); onChange(structuredClone(compare)); } }} className="rounded bg-white/8 px-2 py-1 text-[10px] text-white/55 disabled:opacity-30">切换 A/B</button>
      <button type="button" onClick={() => onChange({ lowDb: 0, midDb: 0, highDb: 0, bands: defaultEqBands(), outputDb: 0, bypass: false })} className="rounded bg-white/8 px-2 py-1 text-[10px] text-white/55">重置 EQ</button>
    </div></div>
    <div ref={graphRef} className="relative overflow-hidden rounded-lg border border-white/10 bg-[#0a1020]">
      <canvas ref={canvasRef} width={W} height={H} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      <svg viewBox={`0 0 ${W} ${H}`} className="relative block w-full touch-none select-none" aria-label="EQ 频率响应曲线">
        {[20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map(frequency => <g key={frequency}><line x1={xAt(frequency)} x2={xAt(frequency)} y1={T} y2={H - B} stroke="white" strokeOpacity="0.06" /><text x={xAt(frequency)} y={H - 8} fill="#64748b" fontSize="10" textAnchor="middle">{frequency >= 1000 ? `${frequency / 1000}k` : frequency}</text></g>)}
        {[-18, -12, -6, 0, 6, 12, 18].map(db => <g key={db}><line x1={L} x2={W - R} y1={yAt(db)} y2={yAt(db)} stroke="white" strokeOpacity={db === 0 ? "0.22" : "0.06"} /><text x={L - 7} y={yAt(db) + 3} fill="#64748b" fontSize="10" textAnchor="end">{db > 0 ? "+" : ""}{db}</text></g>)}
        <path d={curves.individual} stroke={EQ_COLORS[selected]} strokeOpacity="0.45" strokeDasharray="4 4" fill="none" strokeWidth="1.5" />
        <path d={curves.total} data-eq-response="" stroke={eq.bypass ? "#64748b" : "#e2edc7"} fill="none" strokeWidth="2" />
        {bands.map((item, index) => <g key={index} data-eq-band={index} role="button" tabIndex={0} aria-label={`EQ 频段 ${index + 1}`} aria-pressed={selected === index} style={{ cursor: "grab", opacity: item.enabled && !eq.bypass ? 1 : 0.4 }}
          onPointerDown={event => { if (event.button !== 0 || event.currentTarget.closest("fieldset:disabled")) return; event.preventDefault(); event.currentTarget.focus(); setSelected(index); if (event.altKey) { resetBand(index); return; } event.currentTarget.setPointerCapture(event.pointerId); dragRef.current = { index, x: event.clientX, y: event.clientY, band: { ...item } }; onBegin(); }}
          onPointerMove={event => { const drag = dragRef.current; if (!drag || drag.index !== index) return; const bounds = event.currentTarget.ownerSVGElement!.getBoundingClientRect(); const factor = event.ctrlKey ? 0.15 : 1; const frequency = unitToFrequency(frequencyToUnit(drag.band.frequency) + (event.clientX - drag.x) / bounds.width * W / plotW * factor); const gainDb = usesEqGain(item.type) ? eqClamp(drag.band.gainDb - (event.clientY - drag.y) / bounds.height * H / plotH * 36 * factor, -18, 18) : item.gainDb; const current = latest.current; current.onChange({ ...current.eq, bands: current.bands.map((value, i) => i === index ? { ...value, frequency, gainDb } : value) }); }}
          onPointerUp={() => { dragRef.current = null; onEnd(); }} onPointerCancel={() => { dragRef.current = null; onEnd(); }} onLostPointerCapture={() => { dragRef.current = null; onEnd(); }} onDoubleClick={() => resetBand(index)}
          onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); setSelected(index); if (event.key === "Enter" || event.key === " ") return; const updated = event.key === "ArrowLeft" || event.key === "ArrowRight" ? { frequency: eqClamp(item.frequency * Math.pow(2, (event.key === "ArrowLeft" ? -1 : 1) / (event.ctrlKey ? 120 : 12)), 20, 20000) } : usesEqGain(item.type) ? { gainDb: eqClamp(item.gainDb + (event.key === "ArrowUp" ? 1 : -1) * (event.ctrlKey ? 0.1 : 0.5), -18, 18) } : {}; onChange({ ...eq, bands: bands.map((value, i) => i === index ? { ...value, ...updated } : value) }); }}>
          <title>{`${index + 1} · ${frequencyLabel(item.frequency)} Hz · ${item.gainDb.toFixed(1)} dB · Q ${item.q.toFixed(2)}`}</title><circle cx={xAt(item.frequency)} cy={yAt(usesEqGain(item.type) ? item.gainDb : 0)} r={selected === index ? 13 : 11} fill={EQ_COLORS[index]} stroke={selected === index ? "white" : "#0f172a"} strokeWidth="2" /><text x={xAt(item.frequency)} y={yAt(usesEqGain(item.type) ? item.gainDb : 0) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111827" pointerEvents="none">{index + 1}</text>
        </g>)}
      </svg>
    </div>
    <div className="flex flex-wrap gap-1.5">{bands.map((item, index) => <button key={index} type="button" aria-label={`选择 EQ 频段 ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)} className={`min-w-0 flex-1 rounded-md border py-1.5 text-[10px] ${selected === index ? "border-white/25 bg-white/8" : "border-transparent bg-white/3"}`} style={{ color: EQ_COLORS[index], opacity: item.enabled ? 1 : 0.4 }}>{index + 1}<span className="block font-mono text-[9px]">{frequencyLabel(item.frequency)}</span></button>)}</div>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><label className="space-y-1 text-[10px] text-white/40">滤波类型<select aria-label="EQ 滤波类型" value={band.type} onChange={event => updateBand({ type: event.target.value as StudioEqBand["type"] })} className="w-full rounded-md bg-slate-800 px-2 py-1.5 text-xs text-white">{EQ_TYPES.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label><EqNumber label="频率 Hz" value={band.frequency} min={20} max={20000} step={1} onChange={frequency => updateBand({ frequency })} /><EqNumber label="增益 dB" value={band.gainDb} min={-18} max={18} step={0.1} disabled={!usesEqGain(band.type)} onChange={gainDb => updateBand({ gainDb })} /><EqNumber label="带宽 Q" value={band.q} min={0.1} max={18} step={0.05} disabled={band.type === "lowshelf" || band.type === "highshelf"} onChange={q => updateBand({ q })} /></div>
    <div className="flex flex-wrap items-end justify-between gap-3"><button type="button" aria-pressed={band.enabled} onClick={() => updateBand({ enabled: !band.enabled })} className="rounded bg-white/8 px-3 py-2 text-[11px] text-white/60">频段 {selected + 1} · {band.enabled ? "已启用" : "已关闭"}</button><div className="w-28"><EqNumber label="EQ 输出 dB" value={eq.outputDb ?? 0} min={-18} max={18} step={0.1} onChange={outputDb => onChange({ ...eq, outputDb })} /></div></div>
    <p className="text-[10px] leading-5 text-white/35">拖点调频率 / 增益，滚轮调 Q（搁架固定斜率），Ctrl 精调，双击重置单段。灰色为本轨输出频谱，浅线为实际滤波响应；旁通可对比音色。高通 / 低通使用 12 dB/oct，采用标准 IIR 滤波。</p>
  </section>;
}
