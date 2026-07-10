import { create } from "zustand";

export type ToastTone = "info" | "warning" | "error" | "success";

export type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
  /** ms; 0 = sticky until dismissed */
  duration: number;
};

type ToastState = {
  items: ToastItem[];
  push: (message: string, opts?: { tone?: ToastTone; duration?: number }) => number;
  dismiss: (id: number) => void;
  clear: () => void;
};

let seq = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  items: [],
  push: (message, opts) => {
    const text = String(message ?? "").trim();
    if (!text) return -1;
    const id = seq++;
    const tone = opts?.tone ?? "info";
    const duration = opts?.duration ?? (tone === "error" || tone === "warning" ? 4200 : 3200);
    // Dedupe identical live messages so rapid auto-skip doesn't stack spam.
    const existing = get().items.find((t) => t.message === text);
    if (existing) {
      set({
        items: get().items.map((t) =>
          t.id === existing.id ? { ...t, tone, duration } : t,
        ),
      });
      return existing.id;
    }
    set({ items: [...get().items, { id, message: text, tone, duration }].slice(-4) });
    return id;
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
  clear: () => set({ items: [] }),
}));

export function toast(
  message: string,
  opts?: { tone?: ToastTone; duration?: number },
): number {
  return useToastStore.getState().push(message, opts);
}

export function toastError(message: string, duration?: number): number {
  return toast(message, { tone: "error", duration });
}

export function toastWarning(message: string, duration?: number): number {
  return toast(message, { tone: "warning", duration });
}
