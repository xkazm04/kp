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
 * Write safety: data/salary_benchmarks.json is now KEYED by market
 * ({_doc, markets:{cz, de-berlin,…}}). This script writes into ONE market block
 * (`--market <id>`, default "cz") and MERGES it back, preserving every other
 * market — it never emits the legacy FLAT single-market shape over a keyed file
 * (that silently dropped de-berlin). A legacy-flat input is tolerated (with a
 * loud warning) and UPGRADED to the keyed shape on write, so this script can
 * never PRODUCE a flat file again.
 *
 * Usage: npm run market:apply [-- --market cz]   (after npm run market:build)
 *        env: MARKET_BLEND=0..1 (default 0.5) tunes how hard to pull toward ISPV.
 */

const BLEND = Math.min(1, Math.max(0, Number(process.env.MARKET_BLEND ?? 0.7)));
const M_MIN = 0.75; // a family can be re-levelled at most −25% …
const M_MAX = 1.3; // … or +30%, so a mis-mapped family can't blow up the anchors
const MIN_SAMPLE_K = 15; // ISPV employees (thousands) needed to trust the median
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const BENCH = path.join(DATA, "salary_benchmarks.json");
const BACKUP = path.join(DATA, "salary_benchmarks.manual.json");
const PULSE = path.join(DATA, "market_pulse.json");

const r500 = (v) => Math.round(v / 500) * 500;
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// --market <id> (default "cz"): which market block to (re)calibrate + write.
const argv = process.argv.slice(2);
const marketFromArgs = () => {
  const eq = argv.find((a) => a.startsWith("--market="));
  if (eq) return eq.slice("--market=".length).trim();
  const i = argv.indexOf("--market");
  if (i >= 0 && argv[i + 1]) return argv[i + 1].trim();
  return "cz";
};
const MARKET_ID = marketFromArgs() || "cz";

const pulse = JSON.parse(readFileSync(PULSE, "utf8"));
const benchRaw = JSON.parse(readFileSync(BENCH, "utf8"));
const refByFamily = new Map(pulse.reference_salaries.map((r) => [r.family, r]));

// Shape detection: keyed ({markets:{…}}) is canonical; a flat {currency, roles}
// file is legacy (what OLD versions of this script wrote). We READ the target
// market's block from either, but always WRITE keyed (never clobber a keyed file
// with a flat block — that's the data-loss the guard test now surfaces).
const isKeyed =
  benchRaw && typeof benchRaw.markets === "object" && benchRaw.markets !== null && !Array.isArray(benchRaw.markets);
let targetBlock;
if (isKeyed) {
  targetBlock = benchRaw.markets[MARKET_ID];
  if (!targetBlock) {
    console.warn(
      `[apply-salaries] no '${MARKET_ID}' block in keyed benchmarks yet — creating a new one (other markets preserved).`
    );
    targetBlock = {};
  }
} else {
  console.warn(
    `[apply-salaries] WARNING: legacy FLAT benchmarks file detected — treating it as the '${MARKET_ID}' block and UPGRADING the output to the keyed shape (markets{${MARKET_ID}}).`
  );
  targetBlock = benchRaw;
}
if (MARKET_ID !== "cz") {
  console.warn(
    `[apply-salaries] NOTE: the calibration source (data/salary_benchmarks.manual.json + ISPV market_pulse) is the CZ dataset; writing CZ-sourced bands into the '${MARKET_ID}' block.`
  );
}

// The pristine per-market bands are stored FLAT (roles at the top level), so
// tolerate either shape when reading a backup: a keyed file's target block, else
// the flat file itself.
const flatBlock = (obj) =>
  obj && typeof obj.markets === "object" && obj.markets !== null && !Array.isArray(obj.markets)
    ? obj.markets[MARKET_ID] || {}
    : obj;

