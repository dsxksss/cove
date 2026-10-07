/** Studio regression with real Web Audio, synthetic audio and local IPC fixtures. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const csp = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;
const output = new URL("../.tmp/studio-ui-regression/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/__studio_regression", (route) => route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body: '<html><body style="margin:0"><div id="root" style="height:100vh;width:100vw"></div></body></html>' }));
  await page.goto(`${base}/__studio_regression`);
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css?import");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { default: Workspace } = await import("/src/components/StudioWorkspace.tsx");
    const moduleUrl = (path) => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? path;
    const { StudioAudioEngine } = await import(moduleUrl("/src/lib/studioAudio.ts"));
    const subscribe = StudioAudioEngine.prototype.subscribePlayback;
    StudioAudioEngine.prototype.subscribePlayback = function (listener) { window.studioEngine = this; return subscribe.call(this, listener); };
    const { useStudioStore } = await import(moduleUrl("/src/studio/studioStore.ts"));
    window.studioStore = useStudioStore;
    window.__TAURI_INTERNALS__ = { invoke: async (command) => { if (command === "studio_list_projects") return []; return null; } };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { value: async () => [
      { deviceId: "default", kind: "audioinput", label: "默认麦克风" },
      ...Array.from({ length: 8 }, (_, i) => ({ deviceId: `mic-${i}`, kind: "audioinput", label: `麦克风 ${i + 1} (USB Audio Interface / Realtek High Definition Audio)` })),
    ] });
    const { createStudioProject } = await import("/src/studio/types.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const data = Float32Array.from({ length: 48000 * 12 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 48000));
    const blob = encodePcmWav([data], 48000, 16);
    const project = createStudioProject({ songId: "test", title: "Won't Go Home Without You", artist: "Maroon 5", coverUrl: "", durationSec: 12, lyrics: [{ time: 0, text: "I asked her to stay", tr: "我曾试图挽留" }, { time: 4, text: "But she wouldn't listen", tr: "但她不愿听" }] });
    const asset = { id: "test-audio", url: URL.createObjectURL(blob), name: "Won't Go Home Without You (伴奏).wav", mimeType: "audio/wav", durationSec: 12 };
    project.tracks[0].assets = [asset]; project.instrumental = asset;
    project.tracks[0].clips = [{ id: "clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 12 }];
    createRoot(document.getElementById("root")).render(React.createElement(Workspace, { project, onBack() {}, onPlayInPlayer() {} }));
  });
  const play = page.getByRole("button", { name: "播放工作室", exact: true });
  const pause = page.getByRole("button", { name: "暂停工作室播放", exact: true });
  const mic = page.getByRole("button", { name: "麦克风设备", exact: true });
  await play.waitFor();
  await mic.click();
  const menu = page.getByRole("menu", { name: "选择麦克风" });
  await menu.waitFor();
  assert.ok((await menu.boundingBox()).width >= 280, "device menu must have room for a readable device name");
  assert.ok((await menu.boundingBox()).height <= 224, "many devices must scroll instead of covering the whole timeline");
  assert.equal(await menu.getByRole("menuitemradio", { name: "默认麦克风", exact: true }).count(), 1);
  await page.screenshot({ path: fileURLToPath(new URL("1080-device-menu.png", output)) });
  await page.keyboard.press("Escape");
  assert.equal(await menu.count(), 0);

  const timeline = page.getByRole("slider", { name: "时间线播放头", exact: true });
  const slider = page.getByRole("slider", { name: "工作室进度", exact: true });
  const scrub = async (locator, playing) => {
    const box = await locator.boundingBox();
    const y = box.y + (locator === timeline ? 36 : box.height / 2);
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, y, { steps: 8 });
    await page.waitForTimeout(150);
    assert.equal(await (playing ? pause : play).count(), 1, "button must retain the pre-drag state even over the end");
    await page.mouse.move(box.x + box.width * 0.35, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await (playing ? pause : play).count(), 1, "releasing a scrub preserves its original play intent");
    assert.equal(await page.evaluate(() => window.studioEngine.isPlaying), playing);
  };
  await scrub(timeline, false);
  await scrub(slider, false);
  await play.click();
  await page.waitForFunction(() => window.studioEngine.waveform().some((sample) => Math.abs(sample - 128) > 2));
  await scrub(timeline, true);
  await scrub(slider, true);
  await page.waitForFunction(() => window.studioEngine.waveform().some((sample) => Math.abs(sample - 128) > 2));
  await pause.click();
  // End-of-track playback starts from zero rather than falsely lighting pause.
  await slider.focus(); await page.keyboard.press("End"); await play.click();
  await page.waitForFunction(() => window.studioEngine.isPlaying && window.studioEngine.currentTime < 2);
  await pause.click();
  await page.getByRole("button", { name: "回到开头", exact: true }).click();
  const dot = await page.getByRole("button", { name: "拖拽时间线播放头" }).boundingBox();
  const zero = await timeline.getByText("0:00", { exact: true }).boundingBox();
  assert.ok(dot.y + dot.height <= zero.y + 1, "playhead dot and zero label must occupy separate rows");
  const clip = await page.getByRole("button", { name: "音频片段 伴奏", exact: true }).boundingBox();
  const lane = await page.getByLabel("音轨片段", { exact: true }).getByText("伴奏", { exact: true }).boundingBox();
  assert.ok(lane.y + lane.height <= clip.y, "track label must not overlap clip label");
  await page.screenshot({ path: fileURLToPath(new URL("1080-workspace.png", output)) });
  for (const width of [900, 1080]) {
    await page.setViewportSize({ width, height: 700 });
    await mic.scrollIntoViewIfNeeded();
    await mic.click();
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, "device menu must remain within the viewport");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "workspace must not overflow horizontally");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-responsive-menu.png`, output)) });
    await page.keyboard.press("Escape");
  }
  // Clip editing must keep the same transport state and retain its asset cache.
  await timeline.scrollIntoViewIfNeeded();
  const clipControl = page.getByRole("button", { name: "音频片段 伴奏", exact: true });
  let clipBox = await clipControl.boundingBox();
  await page.mouse.move(clipBox.x + clipBox.width / 2, clipBox.y + clipBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(clipBox.x + clipBox.width / 2 + 30, clipBox.y + clipBox.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForFunction(() => window.studioStore.getState().project.tracks[0].clips[0].startSec > 0);
  assert.equal(await page.evaluate(() => window.studioEngine.isPlaying), false);
  await play.click();
  const trim = await page.getByRole("button", { name: "调整片段结尾", exact: true }).boundingBox();
  await page.mouse.move(trim.x + trim.width / 2, trim.y + trim.height / 2); await page.mouse.down();
  await page.mouse.move(trim.x - 40, trim.y + trim.height / 2, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction(() => window.studioStore.getState().project.tracks[0].clips[0].durationSec < 12 && window.studioEngine.isPlaying);
  await pause.click();
  assert.deepEqual(errors, []);
  console.log("Studio UI PASS: 1080/900 layout, device menu, both scrub controls paused/playing, end/restart, clip move/trim, real Web Audio output.");
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)) });
  throw error;
} finally { await browser.close(); }
