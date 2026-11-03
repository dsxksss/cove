/** Actual FFmpeg pitch PCM through browser IPC fixtures, vocal presets and project reopening. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
const output = new URL("../.tmp/studio-voice-regression/", import.meta.url); mkdirSync(output, { recursive: true });
const ffmpeg = fileURLToPath(new URL("../src-tauri/resources/ncm2acc/ffmpeg.exe", import.meta.url));
const browser = await chromium.launch({ headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1080, height: 850 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
let calls = 0;
await page.exposeFunction("nativePitch", args => {
  calls++;
  const input = new URL(`input-${calls}.wav`, output), target = new URL(`shifted-${calls}.wav`, output);
  writeFileSync(input, Buffer.from(args.inputBase64, "base64"));
  try {
    execFileSync(ffmpeg, ["-v", "error", "-nostdin", "-y", "-i", fileURLToPath(input), "-af", `aresample=48000,rubberband=tempo=1:pitch=${2 ** (args.semitones / 12)}:formant=${args.preserveFormants ? "preserved" : "shifted"}:pitchq=quality,apad=whole_len=${Math.round(args.durationSec * 48000)},atrim=end_sample=${Math.round(args.durationSec * 48000)},asetpts=N/SR/TB`, "-c:a", "pcm_s24le", fileURLToPath(target)], { windowsHide: true });
    return readFileSync(target).toString("base64");
  } finally { unlinkSync(input); }
});
try {
  const csp = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security.csp;
  await page.route("**/__studio_voice", route => route.fulfill({ contentType: "text/html", headers: { "Content-Security-Policy": csp }, body: '<html><body style="margin:0"><div id="root" style="height:100vh"></div></body></html>' }));
  await page.goto(`${process.env.COVE_TEST_URL || "http://127.0.0.1:1420"}/__studio_voice`);
  const result = await page.evaluate(async () => {
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => command === "studio_pitch_audio" ? window.nativePitch(args) : null };
    const { createStudioProject, createVocalTrack } = await import("/src/studio/types.ts");
    const { encodePcmWav } = await import("/src/lib/studioWav.ts");
    const { StudioAudioEngine } = await import("/src/lib/studioAudio.ts");
    const { renderStudioMix, renderStudioAudio } = await import("/src/lib/studioExport.ts");
    const { prepareVocalPreset, VOCAL_PRESETS } = await import("/src/lib/studioVocalPresets.ts");
    const { measureNormalization } = await import("/src/lib/studioNormalization.ts");
    const project = createStudioProject({ songId: "voice", title: "移调叠唱与人声处理", artist: "Test", coverUrl: "", durationSec: 2, lyrics: [] });
    const pcm = Float32Array.from({ length: 96000 }, (_, i) => [0.04, 0.12, 0.07, 0.2][Math.floor(i / 24000)] * Math.sin(2 * Math.PI * 440 * i / 48000));
    const blob = encodePcmWav([pcm], 48000, 24);
    window.voiceRaw = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.readAsDataURL(blob); });
    const asset = { id: "recording", name: "人声录音.wav", url: URL.createObjectURL(blob), durationSec: 2, mimeType: "audio/wav" };
    project.tracks[0].assets = [asset]; project.instrumental = asset;
    const vocal = createVocalTrack(1); vocal.assets = [asset]; vocal.clips = [{ id: "vocal-clip", assetId: asset.id, startSec: 0, offsetSec: 0, durationSec: 2 }];
    vocal.mixer = { ...vocal.mixer, gain: 0.6, pan: -0.25 }; project.tracks.push(vocal);
    const original = JSON.stringify(vocal);
    const reports = [];
    for (const preset of VOCAL_PRESETS) {
      const patch = await prepareVocalPreset(project, vocal.id, preset.id);
      const processed = { ...structuredClone(vocal), ...patch };
      const mixerUnchanged = JSON.stringify(processed.mixer) === JSON.stringify(vocal.mixer);
      const repeated = await prepareVocalPreset({ ...project, tracks: [processed] }, vocal.id, preset.id);
      const backupUnchanged = JSON.stringify(repeated.vocalTreatment.before) === JSON.stringify(patch.vocalTreatment.before);
      const repeatedStable = Math.abs(repeated.effects.outputDb - patch.effects.outputDb) < 0.00001;
      processed.mixer = { ...processed.mixer, gain: 1, pan: 0 };
      const audio = await renderStudioAudio({ ...project, tracks: [processed] });
      const measured = measureNormalization([audio.getChannelData(0), audio.getChannelData(1)], audio.sampleRate, { mode: "average", targetDb: -20, ceilingDb: -6 });
      reports.push({ id: preset.id, mixerUnchanged, backupUnchanged, repeatedStable, rms: measured.inputRmsDb, peak: measured.inputPeakDb });
    }
    const high = structuredClone(vocal); high.id = "harmony"; high.pitch = { semitones: 12, preserveFormants: false }; high.mixer = { ...high.mixer, gain: 0.21, pan: 0.2 };
    const engine = new StudioAudioEngine(); await engine.setProject({ ...project, tracks: [vocal, high] }); await engine.play(0);
    const frequency = buffer => { const data = buffer.getChannelData(0), first = Math.round(buffer.sampleRate * 0.5), last = Math.round(buffer.sampleRate * 1.5); let crossings = 0; for (let i = first + 1; i < last; i++) if (data[i - 1] <= 0 && data[i] > 0) crossings++; return crossings; };
    const live = engine.sources.map(item => ({ id: item.trackId, hz: frequency(item.source.buffer), duration: item.source.buffer.duration }));
    high.mixer = { ...high.mixer, gain: 1, pan: 0 };
    const exported = await engine.context.decodeAudioData(await (await renderStudioMix({ ...project, tracks: [high] })).arrayBuffer());
    const exportHz = frequency(exported); engine.dispose();
    window.voiceProject = project;
    return { reports, originalUnchanged: original === JSON.stringify(vocal), live, exportHz, duration: exported.duration };
  });
  assert.ok(result.originalUnchanged);
  for (const report of result.reports) { assert.ok(report.mixerUnchanged && report.backupUnchanged && report.repeatedStable); assert.ok(report.peak <= -5.99, JSON.stringify(report)); assert.ok(report.rms <= -19.95, JSON.stringify(report)); }
  assert.ok(Math.abs(result.live[0].hz - 440) <= 2 && Math.abs(result.live[1].hz - 880) <= 2);
  assert.ok(Math.abs(result.exportHz - 880) <= 2); assert.equal(result.duration, 2);
  assert.equal(calls, 1, "export reuses the same pitched PCM as live playback");
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css?import");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { default: Workspace } = await import("/src/components/StudioWorkspace.tsx");
    const moduleUrl = path => performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname === path).at(-1)?.name ?? path;
    window.voiceStore = (await import(moduleUrl("/src/studio/studioStore.ts"))).useStudioStore;
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "studio_pitch_audio") { if (window.failPitch) throw new Error("模拟移调失败"); return window.nativePitch(args); }
      if (command === "studio_list_projects") return [];
      if (command === "studio_save_project") { window.voiceSaved = JSON.parse(JSON.stringify(args.project)); return; }
      if (command === "studio_load_project") { const project = structuredClone(window.voiceSaved); project.tracks.forEach(track => track.assets.forEach(asset => { asset.url = "blob:expired"; })); return project; }
      if (command === "studio_read_asset") return window.voiceRaw;
      return null;
    } };
    createRoot(document.getElementById("root")).render(React.createElement(Workspace, { project: window.voiceProject, onBack() {}, onPlayInPlayer() {} }));
  });
  await page.getByRole("button", { name: "音轨 人声 1", exact: true }).click();
  await page.getByRole("button", { name: "移调叠唱 / 一键人声处理 ↗", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "音轨调整", exact: true });
  const semitones = dialog.getByRole("spinbutton", { name: "移调半音", exact: true });
  assert.equal(await semitones.isVisible(), false, "exact pitch starts collapsed");
  assert.equal(await dialog.getByRole("button", { name: "一键处理当前人声", exact: true }).isVisible(), true);
  const basicState = await page.evaluate(() => JSON.stringify(window.voiceStore.getState().project));
  await dialog.locator("summary").filter({ hasText: "高级移调设置" }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(window.voiceStore.getState().project)), basicState, "expanding advanced controls must not change audio");
  await semitones.fill("12"); await dialog.getByRole("button", { name: "应用移调", exact: true }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks[1].pitch?.semitones === 12);
  await dialog.getByRole("button", { name: "恢复原调", exact: true }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks[1].pitch?.semitones === 0);
  await dialog.getByRole("button", { name: "高八度叠唱", exact: true }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks.length === 3);
  assert.equal(await semitones.isVisible(), false, "a new layer also opens with simple controls");
  const layerId = await page.evaluate(() => window.voiceStore.getState().project.tracks[2].id);
  const layer = await page.evaluate(() => window.voiceStore.getState().project.tracks[2]);
  assert.equal(layer.pitch.semitones, 12); assert.ok(Math.abs(layer.mixer.gain - 0.21) < 0.00001);
  await dialog.getByRole("button", { name: "流行主唱", exact: true }).click();
  await dialog.getByRole("button", { name: "一键处理当前人声", exact: true }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks[2].vocalTreatment?.presetId === "lead");
  assert.equal(await page.evaluate(() => window.voiceStore.getState().project.tracks[2].mixer.gain), layer.mixer.gain);
  assert.equal(await page.evaluate(() => window.voiceStore.getState().project.tracks[1].vocalTreatment), undefined);
  await page.screenshot({ path: fileURLToPath(new URL("voice-tools.png", output)) });
  // A failed render must keep the previous pitch, surface an error and allow retry.
  await dialog.locator("summary").filter({ hasText: "高级移调设置" }).click();
  await page.evaluate(() => { window.failPitch = true; });
  await semitones.fill("6"); await dialog.getByRole("button", { name: "应用移调", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.voiceStore.getState().project.tracks[2].pitch.semitones), 12);
  await page.evaluate(() => { window.failPitch = false; });
  await dialog.getByRole("button", { name: "应用移调", exact: true }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks[2].pitch.semitones === 6);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.voiceSaved?.tracks[2].pitch.semitones === 6);
  await page.getByRole("button", { name: "工程", exact: true }).click();
  await page.getByRole("menuitem").filter({ hasText: "移调叠唱与人声处理" }).click();
  await page.waitForFunction(() => window.voiceStore.getState().project.tracks[2].assets[0].url !== "blob:expired");
  const restoredUrls = await page.evaluate(() => window.voiceStore.getState().project.tracks.map(track => track.assets[0].url));
  assert.equal(new Set(restoredUrls).size, 1, "every alias must receive the restored original asset URL");
  await page.getByRole("button", { name: `音轨 ${layer.name}`, exact: true }).click();
  await page.getByRole("button", { name: "移调叠唱 / 一键人声处理 ↗", exact: true }).click();
  await dialog.getByRole("button", { name: "恢复处理前", exact: true }).click();
  const restored = await page.evaluate(id => window.voiceStore.getState().project.tracks.find(track => track.id === id), layerId);
  assert.equal(restored.vocalTreatment, undefined); assert.equal(restored.normalizationGain, undefined);
  assert.deepEqual(restored.effects, layer.effects); assert.equal(restored.mixer.gain, layer.mixer.gain); assert.equal(restored.pitch.semitones, 6);
  await page.setViewportSize({ width: 800, height: 600 });
  assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
  await page.screenshot({ path: fileURLToPath(new URL("voice-tools-small.png", output)) });
  assert.deepEqual(errors, []);
  console.log("PASS: actual pitch PCM, distinct live original/octave, export parity/cache, three measured presets, no stacking, preserved mixer/other tracks, failure rollback/retry, harmony UI and saved-project asset/restore roundtrip.");
} finally { await browser.close(); }
