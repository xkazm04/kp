import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

// biz-scan 2026-06-12 — recordOutcome must be an UPSERT, not a blind INSERT: a remounted
// SubmissionRow re-recording, or the control-room form re-typing a candidate the pipeline
// already auto-recorded, used to land as a second decided row that calibrate() counted
// individually (at MIN RESOLVED = 4 one duplicate can move suggestedFloor a whole tier).
// These tests pin the dedup rules — by `ref`, or refless by trimmed candidateRef + outcome —
// and the latestOutcomeByRefs reader the postings GET joins onto submissions, against a
// throwaway SQLite file loading the REAL store module so a copied-out gate can't drift.

// dev-outcomes transitively imports the extensionless TS sibling ./db-path — how Next/tsc
// resolve, but not the bare `node --test` runner. Install the same minimal resolve hook the
// other real-module tests use (see offers-store.test.ts): rewrite a relative, extensionless
// specifier to its .ts file; bare specifiers (better-sqlite3, zod, node:*) pass through.
registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;
    if ((spec.startsWith("./") || spec.startsWith("../")) && context.parentURL) {
      spec = new URL(spec, context.parentURL).href; // relative -> file: so we can test for .ts
    }
    if (spec.startsWith("file:") && !/\.[a-z0-9]+$/i.test(spec) && fs.existsSync(fileURLToPath(spec + ".ts"))) {
      spec += ".ts"; // extensionless import, e.g. "./db-path"
    }
    return nextResolve(spec, context);
  },
});

// Point the store at a throwaway DB BEFORE importing it: db-path reads KP_DB_PATH at module
// load, and the store opens its connection lazily, so the override is in force by first use.
// This MUST stay the first project import.
//
// It used to be a hand-rolled `os.tmpdir()/kp-dev-outcomes-test-${process.pid}.sqlite`.
// `--test-isolation=process` gives each FILE a fresh process, but the OS RECYCLES pids: a
// later run drawing a pid this file had used before re-opened that run's leftover database
// and inherited its committed rows (the after() unlink is best-effort and silently loses to
// the store's still-open handle on Windows). unit-db.ts is the repo-wide fix: a mkdtemp'd run
// directory (unique by construction, never pid-derived), a liveness-gated sweep of abandoned
// dirs, and cleanupUnitDb() to remove our own.
const { cleanupUnitDb, UNIT_DB_PATH: TMP } = await import("./testing/unit-db.ts");
after(cleanupUnitDb);

const {
  recordOutcome,
  recordPipelineOutcome,
  latestOutcomeByRefs,
  listOutcomes,
  calibrate,
  // UAT KAT-L1-002 — the workspace-side capture path (see the block of tests at the
  // foot of this file).
  countRatedHires,
  hireOutcomeRef,
  recordHirePerformance,
  PIPELINE_OUTCOME_REF_PREFIX,
} = await import("./dev-outcomes.ts");

type Row = {
  id: number;
  ref: string | null;
  candidate_ref: string | null;
  predicted_score: number | null;
  outcome: string;
  performance: number | null;
  note: string | null;
  recorded_at: string;
};

// Raw reads via a separate connection on the same WAL file — exactly how the store and
// db.ts share kp.sqlite at runtime.
function rows(): Row[] {
  const d = new Database(TMP);
  const r = d.prepare(`SELECT * FROM dev_outcomes ORDER BY id`).all() as Row[];
  d.close();
  return r;
}

// Pre-upsert databases can hold several rows for one ref; insert one raw to simulate.
function rawInsert(ref: string, outcome: string, performance: number | null, recordedAt: string): void {
  const d = new Database(TMP);
  d.prepare(`INSERT INTO dev_outcomes (ref, outcome, performance, recorded_at) VALUES (?, ?, ?, ?)`).run(ref, outcome, performance, recordedAt);
  d.close();
}

beforeEach(() => {
  listOutcomes(); // force the store to open its connection and create the table
  const d = new Database(TMP);
  d.prepare(`DELETE FROM dev_outcomes`).run();
  d.close();
});

test("a first outcome inserts a fresh row", () => {
  const verdict = recordOutcome({ ref: "s1", candidateRef: "alice", predictedScore: 80, outcome: "hired" });
  assert.equal(verdict, "inserted");
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].ref, "s1");
  assert.equal(all[0].outcome, "hired");
});

test("re-recording the same ref updates in place — never a second decided row", () => {
  recordOutcome({ ref: "s1", candidateRef: "alice", predictedScore: 80, outcome: "hired" });
  const verdict = recordOutcome({ ref: "s1", outcome: "hired", performance: 4 });
  assert.equal(verdict, "updated");
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].performance, 4);
  assert.equal(all[0].predicted_score, 80); // absent fields keep the existing values
  assert.equal(all[0].candidate_ref, "alice");
});

