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
    const { renderStudioMix, normalizationGain } = await import("/src/lib/studioExport.ts");
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
    const measured = await normalizationGain(project, "instrumental");
    // Verify that normalization measures the dry input, independent of EQ,
    // compression, fader and pan. Then exercise the same processing in export.
    const track = project.tracks[0];
    track.normalizationGain = measured;
    track.mixer = { gain: 1, pan: -1, mute: false, solo: false };
    track.effects.eq = { lowDb: 0, midDb: 0, highDb: 0 };
    track.effects.compressor.ratio = 1; track.effects.reverb.mix = 0; track.effects.delay.mix = 0;
    track.offsetMs = 250;
    const processed = await engine.context.decodeAudioData(await (await renderStudioMix(project)).arrayBuffer());
    const peak = (samples) => samples.reduce((n, v) => Math.max(n, Math.abs(v)), 0);
    const offsetSample = processed.getChannelData(0).findIndex(v => Math.abs(v) > 0.005);
    const dsp = { measured, expected: Math.pow(10, -1 / 20) / 0.2, left: peak(processed.getChannelData(0)), right: peak(processed.getChannelData(1)), beginsAt: offsetSample / processed.sampleRate };
    // Channel mode runs through the same final bus in live and offline audio.
    track.offsetMs = 0; track.normalizationGain = undefined; track.mixer.pan = 0;
    const decodeMix = async () => engine.context.decodeAudioData(await (await renderStudioMix(project)).arrayBuffer());
    const difference = (audio) => peak(Float32Array.from(audio.getChannelData(0), (value, i) => value - audio.getChannelData(1)[i]));
    const legacy = await decodeMix();
    track.mixer.channelMode = "stereo";
    const explicitStereo = await decodeMix();
    const legacyDifference = peak(Float32Array.from(legacy.getChannelData(0), (value, i) => value - explicitStereo.getChannelData(0)[i]));
    const rightPcm = Float32Array.from(pcm, (_, i) => 0.16 * Math.sin(2 * Math.PI * 440 * i / 48000));
    const stereoUrl = URL.createObjectURL(encodePcmWav([pcm, rightPcm], 48000, 16));
    track.assets[0] = { ...asset, url: stereoUrl };
    const stereoDifference = difference(await decodeMix());
    await engine.setProject(project); await engine.play(0);
    const source = engine.sources[0].source;
    track.mixer.channelMode = "mono";
    await engine.setProject(project);
    const liveStable = engine.isPlaying && engine.sources[0].source === source;
    const monoDifference = difference(await decodeMix());
    track.effects.reverb.mix = 0.4;
    const wetMonoDifference = difference(await decodeMix());
    track.mixer.pan = -1;
    const pannedMono = await decodeMix();
    track.effects.reverb.mix = 0; track.mixer.pan = 0;
    const antiUrl = URL.createObjectURL(encodePcmWav([pcm, Float32Array.from(pcm, value => -value)], 48000, 16));
    track.assets[0] = { ...asset, url: antiUrl };
    const antiPhase = peak((await decodeMix()).getChannelData(0));
    const channels = { legacyDifference, stereoDifference, liveStable, monoDifference, wetMonoDifference, pannedLeft: peak(pannedMono.getChannelData(0)), pannedRight: peak(pannedMono.getChannelData(1)), antiPhase };
    engine.dispose();
    URL.revokeObjectURL(stereoUrl); URL.revokeObjectURL(antiUrl);
    URL.revokeObjectURL(asset.url);
    return { playbackError, exportError, samples, wav, violations, dsp, channels };
  });
  console.log(JSON.stringify({ ...result, wav: result.wav ? "generated" : null }));
  assert.equal(result.playbackError, null, "packaged CSP must permit playback of local audio");
  assert.equal(result.exportError, null, "packaged CSP must permit offline export");
  assert.equal(result.samples, true, "realtime playback must produce audio samples");
  assert.deepEqual(result.violations, []);
  assert.ok(Math.abs(result.dsp.measured - result.dsp.expected) < 0.005, "normalization must measure the summed dry source peak");
  assert.ok(result.dsp.left > 0.5 && result.dsp.right < 0.0001, "export must honor per-track pan");
  assert.ok(result.dsp.beginsAt >= 0.25 && result.dsp.beginsAt < 0.27, "export must honor millisecond track offset");
  assert.equal(result.channels.legacyDifference, 0, "legacy mono input keeps identical stereo playback gain");
  assert.ok(result.channels.stereoDifference > 0.05, "stereo mode preserves independent source channels");
  assert.ok(result.channels.monoDifference < 0.00001 && result.channels.wetMonoDifference < 0.00001, "mono merges dry and effect output equally into left/right");
  assert.ok(result.channels.pannedLeft > 0.02 && result.channels.pannedRight < 0.0001, "mono can still be panned after downmix");
  assert.ok(result.channels.antiPhase < 0.0001, "mono sums both input channels instead of discarding one");
  assert.equal(result.channels.liveStable, true, "live mode changes do not restart scheduled audio");
  const bytes = Buffer.from(result.wav, "base64");
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt16LE(34), 24);
  assert.ok(bytes.subarray(44).some((value) => value !== 0), "export must contain actual audio");
  writeFileSync(new URL("production-mix.wav", output), bytes);
  console.log(`Production CSP PASS: real playback and nonempty 24-bit WAV (${fileURLToPath(output)}).`);

  // Exercise the real workspace buttons, worklet, offline mix and bundled MP3
  // encoder. Only native dialogs/IPC are substituted with this test directory.
  const exports = [];
  const saved = new Map(), assets = new Map();
  let failSave = false, failAssetWrite = false, vocalCache = null;
  let holdAssetWrite = false, releaseAssetWrite = null;
  let exportOutcome = "success", holdExport = false, releaseExport = null;
  await page.exposeFunction("testNative", async (command, args) => {
    if (command === "studio_list_projects") return [];
    if (command === "test_fail_save") { failSave = args.enabled; return; }
    if (command === "test_fail_asset_write") { failAssetWrite = args.enabled; return; }
    if (command === "test_hold_asset_write") { holdAssetWrite = args.enabled; if (!holdAssetWrite) { releaseAssetWrite?.(); releaseAssetWrite = null; } return; }
    if (command === "test_asset_write_pending") return Boolean(releaseAssetWrite);
    if (command === "test_export_outcome") { exportOutcome = args.outcome; return; }
    if (command === "test_hold_export") { holdExport = args.enabled; if (!holdExport) { releaseExport?.(); releaseExport = null; } return; }
    if (command === "test_vocal_cache") { vocalCache = args; return; }
    if (command === "studio_cache_read") return args.stem === "vocals" ? vocalCache : null;
    if (command === "studio_save_project") {
      if (failSave) throw new Error("模拟磁盘写入失败");
      saved.set(args.project.id, structuredClone(args.project));
      return;
    }
    if (command === "studio_write_asset") {
      if (failAssetWrite) throw new Error("模拟录音资产写入失败");
      if (holdAssetWrite) await new Promise(resolve => { releaseAssetWrite = resolve; });
      const path = new URL(`${args.assetId}.wav`, output);
      writeFileSync(path, Buffer.from(args.inputBase64, "base64"));
      assets.set(args.assetId, path);
      return;
    }
    if (command === "studio_denoise_asset") {
      const input = assets.get(args.assetId);
      assert.ok(input, "denoise must wait for the original asset to be written");
      const path = new URL("ui-denoised.wav", output);
      execFileSync(fileURLToPath(new URL("../src-tauri/resources/ncm2acc/ffmpeg.exe", import.meta.url)), ["-v", "error", "-y", "-i", fileURLToPath(input), "-af", `afftdn=nr=${[0,6,12,18][args.strength]}:nf=-40:tn=1`, "-c:a", "pcm_s24le", fileURLToPath(path)], { windowsHide: true });
      return readFileSync(path).toString("base64");
    }
    if (command === "studio_encode_mp3") {
      const wav = new URL("ui-mix.wav", output), mp3 = new URL("ui-mix.mp3", output);
      writeFileSync(wav, Buffer.from(args.inputBase64, "base64"));
      execFileSync(fileURLToPath(new URL("../src-tauri/resources/ncm2acc/ffmpeg.exe", import.meta.url)), ["-v", "error", "-y", "-i", fileURLToPath(wav), "-codec:a", "libmp3lame", "-b:a", "320k", fileURLToPath(mp3)], { windowsHide: true });
      return readFileSync(mp3).toString("base64");
    }
    if (command === "studio_save_export") {
      assert.ok(["wav", "mp3"].includes(args.extension));
      if (holdExport) await new Promise(resolve => { releaseExport = resolve; });
      if (exportOutcome === "cancel") return null;
      if (exportOutcome === "error") throw new Error("模拟导出失败");
      const path = new URL(`ui-export.${args.extension}`, output);
      writeFileSync(path, Buffer.from(args.inputBase64, "base64"));
      exports.push(args.extension);
      return fileURLToPath(path);
    }
    if (command === "studio_export_package_to_file") {
      if (exportOutcome === "cancel") return null;
      if (exportOutcome === "error") throw new Error("模拟导出失败");
      return fileURLToPath(new URL("export.cove-studio", output));
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
    window.micRequests = 0;
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { value: async () => { window.micRequests++; await micContext.resume(); window.currentMicStream = destination.stream.clone(); return window.currentMicStream; } });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { value: async () => [] });
    const { createStudioProject } = await import("/src/studio/types.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const project = createStudioProject({ songId: "test", source: "qq", title: "Production test", artist: "Test artist", coverUrl: "", durationSec: 12, lyrics: [{ time: 0, text: "Test lyric" }] });
    const pcm = Float32Array.from({ length: 48000 * 12 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 220 * i / 48000));
    const asset = { id: "audio", name: "伴奏.wav", url: URL.createObjectURL(encodePcmWav([pcm], 48000, 16)), durationSec: 12, mimeType: "audio/wav" };
    project.instrumental = asset; project.tracks[0].assets = [asset];
    project.tracks[0].clips = [{ id: "clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 12 }];
    const root = createRoot(document.getElementById("root"));
    window.remount = (key) => root.render(React.createElement(Workspace, { key, project, onBack(snapshot) { window.exitedProject = snapshot; }, async onPlayInPlayer(url, snapshot, returnProject) {
      window.playMixCalls = (window.playMixCalls ?? 0) + 1;
      if (window.failMixPlayback) throw new Error("模拟播放器切换失败");
      const audio = new Audio(url); await audio.play();
      window.playerMix = { title: snapshot.title, artist: snapshot.artist, lyrics: snapshot.lyrics, duration: audio.duration, returnProject };
      audio.pause(); URL.revokeObjectURL(url);
    } }));
    localStorage.setItem("cove.studio.record-countdown", "0");
    window.remount("initial");
  });
  const play = page.getByRole("button", { name: "播放工作室", exact: true });
  await play.waitFor();
  assert.equal(await page.getByRole("button", { name: "开始录音", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.micRequests), 0);
  await play.click();
  await page.waitForFunction(() => window.engine.currentTime > 0.2);
  await page.getByRole("button", { name: "暂停工作室播放", exact: true }).click();
  // Deliberately separate the song playhead from the context's lifetime.
  await page.evaluate(() => { window.store.getState().setCurrentTime(7); window.engine.seek(7); });
  await page.getByRole("button", { name: "人声轨", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "开始录音", exact: true }).count(), 1, "creating a vocal track selects it without an extra click");
  assert.equal(await page.evaluate(() => window.micRequests), 0, "selecting a recording track must not request microphone permission");
  await page.getByRole("button", { name: "麦克风设备", exact: true }).click();
  await page.getByRole("button", { name: "开始录音", exact: true }).focus();
  await page.keyboard.press("Space");
  await page.getByText("有声音", { exact: true }).waitFor();
  assert.equal(await page.getByRole("menu", { name: "选择麦克风", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "删除 人声 1", exact: true }).isDisabled(), true);
  await page.getByText("伴奏", { exact: true }).first().click();
  assert.equal(await page.getByLabel("录音控制", { exact: true }).getByText("人声 1", { exact: true }).count(), 1, "switching selection must keep the real recording target visible");
  assert.equal(await page.getByRole("button", { name: "停止录音", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "返回播放器", exact: true }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "导出", exact: true }).isDisabled(), true);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.testNative("test_hold_asset_write", { enabled: true }));
  await page.getByRole("button", { name: "停止录音", exact: true }).evaluate((button) => { button.click(); button.click(); });
  assert.equal(await page.getByRole("button", { name: "正在保存录音", exact: true }).isDisabled(), true);
  assert.ok(await page.evaluate(() => window.store.getState().recordingTrackId), "duplicate stop must not unlock the session during save");
  await page.waitForFunction(async () => await window.testNative("test_asset_write_pending"));
  assert.equal(await page.getByRole("button", { name: "正在保存录音", exact: true }).isDisabled(), true, "recording remains locked while asset persistence is pending");
  assert.equal(await page.getByRole("button", { name: "删除 人声 1", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.testNative("test_hold_asset_write", { enabled: false }));
  await page.waitForFunction(() => !window.store.getState().recordingTrackId && window.store.getState().project.tracks.some((track) => track.kind === "vocal" && track.clips.length));
  assert.ok(Math.abs(await page.evaluate(() => window.store.getState().project.tracks.find((track) => track.kind === "vocal").clips[0].startSec) - 7) < 128 / 48000, "recorded takes must use the song playhead, allowing only worklet frame alignment");
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks.find((track) => track.kind === "vocal").takes.length), 1);
  const latency = page.getByRole("textbox", { name: "输入延迟", exact: true });
  await latency.fill("-"); assert.equal(await latency.inputValue(), "-");
  await latency.fill("-125"); await latency.press("Tab");
  assert.equal(await page.evaluate(() => window.store.getState().project.inputLatencyMs), -125);
  const latencyBox = await latency.boundingBox();
  assert.ok(latencyBox.y > 400, "latency belongs beside the lower recording controls");
  await page.getByRole("button", { name: "音轨调整", exact: true }).click();
  const tools = page.getByRole("dialog", { name: "音轨调整", exact: true });
  await tools.getByRole("textbox", { name: "音轨偏移", exact: true }).fill("-175");
  await tools.getByRole("textbox", { name: "音轨偏移", exact: true }).press("Tab");
  await tools.getByRole("slider", { name: "音轨声像", exact: true }).fill("-0.25");
  await tools.getByRole("tab", { name: "音频处理", exact: true }).click();
  await tools.getByRole("button", { name: "声音归一化", exact: true }).click();
  await tools.getByRole("button", { name: "取消归一化", exact: true }).waitFor();
  assert.ok(await page.evaluate(() => window.store.getState().project.tracks.find(t => t.kind === "vocal").normalizationGain > 1));
  await tools.getByRole("button", { name: "应用降噪", exact: true }).click();
  await tools.getByRole("button", { name: "恢复降噪前", exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] fieldset').disabled);
  // Subsequent edits and takes must survive both reprocessing and restoration.
  await page.evaluate(() => {
    const store = window.store.getState(), track = store.project.tracks.find(t => t.kind === "vocal");
    const clip = track.clips[0];
    window.denoiseOriginalId = track.denoiseOriginalAssets[clip.assetId];
    store.updateClip(track.id, clip.id, { startSec: 6.5, durationSec: clip.durationSec / 2 });
    const original = track.assets.find(a => a.id === window.denoiseOriginalId);
    store.addAssetToTrack(track.id, { ...original, id: original.id }, undefined, 9);
    window.editedClipPositions = window.store.getState().project.tracks.find(t => t.kind === "vocal").clips.map(({ startSec, offsetSec, durationSec }) => ({ startSec, offsetSec, durationSec }));
  });
  await tools.getByRole("button", { name: "应用降噪", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"] fieldset').disabled);
  await tools.getByRole("button", { name: "恢复降噪前", exact: true }).click();
  const restored = await page.evaluate(() => {
    const track = window.store.getState().project.tracks.find(t => t.kind === "vocal");
    return { current: track.clips.map(({ startSec, offsetSec, durationSec }) => ({ startSec, offsetSec, durationSec })), expected: window.editedClipPositions, original: window.denoiseOriginalId, ids: track.clips.map(c => c.assetId), pan: track.mixer.pan, offset: track.offsetMs };
  });
  assert.deepEqual(restored.current, restored.expected);
  assert.deepEqual(restored.ids, [restored.original, restored.original]);
  assert.equal(restored.pan, -0.25); assert.equal(restored.offset, -175);
  await page.screenshot({ path: fileURLToPath(new URL("track-tools.png", output)) });
  await tools.getByRole("button", { name: "完成", exact: true }).click();
  // A separate cached vocal channel must not overwrite either the accompaniment
  // or the full original-song reference track.
  await page.evaluate(async () => {
    const asset = window.store.getState().project.tracks[0].assets[0];
    const blob = await (await fetch(asset.url)).blob();
    const base64 = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
    await window.testNative("test_vocal_cache", { name: "原曲人声.wav", mimeType: "audio/wav", base64 });
    window.store.getState().addReferenceTrack("original");
    window.originalInstrumentalId = asset.id;
  });
  await page.getByRole("button", { name: "原曲人声参考", exact: true }).click();
  await page.waitForFunction(() => window.store.getState().project.tracks.some(t => t.referenceStem === "vocals" && t.clips.length));
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks[0].assets[0].id === window.originalInstrumentalId), true);
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks.filter(t => t.kind === "reference").length), 2);
  assert.equal(await page.evaluate(() => window.store.getState().project.tracks.find(t => t.referenceStem === "vocals").mixer.mute), true);
  // Formal saving is explicit. Discard must restore the last saved baseline,
  // including when the debounce for recovery drafts has elapsed.
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("工程已保存到本地", { exact: true }).waitFor();
  await page.evaluate(() => window.store.getState().updateProjectTitle("未保存的编辑"));
  await page.waitForTimeout(600);
  assert.equal([...saved.values()].at(-1).title, "Production test");
  await page.getByRole("button", { name: "返回播放器", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.store.getState().project.title), "未保存的编辑");
  await page.getByRole("button", { name: "返回播放器", exact: true }).click();
  await page.getByRole("button", { name: "不保存返回", exact: true }).click();
  assert.equal(await page.evaluate(() => window.exitedProject.title), "Production test");
  // The fixture records onBack without unmounting so the failure case can be
  // tested against the same edited project.
  await page.evaluate(() => { window.exitedProject = null; });
  await page.evaluate(() => window.testNative("test_fail_save", { enabled: true }));
  await page.getByRole("button", { name: "返回播放器", exact: true }).click();
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.exitedProject), null);
  await page.evaluate(() => window.testNative("test_fail_save", { enabled: false }));
  await page.getByRole("button", { name: "保存并返回", exact: true }).click();
  await page.waitForFunction(() => window.exitedProject);
  assert.equal(await page.evaluate(() => window.exitedProject.title), "未保存的编辑");
  await page.evaluate(() => window.store.getState().updateProjectTitle("Production test"));
  await page.getByText("人声 1", { exact: true }).first().click();
  console.log("Studio tools PASS: signed latency/offset, pan, normalization, real FFmpeg denoise, restore after edits/new take, distinct cached vocal reference, explicit save/discard/cancel and failed-save guard.");
  for (const label of ["WAV 音频", "MP3 音频"]) {
    await page.evaluate(() => window.testNative("test_hold_export", { enabled: true }));
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("menuitem", { name: new RegExp(label) }).click();
    await page.getByText("请选择导出文件夹和文件名…", { exact: true }).waitFor();
    const progress = page.getByRole("progressbar", { name: "导出进度", exact: true });
    await progress.waitFor();
    assert.equal(await progress.getAttribute("aria-valuenow"), null, "export must not reuse the last accompaniment percentage");
    await page.evaluate(() => window.testNative("test_hold_export", { enabled: false }));
    await page.getByText(/已导出到：/).waitFor();
    await page.getByRole("button", { name: "导出", exact: true }).waitFor();
    assert.equal(await page.getByRole("progressbar").count(), 0, "completed export leaves its result text without a stale progress bar");
  }
  assert.deepEqual(exports, ["wav", "mp3"]);
  const exportedWav = readFileSync(new URL("ui-export.wav", output));
  assert.equal(exportedWav.readUInt16LE(34), 24);
  const mp3 = readFileSync(new URL("ui-export.mp3", output));
  assert.ok(mp3.length > 30000);
  for (const label of ["WAV 音频", "工作室工程包"]) {
    for (const outcome of ["cancel", "error"]) {
      await page.evaluate(outcome => window.testNative("test_export_outcome", { outcome }), outcome);
      await page.getByRole("button", { name: "导出", exact: true }).click();
      await page.getByRole("menuitem", { name: new RegExp(label) }).click();
      await page.getByText(outcome === "cancel" ? "已取消导出" : "模拟导出失败", { exact: true }).waitFor();
      await page.getByRole("button", { name: "导出", exact: true }).waitFor();
      assert.equal(await page.getByRole("progressbar").count(), 0, "cancelled/failed exports must remove progress without hiding their message");
    }
  }
  await page.evaluate(() => window.testNative("test_export_outcome", { outcome: "success" }));
  await page.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("menuitem", { name: /工作室工程包/ }).click();
  await page.getByText(/工程包已导出到：/).waitFor();
  await page.getByRole("button", { name: "导出", exact: true }).waitFor();
  assert.equal(await page.getByRole("progressbar").count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL("export-complete.png", output)) });
  console.log("Export progress PASS: running export animation, no stale stem percentage, success/cancel/error cleanup for audio and project packages, result text retained.");
  const savedBeforePlayback = structuredClone([...saved.values()].at(-1));
  await page.evaluate(() => window.store.getState().updateProjectTitle("未保存试听"));
  await page.waitForTimeout(600);
  const requestPlayerMix = async () => {
    await page.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("menuitem", { name: /在播放器中播放翻唱/ }).click();
    await page.getByRole("dialog", { name: "保存本次翻唱", exact: true }).waitFor();
  };
  await requestPlayerMix();
  assert.equal(await page.evaluate(() => window.playMixCalls ?? 0), 0, "opening confirmation must not render/play or save");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(await page.evaluate(() => window.store.getState().project.title), "未保存试听");
  await requestPlayerMix(); await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "保存本次翻唱", exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => window.playMixCalls ?? 0), 0);
  assert.deepEqual([...saved.values()].at(-1), savedBeforePlayback);
  await requestPlayerMix();
  await page.evaluate(() => window.testNative("test_fail_save", { enabled: true }));
  await page.getByRole("button", { name: "保存并播放", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.playMixCalls ?? 0), 0, "a failed save cannot hand off playback");
  await page.evaluate(() => window.testNative("test_fail_save", { enabled: false }));
  await page.evaluate(() => { window.failMixPlayback = true; });
  await page.getByRole("button", { name: "不保存播放", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟播放器切换失败" }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "保存本次翻唱", exact: true }).count(), 1);
  assert.equal(await page.evaluate(() => window.store.getState().project.title), "未保存试听");
  assert.equal(await page.evaluate(() => localStorage.getItem(`cove.studio.draft.${window.store.getState().project.id}`) !== null), true, "failed handoff must preserve recovery draft");
  await page.evaluate(() => { window.failMixPlayback = false; });
  await page.getByRole("button", { name: "不保存播放", exact: true }).click();
  await page.waitForFunction(() => window.playerMix);
  const mix = await page.evaluate(() => window.playerMix);
  assert.equal(mix.title, "未保存试听"); assert.equal(mix.artist, "Test artist");
  assert.equal(mix.lyrics[0].text, "Test lyric"); assert.ok(mix.duration >= 12);
  assert.equal(mix.returnProject.title, savedBeforePlayback.title);
  assert.deepEqual([...saved.values()].at(-1), savedBeforePlayback, "no-save preview must not persist unsaved edits");
  assert.equal(await page.getByRole("dialog", { name: "保存本次翻唱", exact: true }).count(), 0);
  await page.evaluate(() => { window.playerMix = null; window.store.getState().updateProjectTitle("保存后试听"); });
  await requestPlayerMix();
  await page.getByRole("button", { name: "保存并播放", exact: true }).click();
  await page.waitForFunction(() => window.playerMix);
  assert.equal([...saved.values()].at(-1).title, "保存后试听");
  assert.equal(await page.evaluate(() => window.playerMix.returnProject.title), "保存后试听");
  assert.equal(await page.evaluate(() => window.playerMix.title), "保存后试听");
  console.log("Player preview confirmation PASS: cancel/Escape, no implicit save/play, save failure, handoff failure with draft retention, current unsaved mix plus saved editor baseline, explicit save then play.");
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
  await page.getByRole("button", { name: "暂停工作室播放", exact: true }).click();
  await page.getByRole("button", { name: "人声轨", exact: true }).click();
  await page.getByText("人声 1", { exact: true }).first().click();
  await page.evaluate(() => {
    const resume = window.engine.context.resume.bind(window.engine.context);
    window.engine.context.resume = async () => { await new Promise(resolve => setTimeout(resolve, 100)); return resume(); };
  });
  for (const scenario of [{ from: 0, latency: 100, start: 0, offset: 0.1 }, { from: 0, latency: -100, start: 0.1, offset: 0 }, { from: 3, latency: 100, start: 2.9, offset: 0 }]) {
    await page.evaluate(({ from, latency }) => { window.store.getState().updateLatency(latency); window.store.getState().setCurrentTime(from); window.engine.seek(from); }, scenario);
    await page.getByRole("button", { name: "开始录音", exact: true }).click();
    await page.getByText("正在录音，再次点击停止", { exact: true }).waitFor();
    await page.waitForTimeout(350);
    assert.equal(await page.getByRole("textbox", { name: "输入延迟", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "停止录音", exact: true }).click();
    await page.waitForFunction(() => !window.store.getState().recordingTrackId);
    const take = await page.evaluate(() => {
      const track = window.store.getState().project.tracks.find(t => t.kind === "vocal");
      const clip = track.clips.at(-1), asset = track.assets.find(a => a.id === clip.assetId);
      return { clip, duration: asset.durationSec };
    });
    assert.ok(Math.abs(take.clip.startSec - scenario.start) < 128 / 48000, `record placement ${JSON.stringify(scenario)}`);
    assert.ok(Math.abs(take.clip.offsetSec - scenario.offset) < 128 / 48000, `zero-start compensation ${JSON.stringify(scenario)}`);
    assert.ok(Math.abs(take.clip.durationSec + take.clip.offsetSec - take.duration) < 0.0001, "full source take must remain available after input compensation");
  }
  await page.evaluate(() => {
    const resume = window.engine.context.resume.bind(window.engine.context);
    let count = 0;
    window.engine.context.resume = async () => {
      if (++count === 2) await new Promise(resolve => { window.releaseRecordResume = resolve; });
      await resume();
      if (count >= 2) window.recordResumeReleased = true;
    };
  });
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.waitForFunction(() => window.releaseRecordResume);
  assert.equal(await page.evaluate(() => window.engine.isPlaying), true);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  assert.equal(await page.evaluate(() => window.engine.isPlaying), false, "cancelling pending recording must stop transport immediately");
  await page.evaluate(() => window.releaseRecordResume());
  await page.waitForFunction(() => window.recordResumeReleased);
  assert.equal(await page.evaluate(() => window.engine.isPlaying), false);
  assert.equal(await page.evaluate(() => window.store.getState().recordingTrackId), null);
  console.log("Recording latency PASS: shared origin after 100ms preparation delay, +100/-100 compensation at zero, nonzero placement, immutable capture setting, full source preservation and cancelling a pending start.");
  await page.evaluate(() => window.testNative("test_fail_asset_write", { enabled: true }));
  await page.getByRole("button", { name: "开始录音", exact: true }).click();
  await page.getByText("正在录音，再次点击停止", { exact: true }).waitFor();
  await page.waitForTimeout(150);
  await page.getByRole("button", { name: "停止录音", exact: true }).click();
  await page.getByText(/录音已保留在当前会话，但写入磁盘失败/).waitFor();
  const recoveredAssetId = await page.evaluate(() => window.store.getState().project.tracks.find(t => t.kind === "vocal").assets.at(-1).id);
  assert.equal(assets.has(recoveredAssetId), false);
  await page.evaluate(() => window.testNative("test_fail_asset_write", { enabled: false }));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("工程已保存到本地", { exact: true }).waitFor();
  assert.equal(assets.has(recoveredAssetId), true, "saving retries a failed recording asset after disk recovery");
  assert.ok([...saved.values()].at(-1).tracks.some(track => track.assets.some(asset => asset.id === recoveredAssetId)));
  console.log("Recording guard PASS: track selection, no premature mic permission, active target deletion lock, device menu lock, stopping after switching tracks, delayed persistence and failed asset retry.");
  assert.deepEqual(runtimeErrors, []);
  console.log("Studio export UI PASS: real AudioWorklet take at song time, recording guards/reset, WAV, bundled FFmpeg MP3, player audio and metadata under production CSP (native dialogs mocked).");
} finally { await browser.close(); }
