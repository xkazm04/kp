#!/usr/bin/env node
/*
 * build-market-pulse.mjs — the pumper → kp bridge.
 *
 * Pulls the Czech labour-market datasets that the `mpsv-vpm` + `mpsv-ispv`
 * Pumper apps produce (see C:\Users\kazda\kiro\pumper), maps their native
 * CZ-ISCO occupation codes onto kp's 16 role_families (data/czisco-role-map.json
 * + data/taxonomy.json), and writes a single, page-ready, committed snapshot at
 * data/market_pulse.json. The /market "Market Pulse" page reads that snapshot —
 * it never talks to Pumper at runtime.
 *
 * Counts come from the vacancy register; every SALARY comes from the ISPV
 * earnings survey. That split is the whole point — an advertised salary is a
 * statistic about adverts, and reading pay off ÚP postings once put the
 * national median at 29 000 Kč with Prague last. See scripts/lib/market-earnings.mjs.
 *
 *   Reference salaries  ← ISPV economy-wide earnings (median + Q1/Q3/D9 deciles),
 *                         weighted by employment, rolled up to role_family.
 *   Locality map        ← per-kraj vacancy volume (mpsv-vpm region_agg) + per-kraj
 *                         earnings (ISPV regional/RSCP, fetched straight from
 *                         data.mpsv.cz — not from Pumper).
 *   Org-type split      ← vacancy counts by public / private / agency, with pay
 *                         from the matching ISPV wage sphere (agencies have no
 *                         sphere, so that tile carries no pay figure).
 *   In-demand roles     ← national open-vacancy counts by family + occupation;
 *                         momentum accrues across runs via market_pulse_history.
 *   JD references       ← representative postings per family (mpsv-vpm samples).
 *
 * Usage:  node scripts/build-market-pulse.mjs   (Pumper must be running on :8088)
 *         PUMPER_URL=http://host:port  overrides the endpoint.
 *         --force  write the snapshot even if validateSnapshot() rejects it.
 *
 * STALENESS CONTRACT. Nobody schedules this. `data/market_pulse.json` is
 * committed and rebuilt by hand, and the /market page calls it stale past
 * STALE_AFTER_DAYS = 60 (app/landing/spark/market/data.ts) — printing the
 * snapshot's age in the hero rather than serving old pay figures silently. Sixty
 * days is therefore the cadence this script owes; see the "Rebuild cadence" note
 * in docs/features/marketing/README.md.
 *
 * NETWORK CONTRACT. Every GET below (Pumper, the MPSV codelists, ISPV) runs
 * through fetchJson() from scripts/lib/market-earnings.mjs: a 20 s
 * AbortSignal.timeout and a KP_OFFLINE refusal. A bare `await fetch()` here used
 * to hang the build forever on an endpoint that accepted the connection and then
 * said nothing — including a Pumper that had died mid-export.
 *
 * A snapshot that fails validateSnapshot() is NOT written and the process exits
 * 1. The documented workflow is `npm run market:build && npm run market:apply`,
 * and market:apply re-levels every shipped salary band from this file — so a
 * broken feed (an ISPV schema change, a Pumper export shape change, salary
 * fields reading adverts again) has to break the chain instead of printing a
 * warning nobody's `&&` can see.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fetchIspv,
  fetchJson,
  isOffline,
  regionalEarnings,
  sphereEarnings,
  nationalEarnings,
} from "./lib/market-earnings.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const PUMPER = process.env.PUMPER_URL || "http://127.0.0.1:8088";
const FORCE = process.argv.includes("--force");
const CISELNIKY = "https://data.mpsv.cz/od/soubory/ciselniky";
const ATTRIBUTION_URL = "https://data.mpsv.cz/web/data/volna-mista-za-celou-cr";

const FAMILY_LABEL_EN = {
  software_engineering: "Software Engineering",
  data_ai: "Data & AI",
  product_project: "Product & Project",
  healthcare_clinical: "Healthcare & Clinical",
  life_sciences_research: "Life Sciences & Research",
  skilled_trades: "Skilled Trades",
  operations_logistics: "Operations & Logistics",
  frontline_service: "Frontline Service",
  sales_marketing: "Sales & Marketing",
  finance_accounting: "Finance & Accounting",
  legal_compliance: "Legal & Compliance",
  hr_people: "HR & People",
  education_academic: "Education & Academia",
  creative_design: "Creative & Design",
  customer_support: "Customer Support",
  general_professional: "General Professional",
};
const FAMILY_ORDER = Object.keys(FAMILY_LABEL_EN);

// ── helpers ──────────────────────────────────────────────────────────────────
/** Every GET this script makes — timeout + KP_OFFLINE refusal, shared with the
 *  earnings module so Pumper and data.mpsv.cz cannot hang the build differently. */
