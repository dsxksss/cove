import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import {
  toast,
  toastWarning,
  useToastStore,
  type ToastTone,
} from "../store/toastStore";
import { usePlayerStore } from "../store/playerStore";

function toneIcon(tone: ToastTone) {
  const cls = "shrink-0";
  switch (tone) {
    case "error":
      return <AlertCircle size={15} className={`${cls} text-rose-300`} />;
    case "warning":
      return <AlertTriangle size={15} className={`${cls} text-amber-300`} />;
    case "success":
      return <CheckCircle2 size={15} className={`${cls} text-emerald-300`} />;
    default:
      return <Info size={15} className={`${cls} text-sky-300`} />;
  }
}

function toneRing(tone: ToastTone): string {
  switch (tone) {
    case "error":
      return "border-rose-400/25 shadow-rose-950/30";
    case "warning":
      return "border-amber-400/25 shadow-amber-950/25";
    case "success":
      return "border-emerald-400/25 shadow-emerald-950/25";
    default:
      return "border-white/12 shadow-black/40";
  }
}

/** Renders toasts + bridges playerStore.error into visible notifications. */
export function ToastHost() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  const error = usePlayerStore((s) => s.error);

  // Bridge store errors → toast (VIP / 音源限制 / 加载失败等).
  useEffect(() => {
    if (!error) return;
    const restricted =
      /会员|VIP|vip|版权|音源|试听|无法播放|受限|付费|无版权/i.test(error);
    if (restricted) toastWarning(error, 4500);
    else toast(error, { tone: "error", duration: 4000 });
  }, [error]);

  useEffect(() => {
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const item of items) {
      if (!item.duration || item.duration <= 0) continue;
      timers.push(setTimeout(() => dismiss(item.id), item.duration));
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [items, dismiss]);

  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
      aria-relevant="additions"
    >
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: -10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: "spring", damping: 24, stiffness: 320 }}
            className={`app-liquid-popover pointer-events-auto flex max-w-[min(420px,92vw)] items-start gap-2.5 rounded-2xl px-3.5 py-2.5 text-left ${toneRing(item.tone)}`}
            role="status"
          >
            <div className="mt-0.5">{toneIcon(item.tone)}</div>
            <p className="min-w-0 flex-1 text-[12.5px] font-semibold leading-snug tracking-wide text-white/90">
              {item.message}
            </p>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/10 hover:text-white/85"
              aria-label="关闭提示"
            >
              <X size={12} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
