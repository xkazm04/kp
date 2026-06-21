#!/usr/bin/env node
// Portable L2 browser driver for /uat — navigate → screenshot + ARIA snapshot +
// visible text + (optional) one click. App-agnostic: every per-app value comes
// from the environment, never hardcoded here.
//
// Usage (run from repo root, Git Bash):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3001 \
//     SHOT_DIR=uat/runs/<id>/shots \
//     node uat/driver/drive.mjs /route shotName [clickRoleName]
//
// Env:
//   BASE_URL     required, e.g. http://localhost:3001
//   SHOT_DIR     where to write <shotName>.png (default: uat/runs/_adhoc/shots)
//   DEV_AUTH     "1" (default) seeds localStorage kp_dev_authed=1 so the dev
//                gate renders the authed workspace at '/'. Set "0" for the
//                public/candidate (tokenized) surfaces.
//   LOCALE       optional cookie/UI locale hint ("cs" | "en"); sets NEXT_LOCALE.
//   HEADFUL      "1" to watch the browser; default headless.
//   SETTLE_MS    post-load settle (default 1200).
//   NAV_TIMEOUT  navigation timeout ms (default 45000 — dev AI surfaces are slow).
//
// Notes (these all bit the pilot — keep them):
//   * MSYS_NO_PATHCONV=1 stops Git Bash mangling a leading-slash route.
//   * Use locator.ariaSnapshot(); page.accessibility.snapshot() was removed in
//     Playwright >= 1.50.
//   * Do NOT wait for 'networkidle' — Next HMR sockets never idle. Use
//     'domcontentloaded' + a short settle.
//   * Budget for latency: a dev AI call can take 30-130s; an early client
//     timeout is itself a finding, not a driver bug.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3001";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/_adhoc/shots";
const DEV_AUTH = (process.env.DEV_AUTH ?? "1") !== "0";
const LOCALE = process.env.LOCALE || "";
const HEADFUL = process.env.HEADFUL === "1";
const SETTLE_MS = Number(process.env.SETTLE_MS) || 1200;
const NAV_TIMEOUT = Number(process.env.NAV_TIMEOUT) || 45000;

const route = process.argv[2] || "/";
const shotName = (process.argv[3] || "shot").replace(/[^a-z0-9_-]/gi, "_");
const clickRoleName = process.argv[4] || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({
    locale: LOCALE === "en" ? "en-US" : LOCALE === "cs" ? "cs-CZ" : undefined,
    viewport: { width: 1440, height: 900 },
  });

  // Seed the dev-auth gate (localStorage kp_dev_authed=1) BEFORE any page script
  // runs, so the workspace renders at '/' instead of the public landing.
  if (DEV_AUTH) {
    await context.addInitScript(() => {
      try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {}
    });
  }
  if (LOCALE) {
    await context.addCookies([
      { name: "NEXT_LOCALE", value: LOCALE, url: BASE_URL },
    ]);
  }

  const page = await context.newPage();
  const url = BASE_URL.replace(/\/$/, "") + route;
  const result = { url, route, shot: null, status: null, error: null };

  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: NAV_TIMEOUT,
    });
    result.status = resp ? resp.status() : null;
    await sleep(SETTLE_MS);

    if (clickRoleName) {
      // Click the first element whose accessible name matches (role-agnostic),
      // then settle again. Language-aware: pass the on-screen label verbatim.
      const target = page.getByText(clickRoleName, { exact: false }).first();
      if (await target.count()) {
        await target.click({ timeout: 8000 }).catch((e) => {
          result.error = `click failed: ${e.message}`;
        });
        await sleep(SETTLE_MS);
        result.url = page.url();
      } else {
        result.error = `no element matching "${clickRoleName}"`;
      }
    }

    const shotPath = path.join(SHOT_DIR, `${shotName}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    result.shot = shotPath;

    const aria = await page.locator("body").ariaSnapshot().catch(() => "(aria snapshot unavailable)");
    const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 6000);

    await writeFile(path.join(SHOT_DIR, `${shotName}.aria.txt`), aria, "utf8");
    await writeFile(path.join(SHOT_DIR, `${shotName}.text.txt`), text, "utf8");

    console.log(JSON.stringify(result, null, 2));
    console.log("\n--- ARIA (truncated) ---\n" + aria.slice(0, 3000));
  } catch (e) {
    result.error = e.message;
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
