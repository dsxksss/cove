import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";
import { useStudioQueueStore } from "../studio/studioQueueStore";

export function StudioQueueIndicator() {
  const items = useStudioQueueStore((state) => state.items);
  const visible = items.filter((item) => item.state === "queued" || item.state === "running" || item.state === "failed" || item.state === "completed").slice(-4);
  if (visible.length === 0) return null;
  const active = visible.filter((item) => item.state === "queued" || item.state === "running");
  return <div className="pointer-events-none fixed right-5 top-5 z-[160] w-80 max-w-[calc(100vw-40px)] space-y-1.5" aria-label="伴奏转换队列">
    {visible.map((item) => <div key={item.id} role="status" className="pointer-events-auto rounded-xl border border-white/10 bg-slate-900/95 p-2.5 shadow-xl backdrop-blur-xl">
      <div className="flex items-center gap-2"><span className="shrink-0 text-lime-200">{item.state === "running" || item.state === "queued" ? <LoaderCircle size={14} className="animate-spin" /> : item.state === "completed" ? <CheckCircle2 size={14} /> : <XCircle size={14} className="text-red-200" />}</span><span className="min-w-0 flex-1 truncate text-[11px] font-bold text-white/80">{item.title}</span><span className="text-[10px] text-white/40">{item.target === "vocals" ? "原曲人声" : "伴奏"}</span></div>
      <p className={`mt-1 truncate text-[10px] ${item.state === "failed" ? "text-red-200/80" : "text-white/45"}`}>{item.state === "queued" ? "排队等待" : item.state === "running" ? `${item.message ?? item.stage} · ${Math.round(item.progress * 100)}%` : item.state === "completed" ? "转换完成，已写入缓存" : item.error ?? "转换失败"}</p>
      {(item.state === "running" || item.state === "queued") && <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-lime-200 transition-[width]" style={{ width: `${Math.max(4, item.progress * 100)}%` }} /></div>}
    </div>)}
    {active.length > 0 && <span className="sr-only">当前有 {active.length} 个伴奏转换任务</span>}
  </div>;
}
