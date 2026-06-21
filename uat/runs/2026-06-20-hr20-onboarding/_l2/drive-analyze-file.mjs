#!/usr/bin/env node
// Bespoke L2 driver for the kp Analyze tab — uploads a CV FILE (the required input
// is a file drop, not a textbox), pastes a target JD, runs the REAL Gemini analysis,
// polls until settled, screenshots + dumps the result text, and reports the currency
// markers + salary the live model emitted. Reuses drive-ai.mjs patterns.
//
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3005 \
//     CV_FILE=uat/runs/.../sarah-rn.txt JD_TEXT="Registered Nurse - ICU ..." \
//     SHOT=uat/runs/.../shots/l2-rn node ..._l2/drive-analyze-file.mjs
import { chromium } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3005").replace(/\/$/, "");
const CV_FILE = process.env.CV_FILE;
const JD_TEXT = process.env.JD_TEXT || "";
const SHOT = process.env.SHOT || "uat/runs/_adhoc/shots/l2-analyze";
const LOCALE = process.env.LOCALE || "en";
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS) || 180000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(path.dirname(SHOT), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1440, height: 1600 } });
  await context.addInitScript(() => { try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {} });
  await context.addCookies([{ name: "NEXT_LOCALE", value: LOCALE, url: BASE_URL }]);
  const page = await context.newPage();
  const result = { cv: CV_FILE, settledMs: null, error: null };
  try {
    await page.goto(BASE_URL + "/?tab=analyze", { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1500);

    // CV is a required file drop → set the first file input directly.
    const fileInputs = page.locator('input[type="file"]');
    result.fileInputCount = await fileInputs.count().catch(() => 0);
    await fileInputs.first().setInputFiles(path.resolve(CV_FILE), { timeout: 10000 });
    await sleep(2500);

    // Paste the target JD into the "Job description text" textbox.
    if (JD_TEXT) {
      const jd = page.getByRole("textbox", { name: /Job description text/i }).first();
      if (await jd.count().catch(() => 0)) await jd.fill(JD_TEXT, { timeout: 8000 }).catch(() => {});
    }
    await sleep(800);

    const before = await page.locator("body").innerText().catch(() => "");
    // The nav tab also matches /^Analyze$/ — scope the SUBMIT strictly to <main>.
    const submit = page.locator("main").getByRole("button", { name: /^Analyze$/i }).last();
    result.submitExists = await submit.count().catch(() => 0);
    result.submitEnabled = await submit.isEnabled().catch(() => false);
    if (!result.submitEnabled) {
      result.error = "Analyze submit is DISABLED — CV did not attach via the file input";
    } else {
      await submit.click({ timeout: 10000 });
      result.clicked = true;
    }

    const start = Date.now();
    let last = before, lastChange = Date.now(), settled = false;
    while (Date.now() - start < SETTLE_MAX_MS) {
      await sleep(2500);
      const now = await page.locator("body").innerText().catch(() => last);
      if (now !== last) { last = now; lastChange = Date.now(); }
      // settle when the result has clearly grown and stabilized for 8s
      if (last.length > before.length + 200 && Date.now() - lastChange >= 8000) { settled = true; break; }
    }
    result.settledMs = Date.now() - start;
    result.settled = settled;

    await page.screenshot({ path: SHOT + ".png", fullPage: true });
    await writeFile(SHOT + ".text.txt", last.slice(0, 16000), "utf8");

    // Report what currency/salary markers the live model emitted.
    const markers = {};
    for (const m of ["CZK", "Kč", "$", "USD", "EUR", "₹", "INR", "/mo", "per month", "monthly", "annual", "/yr"]) {
      const c = (last.match(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      if (c) markers[m] = c;
    }
    // Pull lines mentioning salary/compensation for quick evidence.
    const salaryLines = last.split(/\n/).filter(l => /salary|compensation|comp\b|band|CZK|Kč|USD|\$|month|annual/i.test(l)).slice(0, 12);
    result.currencyMarkers = markers;
    result.salaryLines = salaryLines;
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    result.error = e.message;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main();
