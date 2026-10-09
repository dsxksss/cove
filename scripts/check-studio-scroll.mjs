/** Real wheel gestures: only the panel under the pointer may scroll. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const output = new URL("../.tmp/studio-scroll-regression/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const labels = ["音轨列表", "音轨片段", "歌词内容", "混音与录音设置"];
const snapshot = () => page.evaluate(labels => ({
  document: [document.documentElement.scrollTop, document.body.scrollTop],
  main: document.querySelector('main').scrollTop,
  aside: document.querySelector('aside').scrollTop,
  header: document.querySelector('header').getBoundingClientRect().top,
  transport: document.querySelector('[aria-label="播放控制"]').getBoundingClientRect().top,
  inputs: document.querySelector('[aria-label="参考音轨导入"]').getBoundingClientRect().top,
  panels: Object.fromEntries(labels.map(label => [label, document.querySelector(`[aria-label="${label}"]`)?.scrollTop ?? 0])),
}), labels);
const assertIsolated = (before, after, own) => {
  if (own) { delete before.panels[own]; delete after.panels[own]; }
  assert.deepEqual(after, before, `scrolling ${own ?? "overlay"} must not move the workspace or other panels`);
};
async function wheelOnly(locator, own) {
  const bounds = await locator.boundingBox();
  const overflow = await locator.evaluate(el => el.scrollHeight > el.clientHeight + 1);
  if (!overflow) return false;
  await locator.evaluate(el => { el.scrollTop = 0; });
  const before = await snapshot();
  await page.mouse.move(bounds.x + bounds.width - 16, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 320);
  await page.waitForFunction(el => el.scrollTop > 0, await locator.elementHandle());
  await page.waitForTimeout(100);
  assertIsolated(before, await snapshot(), own);
  for (const [edge, delta] of [["bottom", 1600], ["top", -1600]]) {
    await locator.evaluate((el, edge) => { el.scrollTop = edge === "bottom" ? el.scrollHeight : 0; }, edge);
    const atEdge = await snapshot();
    await page.mouse.wheel(0, delta); await page.waitForTimeout(160);
    assertIsolated(atEdge, await snapshot(), own);
  }
  return true;
}
try {
  await page.route("**/__studio_scroll", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><div id="root" style="height:100vh;width:100vw"></div></body></html>' }));
  await page.goto(`${base}/__studio_scroll`);
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css?import");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { default: Workspace } = await import("/src/components/StudioWorkspace.tsx");
    const { createStudioProject, createVocalTrack } = await import("/src/studio/types.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    window.__TAURI_INTERNALS__ = { invoke: async command => command === "studio_list_projects" ? Array.from({ length: 30 }, (_, i) => ({ id: `p-${i}`, title: `工程 ${i}`, artist: "歌手" })) : null };
    window.scrollDeviceCount = 30;
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { value: async () => Array.from({ length: window.scrollDeviceCount }, (_, i) => ({ deviceId: `mic-${i}`, kind: "audioinput", label: `麦克风 ${i} — USB Audio Interface` })) });
    const project = createStudioProject({ songId: "scroll", title: "面板滚动测试", artist: "Cove", coverUrl: "", durationSec: 60, lyrics: [0, 10, 20].map(time => ({ time, text: "滚动歌词不会带动时间轴", tr: "Translated lyric with contextual lines" })) });
    const asset = { id: "audio", name: "伴奏.wav", mimeType: "audio/wav", durationSec: 60, url: URL.createObjectURL(encodePcmWav([new Float32Array(48000)], 48000, 16)) };
    project.instrumental = asset; project.tracks[0].assets = [asset];
    project.tracks[0].clips = [{ id: "clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 60 }];
    project.tracks.push(...Array.from({ length: 24 }, (_, i) => createVocalTrack(i + 1)));
    createRoot(document.getElementById("root")).render(React.createElement(Workspace, { project, onBack() {}, onPlayInPlayer() {} }));
  });
  await page.getByRole("button", { name: "播放工作室", exact: true }).waitFor();
  for (const width of [700, 900, 1080, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 700 });
    await page.waitForTimeout(80);
    assert.equal(await page.locator("main").evaluate(el => el.scrollHeight > el.clientHeight), false, "main has no hidden overflowing content");
    for (const label of labels) {
      const scrolled = await wheelOnly(page.getByLabel(label, { exact: true }), label);
      if (label === "音轨列表" || label === "音轨片段" || width < 1024) assert.equal(scrolled, true, `${label} must have an independently scrollable area at ${width}px`);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`${width}-panels.png`, output)) });
  }
  // Horizontal wheels over a vertically scrolling lane still pan the timeline.
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const timeline = page.getByLabel("时间轴视图", { exact: true });
  await timeline.evaluate(el => { el.scrollLeft = 0; });
  const lanes = await page.getByLabel("音轨片段", { exact: true }).boundingBox();
  await page.mouse.move(lanes.x + 60, lanes.y + 25); await page.mouse.wheel(300, 0);
  await page.waitForFunction(el => el.scrollLeft > 0, await timeline.elementHandle());
  await page.getByRole("button", { name: "重置时间轴缩放", exact: true }).click();
  const lyrics = page.getByLabel("歌词内容", { exact: true });
  await lyrics.getByRole("button").last().click();
  await page.setViewportSize({ width: 700, height: 700 });
  await page.waitForTimeout(80);
  const activeLyric = lyrics.locator('[aria-current="true"]');
  const lyricBox = await lyrics.boundingBox(), activeBox = await activeLyric.boundingBox();
  assert.ok(activeBox.y >= lyricBox.y - 1 && activeBox.y + activeBox.height <= lyricBox.y + lyricBox.height + 1, "current lyric stays visible after narrowing the window");
  assert.equal(await page.locator("main").evaluate(el => el.scrollTop), 0, "lyric follow only scrolls its own viewport");
  await page.getByRole("button", { name: "工程", exact: true }).click();
  assert.equal(await wheelOnly(page.getByRole("menu", { name: "工程列表" }), null), true);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 700, height: 700 });
  const track = page.getByRole("button", { name: "音轨 人声 1", exact: true });
  await track.click();
  await page.getByRole("button", { name: "麦克风设备", exact: true }).click();
  const menu = page.getByRole("menu", { name: "选择麦克风" });
  const menuBox = await menu.boundingBox();
  assert.ok(menuBox.y >= 0 && menuBox.x >= 0 && menuBox.x + menuBox.width <= 700 && menuBox.y + menuBox.height <= 700);
  assert.equal(await menu.evaluate(el => el.parentElement === document.body), true, "device menu escapes the settings scroll clipping");
  assert.equal(await menu.getByRole("menuitemradio", { name: "默认麦克风", exact: true }).evaluate(el => el === document.activeElement), true, "opening the portal focuses the selected device");
  assert.equal(await wheelOnly(menu, null), true);
  await page.screenshot({ path: fileURLToPath(new URL("700-device-menu.png", output)) });
  await page.keyboard.press("Escape");
  const deviceTrigger = page.getByRole("button", { name: "麦克风设备", exact: true });
  assert.equal(await deviceTrigger.evaluate(el => el === document.activeElement), true, "Escape restores the microphone trigger");
  await deviceTrigger.click(); await page.keyboard.press("ArrowDown");
  assert.equal(await menu.getByRole("menuitemradio").nth(1).evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await menu.count(), 0, "Tab dismisses the portal");
  assert.equal(await page.getByRole("switch", { name: "录音倒计时" }).evaluate(el => el === document.activeElement), true, "Tab continues from the trigger, rather than the end of document.body");
  await page.evaluate(() => { window.scrollDeviceCount = 0; navigator.mediaDevices.dispatchEvent(new Event("devicechange")); });
  await deviceTrigger.click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="选择麦克风"] button').length === 1);
  const shortMenuBox = await menu.boundingBox(), triggerBox = await deviceTrigger.boundingBox();
  assert.ok(Math.abs(triggerBox.y - shortMenuBox.y - shortMenuBox.height - 8) < 1, "short upward menus stay 8px from their trigger");
  await menu.getByRole("menuitemradio", { name: "默认麦克风", exact: true }).click();
  assert.equal(await deviceTrigger.evaluate(el => el === document.activeElement), true, "selection restores trigger focus");
  // A short viewport stresses the settings dialog without scrolling its title/tabs.
  await track.dblclick(); await page.setViewportSize({ width: 700, height: 500 });
  const dialog = page.getByRole("dialog", { name: "音轨调整" });
  const closeBefore = await dialog.getByRole("button", { name: "完成", exact: true }).boundingBox();
  assert.equal(await wheelOnly(page.getByLabel("音轨设置内容", { exact: true }), null), true);
  assert.deepEqual(await dialog.getByRole("button", { name: "完成", exact: true }).boundingBox(), closeBefore);
  assert.equal(await dialog.evaluate(el => el.scrollTop), 0);
  await page.screenshot({ path: fileURLToPath(new URL("short-track-dialog.png", output)) });
  assert.deepEqual(errors, []);
  console.log("Panel scrolling PASS: real wheels at 700/900/1080/1440, independent lists/lyrics/settings, both edge boundaries, stable main/header/transport, horizontal timeline, project/device menus and dialog content.");
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)) });
  throw error;
} finally { await browser.close(); }