const getJson = (url) => fetchJson(url);
/** Pumper /export → array of the stored record `data` objects. */
function records(exp) {
  const arr = Array.isArray(exp) ? exp : exp.records || exp.data || exp.items || [];
  return arr.map((r) => (r && typeof r === "object" && "data" in r ? r.data : r));
}
/** MPSV codelist → Map(id → cs label). */
function codelistMap(cl) {
  const m = new Map();
  for (const it of cl.polozky || []) {
    const name = (it.nazev && (it.nazev.cs || it.nazev)) || it.kod || it.id;
    if (it.id) m.set(it.id, name);
  }
  return m;
}
const r100 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v / 100) * 100);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Snapshot sanity gate — a pure function of the finished snapshot so it can be
 * exercised without a Pumper instance or a live MPSV fetch.
 *
 * Returns [] when the snapshot is publishable, else one string per problem.
 * These are corruption signals, not style notes: an empty `wages` export or a
 * changed `records()` shape silently produces zero salary families, and a salary
 * field that starts reading ADVERTS again lands the national median in the
 * twenties (that regression is why scripts/lib/market-earnings.mjs exists).
 */
export function validateSnapshot(snapshot) {
  const problems = [];
  const reference_salaries = snapshot?.reference_salaries ?? [];
  const regions = snapshot?.regions ?? [];
  const top_occupations = snapshot?.demand?.top_occupations ?? [];
  const meta = snapshot?.meta ?? {};
  if (reference_salaries.length < 8) problems.push(`only ${reference_salaries.length} salary families`);
  if (regions.length !== 14) problems.push(`expected 14 regions, got ${regions.length}`);
  if (!regions.every((r) => r.code)) problems.push("some regions missing NUTS3 code");
  if (!meta.national_median) problems.push("no national median");
  // A sanity floor, not a style rule: a national median in the twenties means
  // a salary field is reading adverts again.
  if (meta.national_median && meta.national_median < 35000)
    problems.push(`national median ${meta.national_median} looks like advertised pay, not earnings`);
  if (regions.some((r) => r.medianSalary == null)) problems.push("some regions have no ISPV earnings median");
  if (top_occupations.length < 10) problems.push("few top occupations");
  return problems;
}

