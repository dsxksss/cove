/** Deterministic local scroll workload. Compare matching labels, not absolute FPS. */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const label = process.argv[2] || "current";
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error("Invalid report label");
const output = new URL("../.tmp/scroll-profile/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__scroll_profile", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
  // Count row function executions only in the test response; production source
  // contains no counters and React.memo itself remains unchanged.
  await page.route("**/src/components/CollectionSongVirtualList.tsx*", async (route) => {
    const response = await route.fetch();
    const original = await response.text();
    assert.ok(original.includes("const handleDragStart ="));
    const body = original.replace("const handleDragStart =", "window.__rowRenders = (window.__rowRenders || 0) + 1; const handleDragStart =");
    await route.fulfill({ response, body });
  });
  await page.route("**/test-cover/*", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#314c78"/><circle cx="48" cy="48" r="25" fill="#879cac"/></svg>',
  }));
  await page.goto(`${process.env.COVE_TEST_URL || "http://127.0.0.1:1420"}/__scroll_profile`);
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
    const { CollectionSongVirtualList } = await import("/src/components/CollectionSongVirtualList.tsx");
    const list = Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, name: `歌曲-${i + 1}`, artist: "歌手", pic: `/test-cover/${i % 40}` }));
    const noop = () => {};
    window.__commits = [];
    window.__rowRenders = 0;
    const props = { open: true, mode: "playlists", list, queue: [], activeIndex: -1, isBrowsing: true, isAppBrowsing: false,
      browseLoadingMore: false, browsePlaylistId: 1, scrollRef: React.createRef(), resetKey: "profile", dragIndex: null,
      onPlay: noop, onOpenActions: noop, onRemove: noop, onMove: noop, onDragStateChange: noop,
      listTotal: list.length, listLoadingMore: false, showLoadMoreFooter: false };
    const root = createRoot(document.getElementById("root"));
    root.render(React.createElement(React.Profiler, { id: "list", onRender: (_, phase, duration) => window.__commits.push({ phase, duration }) },
      React.createElement("div", { style: { height: 580, width: 1000, display: "flex", flexDirection: "column" } }, React.createElement(CollectionSongVirtualList, props))));
  });
  const scroll = page.locator(".overflow-y-auto");
  await page.getByText("歌曲-1", { exact: true }).waitFor();
  await page.mouse.move(300, 300);
  await page.waitForTimeout(400);
  const client = await page.context().newCDPSession(page);
  await client.send("Performance.enable");
  const measure = async (name, step) => {
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    await page.waitForTimeout(250);
    const before = (await client.send("Performance.getMetrics")).metrics;
    const result = await scroll.evaluate(async (element, step) => {
      window.__rowRenders = 0;
      window.__commits = [];
      const frames = [];
      let last = performance.now();
      let maxRows = 0;
      let uncovered = 0;
      for (let i = 0; i < 240; i++) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        frames.push(now - last); last = now;
        // Check painted coverage from the previous frame before moving again.
        const rows = [...element.querySelectorAll(".app-liquid-row")];
        maxRows = Math.max(maxRows, rows.length);
        if (rows.length) {
          const viewport = element.getBoundingClientRect();
          const first = rows[0].getBoundingClientRect();
          const end = rows.at(-1).getBoundingClientRect();
          if (first.top > viewport.top + 24 || end.bottom < viewport.bottom - 24) uncovered++;
        }
        element.scrollTop += step;
      }
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const sorted = frames.slice(1).sort((a, b) => a - b);
      return { rowRenders: window.__rowRenders, commits: window.__commits.length,
        reactRenderMs: window.__commits.reduce((sum, c) => sum + c.duration, 0),
        frameP95Ms: sorted[Math.floor(sorted.length * .95)], framesOver25Ms: sorted.filter((ms) => ms > 25).length,
        maxRows, uncovered, scrollTop: element.scrollTop };
    }, step);
    const after = (await client.send("Performance.getMetrics")).metrics;
    const delta = (name) => ((after.find((m) => m.name === name)?.value || 0) - (before.find((m) => m.name === name)?.value || 0));
    return { name, ...result, scriptMs: delta("ScriptDuration") * 1000, layoutMs: delta("LayoutDuration") * 1000,
      recalcStyleMs: delta("RecalcStyleDuration") * 1000, layouts: delta("LayoutCount") };
  };
  const reports = [];
  for (const [name, step] of [["slow", 18], ["fast", 174]]) reports.push(await measure(name, step));
  assert.deepEqual(errors, []);
  if (process.argv.includes("--check")) {
    assert.ok(reports[0].rowRenders < 160, "slow scroll should reuse mounted rows");
    assert.ok(reports[1].rowRenders < 1000, "fast scroll should render only entering rows");
    for (const report of reports) {
      assert.ok(report.maxRows <= 28, "DOM remains bounded");
      assert.equal(report.uncovered, 0, "viewport must remain covered");
    }
  }
  const report = { label, environment: "Chromium headless, React development build, 2000 tracks with local covers, 240 frames per workload", reports };
  writeFileSync(new URL(`${label}.json`, output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await page.screenshot({ path: fileURLToPath(new URL(`${label}.png`, output)) });
} finally {
  await browser.close();
}
