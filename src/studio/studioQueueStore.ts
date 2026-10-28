import { create } from "zustand";
import { invokeNative } from "../lib/native";

export type StudioQueueState = "queued" | "running" | "completed" | "failed" | "cancelled";
export type StudioQueueItem = {
  id: string;
  projectId: string;
  cacheId: string;
  title: string;
  target: "instrumental" | "vocals";
  input: { inputBase64?: string; sourceUrl?: string; fileName: string };
  state: StudioQueueState;
  stage: string;
  progress: number;
  message?: string;
  error?: string;
  jobId?: string;
  createdAt: string;
  updatedAt: string;
};

type QueueStore = {
  items: StudioQueueItem[];
  enqueue: (input: Omit<StudioQueueItem, "id" | "state" | "stage" | "progress" | "createdAt" | "updatedAt">) => string;
  cancel: (id: string) => void;
  clearFinished: () => void;
};

const MAX_QUEUE_ITEMS = 40;
let workerActive = false;

function now() { return new Date().toISOString(); }
function patch(id: string, value: Partial<StudioQueueItem>) {
  useStudioQueueStore.setState((state) => ({ items: state.items.map((item) => item.id === id ? { ...item, ...value, updatedAt: now() } : item) }));
}
function getItem(id: string) { return useStudioQueueStore.getState().items.find((item) => item.id === id); }

async function runItem(id: string) {
  const item = getItem(id);
  if (!item || item.state === "cancelled") return;
  patch(id, { state: "running", stage: "prepare", progress: 0.02, message: "准备文件" });
  try {
    const started = await invokeNative<{ jobId: string }>("studio_prepare_instrumental", { args: { ...item.input, title: item.title } });
    patch(id, { jobId: started.jobId, stage: "prepare", progress: 0.05 });
    while (true) {
      const current = getItem(id);
      if (!current || current.state === "cancelled") {
        await invokeNative("studio_cancel_job", { jobId: started.jobId }).catch(() => undefined);
        return;
      }
      const status = await invokeNative<{ state: string; stage: string; progress: number; error?: string; message?: string; indeterminate?: boolean }>("studio_job_status", { jobId: started.jobId });
      patch(id, { stage: status.stage, progress: Math.max(0, Math.min(1, status.progress)), message: status.message });
      if (status.state === "running" || status.state === "queued") {
        await new Promise((resolve) => window.setTimeout(resolve, 700));
        continue;
      }
      if (status.state !== "completed") throw new Error(status.error ?? "伴奏任务失败");
      const audio = await invokeNative<{ name: string; base64: string }>("studio_job_audio", { jobId: started.jobId });
      const mimeType = audio.name.toLowerCase().endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
      await invokeNative("studio_cache_write", { cacheId: item.cacheId, stem: item.target === "vocals" ? "vocals" : undefined, name: audio.name, mimeType, inputBase64: audio.base64 });
      if (item.target === "instrumental") {
        const vocals = await invokeNative<{ name: string; base64: string } | null>("studio_job_audio", { jobId: started.jobId, stem: "vocals" }).catch(() => null);
        if (vocals?.base64) await invokeNative("studio_cache_write", { cacheId: item.cacheId, stem: "vocals", name: vocals.name, mimeType: "audio/wav", inputBase64: vocals.base64 }).catch(() => undefined);
      }
      patch(id, { state: "completed", progress: 1, stage: "finalize", message: "已完成" });
      return;
    }
  } catch (error) {
    patch(id, { state: "failed", error: error instanceof Error ? error.message : "伴奏任务失败", message: "转换失败" });
  }
}

async function worker() {
  if (workerActive) return;
  workerActive = true;
  try {
    while (true) {
      const next = useStudioQueueStore.getState().items.find((item) => item.state === "queued");
      if (!next) return;
      await runItem(next.id);
    }
  } finally { workerActive = false; }
}

export const useStudioQueueStore = create<QueueStore>((set, get) => ({
  items: [],
  enqueue: (input) => {
    const existing = get().items.find((item) => item.cacheId === input.cacheId && item.target === input.target && (item.state === "queued" || item.state === "running"));
    if (existing) return existing.id;
    const completed = get().items.find((item) => item.cacheId === input.cacheId && item.target === input.target && item.state === "completed");
    if (completed) return completed.id;
    const id = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = now();
    const newItem: StudioQueueItem = { ...input, id, state: "queued", stage: "prepare", progress: 0, createdAt: timestamp, updatedAt: timestamp };
    set((state) => ({ items: [...state.items, newItem].slice(-MAX_QUEUE_ITEMS) }));
    void worker();
    return id;
  },
  cancel: (id) => patch(id, { state: "cancelled", message: "已取消" }),
  clearFinished: () => set((state) => ({ items: state.items.filter((item) => item.state === "queued" || item.state === "running") })),
}));

