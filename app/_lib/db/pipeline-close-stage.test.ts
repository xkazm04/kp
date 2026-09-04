// closeEntriesByJobId's SECOND predicate — the terminal-stage re-assert.
//
// The sibling file pipeline-close-guard.test.ts pins the STATUS half of the same
// UPDATE. This file exists because the status half alone never closed the incident
// it was written for.
//
// A hire is a STAGE move, not a status move. The candidate a role is FILLED with keeps
// `status='active'` and moves into the terminal column — that is the whole reason
// closeEntriesByJobId resolves `hiredStage` by ROLE and excludes it in the SELECT. But
// the UPDATE re-asserted only `status='active'`, so a recruiter dropping someone onto
// Hired in the window between the SELECT and that row's write satisfied the guard and
// was withdrawn from the role they had just been hired into: the exact incident, with
// the exact care taken to prevent it undone one line later.
//
// TWO claims, both here:
//   1. The steady state — a candidate already at the terminal stage survives a close,
//      end to end through the real store.
//   2. The RACE — the promotion lands mid-window. Replayed on two connections against
//      the statement EXTRACTED from pipeline.ts, so it cannot pass against SQL the app
//      no longer runs, with the guard-stripped control as the non-vacuity proof.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH so every store opens
// a throwaway SQLite file unique to this process).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { closeEntriesByJobId, createPipelineEntry, getPipelineEntry, hasEvent, setPipelineEntryStage } from "./pipeline.ts";

after(() => cleanupUnitDb());

// ── 1. Steady state: the hire is not withdrawn ────────────────────────────────
test("closing a role leaves the candidate standing in the terminal column untouched", () => {
  const jobId = "close-stage-job-1";
  const hired = createPipelineEntry({
    candidateId: "cand-hired",
    candidateLabel: "Hired Person",
    jobId,
    jobTitle: "Backend Eng",
    stage: "Screened",
  }).entry;
  const other = createPipelineEntry({
    candidateId: "cand-other",
    candidateLabel: "Other Person",
    jobId,
    jobTitle: "Backend Eng",
    stage: "Screened",
  }).entry;

  // The hire: a STAGE move onto the terminal column. Status stays 'active' — that is
  // the property this whole file is about.
  assert.equal(setPipelineEntryStage(hired.id, "Hired")?.stage, "Hired");
  assert.equal(getPipelineEntry(hired.id)!.status, "active", "a hire is a stage move; the status stays active");

  const withdrawn = closeEntriesByJobId(jobId);

  assert.equal(withdrawn, 1, "only the non-hired candidate is withdrawn");
  assert.equal(getPipelineEntry(hired.id)!.status, "active", "the candidate the role was FILLED with must survive the close");
  assert.equal(getPipelineEntry(hired.id)!.stage, "Hired");
  assert.equal(
    hasEvent(hired.id, "role_closed"),
    false,
    "the hire must not be given a withdrawal event it never earned"
  );
  assert.equal(getPipelineEntry(other.id)!.status, "role_closed");
  assert.equal(hasEvent(other.id, "role_closed"), true);
});

// ── 2. The race, actually run ─────────────────────────────────────────────────
//
// better-sqlite3 is synchronous, so no second writer gets a turn BETWEEN two statements
// of one transaction in this process. The race is nonetheless real and reproducible: the
// transaction is DEFERRED, so it holds no write lock while it walks its rows, and a
// second CONNECTION on the same file (another request handler, the automation engine)
// can flip a row the SELECT already read. Two handles replay exactly that ordering.
const SOURCE = readFileSync(fileURLToPath(new URL("./pipeline.ts", import.meta.url)), "utf8");

/** The body of a top-level `export function <name>(` up to the next top-level one. */
function functionBody(name: string): string {
  const start = SOURCE.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `${name} not found — did it get renamed?`);
  const rest = SOURCE.slice(start + 1);
  const end = rest.indexOf("\nexport ");
  return end === -1 ? rest : rest.slice(0, end);
}

