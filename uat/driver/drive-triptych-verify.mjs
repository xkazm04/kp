#!/usr/bin/env node
// One-shot consolidation check for the Triptych intake layout: open a session,
// fold + reopen each leaf, screenshot light and dark. Reuses drive-intake.mjs's
// bootstrap (kp_entered cookie + dev-auth + locale); THEME=dark seeds kp-theme.
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/_adhoc/shots";
const THEME = process.env.THEME || "light";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1600, height: 950 } });
  await context.addInitScript((theme) => {
    try {
      window.localStorage.setItem("kp_dev_authed", "1");
      window.localStorage.setItem("kp-theme", theme);
      window.localStorage.removeItem("kp-intake-triptych-cols");
    } catch {}
  }, THEME);
  await context.addCookies([
    { name: "kp_entered", value: "1", url: BASE_URL },
    { name: "NEXT_LOCALE", value: "cs", url: BASE_URL },
  ]);
  const page = await context.newPage();
  const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, `triptych-${THEME}-${n}.png`), fullPage: false });

  await page.goto(`${BASE_URL}/?tab=library`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(2500);
  await page.getByText("Zadání role", { exact: false }).first().click({ timeout: 15000 });
  await sleep(1500);
  // Open the newest session from the ledger (any state works for layout checks).
  const rows = page.locator("button", { hasText: /Probíhá|Připraveno|Inzerát vytvořen/ });
  await rows.first().click({ timeout: 15000 });
  await sleep(2000);
  await shot("all-open");

  // Fold draft, then brief → chat wide with two spines.
  const hideButtons = page.getByRole("button", { name: /Skrýt:/ });
  await hideButtons.first().click({ timeout: 10000 });
  await sleep(700);
  await shot("draft-folded");
  await page.getByRole("button", { name: /Skrýt:/ }).last().click({ timeout: 10000 });
  await sleep(700);
  await shot("two-spines");

  // Reopen both via the spines.
  await page.getByRole("button", { name: /Zobrazit:/ }).first().click({ timeout: 10000 });
  await sleep(700);
  await page.getByRole("button", { name: /Zobrazit:/ }).first().click({ timeout: 10000 });
  await sleep(700);
  await shot("reopened");

  const spines = await page.getByRole("button", { name: /Zobrazit:/ }).count();
  console.log(JSON.stringify({ theme: THEME, ok: spines === 0 }));
  await browser.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
