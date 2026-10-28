/** Background queue regression: worker survives without a StudioWorkspace instance. */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
try {
  await page.goto(base);
  const result = await page.evaluate(async () => {
    const calls = [];
    const jobs = new Map();
    const cacheWrites = [];
    let active = 0;
    let maxActive = 0;
    window.__TAURI_INTERNALS__ = { invoke: async (command, payload) => {
      calls.push(command);
      if (command === "studio_prepare_instrumental") {
        active += 1; maxActive = Math.max(maxActive, active);
        const jobId = `job-${jobs.size + 1}`; jobs.set(jobId, { polls: 0 });
        return { jobId };
      }
      if (command === "studio_job_status") {
        const job = jobs.get(payload.jobId); job.polls += 1;
        if (job.polls < 3) return { state: "running", stage: "separate", progress: job.polls / 3, message: "分离人声" };
        active -= 1; return { state: "completed", stage: "finalize", progress: 1, message: "已完成" };
      }
      if (command === "studio_job_audio") return { name: "伴奏.wav", base64: "AA==" };
      if (command === "studio_cache_write") { cacheWrites.push(payload); return null; }
      if (command === "studio_cancel_job") { active -= 1; return null; }
      throw new Error(`unexpected command ${command}`);
    } };
    const { useStudioQueueStore } = await import("/src/studio/studioQueueStore.ts");
    const input = { projectId: "p1", cacheId: "netease-1", title: "第一首", target: "instrumental", input: { sourceUrl: "https://example.test/one.mp3", fileName: "one.mp3" } };
    const first = useStudioQueueStore.getState().enqueue(input);
    const duplicate = useStudioQueueStore.getState().enqueue(input);
    if (first !== duplicate) throw new Error("same cache was enqueued twice");
    const second = useStudioQueueStore.getState().enqueue({ ...input, projectId: "p2", cacheId: "netease-2", title: "第二首", input: { sourceUrl: "https://example.test/two.mp3", fileName: "two.mp3" } });
    await new Promise((resolve, reject) => {
      const end = Date.now() + 10000;
      const timer = setInterval(() => {
        const items = useStudioQueueStore.getState().items;
        if (items.find(item => item.id === second)?.state === "completed") { clearInterval(timer); resolve(); }
        else if (Date.now() > end) { clearInterval(timer); reject(new Error(JSON.stringify(items))); }
      }, 50);
    });
    const items = useStudioQueueStore.getState().items;
    return { first: items.find(item => item.id === first)?.state, second: items.find(item => item.id === second)?.state, maxActive, prepareCalls: calls.filter(command => command === "studio_prepare_instrumental").length, cacheWrites: cacheWrites.length };
  });
  assert.deepEqual(result, { first: "completed", second: "completed", maxActive: 1, prepareCalls: 2, cacheWrites: 4 });
  console.log("Studio queue PASS: survives without workspace, deduplicates active jobs, runs serially, preserves completion and cache writes.");
} finally { await browser.close(); }
