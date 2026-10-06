import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const output = new URL("../.tmp/background-check/", import.meta.url);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
  const errors = [];
  let storeModuleUrl;
  page.on("response", (response) => {
    if (new URL(response.url()).pathname === "/src/store/playerStore.ts") storeModuleUrl = response.url();
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/test-background.svg", (route) => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700"><defs><pattern id="p" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="#ff783d"/><rect width="50" height="50" fill="#0bc6f0"/><rect x="50" y="50" width="50" height="50" fill="#0bc6f0"/></pattern></defs><rect width="1000" height="700" fill="url(#p)"/></svg>',
  }));
  await page.addInitScript(() => {
    window.desktopCalls = [];
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      if (command === "set_desktop_blur") {
        window.desktopCalls.push(args.enabled);
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (window.desktopFail) throw "系统不支持桌面毛玻璃";
        return;
      }
      if (command === "auth_status") return { any_logged_in: true, kugou: { logged_in: true, uid: "1" } };
      if (command === "load_app_playlists") return { exists: true, playlists: [] };
      if (command === "kugou_user_playlists") return { data: { playlists: [] } };
      return {};
    } };
  });
  await page.goto(process.env.COVE_TEST_URL || "http://127.0.0.1:1420");
  const settings = page.getByRole("tab", { name: "设置", exact: true });
  await page.locator("aside").hover();
  await settings.click();
  const slider = page.getByRole("slider", { name: "封面背景模糊度", exact: true });
  const toggle = page.getByRole("switch", { name: "使用封面背景" });
  const desktopToggle = page.getByRole("switch", { name: "桌面背景模糊", exact: true });
  const desktopSettled = () => page.waitForFunction(() => !document.querySelector('[aria-label="桌面背景模糊"]').disabled);
  await desktopSettled();
  assert.equal(await desktopToggle.getAttribute("aria-checked"), "true");
  await desktopToggle.click();
  await desktopSettled();
  assert.equal(await desktopToggle.getAttribute("aria-checked"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("nmp.desktopBlur")), "0");
  await page.evaluate(() => { window.desktopFail = true; });
  await desktopToggle.click();
  await desktopSettled();
  assert.equal(await desktopToggle.getAttribute("aria-checked"), "false");
  await page.getByText("系统不支持桌面毛玻璃", { exact: true }).waitFor();
  await page.evaluate(() => { window.desktopFail = false; });
  await desktopToggle.click();
  await desktopSettled();
  assert.equal(await desktopToggle.getAttribute("aria-checked"), "true");
  const nativeCallCount = await page.evaluate(() => window.desktopCalls.length);
  assert.equal(await slider.isDisabled(), true);
  await toggle.click();
  assert.equal(await slider.isDisabled(), true, "no cover: blur cannot change the image");
  assert.ok(storeModuleUrl, "use the same Vite module instance as App, including its HMR timestamp");
  await page.evaluate(async (moduleUrl) => {
    const { usePlayerStore } = await import(moduleUrl);
    const pic = `${location.origin}/test-background.svg`;
    usePlayerStore.setState({ queue: [{ id: 1, name: "封面模糊测试", artist: "测试", pic, duration: 180000 }], index: 0, currentCover: pic, duration: 180 });
  }, storeModuleUrl);
  await page.waitForFunction(() => !document.querySelector('[aria-label="封面背景模糊度"]').disabled);
  await slider.focus();
  await slider.press("Home");
  const background = page.locator("[data-cover-background]");
  assert.match(await background.evaluate((element) => getComputedStyle(element).filter), /^blur\(0px\)/);
  await settings.click();
  await page.waitForTimeout(350);
  const sharp = await background.screenshot({ path: fileURLToPath(new URL("blur-0.png", output)) });
  await settings.click();
  await slider.focus();
  await slider.press("End");
  assert.match(await background.evaluate((element) => getComputedStyle(element).filter), /^blur\(60px\)/);
  assert.equal(await page.evaluate(() => localStorage.getItem("nmp.backgroundBlur")), "60");
  await settings.click();
  await page.waitForTimeout(350);
  const blurred = await background.screenshot({ path: fileURLToPath(new URL("blur-60.png", output)) });
  assert.equal(sharp.equals(blurred), false, "blur changes the rendered pixels");
  assert.equal(await page.locator("#unified-player-card").evaluate((element) => getComputedStyle(element).backdropFilter), "none");
  await settings.click();
  await toggle.click();
  assert.equal(await slider.isDisabled(), true);
  assert.equal(await background.count(), 0);
  assert.equal(await page.evaluate(() => window.desktopCalls.length), nativeCallCount, "cover adjustments never reapply the desktop material");
  await page.reload();
  await page.locator("aside").hover();
  await settings.click();
  await desktopSettled();
  assert.equal(await desktopToggle.getAttribute("aria-checked"), "true");
  assert.equal(await slider.inputValue(), "60");
  assert.equal(await slider.isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("PASS: independent native desktop toggle, error/retry/persistence and no native writes during cover adjustments; cover 0/60 px and gating; CSS backdrop remains disabled.");
} finally { await browser.close(); }