test("a ref re-record that flips hired → rejected drops the stale performance", () => {
  recordOutcome({ ref: "s1", candidateRef: "alice", outcome: "hired", performance: 5 });
  recordOutcome({ ref: "s1", outcome: "rejected" });
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].outcome, "rejected");
  assert.equal(all[0].performance, null); // performance only rides a "hired" outcome
});

test("a refless manual entry dedupes against the auto-recorded row (trimmed candidateRef + outcome)", () => {
  const created = recordPipelineOutcome({ candidateId: "ds-s9", candidateLabel: "bob", matchScore: 72 }, "hired");
  assert.equal(created, true);
  // The control-room form knows only the name — whitespace and all.
  const verdict = recordOutcome({ candidateRef: " bob ", outcome: "hired", performance: 3 });
  assert.equal(verdict, "updated");
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].ref, "s9"); // the auto row, updated in place
  assert.equal(all[0].performance, 3);
  assert.equal(all[0].predicted_score, 72);
  assert.equal(all[0].note, "auto-recorded from pipeline hire"); // provenance survives the update
});

test("a refless entry with a DIFFERENT outcome is a fresh row, not a correction", () => {
  recordOutcome({ candidateRef: "alice", outcome: "hired" });
  const verdict = recordOutcome({ candidateRef: "alice", outcome: "rejected" });
  assert.equal(verdict, "inserted"); // same name, different outcome — e.g. another posting
  assert.equal(rows().length, 2);
});

// bug-ui-scan-2026-07-09 (dev-lifecycle-cohort-outcomes #3): the refless key
// (candidateRef, outcome) is not a stable identity — two DIFFERENT real people who share a
// common name and outcome must not collapse into one row. A refless entry asserting its own,
// DIFFERENT predicted score is a distinct outcome and must insert, not overwrite the first's
// score (which silently biases calibration). Pre-fix this UPDATEd in place — one row, the
// second score clobbering the first — so these assertions (2 rows, both scores preserved)
// FAIL against the old blind-update.
test("a refless entry with a DIFFERENT predicted score does not merge into a same-name row", () => {
  const a = recordOutcome({ candidateRef: "J. Smith", outcome: "hired", predictedScore: 90 });
  assert.equal(a, "inserted");
  const b = recordOutcome({ candidateRef: "J. Smith", outcome: "hired", predictedScore: 60 });
  assert.equal(b, "inserted"); // a distinct person/posting — NOT a correction of the first
  const all = rows();
  assert.equal(all.length, 2);
  const scores = all.map((r) => r.predicted_score).sort((x, y) => (x ?? 0) - (y ?? 0));
  assert.deepEqual(scores, [60, 90]); // the first row's 90 survived — nothing was overwritten
});

// The legitimate completion path is preserved: a refless entry with NO score (or the SAME
// score) still updates the matched row in place, so the "add a perf score to the alice hire"
// dedup keeps working and never mints a second decided row.
test("a refless completion with no / matching predicted score still updates in place", () => {
  recordOutcome({ candidateRef: "alice", outcome: "hired", predictedScore: 80 });
  assert.equal(recordOutcome({ candidateRef: "alice", outcome: "hired", performance: 4 }), "updated"); // no score → completes
  assert.equal(recordOutcome({ candidateRef: "alice", outcome: "hired", predictedScore: 80, performance: 5 }), "updated"); // same score → completes
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].performance, 5);
  assert.equal(all[0].predicted_score, 80);
});

test("recordPipelineOutcome stays idempotent per (ref, outcome) and a re-transition updates the one row", () => {
  assert.equal(recordPipelineOutcome({ candidateId: "ds-s5", candidateLabel: "cara", matchScore: 60 }, "rejected"), true);
  assert.equal(recordPipelineOutcome({ candidateId: "ds-s5", candidateLabel: "cara", matchScore: 60 }, "rejected"), false);
  // Re-added later and hired: the latest terminal state wins, still one row for the ref.
  assert.equal(recordPipelineOutcome({ candidateId: "ds-s5", candidateLabel: "cara", matchScore: 60 }, "hired"), true);
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].outcome, "hired");
});

