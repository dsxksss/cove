/** Exercise the actual compiled frontend, with local authentication/search IPC fixtures. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
const edition = process.argv[2];
assert.ok(["full", "player"].includes(edition));
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const root = resolve(`.tmp/release-${version}-${edition}/frontend`);
const output = resolve(`.tmp/Cove-${version}-Windows-x64`); mkdirSync(output, { recursive: true });
const csp = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).app.security.csp;
const types = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer((request, response) => {
  const target = resolve(root, `.${decodeURIComponent(new URL(request.url, "http://localhost").pathname)}`);
  if (target !== root && !target.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  const file = target === root || target.endsWith(sep) ? resolve(root, "index.html") : target;
  if (!existsSync(file)) { response.writeHead(404).end(); return; }
  response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Security-Policy": csp }); response.end(readFileSync(file));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = []; page.on("pageerror", error => errors.push(error.message));
try {
  const files = readdirSync(resolve(root, "assets"));
  assert.equal(files.some(file => file.startsWith("StudioWorkspace-")), edition === "full");
  assert.equal(existsSync(resolve(root, "studio-recorder.worklet.js")), edition === "full");
  if (edition === "player") {
    for (const file of files.filter(file => file.endsWith(".js"))) {
      const source = readFileSync(resolve(root, "assets", file), "utf8");
      for (const token of ["studio_pitch_audio", "studio_prepare_instrumental", "七段参数均衡器", "打开翻唱工作室", "翻唱工作室"]) assert.ok(!source.includes(token), `${file} contains excluded ${token}`);
    }
  }
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.addInitScript(() => {
    window.editionIpc = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, payload) => {
      window.editionIpc.push(command);
      if (command === "auth_status") return { any_logged_in: true, netease: { logged_in: true, uid: "1", nickname: "版本检查" } };
      if (command === "load_app_playlists") return { exists: true, playlists: [] };
      if (command === "netease_user_playlists") return { data: { playlists: [] } };
      if (command === "netease_playlist_page") return { data: { playlist: { tracks: [], trackTotal: 0, trackOffset: 0 } } };
      if (command === "netease_search") return { data: [{ id: 1, name: "版本检查测试歌曲", artist: "测试歌手", duration: 12000 }] };
      if (command === "studio_list_projects") return [];
      if (command === "studio_cache_read") return null;
      if (command === "studio_prepare_instrumental") throw new Error("验证界面时跳过网络伴奏下载");
      return {};
    } };
  });
  await page.goto(base);
  const studio = page.getByRole("button", { name: "打开翻唱工作室", exact: true });
  await page.getByRole("tab", { name: "搜索", exact: true }).waitFor();
  assert.equal(await studio.count(), edition === "full" ? 1 : 0);
  await page.mouse.move(1270, 400);
  await page.getByRole("tab", { name: "搜索", exact: true }).click();
  await page.getByPlaceholder("搜索歌曲、歌手…").fill("版本检查");
  const more = page.getByRole("button", { name: "更多操作 版本检查测试歌曲", exact: true });
  await more.focus(); await more.press("Enter");
  const dialogStudio = page.getByRole("button", { name: "打开翻唱工作室", exact: true });
  assert.equal(await dialogStudio.count(), edition === "full" ? 2 : 0);
  if (edition === "full") {
    await dialogStudio.last().click();
    await page.getByRole("button", { name: "返回播放器", exact: true }).waitFor();
    await page.getByRole("button", { name: "新建人声轨", exact: true }).click();
    await page.getByRole("button", { name: "移调叠唱 / 一键人声处理 ↗", exact: true }).click();
    await page.getByRole("button", { name: "一键处理当前人声", exact: true }).waitFor();
  } else assert.equal(await page.evaluate(() => window.editionIpc.some(command => command.startsWith("studio_"))), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: resolve(output, `frontend-${edition}.png`) });
  writeFileSync(resolve(output, `frontend-verification-${edition}.json`), JSON.stringify({ version, edition, passed: true, checks: ["compiled assets", "player navigation", "search", "song action menu", edition === "full" ? "studio editor and vocal presets" : "no studio UI, commands, editor or worklet"], nativeIpc: "mocked", errors }, null, 2));
  console.log(`PASS: ${edition} compiled frontend, search, song actions and edition features`);
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
