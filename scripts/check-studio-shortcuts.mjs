/** Full-App keyboard ownership regression with local audio and deterministic IPC. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const output = new URL("../.tmp/studio-shortcut-tests/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
const modules = {};
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", (response) => {
  const path = new URL(response.url()).pathname;
  if (["/src/store/playerStore.ts", "/src/studio/studioStore.ts", "/src/lib/studioAudio.ts", "/src/lib/audio.ts"].includes(path)) modules[path] = response.url();
});

try {
  // Keep this check independent of real accounts, remote streams and stem jobs.
  await page.route("**/*", (route) => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.shortcutCalls = { toggle: 0, next: 0, prev: 0, seek: 0, mediaPlay: 0, mediaPause: 0 };
    window.shortcutIpc = [];
    window.shortcutMediaHandlers = {};
    if (navigator.mediaSession) {
      Object.defineProperty(navigator.mediaSession, "setActionHandler", {
        configurable: true,
        value(action, handler) { window.shortcutMediaHandlers[action] = handler; },
      });
    }
    window.__TAURI_INTERNALS__ = { invoke: async (command, payload) => {
      window.shortcutIpc.push([command, payload]);
      if (command === "auth_status") return { any_logged_in: true, netease: { logged_in: true, uid: "1", nickname: "快捷键测试" } };
      if (command === "load_app_playlists") return { exists: true, playlists: [] };
      if (command === "netease_user_playlists") return { data: { playlists: [] } };
      if (command === "netease_playlist_page") return { data: { playlist: { tracks: [], trackTotal: 0, trackOffset: 0 } } };
      if (command === "studio_list_projects") return [];
      if (command === "studio_cache_read") return null;
      return {};
    } };
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: async () => [] });
  });
  await page.goto(base);
  await page.getByRole("button", { name: "打开翻唱工作室", exact: true }).waitFor();
  assert.ok(modules["/src/store/playerStore.ts"], "use the same player-store module instance as App");
  await page.evaluate(async (urls) => {
    const { usePlayerStore } = await import(urls["/src/store/playerStore.ts"]);
    const { getAudio } = await import(urls["/src/lib/audio.ts"]);
    const { useStudioStore } = await import(urls["/src/studio/studioStore.ts"]);
    const { StudioAudioEngine } = await import(urls["/src/lib/studioAudio.ts"]);
    window.shortcutPlayerStore = usePlayerStore;
    window.shortcutStudioStore = useStudioStore;
    const subscribe = StudioAudioEngine.prototype.subscribePlayback;
    StudioAudioEngine.prototype.subscribePlayback = function (listener) {
      window.shortcutStudioEngine = this;
      return subscribe.call(this, listener);
    };
    const audio = getAudio();
    Object.defineProperty(audio, "play", { configurable: true, value: async () => { window.shortcutCalls.mediaPlay++; } });
    Object.defineProperty(audio, "pause", { configurable: true, value: () => { window.shortcutCalls.mediaPause++; } });
    usePlayerStore.setState({
      queue: [{ id: "shortcut-song", source: "qq", name: "Shortcut Test", artist: "Test Artist", duration: 60000 }],
      index: 0, duration: 60, currentTime: 0, isPlaying: false, loading: false,
      toggle() { window.shortcutCalls.toggle++; usePlayerStore.setState((state) => ({ isPlaying: !state.isPlaying })); },
      next: async () => { window.shortcutCalls.next++; },
      prev() { window.shortcutCalls.prev++; },
      seek(value) { window.shortcutCalls.seek++; usePlayerStore.setState({ currentTime: value }); },
    });
  }, modules);
  const blur = async () => page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  const calls = async () => page.evaluate(() => ({ ...window.shortcutCalls }));
  const playing = async () => page.evaluate(() => window.shortcutStudioEngine.isPlaying);
  const expectPlaying = async (value) => page.waitForFunction((expected) => window.shortcutStudioEngine.isPlaying === expected, value);
  const noBackgroundActions = async (before, label) => assert.deepEqual(await calls(), before, label);

  await blur();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.shortcutCalls.toggle === 1 && window.shortcutPlayerStore.getState().isPlaying);
  await page.keyboard.press("Space");
  await page.waitForFunction(() => window.shortcutCalls.toggle === 2 && !window.shortcutPlayerStore.getState().isPlaying);
  assert.equal(await page.evaluate(() => typeof window.shortcutMediaHandlers.play), "function");
  await page.evaluate(() => window.shortcutMediaHandlers.play({}));
  assert.equal((await calls()).mediaPlay, 1, "ordinary player media playback callback is active before entering the studio");

  await page.getByRole("button", { name: "打开翻唱工作室", exact: true }).click();
  await page.getByRole("button", { name: "返回播放器", exact: true }).waitFor();
  await page.evaluate(async () => {
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const data = Float32Array.from({ length: 48000 * 60 }, (_, i) => 0.15 * Math.sin(2 * Math.PI * 220 * i / 48000));
    const blob = encodePcmWav([data], 48000, 16);
    const asset = { id: "shortcut-audio", url: URL.createObjectURL(blob), name: "Shortcut Test.wav", mimeType: "audio/wav", durationSec: 60 };
    window.shortcutStudioStore.getState().replaceAssetOnTrack("instrumental", asset);
  });
  await page.getByText("Shortcut Test.wav", { exact: true }).first().waitFor();
  const original = await calls();
  const play = page.getByRole("button", { name: "播放工作室", exact: true });
  const pause = page.getByRole("button", { name: "暂停工作室播放", exact: true });
  const slider = page.getByRole("slider", { name: "工作室进度", exact: true });
  await blur();
  await page.keyboard.press("Space");
  await expectPlaying(true);
  await pause.waitFor();
  await page.waitForFunction(() => window.shortcutStudioEngine.waveform().some((sample) => Math.abs(sample - 128) > 2));
  await page.keyboard.press("Space");
  await expectPlaying(false);
  await noBackgroundActions(original, "studio blank-space shortcut must not change the ordinary player");

  // One physical hold has one effect, including repeated keydown events.
  await page.keyboard.down("Space");
  await expectPlaying(true);
  for (let i = 0; i < 5; i++) await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  assert.equal(await playing(), true, "holding Space must not repeatedly toggle playback");
  await page.keyboard.press("Space");
  await expectPlaying(false);

  // Sliders support the studio shortcut; native buttons retain their own click.
  await slider.focus();
  await page.keyboard.press("Space");
  await expectPlaying(true);
  await page.keyboard.press("Space");
  await expectPlaying(false);
  await play.focus();
  await page.keyboard.press("Space");
  await expectPlaying(true);
  await pause.focus();
  await page.keyboard.press("Space");
  await expectPlaying(false);

  await page.getByRole("button", { name: "重命名工程", exact: true }).click();
  const title = page.getByRole("textbox", { name: "工程名称", exact: true });
  await title.fill("Draft");
  await title.press("End");
  await title.press("Space");
  await title.press("KeyA");
  assert.equal(await title.inputValue(), "Draft a", "project titles accept spaces without playing audio");
  assert.equal(await playing(), false);
  await title.press("Enter");
  await page.getByRole("button", { name: "重命名 伴奏", exact: true }).click();
  const track = page.getByRole("textbox", { name: "音轨名称", exact: true });
  await track.fill("Track");
  await track.press("End");
  await track.press("Space");
  await track.press("KeyA");
  assert.equal(await track.inputValue(), "Track a", "track-card keyboard handling must not swallow nested input spaces");
  assert.equal(await playing(), false);
  await track.press("Enter");

  await blur();
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", isComposing: true, bubbles: true, cancelable: true })));
  assert.equal(await playing(), false, "IME input cannot toggle studio playback");
  for (const key of ["ArrowLeft", "ArrowRight", "Control+ArrowRight", "q", "p", "l", "/", "Control+,"]) await page.keyboard.press(key);
  assert.equal(await page.getByPlaceholder("搜索歌曲、歌手…").count(), 0, "studio keys must not open the ordinary search overlay");
  assert.equal(await page.locator(".context-panel--queue").count(), 0, "studio keys must not open the ordinary queue");
  await noBackgroundActions(original, "studio controls and typing must not call background player shortcuts");

  // MediaSession callbacks are separate from DOM keyboard listeners.
  await page.evaluate(() => {
    for (const action of ["play", "pause", "nexttrack", "previoustrack", "seekbackward", "seekforward", "seekto", "stop"]) {
      window.shortcutMediaHandlers[action]?.({ seekTime: 3, seekOffset: 2 });
    }
  });
  await noBackgroundActions(original, "media keys in studio mode must not start, seek or skip the ordinary player");
  await page.screenshot({ path: fileURLToPath(new URL("studio-shortcuts.png", output)) });

  await page.getByRole("button", { name: "返回播放器", exact: true }).click();
  await page.getByRole("button", { name: "不保存返回", exact: true }).click();
  await page.getByRole("button", { name: "打开翻唱工作室", exact: true }).waitFor();
  await blur();
  await page.keyboard.press("Space");
  await page.waitForFunction((count) => window.shortcutCalls.toggle === count + 1, original.toggle);
  await page.evaluate(() => window.shortcutMediaHandlers.play({}));
  assert.equal((await calls()).mediaPlay, original.mediaPlay + 1, "ordinary media shortcuts restore on studio exit");
  assert.deepEqual(errors, [], "no full-App runtime errors");
  console.log("Studio shortcuts PASS: full App entry/exit, keyboard ownership, real studio audio, held/IME Space, range/native button focus, project/track text spaces, background shortcut isolation, MediaSession isolation/restoration.");
} catch (error) {
  await page.screenshot({ path: fileURLToPath(new URL("failure.png", output)) });
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
}
