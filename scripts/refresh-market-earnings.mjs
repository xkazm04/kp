#!/usr/bin/env node
/*
 * refresh-market-earnings.mjs — re-level the committed Market Pulse snapshot's
 * salary layer onto real earnings data, in place.
 *
 * `npm run market:build` rebuilds the whole snapshot but needs a running Pumper
 * on :8088 for the ÚP vacancy datasets. The salary layer needs none of that —
 * ISPV/RSCP are public JSON on data.mpsv.cz — so this script exists to refresh
 * pay figures on their own, from anywhere, without touching a single count.
 *
 * What it rewrites (all from scripts/lib/market-earnings.mjs):
 *   regions[].medianSalary / p25 / p75   ← RSCP regional earnings, per kraj
 *   org_types[].medianSalary / p25 / p75 ← ISPV wage-sphere earnings
 *   meta.national_median                 ← ISPV whole-economy earnings
 *
 * What it leaves alone: every vacancy count, the demand ranking, the JD
 * references, and `reference_salaries` (already ISPV-derived and already sane).
 *
 * The advertised medians it replaces are not deleted — each moves to an
 * `advertisedMedian` field. The spread between what a posting offers and what
 * the job pays is a genuine signal we may want to show later; it is just not
 * the thing to label "median salary".
 *
 * Usage: npm run market:earnings
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  fetchIspv,
  regionalEarnings,
  sphereEarnings,
  nationalEarnings,
  round100
} from "./lib/market-earnings.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = path.join(ROOT, "data", "market_pulse.json");

const COVERAGE_NOTE =
  "Two sources, kept apart on purpose. Vacancy counts are live openings registered at the Czech Labour Office (Úřad práce ČR) — real postings, though the register skews toward service, trades and operational roles, so higher-skill and senior corporate counts read low. Every salary figure comes instead from the official ISPV earnings survey (and its regional RSCP cut): what people are actually paid, not what a posting advertises. Where the survey has no figure for something, we leave it out rather than estimate it.";

/** The advertised figure is captured ONCE and never re-derived.
 *
 *  build-market-pulse.mjs already writes BOTH layers — `medianSalary` from the ISPV/RSCP
 *  survey and `advertisedMedian` from the ÚP posting median — so on any snapshot it
 *  produced, `medianSalary` is already earnings. Re-deriving
 *  `advertisedMedian = round100(medianSalary)` here therefore read the EARNINGS number
 *  and stamped it over the advertised one: on the committed snapshot, one
 *  `npm run market:earnings` turned Praha's 24 100 Kč advertised median into 53 600
 *  (the offered-vs-actual spread this field exists to carry collapsed to zero) and
 *  nulled the staffing-agency tile's 25 500 outright, since that row has no survey
 *  median and round100(null) is null. A second run of this script did the same thing.
 *
 *  So an EXISTING key always wins, null included. The derivation survives only as the
 *  migration path for a LEGACY snapshot from before the split — one that carries no
 *  `advertisedMedian` at all and whose `medianSalary` really is still the advert. */
function captureAdvertised(row, advertisedKey, currentKey) {
  return Object.hasOwn(row, advertisedKey) ? row[advertisedKey] : round100(row[currentKey]);
}

async function main() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  console.log(`[market-earnings] fetching ISPV national + RSCP regional from data.mpsv.cz …`);
  const { national, regional, period } = await fetchIspv();
  console.log(`[market-earnings] national rows=${national.length} regional rows=${regional.length} period=${period}`);

  // ── regions ────────────────────────────────────────────────────────────────
  const byKraj = regionalEarnings(regional);
  const unmatched = [];
  for (const region of snapshot.regions) {
    const earnings = byKraj.get(region.krajId);
    if (!earnings || earnings.median == null) {
      unmatched.push(region.name);
      // No survey figure → null, so the page hides the number instead of
      // falling back to the advertised one it was just corrected away from.
      region.advertisedMedian = captureAdvertised(region, "advertisedMedian", "medianSalary");
      region.medianSalary = null;
      region.p25 = null;
      region.p75 = null;
      continue;
    }
    region.advertisedMedian = captureAdvertised(region, "advertisedMedian", "medianSalary");
    region.medianSalary = earnings.median;
    region.p25 = earnings.p25;
    region.p75 = earnings.p75;
    region.employees_k = earnings.employees_k;
  }

  // ── org types ──────────────────────────────────────────────────────────────
  const spheres = sphereEarnings(national);
  for (const org of snapshot.org_types) {
    const earnings = spheres[org.orgType];
    org.advertisedMedian = captureAdvertised(org, "advertisedMedian", "medianSalary");
    org.medianSalary = earnings ? earnings.median : null;
    org.p25 = earnings ? earnings.p25 : null;
    org.p75 = earnings ? earnings.p75 : null;
  }

  // ── meta ───────────────────────────────────────────────────────────────────
  const nation = nationalEarnings(national);
  snapshot.meta.advertised_national_median = captureAdvertised(snapshot.meta, "advertised_national_median", "national_median");
  snapshot.meta.national_median = nation.median;
  snapshot.meta.national_p25 = nation.p25;
  snapshot.meta.national_p75 = nation.p75;
  snapshot.meta.salary_source = "MPSV ČR — ISPV / Regionální statistika ceny práce (RSCP)";
  snapshot.meta.salary_period = period;
  snapshot.meta.ispv_period = period;
  snapshot.meta.earnings_refreshed_at = new Date().toISOString();
  snapshot.meta.coverage_note = COVERAGE_NOTE;

  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2) + "\n");

  // ── validation ─────────────────────────────────────────────────────────────
  const problems = [];
  if (unmatched.length) problems.push(`${unmatched.length} region(s) without a survey median: ${unmatched.join(", ")}`);
  if (!nation.median) problems.push("no national earnings median");
  // A sanity floor, not a style rule: the whole point of this script is that a
  // national median in the twenties means we are reading adverts again.
  if (nation.median && nation.median < 35000) problems.push(`national median ${nation.median} looks like advertised pay, not earnings`);
  const praha = snapshot.regions.find((r) => r.krajId === "Kraj/19");
  const others = snapshot.regions.filter((r) => r.krajId !== "Kraj/19" && r.medianSalary != null);
  if (praha?.medianSalary != null && others.length && others.some((r) => r.medianSalary >= praha.medianSalary)) {
    problems.push("Prague is not the highest-paid region — check the source mapping");
  }
  if (problems.length) console.error(`[market-earnings] VALIDATION WARNINGS: ${problems.join("; ")}`);

  const ranked = [...snapshot.regions]
    .filter((r) => r.medianSalary != null)
    .sort((a, b) => b.medianSalary - a.medianSalary);
  console.log(
    // "advertised", not "was": the number beside it is the posting median this snapshot
    // carries, which after the capture-once fix above is no longer whatever
    // national_median happened to hold on the previous run.
    `[market-earnings] national median ${nation.median} Kč (advertised ${snapshot.meta.advertised_national_median}) · ` +
      `${ranked.length}/14 regions re-levelled · top ${ranked[0]?.name} ${ranked[0]?.medianSalary} · ` +
      `bottom ${ranked[ranked.length - 1]?.name} ${ranked[ranked.length - 1]?.medianSalary}`
  );
}

main().catch((e) => {
  console.error(`[market-earnings] FAILED: ${e.message}`);
  process.exit(1);
});