// Preserve the pristine hand-authored bands the first time we run — always as the
// FLAT target block, never the whole keyed file (so `manual.roles` is defined).
if (!existsSync(BACKUP)) {
  writeFileSync(BACKUP, JSON.stringify(flatBlock(benchRaw), null, 2) + "\n");
  console.log(`[apply-salaries] backed up original → ${path.relative(ROOT, BACKUP)}`);
}
// Always diff against the pristine manual bands, even on re-runs.
const manual = flatBlock(JSON.parse(readFileSync(BACKUP, "utf8")));
const manualByFamily = new Map((manual.roles || []).map((r) => [r.family, r]));

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const period = pulse.meta.ispv_period ? `ISPV ${pulse.meta.ispv_period}` : "ISPV";
const SENIORITY = ["junior", "medior", "senior", "lead"];
const diffRows = [];

// Base bands are always the pristine MANUAL file, so re-runs are idempotent.
const roles = (manual.roles || []).map((mrole) => {
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

// The regenerated single-market block. Currency/default_family come from the
// TARGET block (else the manual base) — never the now-absent top level. Field
// order/shape matches the existing keyed cz block (no per-block _doc; the file's
// top-level _doc carries the keyed-shape documentation).
const block = {
  currency: targetBlock.currency || manual.currency || "CZK",
  market: `Czech Republic monthly gross salary - hand-authored bands calibrated to ${period}`,
  default_family: targetBlock.default_family ?? manual.default_family,
  generated_at: pulse.meta.generated_at,
  roles,
};

// Top-level _doc for the keyed file: preserve the existing one on a keyed input;
// synthesize it when upgrading a legacy-flat file so the shape is self-describing.
const KEYED_DOC =
  "Role-family × seniority anchor bands, KEYED BY MARKET (markets[<market_id>]) so onboarding a second " +
  "market is configuration (add a block) not a full-file swap. taxonomy.role_band selects " +
  "markets[ACTIVE_MARKET.market_id] (a guard test keeps each block's currency in lockstep with its " +
  "MarketConfig). Each market's hand-authored bands (data/salary_benchmarks.manual.json for cz) are " +
  "CALIBRATED to empirical MPSV ISPV earnings from data/market_pulse.json: manual bands are re-levelled " +
  `by a blended, clamped multiplier toward the ISPV median (factor = 1 + ${BLEND}*(clamp(ISPV_median/` +
  `manual_medior_center, ${M_MIN}, ${M_MAX}) - 1)), preserving the manual seniority spread while ` +
  "correcting the level. `factor`/`ispv_median`/`sample_k` per role are provenance. Regenerate via " +
  "`npm run market:build && npm run market:apply [-- --market <id>]` (env MARKET_BLEND=0..1); revert by " +
  "restoring data/salary_benchmarks.manual.json. Consumers read only role.family + role[seniority][0..1].";

const out = {
  _doc: isKeyed ? benchRaw._doc || KEYED_DOC : KEYED_DOC,
  markets: { ...(isKeyed ? benchRaw.markets : {}), [MARKET_ID]: block },
};

// Write-safety invariant: we only ever emit the keyed shape. A regression that
// tried to write a flat top-level block (roles/currency at the root, no markets{})
// would DROP every sibling market silently — refuse loudly instead.
if (!out.markets || typeof out.markets !== "object" || "roles" in out) {
  throw new Error(
    "[apply-salaries] refusing to write a FLAT benchmarks file — that would drop sibling markets. This is a bug."
  );
}
const siblingsPreserved = Object.keys(out.markets).filter((m) => m !== MARKET_ID);

writeFileSync(BENCH, JSON.stringify(out, null, 2) + "\n");

// ── before/after report ──────────────────────────────────────────────────────
const fmt = (b) => (Array.isArray(b) ? `${b[0] / 1000}–${b[1] / 1000}k` : "—");
console.log(
  `\n[apply-salaries] ${period} · blend=${BLEND} · ${roles.length} families → markets.${MARKET_ID} in ${path.relative(ROOT, BENCH)}` +
    (siblingsPreserved.length ? ` (preserved: ${siblingsPreserved.join(", ")})` : "") +
    `\n`
);
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
