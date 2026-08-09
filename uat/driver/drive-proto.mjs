#!/usr/bin/env node
// Prototype-round verifier: opens an intake session, walks the layout variants
// and column toggles, screenshots each state. THEME=dark seeds kp-theme so the
// pre-paint bootstrap renders Spark Dark. Render-only (no LLM calls) — fast.
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
  const context = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1512, height: 950 } });
  await context.addInitScript(
    (theme) => {
      try {
        window.localStorage.setItem("kp_dev_authed", "1");
        window.localStorage.setItem("kp-theme", theme);
        window.localStorage.removeItem("kp-intake-proto-variant");
        window.localStorage.removeItem("kp-intake-triptych-cols");
        window.localStorage.removeItem("kp-intake-cockpit-cols");
      } catch {}
    },
    THEME
  );
  await context.addCookies([
    { name: "kp_entered", value: "1", url: BASE_URL },
    { name: "NEXT_LOCALE", value: "cs", url: BASE_URL },
  ]);
  const page = await context.newPage();
  const shot = async (name) => {
    await sleep(1400);
    await page.screenshot({ path: path.join(SHOT_DIR, `proto-${THEME}-${name}.png`), fullPage: false });
    console.log(`shot ${name}`);
  };

  await page.goto(`${BASE_URL}/?tab=library`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(2500);
  await page.getByText("Zadání role", { exact: false }).first().click({ timeout: 15000 });
  await sleep(1500);
  // Open the first session in the ledger.
  await page.locator("button:has-text('replik'), button:has-text('turn')").first().click({ timeout: 15000 });
  await sleep(1800);
  await shot("00-baseline");

  await page.getByRole("radio", { name: "Triptych" }).click({ timeout: 10000 });
  await shot("01-triptych-open");
  // Fold the draft leaf → spine.
  await page.getByRole("button", { name: /Skrýt: Popis pozice/ }).click({ timeout: 20000 });
  await shot("02-triptych-draft-folded");
  // Fold chat too → review mode (draft spine + chat spine + brief wide).
  await page.getByRole("button", { name: /Skrýt: Rozhovor/ }).first().click({ timeout: 20000 });
  await shot("03-triptych-review");

  await page.getByRole("radio", { name: "Kokpit" }).click({ timeout: 10000 });
  await shot("04-cockpit-default");
  // Switch materials ON (4th instrument) and chat OFF.
  await page.getByRole("button", { name: /Podklady/ }).first().click({ timeout: 10000 });
  await shot("05-cockpit-materials-on");
  // Cockpit toggles carry their accessible name from CONTENT ("⌥2 Rozhovor n").
  await page.getByRole("button", { name: /Rozhovor/ }).first().click({ timeout: 20000 });
  await shot("06-cockpit-chat-off");

  await browser.close();
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
