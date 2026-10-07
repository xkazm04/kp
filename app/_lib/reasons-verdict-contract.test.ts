// THE CONTRACT BEHIND "EVERY AUTOMATED VERDICT CARRIES ITS REASONS".
//
// reasons-coverage.ts counts three kinds of verdict (REASONS_VERDICT_KINDS) and
// reasons-coverage.test.ts proves the COUNTER can go down. Neither says anything about
// the other direction: nothing failed when the product learned to persist a fourth
// kind of verdict about a candidate, so the KPI could keep reading 100% over a set that
// was no longer complete. The vocabulary lived in the counter, and the counter is the
// one place that cannot notice what it leaves out.
//
// THIS TEST READS THE PRODUCERS FROM THE CODE, not from a list kept beside the counter:
//
//   * every `sealDecisionSafe/sealDecisionRecord/seal({ kind: … })` call site under app/
//     (the Art. 22 decision chain — where a rejection or a scorecard is SEALED),
//   * every column in a CREATE TABLE named like a verdict (verdict / scorecard /
//     ranking / rejection) — where a verdict is STORED,
//   * every INSERT INTO analyses — the ranking writer.
//
// Each producer it finds must be CLASSIFIED below: either it maps to one of the
// counter's kinds (and that kind must exist in REASONS_VERDICT_KINDS and have a live arm
// in reasonsBlockOf), or it is explicitly declared not-a-verdict-about-a-candidate with a
// reason. A producer that is in neither place fails the build — that is the whole job:
// adding a kind of verdict forces someone to decide, here, whether the reasons KPI covers
// it. The classification is the decision record; it is allowed to say "exempt", it is not
// allowed to be silent.
//
// NON-VACUITY (a scan that finds nothing must not pass):
//   * the scan must find at least the three producers the goal names;
//   * the detector is run over an injected kind list with a known arm removed, and over a
//     fixture source carrying an unclassified sealed kind — both must report a gap.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REASONS_VERDICT_KINDS, reasonsBlockOf, type ReasonsCatalog } from "./reasons-coverage.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------------------------------
// The scan (pure over { file, text } so a fixture can stand in for the tree)
// ---------------------------------------------------------------------------------------

type SourceFile = { file: string; text: string };

/** A place the code persists a verdict about a candidate. `key` is what the
 *  classification below names; `file` is where the scan found it. */
type Producer = { key: string; file: string };

/** `export const AUTO_REJECTED_KIND = "auto_rejected"` — a sealed kind that is a named
 *  constant rather than a literal at the call site. */