/** The single UPDATE on pipeline_entries inside one function body, whitespace-collapsed. */
function soleUpdate(name: string): string {
  const updates = [...functionBody(name).matchAll(/UPDATE pipeline_entries SET [^`]*/g)].map((m) =>
    m[0].replace(/\s+/g, " ").trim()
  );
  assert.equal(updates.length, 1, `expected exactly one UPDATE in ${name}, saw ${updates.length}`);
  return updates[0];
}

/** Bind the extracted statement's `?` placeholders by the column each sits against, so a
 *  future guard binds automatically instead of breaking this harness on arity. */
function bindParams(sql: string, values: Record<string, unknown>): unknown[] {
  return [...sql.matchAll(/([A-Za-z_]+)\s*(?:=|!=|<>)\s*\?/g)].map((m) => {
    assert.ok(m[1] in values, `the replay has no value for the '${m[1]}' placeholder`);
    return values[m[1]];
  });
}

const RACE_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-close-stage-race-"));
after(() => rmSync(RACE_DIR, { recursive: true, force: true }));

/** Only the columns the statement touches, on a throwaway file — the subject is the
 *  WHERE clause, and boot's full schema would drag seeding and migrations into it. */
function raceDb(name: string): Database.Database {
  const file = path.join(RACE_DIR, `${name}.sqlite`);
  const setup = new Database(file);
  setup.pragma("journal_mode = WAL");
  setup.exec(`CREATE TABLE pipeline_entries (
    id TEXT PRIMARY KEY, candidate_label TEXT NOT NULL, job_title TEXT, archetype TEXT,
    stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', approval_kind TEXT, updated_at TEXT,
    workspace_id TEXT NOT NULL DEFAULT 'workspace'
  );`);
  setup.close();
  return new Database(file);
}

const REPLAY: Record<string, unknown> = {
  updated_at: "2026-01-02",
  id: "e1",
  stage: "Hired", // the terminal column closeEntriesByJobId resolves by ROLE
  workspace_id: "workspace",
};

test("a promotion into the terminal column mid-window makes close's guarded UPDATE a no-op", () => {
  const a = raceDb("close-stage");
  const b = new Database(a.name);
  try {
    a.prepare(
      `INSERT INTO pipeline_entries (id, candidate_label, stage, status, updated_at)
       VALUES ('e1', 'Candidate', 'Interview', 'active', '2026-01-01')`
    ).run();

    // A: the SELECT the close loop reads its work from — status active, not yet terminal.
    const seen = a
      .prepare(`SELECT id FROM pipeline_entries WHERE status = 'active' AND stage != ? AND id = 'e1'`)
      .all(REPLAY.stage) as { id: string }[];
    assert.equal(seen.length, 1, "fixture setup: A must have the row in its work list");

    // B: the recruiter hits Hire. A STAGE move — the status stays 'active', which is
    // precisely why the status guard alone did not see it.
    b.prepare(`UPDATE pipeline_entries SET stage='Hired' WHERE id='e1'`).run();
    const mid = b.prepare(`SELECT status FROM pipeline_entries WHERE id='e1'`).get() as { status: string };
    assert.equal(mid.status, "active", "the hire left the status alone — the status guard cannot catch this");

    // A: the guarded UPDATE, taken verbatim from the shipped function.
    const sql = soleUpdate("closeEntriesByJobId");
    const res = a.prepare(sql).run(...bindParams(sql, REPLAY));

    assert.equal(res.changes, 0, "the stage re-assert must make A's write a no-op");
    const now = a.prepare(`SELECT stage, status FROM pipeline_entries WHERE id='e1'`).get() as {
      stage: string;
      status: string;
    };
    assert.equal(now.stage, "Hired");
    assert.equal(now.status, "active", "the hire must survive intact — this is the incident this guard exists for");
  } finally {
    a.close();
    b.close();
  }
});

// Non-vacuity. Strip ONLY the stage clause out of the SAME extracted statement and the
// SAME sequence withdraws the hire — the bug, reproduced. If this ever stops reproducing
// it, the test above is proving nothing.
test("without the stage re-assert, the identical sequence withdraws the hire", () => {
  const a = raceDb("close-stage-unguarded");
  const b = new Database(a.name);
  try {
    a.prepare(
      `INSERT INTO pipeline_entries (id, candidate_label, stage, status, updated_at)
       VALUES ('e1', 'Candidate', 'Interview', 'active', '2026-01-01')`
    ).run();
    a.prepare(`SELECT id FROM pipeline_entries WHERE status = 'active' AND stage != ?`).all(REPLAY.stage);
    b.prepare(`UPDATE pipeline_entries SET stage='Hired' WHERE id='e1'`).run();

    const unguarded = soleUpdate("closeEntriesByJobId").replace(/\s*AND stage != \?/, "");
    assert.doesNotMatch(unguarded, /stage != \?/, "the control must actually have the stage guard removed");
    const res = a.prepare(unguarded).run(...bindParams(unguarded, REPLAY));

    assert.equal(res.changes, 1, "the un-stage-guarded statement writes — that is the bug");
    const now = a.prepare(`SELECT status FROM pipeline_entries WHERE id='e1'`).get() as { status: string };
    assert.equal(now.status, "role_closed", "the hire was withdrawn from the role they were hired into");
  } finally {
    a.close();
    b.close();
  }
});
