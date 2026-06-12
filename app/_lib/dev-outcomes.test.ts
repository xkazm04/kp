import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
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
// node --test isolates each test file in its own process, so this env mutation can't leak.
const TMP = path.join(os.tmpdir(), `kp-dev-outcomes-test-${process.pid}.sqlite`);
process.env.KP_DB_PATH = TMP;

const { recordOutcome, recordPipelineOutcome, latestOutcomeByRefs, listOutcomes, calibrate } = await import("./dev-outcomes.ts");

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

after(() => {
  // Best-effort: the store's connection is still open (no close hook); on Windows an
  // open SQLite file can't be unlinked, so swallow the error — the temp file is
  // disposable and the process exits next.
  for (const f of [TMP, `${TMP}-wal`, `${TMP}-shm`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* file locked / absent — fine */
    }
  }
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
