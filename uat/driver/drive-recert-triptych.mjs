#!/usr/bin/env node
// Recertify driver for run 2026-08-10-intake-triptych — targeted L2 evidence
// for the three fixes (b54c451b market opt-out, dd67bc46 title provenance +
// inline edit, 41cd5cc3 countFor per-leaf badges).
//
// Sessions are BUILT over the API (fast, deterministic, same origin/cookies as
// the browser context) and then VERIFIED in the real UI — the whole point of
// the findings is UI reachability, so every verdict is read off the rendered
// surface, never off the API alone.
//
//   node uat/driver/drive-recert-triptych.mjs tom        # cs, JD attached: title chip + inline edit
//   node uat/driver/drive-recert-triptych.mjs ctrl       # cs, NO attachment (control arm): title chip
//   node uat/driver/drive-recert-triptych.mjs market-off # en, promote with market UNCHECKED
//   node uat/driver/drive-recert-triptych.mjs market-on  # en, promote with market CHECKED (control arm)
//   SESSION_ID=<id> node ... fold                        # fold each leaf, read every spine badge
//
// Env: BASE_URL (default :3000), SHOT_DIR, HEADFUL, SESSION_ID.

import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR || "uat/runs/2026-08-10-intake-triptych/shots";
const HEADFUL = process.env.HEADFUL === "1";
const flow = (process.argv[2] || "tom").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const journal = { flow, at: new Date().toISOString(), steps: [], error: null };
let page, api;

