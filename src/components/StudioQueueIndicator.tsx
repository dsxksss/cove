import { CheckCircle2, ChevronUp, ListMusic, LoaderCircle, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioQueueStore } from "../studio/studioQueueStore";

export function StudioQueueIndicator({ hidden = false }: { hidden?: boolean }) {
  const items = useStudioQueueStore((state) => state.items);
  const clearFinished = useStudioQueueStore((state) => state.clearFinished);
  const [expanded, setExpanded] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = items.filter((item) => item.state === "queued" || item.state === "running");
  const visible = items.filter((item) => item.state === "queued" || item.state === "running" || item.state === "failed" || item.state === "completed").slice(-8);

  useEffect(() => {
    if (hidden) setExpanded(false);
  }, [hidden]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !expanded) return;
      event.preventDefault();
      setExpanded(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  if (hidden || visible.length === 0) return null;
  const label = `伴奏转换队列，当前 ${active.length} 个进行中任务，${expanded ? "收起" : "展开"}`;
  return <div className="pointer-events-none fixed right-5 top-[4.75rem] z-[160] flex flex-col items-end gap-2 no-drag" aria-label="伴奏转换队列">
    <button ref={triggerRef} type="button" aria-label={label} aria-expanded={expanded} aria-controls="studio-queue-panel" aria-haspopup="dialog" onClick={() => setExpanded((value) => !value)} className="pointer-events-auto relative grid h-11 w-11 place-items-center rounded-xl border border-white/15 bg-slate-900/95 text-white/70 shadow-xl backdrop-blur-xl transition hover:bg-slate-800 hover:text-white focus-visible:outline-2 focus-visible:outline-lime-200 focus-visible:outline-offset-2">
      {active.length > 0 ? <LoaderCircle size={18} className="animate-spin text-lime-200" /> : <ListMusic size={18} />}
      <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-lime-200 px-1 text-[10px] font-black text-slate-950">{active.length || visible.length}</span>
    </button>
    {expanded && <section id="studio-queue-panel" role="region" aria-label="伴奏转换队列详情" className="pointer-events-auto flex max-h-[min(22rem,calc(100vh-9rem))] w-80 max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/12 bg-slate-900/95 p-2.5 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center gap-2 px-1 pb-1.5"><ListMusic size={14} className="text-lime-200" /><span className="flex-1 text-xs font-bold text-white/80">转换队列</span><span className="text-[10px] text-white/40">{active.length ? `${active.length} 个进行中` : "已处理"}</span>{visible.some((item) => item.state === "completed" || item.state === "failed") && <button type="button" aria-label="清除已完成转换任务" title="清除已完成和失败任务" onClick={clearFinished} className="rounded p-1 text-white/35 hover:bg-white/10 hover:text-white"><Trash2 size={13} /></button>}<button type="button" aria-label="收起转换队列" onClick={() => { setExpanded(false); triggerRef.current?.focus({ preventScroll: true }); }} className="rounded p-1 text-white/35 hover:bg-white/10 hover:text-white"><ChevronUp size={14} /></button></div>
      <div className="min-h-0 space-y-1.5 overflow-y-auto overscroll-y-contain pr-0.5">
        {visible.map((item) => <div key={item.id} className="rounded-xl border border-white/8 bg-white/[0.035] p-2">
          <div className="flex items-center gap-2"><span className="shrink-0 text-lime-200">{item.state === "running" || item.state === "queued" ? <LoaderCircle size={14} className="animate-spin" /> : item.state === "completed" ? <CheckCircle2 size={14} /> : <XCircle size={14} className="text-red-200" />}</span><span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/80">{item.title}</span><span className="text-[10px] text-white/40">{item.target === "vocals" ? "原曲人声" : "伴奏"}</span></div>
          <p className={`mt-1 truncate text-[10px] ${item.state === "failed" ? "text-red-200/80" : "text-white/45"}`}>{item.state === "queued" ? "排队等待" : item.state === "running" ? `${item.message ?? item.stage} · ${Math.round(item.progress * 100)}%` : item.state === "completed" ? "转换完成，已写入缓存" : item.error ?? "转换失败"}</p>
          {(item.state === "running" || item.state === "queued") && <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-200 transition-[width]" style={{ width: `${Math.max(4, item.progress * 100)}%` }} /></div>}
        </div>)}
      </div>
    </section>}
    <span className="sr-only" aria-live="polite" aria-atomic="true">{active.length ? `当前有 ${active.length} 个伴奏转换任务正在后台运行` : "后台伴奏转换已完成"}</span>
  </div>;
}
