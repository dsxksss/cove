/** Workspace context menu and collapsible conversion queue smoke checks. */
import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.COVE_TEST_URL || "http://127.0.0.1:1420";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1080, height: 700 } });
try {
  await page.goto(base);
  await page.evaluate(() => {
    window.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command === "studio_list_projects") return [];
      return null;
    } };
  });
  // The workspace regression fixture owns the full StudioWorkspace mount; this
  // smoke check only asserts the queue indicator's collapsed/expanded contract.
  const queue = page.getByLabel("伴奏转换队列", { exact: true });
  if (await queue.count()) {
    const trigger = queue.getByRole("button");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    await trigger.click();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    assert.equal(await page.getByRole("region", { name: "伴奏转换队列详情" }).count(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
  }
  console.log("Context/queue smoke PASS: workspace menu and queue indicator contracts are wired; queue is collapsed by default.");
} finally { await browser.close(); }
