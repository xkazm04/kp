#!/usr/bin/env node
// Multi-turn dialog L2 driver for /uat — drives a chat surface (the role-intake
// dialog) through N exchanges: open the surface, start a session, then for each
// scripted requestor message fill the composer, send, and POLL until the
// agent's reply settles (LLM exchanges run 10–60s+). Captures a screenshot +
// visible text per exchange and a final full-page shot, so the report can cite
// the live register, the live-brief panel state, and real latency.
//
// Reuses drive-ai.mjs's bootstrap/gotchas (MSYS_NO_PATHCONV=1, dev-auth seed,
// domcontentloaded + settle-polling, never networkidle).
//
// Usage (run from repo root, Git Bash):
//   MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:3000 LOCALE=cs \
//     SHOT_DIR=uat/runs/<id>/shots \
//     TAB_LABEL="Zadání role" NEW_LABEL="Nový rozhovor" SEND_LABEL="Odeslat" \
//     MESSAGES='["msg 1","msg 2"]' PROMOTE_LABEL="Vytvořit inzerát" \
//     node uat/driver/drive-intake.mjs /?tab=library intake-run
//
// Env: BASE_URL, SHOT_DIR, DEV_AUTH (default 1), LOCALE, MESSAGES (JSON array,
// required), TAB_LABEL / NEW_LABEL / SEND_LABEL (on-screen labels), PROMOTE_LABEL
// (optional — click after the last exchange), SETTLE_MAX_MS per exchange
// (default 120000), STABLE_MS (default 5000), HEADFUL.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/_adhoc/shots";
const DEV_AUTH = (process.env.DEV_AUTH ?? "1") !== "0";
const LOCALE = process.env.LOCALE || "";
const MESSAGES = JSON.parse(process.env.MESSAGES || "[]");
const TAB_LABEL = process.env.TAB_LABEL || "Intake";
const NEW_LABEL = process.env.NEW_LABEL || "New intake";
const SEND_LABEL = process.env.SEND_LABEL || "Send";
const PROMOTE_LABEL = process.env.PROMOTE_LABEL || "";
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS) || 120000;
const STABLE_MS = Number(process.env.STABLE_MS) || 5000;
const HEADFUL = process.env.HEADFUL === "1";

const route = process.argv[2] || "/?tab=library";
const runName = (process.argv[3] || "intake").replace(/[^a-z0-9_-]/gi, "_");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name, journal) {
  const p = path.join(SHOT_DIR, `${runName}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  journal.shots.push(p);
}

async function settle(page, before) {
  const start = Date.now();
  let last = before, lastChange = Date.now();
  while (Date.now() - start < SETTLE_MAX_MS) {
    await sleep(2000);
    const now = await page.locator("body").innerText().catch(() => last);
    if (now !== last) { last = now; lastChange = Date.now(); }
    if (last.length > before.length + 10 && Date.now() - lastChange >= STABLE_MS) {
      return { text: last, ms: Date.now() - start, settled: true };
    }
  }
  return { text: last, ms: Date.now() - start, settled: false };
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
  // '/' is gated SERVER-SIDE on the kp_entered cookie (app/_lib/auth/session.ts)
  // since the landing/onboarding split — localStorage dev-auth alone leaves the
  // driver on the public landing. Seed both.
  const cookies = [{ name: "kp_entered", value: "1", url: BASE_URL }];
  if (LOCALE) cookies.push({ name: "NEXT_LOCALE", value: LOCALE, url: BASE_URL });
  await context.addCookies(cookies);

  const page = await context.newPage();
  const journal = { url: BASE_URL + route, exchanges: [], shots: [], promote: null, error: null };

  try {
    await page.goto(BASE_URL.replace(/\/$/, "") + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2500);
    await shot(page, "00-library", journal);

    // Open the Intake sub-tab (SegmentedControl option), then start a session.
    await page.getByText(TAB_LABEL, { exact: false }).first().click({ timeout: 15000 });
    await sleep(2000);
    await shot(page, "01-intake-tab", journal);
    const newBtn = page.getByRole("button", { name: new RegExp(NEW_LABEL, "i") }).first();
    const beforeOpen = await page.locator("body").innerText().catch(() => "");
    await newBtn.click({ timeout: 15000 });
    const opened = await settle(page, beforeOpen);
    journal.exchanges.push({ step: "opener", ms: opened.ms, settled: opened.settled });
    await shot(page, "02-opener", journal);

    for (let i = 0; i < MESSAGES.length; i++) {
      const message = MESSAGES[i];
      const box = page.locator("textarea").first();
      // The composer is DISABLED while an exchange is in flight (sending state)
      // — wait for it to re-enable before filling, budgeted like an LLM call.
      await page
        .waitForFunction(() => { const t = document.querySelector("textarea"); return t && !t.disabled; }, null, { timeout: SETTLE_MAX_MS })
        .catch(() => {});
      await box.fill(message, { timeout: 15000 });
      const before = await page.locator("body").innerText().catch(() => "");
      const sentAt = Date.now();
      await page.getByRole("button", { name: new RegExp(SEND_LABEL, "i") }).first().click({ timeout: 10000 });
      // Settled = the composer re-enabled (the reply landed), not text stability
      // — the optimistic bubble + "thinking" indicator fool a text-delta settle.
      const replied = await page
        .waitForFunction(() => { const t = document.querySelector("textarea"); return t && !t.disabled; }, null, { timeout: SETTLE_MAX_MS })
        .then(() => true)
        .catch(() => false);
      const done = { text: await page.locator("body").innerText().catch(() => before), ms: Date.now() - sentAt, settled: replied };
      journal.exchanges.push({ step: `msg-${i + 1}`, message, ms: done.ms, settled: done.settled });
      await shot(page, `${String(i + 3).padStart(2, "0")}-exchange-${i + 1}`, journal);
      await writeFile(path.join(SHOT_DIR, `${runName}-exchange-${i + 1}.text.txt`), done.text.slice(0, 16000), "utf8");
    }

    if (PROMOTE_LABEL) {
      const before = await page.locator("body").innerText().catch(() => "");
      const promoteBtn = page.getByRole("button", { name: new RegExp(PROMOTE_LABEL, "i") }).first();
      if (await promoteBtn.count().catch(() => 0)) {
        const disabled = await promoteBtn.isDisabled().catch(() => null);
        if (disabled) {
          journal.promote = { clicked: false, disabled: true };
        } else {
          await promoteBtn.click({ timeout: 10000 });
          const done = await settle(page, before);
          journal.promote = { clicked: true, ms: done.ms, settled: done.settled };
        }
      } else {
        journal.promote = { clicked: false, found: false };
      }
      await shot(page, "99-promote", journal);
    }

    const aria = await page.locator("body").ariaSnapshot().catch(() => "(aria unavailable)");
    await writeFile(path.join(SHOT_DIR, `${runName}-final.aria.txt`), aria, "utf8");
    console.log(JSON.stringify(journal, null, 2));
  } catch (e) {
    journal.error = e.message;
    await shot(page, "err", journal);
    console.log(JSON.stringify(journal, null, 2));
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main();
