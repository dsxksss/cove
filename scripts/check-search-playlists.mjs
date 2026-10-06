/** UI regression with deterministic IPC fixtures; no account or playback requests. */
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const output = new URL("../.tmp/search-playlist-tests/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__regression", (route) => route.fulfill({
    contentType: "text/html",
    body: '<html><body style="background:#172030"><div id="root" style="position:relative;width:1280px;height:800px"></div></body></html>',
  }));
  await page.goto(`${base}/__regression`);
  await page.evaluate(async () => {
    const refresh = (await import("/@react-refresh")).default;
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    await import("/src/index.css?import");
    document.body.style.setProperty("background", "#172030", "important");
    const React = (await import("/node_modules/.vite/deps/react.js")).default;
    const { createRoot } = (await import("/node_modules/.vite/deps/react-dom_client.js")).default;
    const { SearchOverlay } = await import("/src/components/SearchOverlay.tsx");
    const { CollectionSongVirtualList } = await import("/src/components/CollectionSongVirtualList.tsx");
    window.testCalls = [];
    window.testPicks = [];
    window.failSearch = true;
    window.__TAURI_INTERNALS__ = { invoke: async (command, { args }) => {
      window.testCalls.push({ command, keyword: args.keyword });
      await new Promise((resolve) => setTimeout(resolve, args.keyword === "slow" ? 1000 : 30));
      if (args.keyword === "error" && window.failSearch) throw "网易云请求受限";
      const data = args.keyword === "empty" ? [] : Array.from({ length: 40 }, (_, i) => ({
        id: i + 1, name: `${args.keyword}-${i + 1}`, artist: "测试歌手", album: "测试专辑",
      }));
      return { data };
    } };
    localStorage.setItem("nmp.musicSource", "netease");
    const root = createRoot(document.getElementById("root"));
    window.showSearch = (open = true) => root.render(React.createElement(SearchOverlay, {
      open, onClose() {}, onPick(song) { window.testPicks.push(song.name); }, onOpenSongActions() {},
    }));
    const scrollRef = React.createRef();
    window.listActions = [];
    window.showList = (count, resetKey = "playlist", open = true) => root.render(
      React.createElement("div", { style: { height: 440, display: "flex", flexDirection: "column" } },
        React.createElement(CollectionSongVirtualList, {
          open, mode: "playlists", list: Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `歌曲-${i + 1}`, artist: "歌手" })),
          queue: [], activeIndex: -1, isBrowsing: true, isAppBrowsing: false,
          browseLoadingMore: false, browsePlaylistId: 1, scrollRef, resetKey,
          dragIndex: null,
          onPlay(song, index) { window.listActions.push(["play", song.id, index]); },
          onOpenActions(song) { window.listActions.push(["actions", song.id]); },
          onRemove() {}, onMove() {}, onDragStateChange() {},
          listTotal: count, listLoadingMore: false, showLoadMoreFooter: false,
        })),
    );
    window.showSearch();
  });
  const input = page.getByPlaceholder("搜索歌曲、歌手…");
  const song = (name) => page.getByText(name, { exact: true });
  await input.fill("first");
  await song("first-1").waitFor({ state: "visible" });
  await input.fill("second");
  await input.press("Enter");
  assert.equal(await page.evaluate(() => window.testPicks.length), 0, "cannot pick old query during debounce");
  await song("second-1").waitFor({ state: "visible" });
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  assert.equal(await page.evaluate(() => window.testPicks.length), 0, "IME confirmation cannot play");
  await input.fill("中文");
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => window.testCalls.filter((c) => c.keyword === "中文").length), 0, "no search during composition");
  await input.dispatchEvent("compositionend");
  await song("中文-1").waitFor({ state: "visible" });
  await input.fill("slow");
  await page.waitForFunction(() => window.testCalls.some((c) => c.keyword === "slow"));
  await input.fill("fast");
  await song("fast-1").waitFor({ state: "visible" });
  await page.waitForTimeout(1100);
  assert.equal(await song("slow-1").count(), 0, "late response must not replace latest result");
  await page.getByRole("button", { name: "QQ音乐", exact: true }).click();
  await page.waitForFunction(() => window.testCalls.some((c) => c.command === "qq_search"));
  await song("fast-1").waitFor({ state: "visible" });
  await page.getByRole("button", { name: "网易云音乐", exact: true }).click();
  await input.fill("error");
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /网易云请求受限/);
  assert.equal(await song("fast-1").count(), 0);
  await page.evaluate(() => { window.failSearch = false; });
  await page.getByRole("button", { name: "重试搜索" }).click();
  await song("error-1").waitFor({ state: "visible" });
  await input.fill("empty");
  await page.getByText("没有找到相关歌曲", { exact: true }).waitFor();
  await input.fill("slow");
  await page.waitForTimeout(420);
  await page.evaluate(() => window.showSearch(false));
  await page.waitForTimeout(1100);
  await page.evaluate(() => window.showSearch(true));
  await input.waitFor({ state: "visible" });
  assert.equal(await input.inputValue(), "");
  assert.equal(await song("slow-1").count(), 0);

  await page.evaluate(() => window.showList(2000));
  await song("歌曲-1").waitFor({ state: "visible" });
  assert.ok(await page.locator(".app-liquid-row").count() < 30, "long playlists stay virtualized");
  const scroller = page.locator(".overflow-y-auto");
  await scroller.evaluate((element) => { element.scrollTop = 58000; element.dispatchEvent(new Event("scroll")); });
  await song("歌曲-1001").waitFor({ state: "visible" });
  await page.evaluate(() => window.showList(3));
  await song("歌曲-1").waitFor({ state: "visible" });
  assert.equal(await page.locator(".app-liquid-row").count(), 3, "shortened list paints without scrolling");
  await page.evaluate(() => window.showList(1000, "other-platform:1"));
  await song("歌曲-1").waitFor({ state: "visible" });
  assert.equal(await scroller.evaluate((element) => element.scrollTop), 0);
  await page.setViewportSize({ width: 1000, height: 650 });
  await song("歌曲-1").waitFor({ state: "visible" });
  await song("歌曲-1").click();
  const more = page.getByRole("button", { name: "更多操作 歌曲-1", exact: true });
  await more.focus();
  await more.press("Enter");
  assert.deepEqual(await page.evaluate(() => window.listActions), [["play", 1, 0], ["actions", 1]]);
  // Real wheel input as well as deterministic offsets: fling, reverse and then
  // shrink while a scroll frame could still be queued.
  await scroller.hover();
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 348);
  await page.waitForTimeout(200);
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -232);
  await page.evaluate(() => window.showList(3));
  await song("歌曲-1").waitFor({ state: "visible" });
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".app-liquid-row").count(), 3);
  await page.screenshot({ path: fileURLToPath(new URL("playlist-first-paint.png", output)) });
  assert.deepEqual(errors, [], "no browser runtime errors");

  // Exercise the actual animated drawer, navigation and store together.
  const app = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const appErrors = [];
  let appStoreUrl;
  app.on("response", (response) => {
    if (new URL(response.url()).pathname === "/src/store/playerStore.ts") appStoreUrl = response.url();
  });
  app.on("pageerror", (error) => appErrors.push(error.message));
  await app.addInitScript(() => {
    window.appCalls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, payload) => {
      window.appCalls.push([command, payload]);
      if (command === "auth_status") return { any_logged_in: true, netease: { logged_in: true, uid: "1", nickname: "测试账号" } };
      if (command === "load_app_playlists") return { exists: true, playlists: [] };
      if (command === "netease_user_playlists") return { data: { playlists: [
        { id: 11, name: "长歌单", trackCount: 2000, updateTime: 200, creatorUid: 1 },
        { id: 12, name: "短歌单", trackCount: 3, updateTime: 100, creatorUid: 1 },
      ] } };
      if (command === "netease_playlist_page") {
        const { id, limit, offset } = payload.args;
        await new Promise((resolve) => setTimeout(resolve, 60));
        const total = id === 11 ? 2000 : id === 12 ? 3 : 0;
        return { data: { playlist: {
          tracks: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => ({ id: offset + i + 1, name: `${id === 12 ? "短" : "长"}歌曲-${offset + i + 1}`, artist: "歌手" })),
          trackTotal: total, trackOffset: offset,
        } } };
      }
      if (command === "netease_search") return { data: [{ id: 1, name: "搜索回归歌曲", artist: "测试歌手" }] };
      return {};
    } };
  });
  await app.goto(base);
  await app.locator("aside").hover();
  await app.getByRole("tab", { name: "我的歌单", exact: true }).click();
  await app.getByText("长歌曲-1", { exact: true }).waitFor({ state: "visible", timeout: 10000 }).catch(async (error) => {
    await app.screenshot({ path: fileURLToPath(new URL("app-failure.png", output)) });
    console.log(await app.locator("body").innerText(), appErrors);
    throw error;
  });
  assert.ok(await app.locator(".app-liquid-row").count() < 30);
  const appScroller = app.locator('[aria-label="歌单歌曲"]').locator("..");
  await appScroller.evaluate((element) => { element.scrollTop = 58000; element.dispatchEvent(new Event("scroll")); });
  await app.getByText("长歌曲-1001", { exact: true }).waitFor({ state: "visible" });
  await app.locator('[data-cover-idx="1"]').click();
  await app.getByText("短歌曲-1", { exact: true }).waitFor({ state: "visible", timeout: 10000 }).catch(async (error) => {
    await app.screenshot({ path: fileURLToPath(new URL("app-switch-failure.png", output)) });
    console.log(await app.locator("body").innerText(), await app.evaluate(() => window.appCalls), appErrors);
    throw error;
  });
  assert.equal(await appScroller.evaluate((element) => element.scrollTop), 0);
  await app.getByTitle("上一个歌单", { exact: true }).click();
  await app.getByText("长歌曲-1", { exact: true }).waitFor({ state: "visible" });
  await app.getByTitle("下一个歌单", { exact: true }).click();
  await app.getByText("短歌曲-1", { exact: true }).waitFor({ state: "visible" });
  await app.screenshot({ path: fileURLToPath(new URL("app-playlist-first-paint.png", output)) });
  await app.getByRole("tab", { name: "搜索", exact: true }).click();
  await app.getByPlaceholder("搜索歌曲、歌手…").fill("测试");
  await app.getByText("搜索回归歌曲", { exact: true }).waitFor({ state: "visible" });
  await app.screenshot({ path: fileURLToPath(new URL("app-search.png", output)) });
  await app.keyboard.press("Escape");
  assert.ok(appStoreUrl);
  await app.evaluate(async (moduleUrl) => {
    const { usePlayerStore } = await import(moduleUrl);
    usePlayerStore.setState({
      queue: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `队列测试-${i + 1}`, artist: "测试歌手" })),
      index: -1,
    });
  }, appStoreUrl);
  const openQueue = app.getByRole("button", { name: "播放队列", exact: true }).filter({ visible: true });
  const queuePanel = app.locator(".context-panel--queue");
  await openQueue.click();
  await queuePanel.waitFor({ state: "visible" });
  await queuePanel.getByText("播放队列", { exact: true }).click();
  assert.equal(await queuePanel.isVisible(), true, "inside clicks keep the queue open");
  await queuePanel.getByRole("button", { name: "更多操作 队列测试-1", exact: true }).click();
  await app.getByRole("button", { name: "关闭歌曲操作", exact: true }).click();
  assert.equal(await queuePanel.isVisible(), true, "song actions do not dismiss their parent queue");
  const queueScroller = queuePanel.locator('[aria-label="播放队列"]').locator("..");
  await queueScroller.hover();
  await app.mouse.wheel(0, 900);
  await app.waitForFunction(() => document.querySelector('.context-panel--queue [aria-label="播放队列"]').parentElement.scrollTop > 0);
  assert.equal(await queuePanel.isVisible(), true, "wheel scrolling keeps the queue open");
  await app.mouse.click(500, 450);
  await queuePanel.waitFor({ state: "detached" });
  await openQueue.click();
  await queuePanel.getByRole("button", { name: "关闭面板" }).click();
  await queuePanel.waitFor({ state: "detached" });
  await openQueue.click();
  await app.keyboard.press("Escape");
  await queuePanel.waitFor({ state: "detached" });
  console.log("PASS: queue outside click, inside click, song actions, wheel scroll, close button, reopen and Escape.");
  assert.deepEqual(appErrors, [], "no full-app runtime errors");
  console.log("PASS: search debounce, IME, stale responses, source switch, error/retry/empty, close/reopen; playlist first paint, virtualization, shrink, source reset, resize; full App drawer, cover clicks, previous/next playlist, search navigation.");
} finally {
  await browser.close();
}
