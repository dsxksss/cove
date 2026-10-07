/** Real audio loading and mixing under the exact packaged application's CSP. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const output = new URL("../.tmp/studio-production-regression/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const runtimeErrors = [];
page.on("pageerror", (error) => runtimeErrors.push(error.message));
try {
  await page.route("**/__studio_production", (route) => route.fulfill({
    contentType: "text/html", headers: { "Content-Security-Policy": config.app.security.csp },
    body: '<html><body><div id="root" style="height:100vh"></div></body></html>',
  }));
  await page.goto(`${base}/__studio_production`);
  const result = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener("securitypolicyviolation", (event) => violations.push(`${event.effectiveDirective}: ${event.blockedURI}`));
    const { StudioAudioEngine } = await import("/src/lib/studioAudio.ts");
    const { renderStudioMix } = await import("/src/lib/studioExport.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const { createStudioProject } = await import("/src/studio/types.ts");
    const pcm = Float32Array.from({ length: 48000 * 2 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 48000));
    const asset = { id: "audio", name: "本地伴奏.wav", url: URL.createObjectURL(encodePcmWav([pcm], 48000, 16)), durationSec: 2, mimeType: "audio/wav" };
    const project = createStudioProject({ songId: "test", title: "Production test", artist: "Test", coverUrl: "", durationSec: 2, lyrics: [] });
    project.tracks[0].assets = [asset];
    project.tracks[0].clips = [{ id: "clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 2 }];
    project.instrumental = asset;
    const engine = new StudioAudioEngine();
    let playbackError = null, exportError = null, samples = false, wav = null;
    try {
      await engine.setProject(project);
      await engine.play(0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      samples = engine.waveform().some((value) => Math.abs(value - 128) > 2);
    } catch (error) { playbackError = error.message; }
    try {
      const mix = await renderStudioMix(project);
      wav = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(mix); });
    } catch (error) { exportError = error.message; }
    engine.dispose();
    URL.revokeObjectURL(asset.url);
    return { playbackError, exportError, samples, wav, violations };
  });
  console.log(JSON.stringify({ ...result, wav: result.wav ? "generated" : null }));
  assert.equal(result.playbackError, null, "packaged CSP must permit playback of local audio");
  assert.equal(result.exportError, null, "packaged CSP must permit offline export");
  assert.equal(result.samples, true, "realtime playback must produce audio samples");
  assert.deepEqual(result.violations, []);
  const bytes = Buffer.from(result.wav, "base64");
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt16LE(34), 24);
  assert.ok(bytes.subarray(44).some((value) => value !== 0), "export must contain actual audio");
  writeFileSync(new URL("production-mix.wav", output), bytes);
  console.log(`Production CSP PASS: real playback and nonempty 24-bit WAV (${fileURLToPath(output)}).`);

  // Exercise the real workspace buttons, worklet, offline mix and bundled MP3
  // encoder. Only native dialogs/IPC are substituted with this test directory.
  const exports = [];
  await page.exposeFunction("testNative", (command, args) => {
    if (command === "studio_list_projects") return [];
    if (command === "studio_encode_mp3") {
      const wav = new URL("ui-mix.wav", output), mp3 = new URL("ui-mix.mp3", output);
      writeFileSync(wav, Buffer.from(args.inputBase64, "base64"));
      execFileSync(fileURLToPath(new URL("../src-tauri/resources/ncm2acc/ffmpeg.exe", import.meta.url)), ["-v", "error", "-y", "-i", fileURLToPath(wav), "-codec:a", "libmp3lame", "-b:a", "320k", fileURLToPath(mp3)], { windowsHide: true });
      return readFileSync(mp3).toString("base64");
    }
    if (command === "studio_save_export") {
      assert.ok(["wav", "mp3"].includes(args.extension));
      const path = new URL(`ui-export.${args.extension}`, output);
      writeFileSync(path, Buffer.from(args.inputBase64, "base64"));
      exports.push(args.extension);
      return fileURLToPath(path);
    }
    return null;
  });
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css?import");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { default: Workspace } = await import("/src/components/StudioWorkspace.tsx");
    // Vite can append HMR timestamps. Patch the exact module used by Workspace.
    const moduleUrl = (path) => performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path).at(-1)?.name ?? path;
    const { StudioAudioEngine } = await import(moduleUrl("/src/lib/studioAudio.ts"));
    const original = StudioAudioEngine.prototype.subscribePlayback;
    StudioAudioEngine.prototype.subscribePlayback = function (listener) { window.engine = this; return original.call(this, listener); };
    const { useStudioStore } = await import(moduleUrl("/src/studio/studioStore.ts"));
    window.store = useStudioStore;
    const { StudioRecorder } = await import(moduleUrl("/src/lib/studioRecorder.ts"));
    const stop = StudioRecorder.prototype.stop;
    StudioRecorder.prototype.stop = async function () {
      const blob = await stop.call(this);
      // Keep the save pending long enough to check repeated clicks reliably.
      await new Promise((resolve) => setTimeout(resolve, 300));
      return blob;
    };
    window.__TAURI_INTERNALS__ = { invoke: (command, args) => window.testNative(command, args) };
    const micContext = new AudioContext(); window.micContext = micContext;
    const oscillator = micContext.createOscillator();
    oscillator.frequency.value = 440;
    const gain = micContext.createGain(); gain.gain.value = 0.2;
    const destination = micContext.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination); oscillator.start();
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { await micContext.resume(); window.currentMicStream = destination.stream.clone(); return window.currentMicStream; } });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { value: async () => [] });
    const { createStudioProject } = await import("/src/studio/types.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const project = createStudioProject({ songId: "test", source: "qq", title: "Production test", artist: "Test artist", coverUrl: "", durationSec: 12, lyrics: [{ time: 0, text: "Test lyric" }] });
    const pcm = Float32Array.from({ length: 48000 * 12 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 48000));
    const asset = { id: "audio", name: "伴奏.wav", url: URL.createObjectURL(encodePcmWav([pcm], 48000, 16)), durationSec: 12, mimeType: "audio/wav" };
    project.instrumental = asset; project.tracks[0].assets = [asset];
    project.tracks[0].clips = [{ id: "clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 12 }];
    const root = createRoot(document.getElementById("root"));
    window.remount = (key) => root.render(React.createElement(Workspace, { key, project, onBack() {}, async onPlayInPlayer(url, snapshot) {
      const audio = new Audio(url); await audio.play();
      window.playerMix = { title: snapshot.title, artist: snapshot.artist, lyrics: snapshot.lyrics, duration: audio.duration };
      audio.pause(); URL.revokeObjectURL(url);
    } }));
    localStorage.setItem("cove.studio.record-countdown", "0");
    window.remount("initial");
  });
  const play = page.getByRole("button", { name: "播放工作室", exact: true });
  await play.click();
  await page.waitForFunction(() => window.engine.currentTime > 0.2);
  await page.getByRole("button", { name: "暂停工作室播放", exact: true }).click();
  // Deliberately separate the song playhead from the context's lifetime.
  await page.evaluate(() => { window.store.getState().setCurrentTime(7); window.engine.seek(7); });
  await page.getByRole("button", { name: "人声轨", exact: true }).click();
  await page.getByText("人声 1", { exact: true }).first().click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.getByText("有声音", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "返回播放器", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "导出", exact: true }).isDisabled(), true);
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "停止录音", exact: true }).evaluate((button) => { button.click(); button.click(); });
  assert.equal(await page.getByRole("button", { name: "正在保存录音", exact: true }).isDisabled(), true);
  assert.ok(await page.evaluate(() => window.store.getState().recordingTrackId), "duplicate stop must not unlock the session during save");
  await page.waitForFunction(() => !window.store.getState().recordingTrackId && window.store.getState().project.tracks.some((track) => track.kind === "vocal" && track.clips.length));
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks.find((track) => track.kind === "vocal").clips[0].startSec), 7, "recorded takes must use the song playhead, not AudioContext time");
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks.find((track) => track.kind === "vocal").takes.length), 1);
  for (const label of ["WAV 音频", "MP3 音频"]) {
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(label) }).click();
    await page.getByText(/已导出到：/).waitFor();
  }
  assert.deepEqual(exports, ["wav", "mp3"]);
  const exportedWav = readFileSync(new URL("ui-export.wav", output));
  assert.equal(exportedWav.readUInt16LE(34), 24);
  const mp3 = readFileSync(new URL("ui-export.mp3", output));
  assert.ok(mp3.length > 30000);
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: /在播放器中播放翻唱/ }).click();
  await page.waitForFunction(() => window.playerMix);
  const mix = await page.evaluate(() => window.playerMix);
  assert.equal(mix.title, "Production test"); assert.equal(mix.artist, "Test artist");
  assert.equal(mix.lyrics[0].text, "Test lyric"); assert.ok(mix.duration >= 12);
  await page.getByRole("switch", { name: "录音倒计时", exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.getByText("准备录音", { exact: true }).waitFor();
  await page.evaluate(() => window.currentMicStream.getAudioTracks()[0].dispatchEvent(new Event("ended")));
  await page.getByText("麦克风已断开，录音已停止", { exact: true }).waitFor();
  assert.equal(await page.getByText("准备录音", { exact: true }).count(), 0, "device loss must remove the countdown overlay");
  assert.equal(await page.evaluate(() => window.store.getState().recordingTrackId), null);
  await page.getByRole("switch", { name: "录音倒计时", exact: true }).click();
  // An interrupted component must never leave the next session locked.
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.getByText("有声音", { exact: true }).waitFor();
  await page.evaluate(() => window.remount("reentered"));
  await page.waitForFunction(() => !window.store.getState().recordingTrackId);
  await play.click();
  await page.waitForFunction(() => window.engine.isPlaying);
  assert.deepEqual(runtimeErrors, []);
  console.log("Studio export UI PASS: real AudioWorklet take at song time, recording guards/reset, WAV, bundled FFmpeg MP3, player audio and metadata under production CSP (native dialogs mocked).");
} finally { await browser.close(); }
