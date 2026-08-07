#!/usr/bin/env node
// Recertify driver for run 2026-08-07-intake — targeted L2 evidence collection
// for the shipped fixes (editable brief, re-open, frozen promoted, turn
// citations, detail rows, export, grade_label, latency hint, dev-tab brief
// prefill). Flows are subcommands so a failed flow can be re-run alone:
//   node uat/driver/drive-recertify.mjs A   # fresh cs dialog: latency, chips,
//                                           # details, edit, export, complete,
//                                           # reopen, continue
//   node uat/driver/drive-recertify.mjs B   # grade_label ("Band 5, roughly")
//   node uat/driver/drive-recertify.mjs C   # frozen promoted session
//   node uat/driver/drive-recertify.mjs D   # dev tab: brief-prefilled need
// Env: BASE_URL (default :3000), SHOT_DIR, HEADFUL. Czech UI (LOCALE=cs).

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/2026-08-07-intake-recertify/shots";
const SETTLE_MAX_MS = Number(process.env.SETTLE_MAX_MS) || 150000;
const HEADFUL = process.env.HEADFUL === "1";
const flow = (process.argv[2] || "A").toUpperCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const journal = { flow, steps: [], error: null };
let page;

async function shot(name) {
  const p = path.join(SHOT_DIR, `${flow}-${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  journal.steps.push({ shot: p });
  return p;
}
function log(step, data = {}) {
  journal.steps.push({ step, ...data });
}
async function bodyText() {
  return page.locator("body").innerText().catch(() => "");
}
async function waitComposerEnabled(timeout = SETTLE_MAX_MS) {
  return page
    .waitForFunction(() => { const t = document.querySelector("textarea"); return t && !t.disabled; }, null, { timeout })
    .then(() => true)
    .catch(() => false);
}
async function sendMessage(text, { latencyShot = false } = {}) {
  await waitComposerEnabled();
  await page.locator("textarea").first().fill(text, { timeout: 15000 });
  const t0 = Date.now();
  await page.getByRole("button", { name: /Odeslat|Send/i }).first().click({ timeout: 10000 });
  if (latencyShot) {
    await sleep(10500);
    await shot("latency-hint-10s");
    log("latency-hint", { containsSlowLine: (await bodyText()).includes("Stále přemýšlím") });
  }
  const ok = await waitComposerEnabled();
  log("exchange", { text: text.slice(0, 60), ms: Date.now() - t0, settled: ok });
  return ok;
}
async function openIntakeTab() {
  await page.goto(BASE_URL + "/?tab=library", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  await page.getByText("Zadání role", { exact: false }).first().click({ timeout: 20000 });
  await sleep(1500);
}

async function flowA() {
  await openIntakeTab();
  await page.getByRole("button", { name: /Nový rozhovor/i }).first().click({ timeout: 15000 });
  await waitComposerEnabled();
  await shot("00-opened");

  await sendMessage(
    "Je to náhrada — odešel nám senior Java vývojář z platebního týmu, potřebujeme v podstatě stejného člověka",
    { latencyShot: true }
  );
  await sendMessage("Java vývojář do platebního týmu");
  await sendMessage("Java, Kafka a zkušenost s on-call provozem");
  await shot("01-brief-captured");

  // Item 5 — turn citation chip: click the first "replika [N]" chip.
  const chip = page.getByRole("button", { name: /replika \[/i }).first();
  if (await chip.count()) {
    await chip.click({ timeout: 8000 });
    await sleep(400); // mid-flash (flash lasts 1.6 s)
    await shot("02-turn-chip-flash");
    log("turn-chip", { clicked: true });
  } else {
    log("turn-chip", { clicked: false, reason: "no chip rendered" });
  }

  // Item 6 — detail row: expand the first requirement's details.
  const summary = page.locator("summary").first();
  if (await summary.count()) {
    await summary.click({ timeout: 8000 }).catch(() => {});
    await sleep(300);
    await shot("03-detail-row");
    const txt = await bodyText();
    log("detail-row", { weightVisible: txt.includes("váha"), confidenceVisible: txt.includes("jistota") });
  }

  // Item 2 — edit: change the first requirement's skill, save, check chips.
  await page.getByRole("button", { name: /Upravit zadání/i }).first().click({ timeout: 10000 });
  await sleep(500);
  await shot("04-edit-open");
  const skillInput = page.getByPlaceholder("Dovednost nebo schopnost").first();
  const before = await skillInput.inputValue().catch(() => "");
  await skillInput.fill(`${before} (upřesněno ručně)`, { timeout: 8000 });
  await page.getByRole("button", { name: /Uložit změny/i }).first().click({ timeout: 10000 });
  await sleep(1500);
  await shot("05-edit-saved");
  log("edit", { changedFrom: before });

  // Item 7 — export download.
  const exportBtn = page.getByRole("button", { name: /Exportovat/i }).first();
  if (await exportBtn.count()) {
    const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await exportBtn.click({ timeout: 8000 });
    const download = await dl;
    if (download) {
      const p = path.join(SHOT_DIR, "export-brief.md");
      await download.saveAs(p);
      log("export", { saved: p });
    } else {
      log("export", { saved: null, reason: "no download event" });
    }
  }

  // Drive to completion: answer adaptively until the status chip flips.
  const fillers = ["senior", "převezme služby a on-call rotace pojede bez výpadků", "platební tým, pět lidí", "přeskočit", "ok", "ok", "ok"];
  for (const f of fillers) {
    if ((await bodyText()).includes("Připraveno")) break;
    await sendMessage(f);
  }
  await shot("06-completed");
  log("completed", { statusReady: (await bodyText()).includes("Připraveno") });

  // Item 3 — reopen + continue.
  const reopenBtn = page.getByRole("button", { name: /Znovu otevřít rozhovor/i }).first();
  if (await reopenBtn.count()) {
    await reopenBtn.click({ timeout: 10000 });
    await sleep(2000);
    await shot("07-reopened");
    const txt = await bodyText();
    log("reopen", {
      statusOpen: txt.includes("Probíhá"),
      systemLine: txt.includes("Rozhovor znovu otevřel zadavatel"),
    });
    const sent = await sendMessage("Ještě doplnění — Docker by byl výhodou");
    await shot("08-continued");
    log("continue-after-reopen", { sent });
  } else {
    log("reopen", { found: false });
  }
}

async function flowB() {
  await openIntakeTab();
  await page.getByRole("button", { name: /Nový rozhovor/i }).first().click({ timeout: 15000 });
  await waitComposerEnabled();
  await sendMessage("Hledáme poprvé zdravotní sestru pro naši kliniku — nikdy jsme tuhle roli neměli");
  await sendMessage("Zdravotní sestra");
  await sendMessage("Band 5, roughly — tak tomu říká nemocnice");
  await shot("01-grade-label");
  const txt = await bodyText();
  log("grade-label", {
    facetVisible: txt.includes("Úroveň (jak uvedeno)") || txt.toLowerCase().includes("band 5"),
    assumedChip: txt.includes("předpoklad"),
  });
  const aria = await page.locator("body").ariaSnapshot().catch(() => "");
  await writeFile(path.join(SHOT_DIR, "B-grade-aria.txt"), aria, "utf8");
}

async function flowC() {
  await openIntakeTab();
  // Two sessions share the title; the PROMOTED one is the row whose status chip
  // says "Inzerát vytvořen".
  await page
    .getByRole("button")
    .filter({ hasText: "Senior Java vývojář" })
    .filter({ hasText: "Inzerát vytvořen" })
    .first()
    .click({ timeout: 15000 });
  await sleep(2000);
  await shot("01-promoted-frozen");
  const txt = await bodyText();
  log("frozen", {
    noteVisible: txt.includes("Inzerát už existuje — zadání je zamčené"),
    editAbsent: !(await page.getByRole("button", { name: /Upravit zadání/i }).count()),
    exportPresent: (await page.getByRole("button", { name: /Exportovat/i }).count()) > 0,
  });
}

async function flowD() {
  await page.goto(BASE_URL + "/?tab=dev", { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(3000);
  await page.getByText("Define need", { exact: false }).first().click({ timeout: 15000 });
  await sleep(2000);
  await shot("01-dev-tab");
  // Pick the promoted JD in the need form's custom combobox (app/_components/Select:
  // role=combobox trigger → role=listbox → role=option).
  const trigger = page.getByRole("combobox").first();
  const jdPick = trigger;
  if (await trigger.count()) {
    await trigger.click({ timeout: 10000 });
    await sleep(500);
    const option = page.getByRole("option").filter({ hasText: "Senior Java vývojář" }).first();
    log("jd-options", { matched: (await option.count()) > 0 });
    if (await option.count()) await option.click({ timeout: 8000 });
    await sleep(3000);
    await shot("02-jd-picked");
    const aria = await page.locator("body").ariaSnapshot().catch(() => "");
    await writeFile(path.join(SHOT_DIR, "D-need-aria.txt"), aria, "utf8");
    const txt = await bodyText();
    log("brief-prefill", {
      javaVisible: txt.includes("Java"),
      seniorVisible: txt.toLowerCase().includes("senior"),
    });
  } else {
    log("brief-prefill", { jdFound: false });
  }
}

// Follow-up: session-reuse checks that flow A couldn't cover live (details rows
// and requirement-edit need a session that HAS requirements — the correction
// session; post-reopen send reuses flow A's reopened session).
async function flowE() {
  await openIntakeTab();
  // E1 — correction session (has NEZBYTNÉ rows): details + requirement edit.
  await page
    .getByRole("button")
    .filter({ hasText: "Senior Java vývojář" })
    .filter({ hasText: "Probíhá" })
    .first()
    .click({ timeout: 15000 });
  await sleep(2000);
  const summary = page.locator("summary").first();
  log("summary-count", { n: await summary.count() });
  if (await summary.count()) {
    await summary.click({ timeout: 8000 });
    await sleep(400);
    await shot("01-detail-row");
    const txt = await bodyText();
    log("detail-row", { weight: txt.includes("váha"), confidence: txt.includes("jistota") });
  }
  const chip = page.getByRole("button", { name: /replika \[/i }).first();
  if (await chip.count()) {
    await chip.click({ timeout: 8000 });
    await sleep(400);
    await shot("02-turn-chip-flash");
  }
  await shot("03-before-edit");
  await page.getByRole("button", { name: /Upravit zadání/i }).first().click({ timeout: 10000 });
  await sleep(600);
  const skillInput = page.getByPlaceholder("Dovednost nebo schopnost").first();
  log("edit-inputs", { n: await page.getByPlaceholder("Dovednost nebo schopnost").count() });
  if (await skillInput.count()) {
    const before = await skillInput.inputValue();
    await skillInput.fill(`${before} 17+`, { timeout: 8000 });
    await page.getByRole("button", { name: /Uložit změny/i }).first().click({ timeout: 10000 });
    await sleep(2000);
    await shot("04-after-edit");
    const txt = await bodyText();
    log("edit", { before, statedChipCount: (txt.match(/řekli jste/g) || []).length });
  }
  // E2 — flow A's reopened session: send a message after reopen.
  await page.getByText("Všechny rozhovory", { exact: false }).first().click({ timeout: 10000 });
  await sleep(1000);
  await page
    .getByRole("button")
    .filter({ hasText: "Java vývojář do platebního týmu" })
    .filter({ hasText: "Probíhá" })
    .first()
    .click({ timeout: 15000 });
  await sleep(2000);
  const reopened = await bodyText();
  log("reopen-state", { systemLine: reopened.includes("Rozhovor znovu otevřel zadavatel") });
  await sendMessage("Ještě doplnění — Docker by byl výhodou");
  await shot("05-sent-after-reopen");
  log("continue-after-reopen", { replied: true });
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADFUL });
  const context = await browser.newContext({ locale: "cs-CZ", viewport: { width: 1440, height: 900 } });
  await context.addInitScript(() => { try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {} });
  await context.addCookies([
    { name: "kp_entered", value: "1", url: BASE_URL },
    { name: "NEXT_LOCALE", value: "cs", url: BASE_URL },
  ]);
  page = await context.newPage();
  try {
    if (flow === "A") await flowA();
    else if (flow === "B") await flowB();
    else if (flow === "C") await flowC();
    else if (flow === "D") await flowD();
    else if (flow === "E") await flowE();
    else throw new Error(`unknown flow ${flow}`);
  } catch (e) {
    journal.error = e.message;
    await shot("err");
  } finally {
    console.log(JSON.stringify(journal, null, 2));
    await browser.close();
  }
}

main();