function log(step, data = {}) {
  journal.steps.push({ step, ...data });
  console.log(`[${flow}] ${step}`, JSON.stringify(data).slice(0, 600));
}
async function capture(name) {
  const base = path.join(SHOT_DIR, `rc-${flow}-${name}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const aria = await page.locator("body").ariaSnapshot().catch(() => "");
  await writeFile(`${base}.aria.txt`, aria, "utf8");
  const text = await page.locator("body").innerText().catch(() => "");
  await writeFile(`${base}.text.txt`, text, "utf8");
  journal.steps.push({ shot: `${base}.png` });
  return { aria, text };
}
async function jpost(url, body) {
  const r = await api.post(BASE_URL + url, { data: body ?? {} , timeout: 180000 });
  return { status: r.status(), json: await r.json().catch(() => null) };
}
async function jget(url) {
  const r = await api.get(BASE_URL + url, { timeout: 60000 });
  return { status: r.status(), json: await r.json().catch(() => null) };
}

// The spine badge is the whole point of 41cd5cc3: read the DOM exactly
// (accessible name + the aria-hidden glyph + the sr-only hint), because a
// button's aria-label overrides its contents in the a11y tree.
async function readSpines() {
  return page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button[aria-expanded='false']")) {
      const label = b.getAttribute("aria-label") || "";
      if (!/:/.test(label) && !/Zobrazit|Show/i.test(label)) continue;
      const badge = b.querySelector("span[title]");
      out.push({
        ariaLabel: label,
        glyph: badge?.querySelector("[aria-hidden]")?.textContent?.trim() ?? null,
        srOnly: badge?.querySelector(".sr-only")?.textContent?.trim() ?? null,
        titleAttr: badge?.getAttribute("title") ?? null,
        text: b.textContent.trim().replace(/\s+/g, " "),
      });
    }
    return out;
  });
}
async function openIntakeTab(locale) {
  await page.goto(`${BASE_URL}/?tab=library`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(2500);
  await page.getByText(locale === "cs" ? "Zadání role" : "Intake", { exact: true }).first().click({ timeout: 20000 });
  await sleep(1500);
}
async function openSessionByTitle(title) {
  // An untitled session is a real state (the control arm produced one) — the
  // ledger renders it under the `untitled` label, so open it by that.
  const t = (title || "").trim() || "Nepojmenovaná role";
  await page.getByRole("button", { name: new RegExp(t.slice(0, 28).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }).first().click({ timeout: 20000 });
  await sleep(2500);
  // Prove the session actually opened before any verdict is read off the page.
  await page.getByRole("button", { name: /Skrýt:|Hide:/i }).first().waitFor({ timeout: 20000 });
}

async function buildSession({ lang, jdSlug, messages }) {
  const created = await jpost("/api/intake", { lang });
  const id = created.json?.id;
  log("created", { id, status: created.status });
  if (jdSlug) {
    const a = await jpost(`/api/intake/${id}/attachments`, { kind: "jd", jdSlug });
    log("attached", { status: a.status, title: a.json?.attachments?.[0]?.title });
  }
  for (const m of messages) {
    const t0 = Date.now();
    const r = await jpost(`/api/intake/${id}/message`, { message: m });
    log("exchange", {
      ms: Date.now() - t0,
      status: r.status,
      source: r.json?.source,
      title: r.json?.brief?.title,
      spineProvenance: r.json?.brief?.spineProvenance,
      reqs: r.json?.brief?.requirements?.length,
      facets: r.json?.brief?.facets?.length,
      crit: r.json?.brief?.successCriteria?.length,
    });
  }
  const final = await jget(`/api/intake/${id}`);
  return { id, intake: final.json };
}

const TOM_OPENER =
  "Potřebuju posílit tým, hledám seniorního Java vývojáře do platebního týmu. Ten starý inzerát, co posílám, mi přijde úplně mimo, nechci ho opakovat.";
const PRIYA_OPENER =
  "I need to hire a Band 5 registered nurse for our clinic in Leeds. Two of my three nurses are leaving and the rota is falling apart.";
const PRIYA_FOLLOWUP =
  "The dealbreaker is a valid NMC registration and at least two years of post-registration ward experience. In 90 days I want her running her own clinic list unsupervised and signed off on our medication competency.";
// The prior L2's arm: an opener that names NO title, so the engine must infer
// one — the only condition under which `spineProvenance.title === "inferred"`,
// and therefore the only arm that can prove the chip renders the INFERRED state
// and that an inline correction flips it to `stated`.
const NOTITLE_OPENER =
  "Máme problém v platebním týmu — nasazování se rozpadá, releasy stojí a nikdo to neumí opravit. Potřebuju někoho, kdo to vezme za své. Ten starý inzerát, co posílám, mi přijde úplně mimo, nechci ho opakovat.";
const TOM_FOLLOWUP =
  "Tvrdá podmínka je Java a Kafka v produkci. Za 90 dní chci, aby ten člověk sám vydal release do produkce a opravil nasazovací pipeline.";
// Verbatim replay of the PRIOR L2's control-arm transcript (session
// intake-msn3bnnp-negmkh, read back off the live DB) — same words, so the only
// variable between this run's two arms is the attachment, and the run-over-run
// comparison is against an identical stimulus.
const REPLAY_MESSAGES = [
  "Odchází nám člověk z platebního týmu — nechci nabírat podle starého inzerátu, potřebuju někoho, kdo umí navrhnout idempotentní zpracování plateb.",
  "Za posledních 90 dní musí převzít on-call rotaci nad platbami bez výpadku a předělat retry logiku tak, aby se platba nikdy neprovedla dvakrát.",
  "Tvrdá podmínka je Java a Kafka v produkci. Seniorita senior, tým šest lidí, Praha, hybridně.",
];

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: !HEADFUL });
  const locale = process.env.LOCALE || (flow.startsWith("market") ? "en" : "cs");
  const context = await browser.newContext({
    locale: locale === "cs" ? "cs-CZ" : "en-US",
    viewport: { width: 1600, height: 1000 },
  });
  await context.addInitScript(() => { try { window.localStorage.setItem("kp_dev_authed", "1"); } catch {} });
  await context.addCookies([
    { name: "kp_entered", value: "1", url: BASE_URL },
    { name: "NEXT_LOCALE", value: locale, url: BASE_URL },
  ]);
  page = await context.newPage();
  api = context.request;

  try {
    if (/^(tom|ctrl|notitle|notitle-attached|replay-attached|replay-ctrl)$/.test(flow)) {
      let jdSlug = null;
      if (/attached$/.test(flow) || flow === "tom") {
        const jds = await jget("/api/jds");
        const list = jds.json?.jds ?? jds.json?.items ?? [];
        const pick = list.find((j) => /java/i.test(j.title || "")) || list[0];
        jdSlug = pick?.slug;
        log("jd-picked", { jdSlug, title: pick?.title });
      }
      const messages = flow.startsWith("replay")
        ? REPLAY_MESSAGES
        : [flow.startsWith("notitle") ? NOTITLE_OPENER : TOM_OPENER, TOM_FOLLOWUP];
      // SESSION_ID re-inspects an already-built session in the UI (no new LLM
      // spend) — used when a browser step failed after the dialog was paid for.
      const { id, intake } = process.env.SESSION_ID
        ? { id: process.env.SESSION_ID, intake: (await jget(`/api/intake/${process.env.SESSION_ID}`)).json }
        : await buildSession({ lang: "cs", jdSlug, messages });
      journal.sessionId = id;
      journal.brief = intake?.brief;
      log("before-edit", {
        title: intake?.brief?.title,
        spineProvenance: intake?.brief?.spineProvenance,
        facetProvenance: (intake?.brief?.facets ?? []).map((f) => `${f.label}=${f.provenance}`),
        reqProvenance: (intake?.brief?.requirements ?? []).map((r) => `${r.skill}=${r.provenance}`),
      });
      await openIntakeTab("cs");
      await openSessionByTitle(intake?.brief?.title || intake?.title || "");
      const landed = await capture("landed");
      // The finding: does the TITLE carry a provenance chip in the rendered brief?
      const roleRow = await page.evaluate(() => {
        const nodes = [...document.querySelectorAll("div,section")];
        const row = nodes.find((n) => /Role/.test(n.previousElementSibling?.textContent || "") && n.textContent.length < 400);
        return row ? row.textContent.trim().replace(/\s+/g, " ") : null;
      });
      log("role-row", { roleRow, ariaHasTitleChip: /úsudek AI|řekli jste|předpoklad/.test(landed.aria) });
      // Inline correction (the second half of dd67bc46)
      const editBtn = page.getByRole("button", { name: /Upravit název|Edit title/i }).first();
      const hasEdit = await editBtn.count();
      log("edit-affordance", { present: hasEdit > 0 });
      if (hasEdit > 0) {
        await editBtn.click({ timeout: 10000 });
        await sleep(800);
        const input = page.getByRole("textbox", { name: /název|title/i }).first();
        await input.fill("Backend inženýr do platebního týmu", { timeout: 10000 });
        await capture("editing");
        await page.getByRole("button", { name: /^Uložit|^Save/i }).first().click({ timeout: 10000 });
        await sleep(3500);
        await capture("edited");
        const after = await jget(`/api/intake/${id}`);
        log("after-edit", {
          title: after.json?.brief?.title,
          spineProvenance: after.json?.brief?.spineProvenance,
          reqProvenance: (after.json?.brief?.requirements ?? []).map((r) => r.provenance),
          facetProvenance: (after.json?.brief?.facets ?? []).map((f) => f.provenance),
        });
      }
      // Spines, on this same rich session (41cd5cc3)
      for (const col of ["Popis pozice", "Živé zadání"]) {
        const b = page.getByRole("button", { name: new RegExp(`Skrýt: ${col}`, "i") }).first();
        if (await b.count()) { await b.click({ timeout: 10000 }); await sleep(1200); }
      }
      await capture("folded-draft-brief");
      log("spines-A", { spines: await readSpines() });
      // Podklady visibility while the draft leaf is folded (L1-TOM-5 regression check)
      const podklady = await page.getByText(/Podklady|Materials/i).count();
      log("podklady-when-draft-folded", { count: podklady });
      // Now the chat spine: reopen brief, fold chat
      await page.getByRole("button", { name: /Zobrazit: Živé zadání/i }).first().click({ timeout: 10000 });
      await sleep(1200);
      await page.getByRole("button", { name: /Skrýt: Rozhovor|Skrýt: Konverzace/i }).first().click({ timeout: 10000 }).catch(() => {});
      await sleep(1200);
      await capture("folded-chat-draft");
      log("spines-B", { spines: await readSpines() });
    }

    if (flow === "market-off" || flow === "market-on") {
      const want = flow === "market-on";
      const { id, intake } = process.env.SESSION_ID
        ? { id: process.env.SESSION_ID, intake: (await jget(`/api/intake/${process.env.SESSION_ID}`)).json }
        : await buildSession({ lang: "en", messages: [PRIYA_OPENER, PRIYA_FOLLOWUP] });
      journal.sessionId = id;
      await openIntakeTab("en");
      await openSessionByTitle(intake?.brief?.title || intake?.title || "");
      const landed = await capture("landed");
      const box = page.getByRole("checkbox", { name: /market|salary|mzd/i }).first();
      const present = await box.count();
      log("market-checkbox", { present: present > 0, checkedByDefault: present ? await box.isChecked() : null });
      if (present > 0 && !want) { await box.uncheck({ timeout: 10000 }); await sleep(1200); }
      const noteAfter = await page.locator("body").innerText();
      log("working-note", {
        assertsMarket: /market salary research|průzkum(u)? mezd/i.test(noteAfter),
        checked: present ? await box.isChecked() : null,
      });
      await capture("promote-row");
      await page.getByRole("button", { name: /Create (the )?JD|Vytvořit inzerát/i }).first().click({ timeout: 15000 });
      await sleep(6000);
      await capture("promoted");
      const after = await jget(`/api/intake/${id}`);
      const slug = after.json?.jdSlug;
      log("promoted", { slug });
      // Poll the produced JD until the background build lands.
      let jd = null;
      for (let i = 0; i < 60; i++) {
        const r = await jget(`/api/jds/${slug}`);
        jd = r.json?.jd ?? r.json;
        if (jd?.body && jd.body.length > 400 && !/analyzing/i.test(jd.status || "")) break;
        await sleep(5000);
      }
      const body = jd?.body || "";
      const salaryLine = (body.match(/.*(salary|Mzda|Plat|CZK|GBP|£).*/gi) || []).slice(0, 6);
      log("jd", {
        slug,
        status: jd?.status,
        len: body.length,
        buildOptions: jd?.buildInput?.options ?? jd?.build_input?.options ?? null,
        salaryLine,
      });
      await writeFile(path.join(SHOT_DIR, `rc-${flow}-jd.md`), body, "utf8");
    }

    if (flow === "fold") {
      const id = process.env.SESSION_ID;
      const intake = (await jget(`/api/intake/${id}`)).json;
      await openIntakeTab(locale);
      await openSessionByTitle(intake?.brief?.title || intake?.title || "");
      await capture("landed");
      log("spines-open", { spines: await readSpines() });
    }
  } catch (error) {
    journal.error = String(error?.stack || error);
    console.error(journal.error);
  } finally {
    await writeFile(path.join(SHOT_DIR, `rc-${flow}-journal.json`), JSON.stringify(journal, null, 2), "utf8");
    await page?.context()?.browser()?.close().catch(() => {});
  }
}

main();
