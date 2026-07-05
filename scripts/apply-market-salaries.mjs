#!/usr/bin/env node
/*
 * apply-market-salaries.mjs — feed the Market Pulse data back into the app.
 *
 * Updates data/salary_benchmarks.json (the deterministic CZK anchor bands the
 * jobfit pipeline feeds Gemini via taxonomy.role_band) by CALIBRATING each role
 * family's hand-authored bands to the empirical ISPV earnings level from
 * data/market_pulse.json — rather than replacing them.
 *
 * Why calibrate, not replace: ISPV deciles are within-occupation over the whole
 * CZ workforce (mostly non-Prague, non-senior), so a raw decile→seniority map
 * systematically undersells senior/lead and mis-levels broadly-mapped families
 * (e.g. legal → paralegal-dominated). Instead we keep the manual bands' seniority
 * SPREAD (which encodes real progression) and re-LEVEL each family by a blended,
 * clamped multiplier toward its ISPV median:
 *
 *   m      = clamp(ISPV_median / manual_medior_center, M_MIN, M_MAX)
 *   factor = 1 + BLEND*(m - 1)                 // 0 = keep manual, 1 = full re-level
 *   band  →  [lo*factor, hi*factor]            // shape preserved, level corrected
 *
 * Families below MIN_SAMPLE_K ISPV employees (unreliable) or with no coverage
 * (e.g. product_project) keep their manual band untouched.
 *
 * Safety: the original hand-authored file is backed up to
 * data/salary_benchmarks.manual.json (once) so this is fully reversible.
 * role_band reads only role.family + role[seniority][0..1]; the added provenance
 * fields (source/factor/sample_k) are ignored by consumers.
 *
 * Usage: npm run market:apply   (after npm run market:build)
 *        env: MARKET_BLEND=0..1 (default 0.5) tunes how hard to pull toward ISPV.
 */

const BLEND = Math.min(1, Math.max(0, Number(process.env.MARKET_BLEND ?? 0.7)));
const M_MIN = 0.75; // a family can be re-levelled at most −25% …
const M_MAX = 1.3; // … or +30%, so a mis-mapped family can't blow up the anchors
const MIN_SAMPLE_K = 15; // ISPV employees (thousands) needed to trust the median
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const BENCH = path.join(DATA, "salary_benchmarks.json");
const BACKUP = path.join(DATA, "salary_benchmarks.manual.json");
const PULSE = path.join(DATA, "market_pulse.json");

const r500 = (v) => Math.round(v / 500) * 500;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

const pulse = JSON.parse(readFileSync(PULSE, "utf8"));
const bench = JSON.parse(readFileSync(BENCH, "utf8"));
const refByFamily = new Map(pulse.reference_salaries.map((r) => [r.family, r]));

// Preserve the pristine hand-authored bands the first time we run.
if (!existsSync(BACKUP)) {
  copyFileSync(BENCH, BACKUP);
  console.log(`[apply-salaries] backed up original → ${path.relative(ROOT, BACKUP)}`);
}
// Always diff against the pristine manual bands, even on re-runs.
const manual = JSON.parse(readFileSync(BACKUP, "utf8"));
const manualByFamily = new Map((manual.roles || []).map((r) => [r.family, r]));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const period = pulse.meta.ispv_period ? `ISPV ${pulse.meta.ispv_period}` : "ISPV";
const SENIORITY = ["junior", "medior", "senior", "lead"];
const diffRows = [];

// Base bands are always the pristine MANUAL file, so re-runs are idempotent.
const roles = manual.roles.map((mrole) => {
  const family = mrole.family;
  const ref = refByFamily.get(family);
  const medior = Array.isArray(mrole.medior) ? mrole.medior : null;
  const center = medior ? (medior[0] + medior[1]) / 2 : null; // manual "level" for this family
  // Gate: need ISPV coverage, a usable median, a manual anchor, and enough sample.
  if (!ref || num(ref.median) == null || center == null || (ref.employees_k ?? 0) < MIN_SAMPLE_K) {
    diffRows.push({ family, kept: true, factor: 1, before: mrole, after: mrole });
    return { ...mrole, source: "manual" };
  }
  const m = clamp(ref.median / center, M_MIN, M_MAX);
  const factor = 1 + BLEND * (m - 1);
  const scaleBand = (b) => {
    const lo = r500(b[0] * factor);
    return [lo, Math.max(r500(b[1] * factor), lo + 500)];
  };
  const after = { family };
  for (const s of SENIORITY) after[s] = Array.isArray(mrole[s]) ? scaleBand(mrole[s]) : mrole[s];
  after.source = `manual×${period}`;
  after.factor = +factor.toFixed(3);
  after.ispv_median = ref.median;
  after.sample_k = ref.employees_k ?? null;
  after.occupations = ref.occupations ?? null;
  diffRows.push({ family, kept: false, factor, before: mrole, after });
  return after;
});

const out = {
  currency: bench.currency || "CZK",
  market: `Czech Republic monthly gross salary — hand-authored bands calibrated to ${period}`,
  default_family: bench.default_family,
  _doc:
    "Role-family × seniority anchor bands. The hand-authored bands (data/salary_benchmarks.manual.json) " +
    "are CALIBRATED to empirical MPSV ISPV earnings from data/market_pulse.json: each family's manual " +
    "bands are re-levelled by a blended, clamped multiplier toward its ISPV median (factor = 1 + " +
    `${BLEND}*(clamp(ISPV_median/manual_medior_center, ${M_MIN}, ${M_MAX}) - 1)), preserving the manual ` +
    "seniority spread while correcting the overall level. `factor`/`ispv_median`/`sample_k` per role are " +
    "provenance. Families below the ISPV sample gate or with no coverage (e.g. product_project) keep " +
    "their manual band (source:'manual'). Regenerate via `npm run market:build && npm run market:apply` " +
    "(env MARKET_BLEND=0..1). Revert by restoring data/salary_benchmarks.manual.json. Bands remain CZ-wide; " +
    "the deterministic layer applies data/taxonomy.json::company_adjustments (Prague/enterprise premium) on " +
    "top. Consumers (taxonomy.role_band) read only role.family + role[seniority][0..1].",
  generated_at: pulse.meta.generated_at,
  roles,
};

writeFileSync(BENCH, JSON.stringify(out, null, 2) + "\n");

// ── before/after report ──────────────────────────────────────────────────────
const fmt = (b) => (Array.isArray(b) ? `${b[0] / 1000}–${b[1] / 1000}k` : "—");
console.log(`\n[apply-salaries] ${period} · blend=${BLEND} · ${roles.length} families → ${path.relative(ROOT, BENCH)}\n`);
for (const row of diffRows) {
  if (row.kept) {
    console.log(`  ${row.family}  (manual, unchanged — no/low ISPV coverage)`);
    continue;
  }
  console.log(`  ${row.family}  ×${row.factor.toFixed(2)}`);
  for (const s of SENIORITY) {
    const before = fmt(row.before[s]);
    const after = fmt(row.after[s]);
    const mark = before !== after ? "→" : "=";
    console.log(`     ${s.padEnd(7)} ${before.padStart(11)}  ${mark}  ${after}`);
  }
}
console.log(
  `\n[apply-salaries] done. Revert with: copy data\\salary_benchmarks.manual.json data\\salary_benchmarks.json`
);
