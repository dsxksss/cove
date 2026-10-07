import { useRef } from "react";

export function StudioPanKnob({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const drag = useRef<{ id: number; y: number; value: number } | null>(null);
  const text = value === 0 ? "居中" : `${value < 0 ? "左" : "右"} ${Math.round(Math.abs(value) * 100)}%`;
  return <div className="flex flex-col items-center gap-2">
    <div className="relative h-16 w-16 rounded-full border border-white/10 bg-slate-950 shadow-inner focus-within:ring-2 focus-within:ring-lime-200/50">
      <svg aria-hidden="true" viewBox="0 0 64 64" className="absolute inset-0"><circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,.13)" strokeWidth="2" /><circle cx="32" cy="32" r="23" fill="rgba(255,255,255,.07)" /><g transform={`rotate(${value * 135} 32 32)`}><line x1="32" x2="32" y1="12" y2="23" stroke="#d9f99d" strokeWidth="3" strokeLinecap="round" /></g></svg>
      <input aria-label="音轨声像" aria-valuetext={text} type="range" min="-1" max="1" step="0.01" value={value} onChange={event => onChange(Number(event.target.value))}
        title="上下拖动调整声像，Shift 精调，双击居中" className="absolute inset-0 h-full w-full cursor-ns-resize opacity-0"
        onDoubleClick={event => { event.stopPropagation(); onChange(0); }}
        onPointerDown={event => { if (event.button !== 0 || event.currentTarget.matches(":disabled")) return; event.preventDefault(); event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: event.pointerId, y: event.clientY, value }; }}
        onPointerMove={event => { if (event.currentTarget.matches(":disabled")) { drag.current = null; return; } const current = drag.current; if (!current || current.id !== event.pointerId) return; current.value = Math.max(-1, Math.min(1, current.value + (current.y - event.clientY) / 100 * (event.shiftKey ? 0.1 : 1))); current.y = event.clientY; onChange(Math.round(current.value * 100) / 100); }}
        onLostPointerCapture={() => { drag.current = null; }} onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }} />
    </div>
    <button type="button" onClick={() => onChange(0)} title="重置声像" className="rounded px-2 py-1 font-mono text-xs text-lime-100 hover:bg-white/10">{text}</button>
  </div>;
}
