#!/usr/bin/env node
// L2 inspection driver for /uat — multi-click navigation into an existing
// role-intake session, then ARIA + text + screenshot capture, with optional
// spine-fold toggling (to observe the folded draft spine's badge live).
//
// Usage (repo root, Git Bash):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3000 LOCALE=cs \
//     SHOT_DIR=uat/runs/<id>/shots \
//     CLICKS='["Zadání role","Zdravotní sestra"]' \
//     [FOLD='Popis pozice'] [EXPAND='Podklady'] \
//     node uat/driver/drive-l2-inspect.mjs "/?tab=library" shotName
//
// Env: BASE_URL, SHOT_DIR, DEV_AUTH(1), LOCALE, CLICKS (JSON array of visible
// label substrings, clicked in order), FOLD (label of a spine/summary to click
// after landing), EXPAND (label of a <details> summary to open), SETTLE_MS.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/_adhoc/shots";
const DEV_AUTH = (process.env.DEV_AUTH ?? "1") !== "0";
const LOCALE = process.env.LOCALE || "";
const CLICKS = JSON.parse(process.env.CLICKS || "[]");
const FOLD = process.env.FOLD || "";
const EXPAND = process.env.EXPAND || "";
const SETTLE_MS = Number(process.env.SETTLE_MS) || 2000;

const route = process.argv[2] || "/?tab=library";
const shotName = (process.argv[3] || "inspect").replace(/[^a-z0-9_-]/gi, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(page, name, out) {
  const p = path.join(SHOT_DIR, `${shotName}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  const aria = await page.locator("body").ariaSnapshot().catch(() => "(aria unavailable)");
  const text = await page.locator("body").innerText().catch(() => "");
  await writeFile(path.join(SHOT_DIR, `${shotName}-${name}.aria.txt`), aria, "utf8");
  await writeFile(path.join(SHOT_DIR, `${shotName}-${name}.text.txt`), text, "utf8");
  out.captures.push({ name, shot: p, ariaLen: aria.length });
  return { aria, text };
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: LOCALE === "en" ? "en-US" : LOCALE === "cs" ? "cs-CZ" : undefined,
    viewport: { width: 1600, height: 1000 },
  });
  if (DEV_AUTH) {
    await context.addInitScript(() => { try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {} });
  }
  const cookies = [];
  if (DEV_AUTH) cookies.push({ name: "kp_entered", value: "1", url: BASE_URL });
  if (LOCALE) cookies.push({ name: "NEXT_LOCALE", value: LOCALE, url: BASE_URL });
  if (cookies.length) await context.addCookies(cookies);

  const page = await context.newPage();
  const out = { url: BASE_URL + route, clicks: [], captures: [], error: null };
  try {
    await page.goto(BASE_URL.replace(/\/$/, "") + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(SETTLE_MS);
    for (const label of CLICKS) {
      const target = page.getByText(label, { exact: false }).first();
      const n = await target.count().catch(() => 0);
      if (!n) { out.clicks.push({ label, ok: false, reason: "not found" }); break; }
      await target.click({ timeout: 15000 }).catch((e) => out.clicks.push({ label, ok: false, reason: e.message }));
      out.clicks.push({ label, ok: true });
      await sleep(SETTLE_MS + 1500);
    }
    await capture(page, "landed", out);
    if (EXPAND) {
      const s = page.getByText(EXPAND, { exact: false }).first();
      if (await s.count().catch(() => 0)) { await s.click({ timeout: 10000 }).catch(() => {}); await sleep(1500); await capture(page, "expanded", out); }
      else out.clicks.push({ label: EXPAND, ok: false, reason: "expand target not found" });
    }
    if (FOLD) {
      // Spine toggles expose their label as an ACCESSIBLE NAME (aria-label),
      // not visible text — getByText misses them. Use role+name.
      const f = page.getByRole("button", { name: new RegExp(FOLD, "i") }).first();
      if (await f.count().catch(() => 0)) { await f.click({ timeout: 10000 }).catch(() => {}); await sleep(1500); await capture(page, "folded", out); }
      else out.clicks.push({ label: FOLD, ok: false, reason: "fold target not found" });
    }
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    out.error = e.message;
    await capture(page, "err", out).catch(() => {});
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
