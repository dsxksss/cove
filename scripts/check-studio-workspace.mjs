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
  // Context actions must target the clicked track, not stale selection.
  await page.evaluate(() => {
    const store = window.studioStore.getState();
    const id = store.addVocalTrack(); window.menuTrackId = id;
    store.renameTrack(id, "菜单测试");
    const asset = { ...store.project.tracks[0].assets[0], id: "menu-audio" };
    store.addAssetToTrack(id, asset, undefined, 1);
    const clip = window.studioStore.getState().project.tracks.find(t => t.id === id).clips[0];
    store.updateClip(id, clip.id, { durationSec: 4, offsetSec: 1 });
    store.updateTrack(id, { offsetMs: -100 });
  });
  const card = page.getByRole("button", { name: "音轨 菜单测试", exact: true });
  const context = page.getByRole("menu", { name: "音轨右键菜单", exact: true });
  const tools = page.getByRole("dialog", { name: "音轨调整", exact: true });
  const getMenuTrack = () => page.evaluate(() => window.studioStore.getState().project.tracks.find(t => t.id === window.menuTrackId));
  await page.getByRole("button", { name: "音轨 伴奏", exact: true }).click();
  await card.click({ button: "right" });
  await context.getByRole("menuitemcheckbox", { name: "静音音轨", exact: true }).click();
  assert.equal((await getMenuTrack()).mixer.mute, true);
  assert.equal(await page.evaluate(() => window.studioStore.getState().project.tracks[0].mixer.mute), false);
  assert.equal(await card.evaluate(el => document.activeElement === el), true, "menu actions restore focus to their target");
  await page.keyboard.press("Shift+F10");
  await context.getByRole("menuitemcheckbox", { name: "独奏音轨", exact: true }).click();
  assert.equal((await getMenuTrack()).mixer.solo, true);
  await card.dblclick();
  await tools.waitFor();
  const name = tools.getByRole("textbox", { name: "详细音轨名称", exact: true });
  await name.fill("不应保存"); await name.press("Escape");
  assert.equal((await getMenuTrack()).name, "菜单测试", "Escape cancels only the name edit");
  await name.fill("主唱详细设置"); await name.press("Enter");
  await tools.getByRole("slider", { name: "音轨音量", exact: true }).fill("3");
  await tools.getByRole("textbox", { name: "声像", exact: true }).fill("-35");
  await tools.getByRole("textbox", { name: "声像", exact: true }).press("Tab");
  await tools.getByRole("button", { name: "单声道", exact: true }).click();
  let target = await getMenuTrack();
  assert.ok(Math.abs(target.mixer.gain - Math.pow(10, 3 / 20)) < 0.001);
  assert.equal(target.mixer.pan, -0.35); assert.equal(target.mixer.channelMode, "mono");
  await page.screenshot({ path: fileURLToPath(new URL("1080-channel-settings.png", output)) });
  await tools.getByRole("tab", { name: "效果器", exact: true }).click();
  await tools.getByRole("slider", { name: "lowDb", exact: true }).fill("5");
  await tools.getByRole("button", { name: "复制效果器", exact: true }).click();
  await tools.getByRole("button", { name: "完成", exact: true }).click();
  const renamedCard = page.getByRole("button", { name: "音轨 主唱详细设置", exact: true });
  await page.getByRole("button", { name: "音轨 伴奏", exact: true }).click({ button: "right" });
  await context.getByRole("menuitem", { name: "粘贴效果器", exact: true }).click();
  assert.equal(await page.evaluate(() => window.studioStore.getState().project.tracks[0].effects.eq.lowDb), 5);
  await renamedCard.click({ button: "right" });
  await context.getByRole("menuitem", { name: "恢复默认效果", exact: true }).click();
  assert.equal((await getMenuTrack()).effects.eq.lowDb, 0);
  await page.evaluate(() => window.studioStore.getState().setRecordingTrackId(window.menuTrackId));
  await renamedCard.click({ button: "right" });
  assert.equal(await context.getByRole("menuitem", { name: "删除音轨", exact: true }).isDisabled(), true);
  assert.equal(await context.getByRole("menuitem", { name: "音轨详细设置", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.studioStore.getState().setRecordingTrackId(null));
  // Right-click on a trim handle must not scrub or edit. Split uses the
  // displayed timeline position including the track's negative offset.
  const menuClips = page.getByRole("button", { name: "音频片段 主唱详细设置", exact: true });
  await menuClips.first().scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.studioStore.getState().setCurrentTime(2.9); window.studioEngine.seek(2.9); });
  const before = await getMenuTrack();
  await menuClips.first().getByRole("button", { name: "调整片段起点", exact: true }).click({ button: "right" });
  await page.mouse.move(800, 300);
  assert.deepEqual((await getMenuTrack()).clips, before.clips);
  const menuBox = await context.boundingBox();
  assert.ok(menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 1080 && menuBox.y + menuBox.height <= 700);
  await page.screenshot({ path: fileURLToPath(new URL("1080-clip-context.png", output)) });
  await context.getByRole("menuitem", { name: "在播放头处分割", exact: true }).click();
  target = await getMenuTrack();
  assert.equal(target.clips.length, 2); assert.ok(Math.abs(target.clips[0].durationSec - 2) < 0.0001);
  assert.ok(Math.abs(target.clips[1].offsetSec - 3) < 0.0001);
  await menuClips.first().click({ button: "right" });
  await context.getByRole("menuitem", { name: "复制片段到末尾", exact: true }).click();
  assert.equal((await getMenuTrack()).clips.length, 3);
  await menuClips.last().click({ button: "right" });
  await context.getByRole("menuitem", { name: "删除片段", exact: true }).click();
  assert.equal((await getMenuTrack()).clips.length, 2);
  await menuClips.first().dblclick();
  await tools.waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    window.studioStore.getState().setCurrentTime(1.2);
    await window.studioEngine.play(1.2);
    window.beforeDetailsSource = window.studioEngine.sources[0].source;
  });
  await menuClips.first().dblclick();
  await tools.waitFor();
  assert.equal(await page.evaluate(() => window.studioEngine.isPlaying && window.studioEngine.sources[0].source === window.beforeDetailsSource), true, "double-clicking a clip must not pause or restart live audio");
  await page.keyboard.press("Escape");
  await page.locator('[aria-label="音轨片段"] p').filter({ hasText: "主唱详细设置" }).dblclick();
  await tools.waitFor();
  assert.equal(await page.evaluate(() => window.studioEngine.isPlaying && window.studioEngine.sources[0].source === window.beforeDetailsSource), true, "double-clicking a track title must not seek or pause");
  for (const width of [900, 1080]) {
    await page.setViewportSize({ width, height: 700 });
    const box = await tools.boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 700, "details panel stays within the window");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-channel-settings.png`, output)) });
  }
  await page.keyboard.press("Escape");
  await pause.click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await page.evaluate(() => window.savedEffectsProject.tracks.find(t => t.id === window.menuTrackId).mixer.channelMode), "mono");

  // Thin trim markers must still track the visible edge of shifted audio.
  await page.evaluate(() => {
    const store = window.studioStore.getState();
    store.removeTrack(window.menuTrackId);
    store.updateTrack("instrumental", { offsetMs: -350 });
    store.updateClip("instrumental", "clip", { startSec: 0.1, offsetSec: 0.2, durationSec: 2 });
    store.resetEffects("instrumental");
    store.updateMixer("instrumental", { solo: false, mute: false, gain: 1 });
    store.setCurrentTime(0);
  });
  await timeline.scrollIntoViewIfNeeded();
  ruler = await timeline.boundingBox();
  const leftTrim = zoomClip.getByRole("button", { name: "调整片段起点", exact: true });
  const trimStyle = await leftTrim.evaluate(el => ({ width: el.getBoundingClientRect().width, line: el.firstElementChild.getBoundingClientRect().width, fill: getComputedStyle(el).backgroundColor }));
  assert.ok(trimStyle.width <= 6 && trimStyle.line === 1 && trimStyle.fill === "rgba(0, 0, 0, 0)", "trim affordance is a one-pixel edge with a transparent narrow hit target");
  const leftBox = await leftTrim.boundingBox();
  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2); await page.mouse.down();
  await page.mouse.move(leftBox.x + leftBox.width / 2 + ruler.width * 0.2 / 12, leftBox.y + leftBox.height / 2, { steps: 5 }); await page.mouse.up();
  edited = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
  assert.ok(Math.abs(edited.startSec - 0.55) < 0.002 && Math.abs(edited.offsetSec - 0.65) < 0.002 && Math.abs(edited.durationSec - 1.55) < 0.002, "left trimming responds immediately even when a negative track offset hides the source head");
  await page.evaluate(() => window.studioStore.getState().updateClip("instrumental", "clip", { startSec: 0.1, offsetSec: 0.2, durationSec: 2 }));
  const rightBox = await zoomClip.getByRole("button", { name: "调整片段结尾", exact: true }).boundingBox();
  await page.mouse.move(rightBox.x + rightBox.width / 2, rightBox.y + rightBox.height / 2); await page.mouse.down();
  await page.mouse.move(ruler.x - 12, rightBox.y + rightBox.height / 2, { steps: 5 }); await page.mouse.up();
  edited = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips[0]);
  assert.ok(Math.abs(edited.durationSec - 0.3) < 0.002, `right trim retains 50ms of visible audio after the hidden 250ms head, instead of making the clip disappear: ${JSON.stringify({ edited, rightBox, ruler })}`);

  // The cut pointer must use song time after both zoom and horizontal scroll.
  await page.evaluate(() => {
    const store = window.studioStore.getState();
    store.updateTrack("instrumental", { offsetMs: -100 });
    store.updateClip("instrumental", "clip", { startSec: 2, offsetSec: 1, durationSec: 4 });
  });
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  await viewport.evaluate(el => { el.scrollLeft = el.scrollWidth * 0.12; });
  await timeline.focus(); await page.keyboard.press("c");
  const cutTool = page.getByRole("button", { name: "切分工具", exact: true });
  assert.equal(await cutTool.getAttribute("aria-pressed"), "true");
  await page.keyboard.press("v");
  assert.equal(await cutTool.getAttribute("aria-pressed"), "false");
  await cutTool.click();
  assert.equal(await cutTool.getAttribute("aria-pressed"), "true");
  ruler = await timeline.boundingBox();
  const cuttingBox = await zoomClip.boundingBox();
  const cutX = ruler.x + ruler.width * 3.25 / 12, cutY = cuttingBox.y + cuttingBox.height / 2;
  await page.mouse.move(cutX, cutY);
  await page.screenshot({ path: fileURLToPath(new URL("1080-cut-preview.png", output)) });
  await page.mouse.click(cutX, cutY);
  let parts = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts[0].durationSec - 1.35) < 0.002 && Math.abs(parts[1].offsetSec - 2.35) < 0.002, "cut tool preserves source continuity at the pointed song time");
  assert.equal(await page.evaluate(() => window.studioEngine.isPlaying), false);
  await page.keyboard.press("Escape");
  assert.equal(await cutTool.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => window.studioStore.getState().setCurrentTime(4.25));
  await page.getByRole("button", { name: "音频片段 伴奏", exact: true }).last().focus();
  await page.keyboard.press("s");
  parts = await page.evaluate(() => window.studioStore.getState().project.tracks[0].clips);
  assert.equal(parts.length, 3);
  assert.ok(Math.abs(parts[1].durationSec - 1) < 0.002 && Math.abs(parts[2].startSec - 4.35) < 0.002, "S cuts only the focused clip at the playhead");
  await page.keyboard.press("s");
  assert.equal(await page.getByRole("button", { name: "音频片段 伴奏", exact: true }).count(), 3, "repeat cutting at an existing boundary does not create empty clips");
  await page.getByRole("button", { name: "音频片段 伴奏", exact: true }).last().focus();
  await page.keyboard.press("Delete");

  // Decode the exported WAV to verify the real renderer ends at the cut,
  // despite the source song and retained asset still being twelve seconds.
  const cutExport = await page.evaluate(async () => {
    const { renderStudioMix } = await import("/src/lib/studioExport.ts");
    const project = window.studioStore.getState().project;
    const decode = new AudioContext();
    try {
      const audio = await decode.decodeAudioData(await (await renderStudioMix(project)).arrayBuffer());
      const end = audio.getChannelData(0).slice(-4800);
      return { duration: audio.duration, songDuration: project.durationSec, tailPeak: end.reduce((peak, value) => Math.max(peak, Math.abs(value)), 0) };
    } finally { await decode.close(); }
  });
  assert.ok(Math.abs(cutExport.duration - 4.25) < 1 / 48000 && cutExport.songDuration === 12 && cutExport.tailPeak > 0.01, "cut-and-delete export ends with audio at 4.25s, not a silent tail to the 12s song end");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  assert.equal(await page.evaluate(() => window.savedEffectsProject.tracks[0].clips.length), 2, "cut clips are persisted independently");
  for (const width of [900, 1080]) {
    await page.setViewportSize({ width, height: 700 });
    const controls = page.getByRole("group", { name: "时间线编辑工具", exact: true });
    const box = await controls.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, "cut/move controls fit the window");
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-cut-trim.png`, output)) });
  }
  console.log("Cut/export PASS: narrow trim markers, negative-offset left trim, zoomed/scrolled cut preview and click, C/V/Escape and S, no empty boundary clips, delete/save halves, real WAV duration and audible final samples.");
  assert.deepEqual(errors, []);
  console.log("Studio UI PASS: reference inputs, recording guidance, locate/restart, zoom/move/trim, contextual track/clip actions and recording locks, precise split/duplicate, double-click details without audio interruption, volume/pan/mono, effect paste/reset, rename cancellation, save, 1080/900 layout, real Web Audio output.");
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)) });
  throw error;
} finally { await browser.close(); }
