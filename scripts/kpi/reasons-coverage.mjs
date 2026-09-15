#!/usr/bin/env node
// THE METER for "every automated step is explainable to the candidate": what share
// of the verdicts this product actually produces can say why.
//
//   npm run kpi:reasons            # human-readable
//   npm run kpi:reasons -- --json  # the record a KPI writer stores
//
// It walks the DEMO CORPUS — the seeded material a fresh install self-seeds from
// (data/seed_*) — and, when a database is present (KP_DB_PATH, else data/kp.sqlite),
// the verdicts that install has since produced. Both sources feed the ONE pure
// counter in app/_lib/reasons-coverage.ts, which is also what the unit gate runs, so
// the meter and the gate cannot disagree about what "has a reasons block" means.
//
// WHAT IT WILL NOT DO IS ROUND AN EMPTY DENOMINATOR UP TO GREEN. The static seed
// corpus holds 66 rankings and no interviews or rejections at all, so on a clean
// checkout two of the three arms have nothing to count. That is reported as
// `measured: false` and printed as "not measured", never as 100% — the whole reason
// this is a counter and not an assertion.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countReasonsCoverage, reasonsCoveragePct, REASONS_VERDICT_KINDS } from "@/app/_lib/reasons-coverage";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const asJson = process.argv.includes("--json");

/** The `decisions.wave.reasons.*` slice of the English catalog, wrapped as the
 *  translator `waveReasonText` takes. English because this measures whether a reason
 *  RESOLVES at all — `npm run i18n:check` is what proves the other three locales
 *  carry the same keys, and duplicating that here would measure it twice and own it
 *  nowhere. */
function englishWaveCatalog() {
  const messages = JSON.parse(readFileSync(path.join(REPO_ROOT, "messages", "en.json"), "utf8"));
  const reasons = messages?.decisions?.wave?.reasons ?? {};
  const lookup = (key) => reasons[String(key).replace(/^reasons\./, "")];
  const t = (key, params) => {
    const template = lookup(key);
    if (template === undefined) return "";
    return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params?.[name] ?? `{${name}}`));
  };
  t.has = (key) => lookup(key) !== undefined;
  return t;
}

/** RANKINGS from the seeded analysis corpus — one produced job-fit verdict each. */
function seededRankings() {
  const file = path.join(REPO_ROOT, "data", "seed_analyses", "analyses.json");
  if (!existsSync(file)) return [];
  const rows = JSON.parse(readFileSync(file, "utf8"));
  return rows.map((row) => ({
    kind: "ranking",
    id: `seed:${row.id}`,
    explanation: row?.payload?.explanation ?? null,
    jobFitSummary: row?.payload?.jobFit?.summary ?? null,
  }));
}

/** Everything the INSTALL has produced since, when there is an install to read.
 *  Read-only and entirely optional: no database simply means those arms stay
 *  unmeasured, which is a truthful reading of a checkout that has run nothing. */
async function producedVerdicts() {
  const dbPath = process.env.KP_DB_PATH ?? path.join(REPO_ROOT, "data", "kp.sqlite");
  if (!existsSync(dbPath)) return { verdicts: [], dbPath: null };
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const verdicts = [];
  const tableExists = (name) =>
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?`).get(name) !== undefined;
  try {
    // Rankings: every stored analysis is a produced score about a person.
    if (tableExists("analyses")) {
      for (const row of db.prepare(`SELECT id, payload_json FROM analyses`).all()) {
        let payload = {};
        try {
          payload = JSON.parse(row.payload_json ?? "{}");
        } catch {
          /* an unparseable payload carries no prose — it falls through as a miss, which is correct */
        }
        verdicts.push({
          kind: "ranking",
          id: `analysis:${row.id}`,
          explanation: payload?.explanation ?? null,
          jobFitSummary: payload?.jobFit?.summary ?? null,
        });
      }
    }
    // Scorecards: the per-competency interview verdict.
    if (tableExists("interview_sessions")) {
      const rows = db
        .prepare(`SELECT id, scorecard_json FROM interview_sessions WHERE scorecard_json IS NOT NULL`)
        .all();
      for (const row of rows) {
        let scorecard = {};
        try {
          scorecard = JSON.parse(row.scorecard_json ?? "{}");
        } catch {
          /* same as above: unreadable means no reasons, and it is counted as one */
        }
        verdicts.push({ kind: "scorecard", id: `interview:${row.id}`, ratings: scorecard?.ratings });
      }
    }
    // Rejections: the SEALED adverse decisions, read exactly as the candidate-facing
    // and operator-facing surfaces read them (code + the record's inputs as params).
    if (tableExists("decision_records")) {
      const rows = db
        .prepare(`SELECT id, reason_code, payload_json FROM decision_records WHERE kind IN ('auto_rejected','rejected')`)
        .all();
      for (const row of rows) {
        let params = {};
        try {
          const inputs = JSON.parse(row.payload_json ?? "{}")?.inputs;
          if (inputs && typeof inputs === "object") params = inputs;
        } catch {
          /* no params — the code alone still has to resolve, and that is the check */
        }
        verdicts.push({
          kind: "rejection",
          id: `decision:${row.id}`,
          reason: { reasonCode: row.reason_code ?? "", reasonParams: params },
        });
      }
    }
  } finally {
    db.close();
  }
  return { verdicts, dbPath };
}

const { verdicts: produced, dbPath } = await producedVerdicts();
const coverage = countReasonsCoverage([...seededRankings(), ...produced], englishWaveCatalog());

if (asJson) {
  console.log(JSON.stringify({ ...coverage, source: { seed: "data/seed_*", db: dbPath } }, null, 2));
} else {
  const pct = (a) => (a.measured ? `${reasonsCoveragePct(a)}% (${a.withReasons}/${a.checked})` : "not measured (0 verdicts)");
  console.log("Reasons coverage — produced verdicts that can say why");
  console.log(`  source: data/seed_* ${dbPath ? `+ ${path.relative(REPO_ROOT, dbPath)}` : "(no database — seeded corpus only)"}`);
  for (const kind of REASONS_VERDICT_KINDS) console.log(`  ${kind.padEnd(10)} ${pct(coverage.byKind[kind])}`);
  console.log(`  ${"TOTAL".padEnd(10)} ${pct(coverage.total)}`);
  if (coverage.unmeasuredKinds.length > 0) {
    console.log(`  NOT COVERED by the total above: ${coverage.unmeasuredKinds.join(", ")} — nothing produced to count.`);
  }
  for (const miss of coverage.misses.slice(0, 20)) console.log(`  MISS ${miss.kind} ${miss.id}: ${miss.why}`);
  if (coverage.misses.length > 20) console.log(`  … and ${coverage.misses.length - 20} more`);
}
