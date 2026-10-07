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
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => { if (command === "studio_list_projects") return []; if (command === "studio_save_project") window.savedEffectsProject = JSON.parse(JSON.stringify(args.project)); return null; } };
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
  assert.equal(await page.getByRole("button", { name: "粘贴效果器", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "开始录音", exact: true }).count(), 0, "record controls must be unavailable before choosing a vocal track");
  await page.screenshot({ path: fileURLToPath(new URL("1080-no-vocal.png", output)) });
  const importActions = page.getByLabel("参考音轨导入", { exact: true });
  const importBoxes = await Promise.all(["原曲", "原曲人声参考", "本地"].map(name => importActions.getByRole("button", { name, exact: true }).boundingBox()));
  assert.ok(importBoxes[0].x < importBoxes[1].x && importBoxes[1].x < importBoxes[2].x && importBoxes.every(box => box.y === importBoxes[0].y), "original vocal reference belongs between original and local on the same row");
  await importActions.getByRole("button", { name: "本地", exact: true }).click();
  assert.equal(await page.getByRole("menuitem", { name: "导入本地原曲", exact: true }).count(), 1);
  assert.equal(await page.getByRole("menuitem", { name: "从本地歌曲提取人声", exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "新建人声轨", exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).waitFor();
  assert.equal(await page.getByLabel("录音控制", { exact: true }).getByText("人声 1", { exact: true }).count(), 1);
  await page.getByText("伴奏", { exact: true }).first().click();
  assert.equal(await page.getByRole("button", { name: "开始录音", exact: true }).count(), 0);
  await page.getByRole("button", { name: "选择人声轨", exact: true }).click();
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
  const scrub = async (locator) => {
    const box = await locator.boundingBox();
    const y = box.y + (locator === timeline ? 36 : box.height / 2);
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width, y, { steps: 8 });
    await page.waitForTimeout(150);
    assert.equal(await play.count(), 1, "locating pauses playback, including when dragging over the end");
    await page.mouse.move(box.x + box.width * 0.35, y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await play.count(), 1, "releasing a locate waits for an explicit play action");
    assert.equal(await page.evaluate(() => window.studioEngine.isPlaying), false);
  };
  await scrub(timeline);
  await scrub(slider);
  await play.click();
  await page.waitForFunction(() => window.studioEngine.waveform().some((sample) => Math.abs(sample - 128) > 2));
  await scrub(timeline);
  const anchor = await page.evaluate(() => window.studioStore.getState().currentTime);
  await play.click();
  await page.waitForFunction(start => window.studioEngine.currentTime > start + 0.3, anchor);
  await page.getByRole("button", { name: "重新播放", exact: true }).click();
  assert.ok(Math.abs(await page.evaluate(() => window.studioEngine.currentTime) - anchor) < 0.2, "restart uses the locate anchor, not song zero or the running playhead");
  await scrub(slider);
  await play.click();
  await page.waitForFunction(() => window.studioEngine.waveform().some((sample) => Math.abs(sample - 128) > 2));
  await pause.click();
  // End-of-track playback starts from zero rather than falsely lighting pause.
  await slider.focus(); await page.keyboard.press("End"); await play.click();
  await page.waitForFunction(() => window.studioEngine.isPlaying && window.studioEngine.currentTime < 2);
  await pause.click();
  await timeline.focus(); await page.keyboard.press("Home");
  // Copy from one track, then modify that source. Pasting during playback must
  // use the frozen snapshot and keep the existing audio sources scheduled.
  await page.getByText("人声 1", { exact: true }).first().click();
  const copiedEffects = {
    eq: { lowDb: -3, midDb: 5, highDb: 2 },
    compressor: { thresholdDb: -24, ratio: 4, attackMs: 7, releaseMs: 180 },
    reverb: { mix: 0.3, decaySec: 2.4 },
    delay: { mix: 0.2, timeMs: 240, feedback: 0.4 },
  };
  await page.evaluate((effects) => {
    const state = window.studioStore.getState();
    window.effectsSourceId = state.project.tracks.find(t => t.kind === "vocal").id;
    state.updateEffects(window.effectsSourceId, effects);
  }, copiedEffects);
  await page.getByRole("button", { name: "复制效果器", exact: true }).click();
  await page.getByRole("button", { name: "恢复默认效果", exact: true }).click();
  await page.getByText("伴奏", { exact: true }).first().click();
  await play.click();
  await page.waitForFunction(() => window.studioEngine.isPlaying);
  await page.evaluate(() => { window.effectsPlayingSources = window.studioEngine.sources; window.effectsOrigin = window.studioEngine.startContextTime; });
  await page.getByRole("button", { name: "粘贴效果器", exact: true }).click();
  await page.waitForFunction(() => window.studioStore.getState().project.tracks[0].effects.eq.midDb === 5);
  assert.deepEqual(await page.evaluate(() => window.studioStore.getState().project.tracks[0].effects), copiedEffects);
  assert.equal(await page.evaluate(() => window.studioEngine.sources === window.effectsPlayingSources && window.studioEngine.startContextTime === window.effectsOrigin && window.studioEngine.isPlaying), true);
  assert.equal(await pause.count(), 1);
  await page.waitForFunction(() => window.studioEngine.waveform().some(sample => Math.abs(sample - 128) > 2));
  await pause.click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.savedEffectsProject);
  assert.deepEqual(await page.evaluate(() => window.savedEffectsProject.tracks[0].effects), copiedEffects);
  assert.equal(await page.evaluate(() => "effectsClipboard" in window.savedEffectsProject), false);
  await page.getByRole("button", { name: "恢复默认效果", exact: true }).click();
  await timeline.focus(); await page.keyboard.press("Home");
  const dot = await page.getByRole("button", { name: "拖拽时间线播放头" }).boundingBox();
  const zero = await timeline.getByText("0:00", { exact: true }).boundingBox();
  assert.ok(dot.y + dot.height <= zero.y + 1, "playhead dot and zero label must occupy separate rows");
  const clip = await page.getByRole("button", { name: "音频片段 伴奏", exact: true }).boundingBox();
  const lane = await page.getByLabel("音轨片段", { exact: true }).getByText("伴奏", { exact: true }).boundingBox();
  assert.ok(lane.y + lane.height <= clip.y, "track label must not overlap clip label");
  await page.screenshot({ path: fileURLToPath(new URL("1080-workspace.png", output)) });
  const longTrackName = "主唱叠唱和声轨道用于检查效果器复制粘贴按钮是否被挤压";
  await page.evaluate(name => window.studioStore.getState().renameTrack(window.effectsSourceId, name), longTrackName);
  await page.getByText(longTrackName, { exact: true }).first().click();
  for (const width of [900, 1080]) {
    await page.setViewportSize({ width, height: 700 });
    await mic.scrollIntoViewIfNeeded();
    await mic.click();
    const box = await menu.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0, "device menu must remain within the viewport");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "workspace must not overflow horizontally");
    const panel = page.getByRole("group", { name: `${longTrackName} 效果器`, exact: true });
    const panelBox = await panel.boundingBox();
    const actionBoxes = await Promise.all(["复制效果器", "粘贴效果器", "恢复默认效果"].map(name => panel.getByRole("button", { name, exact: true }).boundingBox()));
    for (const box of actionBoxes) assert.ok(box.x >= panelBox.x && box.x + box.width <= panelBox.x + panelBox.width, "effect actions must stay within the panel even with long track names");
    assert.ok(actionBoxes.every(box => Math.abs(box.y - actionBoxes[0].y) < 1), "effect actions must stay on a single row");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-responsive-menu.png`, output)) });
    await page.keyboard.press("Escape");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-effects-recording.png`, output)) });
  }
  await page.evaluate(() => window.studioStore.getState().removeTrack(window.effectsSourceId));
  // Ctrl+wheel must zoom the song around the pointer without browser zoom.
  const viewport = page.getByLabel("时间轴视图", { exact: true });
  await timeline.scrollIntoViewIfNeeded();
  let view = await viewport.boundingBox(), ruler = await timeline.boundingBox();
  const pointerX = view.x + view.width / 2, pointerY = view.y + 40;
  const underPointer = (pointerX - ruler.x) / ruler.width * 12;
  await page.mouse.move(pointerX, pointerY);
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -240); await page.keyboard.up("Control");
  await page.waitForFunction(() => document.querySelector('[aria-label="重置时间轴缩放"]').textContent !== "100%");
  ruler = await timeline.boundingBox();
  assert.ok(Math.abs((pointerX - ruler.x) / ruler.width * 12 - underPointer) < 0.03, "zoom preserves the time under the pointer");
  assert.equal(await page.evaluate(() => innerWidth), 1080);
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth * 0.2; });
  view = await viewport.boundingBox(); ruler = await timeline.boundingBox();
  const seekX = view.x + view.width * 0.4;
  await page.mouse.click(seekX, view.y + 40);
  assert.ok(Math.abs(await page.evaluate(() => window.studioStore.getState().currentTime) - (seekX - ruler.x) / ruler.width * 12) < 0.03, "scrolled zoomed ruler locates the correct song time");
  await page.evaluate(() => window.studioStore.getState().updateClip("instrumental", "clip", { startSec: 2, offsetSec: 0, durationSec: 1 }));
  const zoomClip = page.getByRole("button", { name: "音频片段 伴奏", exact: true });
  await zoomClip.scrollIntoViewIfNeeded();
  let zoomBox = await zoomClip.boundingBox(); ruler = await timeline.boundingBox();
  const secondsPerPixel = 12 / ruler.width;
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2); await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2 + 24, zoomBox.y + zoomBox.height / 2, { steps: 6 }); await page.mouse.up();
  let edited = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
  assert.ok(Math.abs(edited.startSec - (2 + 24 * secondsPerPixel)) < 0.002, "clip dragging respects zoomed seconds per pixel");
  await zoomClip.focus(); await page.keyboard.press("Control+ArrowRight");
  let next = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
  assert.ok(Math.abs(next.startSec - edited.startSec - 0.01) < 0.0001, "Ctrl+arrow nudges a clip by 10ms without changing the playhead");
  zoomBox = await zoomClip.boundingBox();
  const beforeScroll = next.startSec;
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2); await page.mouse.down();
  const scrolled = await viewport.evaluate(el => { const before = el.scrollLeft; el.scrollLeft += 30; return el.scrollLeft - before; });
  await page.waitForFunction(start => window.studioStore.getState().project.tracks[0].clips[0].startSec > start, beforeScroll);
  await page.mouse.up();
  next = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
  assert.ok(Math.abs(next.startSec - beforeScroll - scrolled * secondsPerPixel) < 0.002, "scrolling while holding a clip keeps it underneath the pointer");
  for (const label of ["调整片段起点", "调整片段结尾"]) {
    const handle = page.getByRole("button", { name: label, exact: true });
    await handle.scrollIntoViewIfNeeded();
    const box = await handle.boundingBox();
    const before = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
    const dx = label === "调整片段起点" ? 12 : -12;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
    const after = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
    assert.ok(Math.abs(before.durationSec - after.durationSec - 12 * secondsPerPixel) < 0.002, "zoomed trim preserves its pixel/time mapping");
  }
  await page.screenshot({ path: fileURLToPath(new URL("1080-zoomed-timeline.png", output)) });
  await page.getByRole("button", { name: "重置时间轴缩放", exact: true }).click();
  // A temporarily shortened song during a drag must not destroy its cue.
  await page.evaluate(() => window.studioStore.getState().updateClip("instrumental", "clip", { startSec: 12, offsetSec: 0, durationSec: 12 }));
  await timeline.focus(); await page.keyboard.press("Home");
  await page.keyboard.press("Shift+ArrowRight"); await page.keyboard.press("Shift+ArrowRight");
  assert.equal(await page.getByLabel("播放起点", { exact: true }).textContent(), "0:20.000");
  await zoomClip.scrollIntoViewIfNeeded(); zoomBox = await zoomClip.boundingBox(); ruler = await timeline.boundingBox();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2); await page.mouse.down();
  await page.mouse.move(zoomBox.x + zoomBox.width / 2 - ruler.width / 3, zoomBox.y + zoomBox.height / 2, { steps: 5 });
  assert.equal(await page.getByLabel("播放起点", { exact: true }).textContent(), "0:20.000");
  await page.mouse.move(zoomBox.x + zoomBox.width / 2, zoomBox.y + zoomBox.height / 2, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.getByLabel("播放起点", { exact: true }).textContent(), "0:20.000");
  await page.evaluate(() => window.studioStore.getState().updateClip("instrumental", "clip", { startSec: 0, offsetSec: 0, durationSec: 12 }));
  await timeline.focus(); await page.keyboard.press("Home");
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
  console.log("Studio UI PASS: ordered reference inputs, vocal recording guidance, locate/pause and anchored restart, Ctrl+wheel zoom and pan, 10ms nudge and scaled move/trim, independent effect paste with uninterrupted audio, save, 1080/900 layout, real Web Audio output.");
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)) });
  throw error;
} finally { await browser.close(); }
