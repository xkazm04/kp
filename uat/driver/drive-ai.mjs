#!/usr/bin/env node
// AI-surface L2 driver for /uat — fill the real-context inputs, trigger the model
// call, and POLL until the result settles (kp AI calls run 15-130s), then capture
// + optionally assert the output ECHOES a supplied real entity (the grounding
// check that proves the live path used the user's real context, not a default).
//
// This exists because drive.mjs's "one click + short settle" can't see an AI
// result that lands 60s later — and L2's unique value over a CI/model gate is
// proving the *grounded / non-default* path end to end.
//
// Usage (run from repo root, Git Bash):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3001 \
//     SHOT_DIR=uat/runs/<id>/shots \
//     FILL='[["CV text","<paste cv>"],["Target role","Pobočkový bankéř"]]' \
//     GENERATE="Spustit analýzu" \
//     EXPECT="Pobočkový bankéř" \
//     node uat/driver/drive-ai.mjs /?tab=analyze analyze-grounded
//
// Env:
//   BASE_URL     required (see env.md — :3001 in dev)
//   SHOT_DIR     where to write artifacts (default uat/runs/_adhoc/shots)
//   DEV_AUTH     "1" (default) seeds the dev-auth gate; "0" for tokenized pages
//   LOCALE       "cs" | "en" — UI locale hint (cookie + browser locale)
//   FILL         JSON array of [accessibleLabelOrPlaceholder, value] pairs to type
//   GENERATE     the on-screen label of the button that triggers the AI call
//   EXPECT       optional string the FINAL output must contain (the grounding
//                assertion) — sets exit code 2 if absent after settle
//   SETTLE_MAX_MS  max wait for the result to settle (default 140000)
//   POLL_MS      how often to re-read the output (default 2500)
//   STABLE_MS    output must be unchanged this long to count as "settled" (default 6000)
//   HEADFUL      "1" to watch
//
// Same gotchas as drive.mjs: MSYS_NO_PATHCONV=1, locator.ariaSnapshot(), never
// networkidle, role/language-aware selectors, and an early client-timeout is
// itself a finding (don't shorten SETTLE_MAX_MS to "make it pass").

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/_adhoc/shots";
const DEV_AUTH = (process.env.DEV_AUTH ?? "1") !== "0";
const LOCALE = process.env.LOCALE || "";
const FILL = process.env.FILL ? JSON.parse(process.env.FILL) : [];
const GENERATE = process.env.GENERATE || "";
const EXPECT = process.env.EXPECT || "";
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS) || 140000;
const POLL_MS = Number(process.env.POLL_MS) || 2500;
const STABLE_MS = Number(process.env.STABLE_MS) || 6000;
const HEADFUL = process.env.HEADFUL === "1";

const route = process.argv[2] || "/";
const shotName = (process.argv[3] || "ai-shot").replace(/[^a-z0-9_-]/gi, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Find a fillable control by accessible label, placeholder, or nearby <label>.
async function fill(page, labelOrPlaceholder, value) {
  const tries = [
    () => page.getByLabel(labelOrPlaceholder, { exact: false }).first(),
    () => page.getByPlaceholder(labelOrPlaceholder, { exact: false }).first(),
    () => page.getByRole("textbox", { name: new RegExp(labelOrPlaceholder, "i") }).first(),
  ];
  for (const make of tries) {
    const el = make();
    if (await el.count().catch(() => 0)) {
      await el.fill(String(value), { timeout: 8000 }).catch(() => {});
      return true;
    }
  }
  return false;
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({
    locale: LOCALE === "en" ? "en-US" : LOCALE === "cs" ? "cs-CZ" : undefined,
    viewport: { width: 1440, height: 900 },
  });
  if (DEV_AUTH) {
    await context.addInitScript(() => { try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {} });
  }
  if (LOCALE) await context.addCookies([{ name: "NEXT_LOCALE", value: LOCALE, url: BASE_URL }]);

  const page = await context.newPage();
  const url = BASE_URL.replace(/\/$/, "") + route;
  const result = { url, route, filled: [], generated: false, settledMs: null, expectFound: null, error: null };

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(1200);

    for (const [label, value] of FILL) {
      const ok = await fill(page, label, value);
      result.filled.push({ label, ok });
    }

    // Snapshot the body text BEFORE generating, so we can detect the result delta.
    const before = await page.locator("body").innerText().catch(() => "");

    if (GENERATE) {
      const btn = page.getByRole("button", { name: new RegExp(GENERATE, "i") }).first();
      const fallback = page.getByText(GENERATE, { exact: false }).first();
      const target = (await btn.count().catch(() => 0)) ? btn : fallback;
      if (await target.count().catch(() => 0)) {
        await target.click({ timeout: 8000 });
        result.generated = true;
      } else {
        result.error = `generate control "${GENERATE}" not found`;
      }
    }

    // Poll until the visible text grows and then stays stable for STABLE_MS, or
    // until SETTLE_MAX_MS. A client-side timeout/spinner-forever is a finding —
    // it shows up here as error/never-settled, NOT a driver bug.
    const start = Date.now();
    let last = before, lastChange = Date.now(), settled = false;
    while (Date.now() - start < SETTLE_MAX_MS) {
      await sleep(POLL_MS);
      const now = await page.locator("body").innerText().catch(() => last);
      if (now !== last) { last = now; lastChange = Date.now(); }
      if (last.length > before.length + 40 && Date.now() - lastChange >= STABLE_MS) {
        settled = true;
        result.settledMs = Date.now() - start;
        break;
      }
    }
    if (!settled && !result.settledMs) result.settledMs = Date.now() - start;

    if (EXPECT) {
      result.expectFound = last.includes(EXPECT);
      if (!result.expectFound) {
        result.error = (result.error ? result.error + "; " : "") +
          `grounding assertion FAILED: output does not contain "${EXPECT}"`;
      }
    }

    const shotPath = path.join(SHOT_DIR, `${shotName}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    const aria = await page.locator("body").ariaSnapshot().catch(() => "(aria unavailable)");
    await writeFile(path.join(SHOT_DIR, `${shotName}.text.txt`), last.slice(0, 12000), "utf8");
    await writeFile(path.join(SHOT_DIR, `${shotName}.aria.txt`), aria, "utf8");
    result.shot = shotPath;

    console.log(JSON.stringify(result, null, 2));
    if (EXPECT && result.expectFound === false) process.exitCode = 2;
  } catch (e) {
    result.error = e.message;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