test("latestOutcomeByRefs returns the newest row per ref and only the asked-for refs", () => {
  // Legacy double-write (pre-upsert DBs can hold these): the later row must win.
  rawInsert("s1", "rejected", null, "2026-06-01T00:00:00.000Z");
  rawInsert("s1", "hired", 4, "2026-06-02T00:00:00.000Z");
  rawInsert("s2", "withdrawn", null, "2026-06-03T00:00:00.000Z");
  const latest = latestOutcomeByRefs(["s1", "s2", "s-unknown"]);
  assert.equal(latest.size, 2);
  assert.deepEqual(latest.get("s1"), { outcome: "hired", performance: 4, recordedAt: "2026-06-02T00:00:00.000Z" });
  assert.equal(latest.get("s2")?.outcome, "withdrawn");
  assert.equal(latest.has("s-unknown"), false);
  assert.equal(latestOutcomeByRefs([]).size, 0);
});

// ── UAT KAT-L1-002 — the on-the-job rating, captured from the recruiting workspace ──
//
// The blocker was that the 1..5 performance field had exactly one writer (the dev-case
// control room), so "did the 90 %-match candidates get hired AND stay?" had no data
// path. These pin the properties that make the new path safe to add to the SAME store
// the promote-floor calibration reads: one row per hire (a devcase-promoted candidate
// must UPDATE the auto-recorded row, never mint a second decided outcome), a ref space
// that cannot collide with a submission id, and an unrated hire that stays unrated.

test("hireOutcomeRef routes a devcase-promoted hire to its submission ref and everyone else to a namespaced one", () => {
  // Mirrors recordPipelineOutcome's own derivation — the two must agree or a rating
  // would open a second decided row for the same person.
  assert.equal(hireOutcomeRef({ id: "m-cand-013-job-000", candidateId: "ds-sub_42" }), "sub_42");
  assert.equal(hireOutcomeRef({ id: "pe-043", candidateId: "cand-043" }), `${PIPELINE_OUTCOME_REF_PREFIX}pe-043`);
  assert.equal(hireOutcomeRef({ id: "pe-043", candidateId: null }), `${PIPELINE_OUTCOME_REF_PREFIX}pe-043`);
  // The namespace is what keeps a seeded entry id like "pe-043" out of the submission
  // ref space; both id spaces are alphanumeric+dash, so the colon cannot occur in one.
  assert.ok(PIPELINE_OUTCOME_REF_PREFIX.includes(":"));
});

test("rating a devcase-promoted hire updates the auto-recorded row — never a second decided outcome", () => {
  assert.equal(recordPipelineOutcome({ candidateId: "ds-s9", candidateLabel: "bob", matchScore: 72 }, "hired"), true);
  const verdict = recordHirePerformance({ id: "m-bob-job-1", candidateId: "ds-s9", candidateLabel: "bob", matchScore: 72 }, 4);
  assert.equal(verdict, "updated");
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].ref, "s9");
  assert.equal(all[0].performance, 4);
  assert.equal(all[0].predicted_score, 72); // the rating lands beside the score that predicted it
  assert.equal(calibrate(55).resolved, 1); // one decided outcome, not two
});

test("rating an ordinary board hire inserts one row, and a correction updates it in place", () => {
  const entry = { id: "pe-043", candidateId: "cand-043", candidateLabel: "Eliška Králová", matchScore: 46 };
  assert.equal(recordHirePerformance(entry, 2), "inserted");
  assert.equal(recordHirePerformance(entry, 5), "updated"); // a mis-click is corrected, not doubled
  const all = rows();
  assert.equal(all.length, 1);
  assert.equal(all[0].ref, `${PIPELINE_OUTCOME_REF_PREFIX}pe-043`);
  assert.equal(all[0].outcome, "hired");
  assert.equal(all[0].performance, 5);
  assert.equal(all[0].candidate_ref, "Eliška Králová");
});

test("an out-of-range or absent match score is dropped, never clamped onto the rating", () => {
  recordHirePerformance({ id: "pe-1", candidateId: null, candidateLabel: "a", matchScore: 850 }, 3);
  recordHirePerformance({ id: "pe-2", candidateId: null, candidateLabel: "b", matchScore: null }, 3);
  const all = rows();
  assert.deepEqual(all.map((r) => r.predicted_score), [null, null]);
});

test("a rating outside 1..5 is refused at the store, not persisted", () => {
  const entry = { id: "pe-9", candidateId: null, candidateLabel: "z", matchScore: 70 };
  assert.throws(() => recordHirePerformance(entry, 0));
  assert.throws(() => recordHirePerformance(entry, 6));
  assert.throws(() => recordHirePerformance(entry, 3.5));
  assert.equal(rows().length, 0);
});