function kindConstants(files: readonly SourceFile[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { text } of files) {
    for (const m of text.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*_KIND)\s*=\s*["']([a-z_]+)["']/g)) out.set(m[1], m[2]);
  }
  return out;
}

/** Every sealed decision kind the code can write: the `kind:` expression of each seal
 *  call, with comparisons stripped (`action === "reject" ? "rejected" : …` seals
 *  "rejected", not "reject") and named constants resolved. */
function sealedKindProducers(files: readonly SourceFile[]): Producer[] {
  const consts = kindConstants(files);
  const out: Producer[] = [];
  for (const { file, text } of files) {
    for (const m of text.matchAll(/\b(?:sealDecisionSafe|sealDecisionRecord|seal)\(\s*\{\s*kind:\s*([^\n]+)/g)) {
      const expr = m[1].replace(/[!=]==?\s*["'][^"']*["']/g, "");
      for (const lit of expr.matchAll(/["']([a-z][a-z_]*)["']/g)) out.push({ key: `sealed:${lit[1]}`, file });
      for (const id of expr.matchAll(/\b([A-Z][A-Z0-9_]*_KIND)\b/g)) {
        const value = consts.get(id[1]);
        out.push({ key: `sealed:${value ?? `?${id[1]}`}`, file });
      }
    }
  }
  return out;
}

/** Every verdict-shaped COLUMN a CREATE TABLE declares, as `table.column`. */
function verdictColumnProducers(files: readonly SourceFile[]): Producer[] {
  const out: Producer[] = [];
  for (const { file, text } of files) {
    for (const table of text.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/g)) {
      for (const col of table[2].matchAll(/^\s+(\w*(?:verdict|scorecard|ranking|rejection)\w*)\s+(?:TEXT|INTEGER|REAL)\b/gim)) {
        out.push({ key: `column:${table[1]}.${col[1]}`, file });
      }
    }
  }
  return out;
}

/** The ranking writer: a verdict about a candidate is a row in `analyses`. */
function analysisWriteProducers(files: readonly SourceFile[]): Producer[] {
  const out: Producer[] = [];
  for (const { file, text } of files) {
    if (/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+analyses\b/.test(text)) out.push({ key: "write:analyses", file });
  }
  return out;
}

function scanProducers(files: readonly SourceFile[]): Producer[] {
  return [...sealedKindProducers(files), ...verdictColumnProducers(files), ...analysisWriteProducers(files)];
}

// ---------------------------------------------------------------------------------------
// The classification — the decision record. Every producer the scan can find is named
// here: a counter kind it feeds, or an explicit exemption with the reason.
// ---------------------------------------------------------------------------------------

type Classification = { counts: string } | { exempt: string };

const PRODUCER_CLASSIFICATION: Record<string, Classification> = {
  // RANKING — the match / job-fit verdict.
  "write:analyses": { counts: "ranking" },

  // SCORECARD — the per-competency interview verdict, stored and sealed.
  "column:interview_sessions.scorecard_json": { counts: "scorecard" },
  "sealed:ai_scorecard": { counts: "scorecard" },
  "sealed:human_scorecard": { counts: "scorecard" },

  // REJECTION — a sealed adverse screening decision. screen-wave.ts seals
  // AUTO_REJECTED_KIND; a recruiter's reject seals "rejected" (pipeline-entry-action.ts).
  "sealed:auto_rejected": { counts: "rejection" },
  "sealed:rejected": { counts: "rejection" },

  // RANKING, sealed — the verdict a Match add carries (MATCH_VERDICT_KIND, ADR 0018). The
  // meter counts it in the ranking arm's match-filed source, resolved through
  // matchVerdictReasons. INTERNAL until the owner rules on candidate visibility: it is not
  // in status-decisions.ts's CANDIDATE_VISIBLE / AI_VERDICT allowlists, so /status/[token]
  // does not show it — a ranking against a role the candidate may never have applied for
  // is a different disclosure from a rejection.
  "sealed:match_verdict": { counts: "ranking" },

  // EXEMPT — sealed or stored, but not an automated verdict whose reasons the KPI measures.
  "sealed:screen_wave_holdout": { exempt: "a would-be rejection the wave SPARED to form the calibration clean arm — no adverse outcome reaches the candidate" },
  "sealed:auto_advanced": { exempt: "a positive routing decision; the goal's measure is scorecard / ranking / rejection" },
  "sealed:advanced": { exempt: "a positive routing decision; the goal's measure is scorecard / ranking / rejection" },
  "sealed:reinstated": { exempt: "the reversal of a rejection — it overturns a verdict rather than producing one" },
  "sealed:offer_terms": { exempt: "the terms of an offer a human sets; not an AI verdict about the candidate" },
  "sealed:group_eval_lead": { exempt: "a group-level advisory over several candidates, recorded as an advisory" },
  "sealed:group_eval_advisory": { exempt: "a group-level advisory over several candidates, recorded as an advisory" },
  "sealed:screening_threshold_adjusted": { exempt: "a POLICY change (the auto-reject floor), not a verdict about a person" },
  "sealed:interview_scheduled": { exempt: "scheduling bookkeeping" },
  "sealed:interview_cancelled": { exempt: "scheduling bookkeeping" },
  "sealed:interview_no_show": { exempt: "scheduling bookkeeping" },
  "sealed:interview_proposal_declined": { exempt: "scheduling bookkeeping" },
  "column:gig_outcomes.verdict": { exempt: "the external judge's verdict on a freelance gig deliverable, not on a candidate" },
  "column:gig_lessons.verdict": { exempt: "what a gig outcome teaches a recipe, not a verdict on a candidate" },
};

// ---------------------------------------------------------------------------------------
// The detector — pure, so the controls can feed it a doctored kind list or a fixture.
// ---------------------------------------------------------------------------------------

type Gap = { producer: string; file: string; why: string };

/** Producers the contract cannot vouch for: unclassified, or classified into a counter
 *  kind that `kinds` (the counter's vocabulary) does not contain. */
function contractGaps(
  producers: readonly Producer[],
  classification: Record<string, Classification>,
  kinds: readonly string[]
): Gap[] {
  const gaps: Gap[] = [];
  for (const p of producers) {
    const c = classification[p.key];
    if (!c) {
      gaps.push({ producer: p.key, file: p.file, why: "unclassified — decide whether the reasons KPI covers it, then name it in PRODUCER_CLASSIFICATION" });
    } else if ("counts" in c && !kinds.includes(c.counts)) {
      gaps.push({ producer: p.key, file: p.file, why: `feeds "${c.counts}", which is not in REASONS_VERDICT_KINDS` });
    }
  }
  return gaps;
}

/** The three producers the goal names. A scan that cannot find these is broken, and a
 *  broken scan finds nothing — which would otherwise read as "no gaps". */
const KNOWN_PRODUCERS: { key: string; file: string }[] = [
  { key: "sealed:auto_rejected", file: "app/_lib/screen-wave.ts" },
  { key: "sealed:ai_scorecard", file: "app/_lib/interview-scorecard-commit.ts" },
  { key: "column:interview_sessions.scorecard_json", file: "app/_lib/db/core.ts" },
  { key: "write:analyses", file: "app/_lib/db/analyses.ts" },
];

function missingKnownProducers(producers: readonly Producer[]): string[] {
  return KNOWN_PRODUCERS.filter((k) => !producers.some((p) => p.key === k.key && p.file === k.file)).map(
    (k) => `${k.key} in ${k.file}`
  );
}

// ---------------------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------------------

function walk(dir: string, out: SourceFile[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push({ file: path.relative(REPO_ROOT, full).split(path.sep).join("/"), text: readFileSync(full, "utf8") });
    }
  }
}

const SOURCES: SourceFile[] = [];
walk(path.join(REPO_ROOT, "app"), SOURCES);
const PRODUCERS = scanProducers(SOURCES);

const CATALOG = Object.assign(() => "", { has: () => false }) as unknown as ReasonsCatalog;

test("the scan finds the producers the goal names — a broken scan cannot pass by finding nothing", () => {
  assert.deepEqual(missingKnownProducers(PRODUCERS), []);
  assert.ok(PRODUCERS.length >= KNOWN_PRODUCERS.length, `scan found only ${PRODUCERS.length} producers`);
});

test("every verdict producer in the code is classified, and every counted kind is in REASONS_VERDICT_KINDS", () => {
  const gaps = contractGaps(PRODUCERS, PRODUCER_CLASSIFICATION, REASONS_VERDICT_KINDS);
  assert.deepEqual(gaps, [], `producers the reasons KPI has no decision about:\n${JSON.stringify(gaps, null, 2)}`);
});

test("every kind in REASONS_VERDICT_KINDS has a live arm in reasonsBlockOf and a real producer", () => {
  for (const kind of REASONS_VERDICT_KINDS) {
    const result = reasonsBlockOf({ kind, id: "contract" } as never, CATALOG);
    assert.equal(typeof result?.ok, "boolean", `reasonsBlockOf has no arm for "${kind}"`);
    const fed = Object.entries(PRODUCER_CLASSIFICATION).filter(([, c]) => "counts" in c && c.counts === kind);
    assert.ok(fed.length > 0, `"${kind}" has no classified producer`);
    assert.ok(
      fed.some(([key]) => PRODUCERS.some((p) => p.key === key)),
      `"${kind}" is classified but the scan finds none of its producers — a dead arm`
    );
  }
});

test("classification has no stale rows — each names a producer the code still has", () => {
  const found = new Set(PRODUCERS.map((p) => p.key));
  const stale = Object.keys(PRODUCER_CLASSIFICATION).filter((k) => !found.has(k));
  assert.deepEqual(stale, [], "PRODUCER_CLASSIFICATION names a producer the scan no longer finds");
});

test("the corpus meter's rejection query counts every sealed kind classified as a rejection", () => {
  const meter = readFileSync(path.join(REPO_ROOT, "scripts", "kpi", "reasons-coverage.mjs"), "utf8");
  const m = meter.match(/kind IN \(([^)]*)\)/);
  assert.ok(m, "could not find the meter's `kind IN (…)` rejection filter");
  const metered = new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
  for (const [key, c] of Object.entries(PRODUCER_CLASSIFICATION)) {
    if (!key.startsWith("sealed:") || !("counts" in c) || c.counts !== "rejection") continue;
    assert.ok(metered.has(key.slice("sealed:".length)), `${key} is a rejection producer the meter's SQL does not count`);
  }
});

// ---------------------------------------------------------------------------------------
// POSITIVE CONTROLS — the detector must go red when it should.
// ---------------------------------------------------------------------------------------

test("POSITIVE CONTROL — removing the scorecard arm from the kind list reds every scorecard producer", () => {
  const withoutScorecard = REASONS_VERDICT_KINDS.filter((k) => k !== "scorecard");
  const gaps = contractGaps(PRODUCERS, PRODUCER_CLASSIFICATION, withoutScorecard);
  const keys = new Set(gaps.map((g) => g.producer));
  assert.ok(keys.has("sealed:ai_scorecard"), "the AI scorecard seal must be reported");
  assert.ok(keys.has("column:interview_sessions.scorecard_json"), "the stored scorecard must be reported");
  assert.ok(![...keys].some((k) => k === "write:analyses" || k === "sealed:auto_rejected"), "only the removed arm's producers are reported");
});

test("POSITIVE CONTROL — removing the rejection arm reds the screen-wave seal", () => {
  const gaps = contractGaps(PRODUCERS, PRODUCER_CLASSIFICATION, REASONS_VERDICT_KINDS.filter((k) => k !== "rejection"));
  assert.ok(gaps.some((g) => g.producer === "sealed:auto_rejected" && g.file === "app/_lib/screen-wave.ts"));
});

test("POSITIVE CONTROL — a new sealed verdict kind, a new verdict column and a new ranking writer all fail", () => {
  const fixture: SourceFile[] = [
    {
      file: "app/_lib/fixture-shortlist.ts",
      text: `sealDecisionSafe({ kind: "ai_shortlist", actor });\nconst X_KIND = "x";`,
    },
    { file: "app/_lib/fixture-store.ts", text: "CREATE TABLE IF NOT EXISTS fit_checks (\n      ranking_json TEXT,\n      id TEXT\n    );" },
  ];
  const gaps = contractGaps(scanProducers(fixture), PRODUCER_CLASSIFICATION, REASONS_VERDICT_KINDS);
  assert.deepEqual(gaps.map((g) => g.producer).sort(), ["column:fit_checks.ranking_json", "sealed:ai_shortlist"]);
});

test("the scan reads comparisons and named constants correctly", () => {
  const fixture: SourceFile[] = [
    { file: "a.ts", text: `export const HOLD_KIND = "held_out";\nsealDecisionSafe({ kind: HOLD_KIND, a: 1 });` },
    { file: "b.ts", text: `sealDecisionSafe({ kind: action === "reject" ? "rejected" : "advanced", a: 1 });` },
  ];
  assert.deepEqual(
    sealedKindProducers(fixture).map((p) => p.key),
    ["sealed:held_out", "sealed:rejected", "sealed:advanced"]
  );
});

test("VACUITY CONTROL — an empty scan reports the known producers as missing", () => {
  assert.equal(missingKnownProducers([]).length, KNOWN_PRODUCERS.length);
});