const roleMap = JSON.parse(readFileSync(path.join(DATA, "czisco-role-map.json"), "utf8"));
function codeDigits(cz) {
  return String(cz || "").split("/").pop().replace(/\D/g, "");
}
function familyOf(cz) {
  const n = codeDigits(cz);
  for (let len = n.length; len >= 1; len--) {
    const hit = roleMap.byPrefix[n.slice(0, len)];
    if (hit) return hit;
  }
  return roleMap.default;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  // Refuse up front rather than per-URL: an air-gapped operator should be told
  // once, before six parallel fetches each reject with the same sentence.
  if (isOffline()) {
    throw new Error(
      "KP_OFFLINE is set — this build pulls from Pumper and data.mpsv.cz and cannot run offline. " +
        "data/market_pulse.json is committed, so an offline install already has a snapshot."
    );
  }
  console.log(`[market-pulse] pulling datasets from ${PUMPER} …`);
  const [aggRaw, regionRaw, samplesRaw, wagesRaw, freshRaw] = await Promise.all([
    getJson(`${PUMPER}/datasets/mpsv-vpm/role_region_agg/export`),
    getJson(`${PUMPER}/datasets/mpsv-vpm/region_agg/export`),
    getJson(`${PUMPER}/datasets/mpsv-vpm/vacancy_samples/export`),
    getJson(`${PUMPER}/datasets/mpsv-ispv/wages/export`),
    getJson(`${PUMPER}/datasets/mpsv-vpm/freshness/export`).catch(() => []),
  ]);
  const agg = records(aggRaw);
  const region = records(regionRaw);
  const samples = records(samplesRaw);
  const wages = records(wagesRaw);
  const freshness = records(freshRaw)[0] || {};
  console.log(
    `[market-pulse] role_region_agg=${agg.length} region_agg=${region.length} ` +
      `samples=${samples.length} wages=${wages.length}`
  );

  console.log(`[market-pulse] loading MPSV codelists …`);
  const [krajeCl, isco, skillsCl] = await Promise.all([
    getJson(`${CISELNIKY}/kraje.json`),
    getJson(`${CISELNIKY}/cz-isco.json`),
    getJson(`${CISELNIKY}/dovednosti.json`),
  ]);
  const kraje = new Map(); // id → {name, nuts3}
  for (const k of krajeCl.polozky || [])
    kraje.set(k.id, { name: (k.nazev && k.nazev.cs) || k.kod, nuts3: k.kodNuts3 || null });
  const iscoName = codelistMap(isco);
  const skillName = codelistMap(skillsCl);

  // 1) reference salaries — ISPV deciles rolled up to role_family, employment-weighted
  const bands = {};
  for (const w of wages) {
    const fam = familyOf(w.czIsco);
    const med = num(w.medianMzda);
    if (med == null) continue;
    const wt = num(w.pocetZamestnancuMzda) || 0.01; // thousands of employees
    const d1 = num(w.diferenciaceD1M) ?? med * 0.62;
    const q1 = num(w.diferenciaceQ1M) ?? med * 0.78;
    const q3 = num(w.diferenciaceQ3M) ?? med * 1.3;
    const d9 = num(w.diferenciaceD9M) ?? med * 1.75;
    const b = (bands[fam] ||= { p10: 0, j: 0, m: 0, s: 0, l: 0, med: 0, w: 0, occ: new Set() });
    b.p10 += d1 * wt;
    b.j += q1 * wt;
    b.m += med * wt;
    b.s += q3 * wt;
    b.l += d9 * wt;
    b.med += med * wt;
    b.w += wt;
    b.occ.add(w.czIsco);
  }
  const reference_salaries = FAMILY_ORDER.filter((f) => bands[f] && bands[f].w > 0).map((f) => {
    const b = bands[f];
    return {
      family: f,
      label: FAMILY_LABEL_EN[f],
      // decile ladder (employment-weighted, D1→D9) — junior..lead are the tier
      // anchors; p10 is the bottom-decile floor used to build the junior band.
      p10: r100(b.p10 / b.w),
      junior: r100(b.j / b.w),
      medior: r100(b.m / b.w),
      senior: r100(b.s / b.w),
      lead: r100(b.l / b.w),
      median: r100(b.med / b.w),
      employees_k: Math.round(b.w),
      occupations: b.occ.size,
    };
  });

  // ISPV earnings — the source of every salary figure below. Fetched straight
  // from data.mpsv.cz (public JSON, same host as the codelists above), so a
  // rebuild depends on Pumper only for the counts.
  console.log(`[market-pulse] fetching ISPV national + RSCP regional earnings …`);
  const ispv = await fetchIspv();
  const krajEarnings = regionalEarnings(ispv.regional);
  const sphere = sphereEarnings(ispv.national);
  const nation = nationalEarnings(ispv.national);

  // 2) locality map — per-kraj vacancy volume (region_agg) + per-kraj EARNINGS
  //    (RSCP). The advertised median rides along under its own name: the gap
  //    between offered and actual pay is a real signal, it just isn't "median
  //    salary".
  const regions = region
    .filter((x) => x.orgType === "all" && x.krajId !== "ALL")
    .map((x) => {
      const meta = kraje.get(x.krajId) || { name: x.krajId, nuts3: null };
      const earnings = krajEarnings.get(x.krajId) || { median: null, p25: null, p75: null, employees_k: 0 };
      return {
        krajId: x.krajId,
        code: meta.nuts3,
        name: meta.name,
        vacancies: x.count,
        medianSalary: earnings.median,
        p25: earnings.p25,
        p75: earnings.p75,
        employees_k: earnings.employees_k,
        advertisedMedian: r100(num(x.salaryMedian)),
      };
    })
    .sort((a, b) => b.vacancies - a.vacancies);

  // 3) org-type split — vacancy counts from the register, pay from the matching
  //    ISPV wage sphere. `agency` has no sphere, so it carries no pay figure and
  //    the page renders that tile as a count only.
  const ORG_LABEL = { private: "Private sector", public: "Public sector", agency: "Staffing agency" };
  const org_types = region
    .filter((x) => x.krajId === "ALL" && x.orgType !== "all")
    .map((x) => {
      const earnings = sphere[x.orgType];
      return {
        orgType: x.orgType,
        label: ORG_LABEL[x.orgType] || x.orgType,
        vacancies: x.count,
        medianSalary: earnings ? earnings.median : null,
        p25: earnings ? earnings.p25 : null,
        p75: earnings ? earnings.p75 : null,
        advertisedMedian: r100(num(x.salaryMedian)),
      };
    })
    .sort((a, b) => b.vacancies - a.vacancies);

  // 4) demand — national counts by family + occupation (kraj = ALL cells)
  const natCells = agg.filter((x) => x.krajId === "ALL");
  const famCount = {};
  const occ = {}; // czIsco → {count, salWeighted, salW}
  for (const c of natCells) {
    const fam = familyOf(c.czIsco);
    famCount[fam] = (famCount[fam] || 0) + c.count;
    const o = (occ[c.czIsco] ||= { count: 0, salW: 0, salWSum: 0 });
    o.count += c.count;
    if (num(c.salaryMedian) != null) {
      o.salW += c.salaryMedian * c.count;
      o.salWSum += c.count;
    }
  }
  // ISPV median lookup per czIsco (economy-wide, preferred over vacancy median)
  const ispvMedian = new Map();
  for (const w of wages) if (num(w.medianMzda) != null && !ispvMedian.has(w.czIsco)) ispvMedian.set(w.czIsco, w.medianMzda);

  const nationalTotal =
    region.find((x) => x.krajId === "ALL" && x.orgType === "all")?.count ||
    Object.values(famCount).reduce((a, b) => a + b, 0);

  const top_families = FAMILY_ORDER.filter((f) => famCount[f])
    .map((f) => ({
      family: f,
      label: FAMILY_LABEL_EN[f],
      vacancies: famCount[f],
      share: +(famCount[f] / nationalTotal).toFixed(4),
    }))
    .sort((a, b) => b.vacancies - a.vacancies);

  const top_occupations = Object.entries(occ)
    .map(([cz, o]) => ({
      czIsco: cz,
      name: iscoName.get(cz) || cz,
      family: familyOf(cz),
      vacancies: o.count,
      medianSalary: ispvMedian.has(cz) ? r100(ispvMedian.get(cz)) : o.salWSum ? r100(o.salW / o.salWSum) : null,
    }))
    .sort((a, b) => b.vacancies - a.vacancies)
    .slice(0, 25);

  // 5) JD references — representative postings per family
  const byFam = {};
  for (const s of samples) {
    const fam = familyOf(s.czIsco);
    (byFam[fam] ||= []).push(s);
  }
  const jd_references = FAMILY_ORDER.filter((f) => byFam[f]).map((f) => {
    const items = byFam[f]
      .sort((a, b) => (b.salaryPoint ? 1 : 0) - (a.salaryPoint ? 1 : 0) || (b.skills?.length || 0) - (a.skills?.length || 0))
      .slice(0, 6)
      .map((s) => ({
        title: s.title,
        occupation: iscoName.get(s.czIsco) || null,
        employer: s.employer || null,
        orgType: s.orgType,
        region: (kraje.get(s.krajId) || {}).name || null,
        salaryMin: num(s.salaryMin),
        salaryMax: num(s.salaryMax),
        posted: s.postedAt || null,
        skills: (s.skills || []).map((c) => skillName.get(c) || c).slice(0, 8),
      }));
    return { family: f, label: FAMILY_LABEL_EN[f], items };
  });

  // 6) momentum — delta vs the previous snapshot (accrues over runs)
  const now = new Date().toISOString();
  const histPath = path.join(DATA, "market_pulse_history.json");
  const history = existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf8")) : [];
  const prev = history[history.length - 1];
  if (prev && prev.families) {
    for (const tf of top_families) {
      const before = prev.families[tf.family];
      tf.momentum = before ? +(((tf.vacancies - before) / before) * 100).toFixed(1) : null;
    }
  } else {
    for (const tf of top_families) tf.momentum = null;
  }
  history.push({ generated_at: now, total: nationalTotal, families: Object.fromEntries(top_families.map((t) => [t.family, t.vacancies])) });

  const snapshot = {
    meta: {
      generated_at: now,
      currency: "CZK",
      salary_basis: "monthly gross",
      total_vacancies: nationalTotal,
      occupations_tracked: new Set(agg.map((x) => x.czIsco)).size,
      regions: regions.length,
      national_median: nation.median,
      national_p25: nation.p25,
      national_p75: nation.p75,
      advertised_national_median: r100(num(region.find((x) => x.krajId === "ALL" && x.orgType === "all")?.salaryMedian)),
      salary_source: "MPSV ČR — ISPV / Regionální statistika ceny práce (RSCP)",
      salary_period: ispv.period,
      ispv_period: ispv.period,
      // vacancy freshness (from mpsv-vpm's recency-filtered corpus)
      vacancies_date: freshness.refDate ?? null,
      median_posting_age_days: freshness.medianPostedAgeDays ?? null,
      posted_within_90d_pct: freshness.postedWithin90dPct ?? null,
      posted_within_180d_pct: freshness.postedWithin180dPct ?? null,
      relics_filtered: freshness.filteredOld ?? 0,
      source: "MPSV / Úřad práce ČR — Volná místa + ISPV",
      license: "CC BY 4.0",
      attribution: "Data © MPSV ČR (Úřad práce ČR, ISPV), CC BY 4.0",
      attribution_url: ATTRIBUTION_URL,
      coverage_note:
        "Two sources, kept apart on purpose. Vacancy counts are live openings registered at the Czech Labour Office (Úřad práce ČR) — real postings, though the register skews toward service, trades and operational roles, so higher-skill and senior corporate counts read low. Every salary figure comes instead from the official ISPV earnings survey (and its regional RSCP cut): what people are actually paid, not what a posting advertises. Where the survey has no figure for something, we leave it out rather than estimate it.",
    },
    reference_salaries,
    regions,
    org_types,
    demand: { national_total: nationalTotal, top_families, top_occupations },
    jd_references,
  };

  const outPath = path.join(DATA, "market_pulse.json");

  // Validate BEFORE writing. This used to warn on stderr and still exit 0 with
  // the bad snapshot already on disk, so `npm run market:build && npm run
  // market:apply` happily re-levelled every shipped salary band from it.
  const problems = validateSnapshot(snapshot);
  if (problems.length && !FORCE) {
    console.error(`[market-pulse] VALIDATION FAILED: ${problems.join("; ")}`);
    console.error(
      `[market-pulse] refusing to overwrite ${path.relative(ROOT, outPath)} — the committed snapshot is untouched. ` +
        `Fix the feed (Pumper export shape? ISPV schema?) and re-run, or pass --force to write it anyway.`
    );
    process.exit(1);
  }
  if (problems.length) {
    console.error(`[market-pulse] VALIDATION FAILED (--force, writing anyway): ${problems.join("; ")}`);
  }

  writeFileSync(histPath, JSON.stringify(history.slice(-40), null, 2) + "\n");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n");

  console.log(
    `[market-pulse] wrote ${path.relative(ROOT, outPath)} — ${reference_salaries.length} families, ` +
      `${regions.length} regions, ${top_occupations.length} occupations, ` +
      `${jd_references.reduce((a, b) => a + b.items.length, 0)} JD refs, total ${nationalTotal} vacancies.`
  );
}

// Only fetch/build when invoked as a script — importing this module (e.g. to
// exercise validateSnapshot) must not hit Pumper or write data/.
if (process.argv[1]?.endsWith("build-market-pulse.mjs")) {
  main().catch((e) => {
    console.error(`[market-pulse] FAILED: ${e.message}`);
    process.exit(1);
  });
}