test("countRatedHires counts only hires carrying a rating — an unrated hire is absent, never a zero", () => {
  recordHirePerformance({ id: "pe-1", candidateId: null, candidateLabel: "a", matchScore: 70 }, 4);
  // A hire the pipeline auto-recorded but nobody has rated yet.
  recordPipelineOutcome({ candidateId: "ds-s2", candidateLabel: "b", matchScore: 80 }, "hired");
  // …and outcomes that can never carry a rating at all.
  recordOutcome({ ref: "r1", outcome: "rejected", predictedScore: 40 });
  recordOutcome({ ref: "r2", outcome: "pending" });
  assert.equal(countRatedHires(), 1);
  const unrated = latestOutcomeByRefs(["s2"]).get("s2");
  assert.equal(unrated?.outcome, "hired");
  assert.equal(unrated?.performance, null); // unrated reads as unrated
});

test("ratings are per workspace — one team's on-the-job data never counts for another", () => {
  recordHirePerformance({ id: "pe-1", candidateId: null, candidateLabel: "a", matchScore: 70 }, 4, "workspace");
  recordHirePerformance({ id: "pe-1", candidateId: null, candidateLabel: "a", matchScore: 70 }, 2, "other-team");
  assert.equal(countRatedHires("workspace"), 1);
  assert.equal(countRatedHires("other-team"), 1);
  assert.equal(rows().length, 2); // same ref, two tenants — no cross-tenant upsert
  assert.equal(latestOutcomeByRefs([`${PIPELINE_OUTCOME_REF_PREFIX}pe-1`], "workspace").get(`${PIPELINE_OUTCOME_REF_PREFIX}pe-1`)?.performance, 4);
});

// The 85 NO-CONVERGING-BAND fallback is "nothing converted anywhere, stay conservative"
// advice — NOT a measured band. Two of the five rationales assert a conversion that was
// actually observed: "calibrated" says the floor "sits at the first band where most promoted
// candidates were hired", and "lower" says the band between the suggestion and the current
// floor "converted well". Riding the fallback, both sentences contradict the hire-rate column
// printed directly above them in CalibrationPanel — and the operator reaches that state by
// TAKING THE APP'S OWN ADVICE: apply suggested → 85, then read "well-calibrated" on the next
// 3-second poll. Pre-fix these assertions fail with "calibrated" / "lower".
test("the no-converging-band fallback never claims a floor is calibrated or too strict", () => {
  for (const [ref, score] of [
    ["z1", 95],
    ["z2", 88],
    ["z3", 60],
    ["z4", 50],
  ] as const) {
    recordOutcome({ ref, predictedScore: score, outcome: "rejected" });
  }
  const atFallback = calibrate(85);
  assert.equal(atFallback.suggestedFloor, 85, "the conservative fallback itself is unchanged");
  assert.equal(atFallback.rationale.kind, "weak", "no band converted — the floor is not 'well-calibrated'");
  const above = calibrate(90);
  assert.equal(above.rationale.kind, "weak", "no band converted — 85–90 did not 'convert well'");
  // Raising toward the fallback is the documented conservative advice and stays truthful:
  // with every band at a 0 hire rate, "candidates below 85 rarely converted" holds.
  assert.equal(calibrate(55).rationale.kind, "raise");
});

test("a band that really did convert still reads as calibrated at its own floor", () => {
  recordOutcome({ ref: "c1", predictedScore: 60, outcome: "hired" });
  recordOutcome({ ref: "c2", predictedScore: 65, outcome: "hired" });
  recordOutcome({ ref: "c3", predictedScore: 40, outcome: "rejected" });
  recordOutcome({ ref: "c4", predictedScore: 20, outcome: "rejected" });
  const cal = calibrate(55);
  assert.equal(cal.suggestedFloor, 55); // the 55–69 band converted
  assert.equal(cal.rationale.kind, "calibrated"); // a real converging band still earns the claim
  assert.equal(calibrate(70).rationale.kind, "lower"); // …and so does the "too strict" advice
});

test("calibrate counts an upserted ref once — a re-record cannot inflate the resolved sample", () => {
  recordOutcome({ ref: "a", outcome: "hired", predictedScore: 90 });
  recordOutcome({ ref: "b", outcome: "hired", predictedScore: 88 });
  recordOutcome({ ref: "c", outcome: "rejected", predictedScore: 60 });
  recordOutcome({ ref: "d", outcome: "rejected", predictedScore: 50 });
  // The double-count scenario: the same hire recorded again (remount, or manual re-entry).
  recordOutcome({ ref: "a", outcome: "hired", predictedScore: 90, performance: 5 });
  const cal = calibrate(55);
  assert.equal(cal.resolved, 4); // 5 writes, 4 real outcomes
  assert.equal(cal.bands.reduce((sum, b) => sum + b.count, 0), 4);
});
