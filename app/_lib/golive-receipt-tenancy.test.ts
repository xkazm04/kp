import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import {
  openReceipt,
  readReceipt,
  finishReceipt,
  claimResume,
} from "./golive-receipt-store.ts";

after(() => cleanupUnitDb());

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "golive-receipt-store.ts"),
  "utf8"
);
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

// The one-time failure_code normalisation (normalizeFailureCodes) is the single
// deployment-wide pair of statements in this store and says so in its own SQL. It is a
// schema repair with no tenant to attribute it to; the test below pins that it stays
// confined to failure_code, so the exemption cannot grow into a cross-tenant read.
const NORMALISATION_MARKER = "one-time normalisation, deployment-wide by design";

// What a marked (deployment-wide) statement may look like, as a pure function of its SQL
// text so the bad shapes can be proven red below without touching the store. Returns the
// violations; an empty list means the statement stays inside the exemption.
//  - a SELECT projects a constant only (`SELECT 1`): a column list could read job or
//    workspace identity across tenants;
//  - an UPDATE's WHOLE assignment list, SET up to WHERE (or the end), is exactly
//    [failure_code]: a first-column-only regex lets `SET failure_code = 'X', job_id = ?` by.
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = "";
  for (const ch of list) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === "(" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "}") {
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

function normalisationViolations(sql: string): string[] {
  const violations: string[] = [];
  if (!/failure_code/i.test(sql)) violations.push("does not mention failure_code");
  if (/^\s*select\b/i.test(sql)) {
    const projection = /^\s*select\s+([\s\S]*?)\s+from\b/i.exec(sql)?.[1] ?? "";
    if (!/^(\d+|'[^']*')$/.test(projection)) {
      violations.push(`SELECT projects "${projection}", not a constant`);
    }
  }
  const set = /\bset\b([\s\S]*?)(?:\bwhere\b|$)/i.exec(sql);
  if (set) {
    const columns = splitTopLevel(set[1]).map((a) => /^([a-z_]+)\s*=/i.exec(a)?.[1].toLowerCase() ?? a);
    if (columns.length !== 1 || columns[0] !== "failure_code") {
      violations.push(`SET assigns [${columns.join(", ")}], not exactly [failure_code]`);
    }
  }
  return violations;
}

test("every SELECT/UPDATE/INSERT on job_golive_receipts carries workspace_id", () => {
  const statements = sqlBlocks.filter(
    (s) => /\b(from|into|update)\s+job_golive_receipts\b/i.test(s) && !s.includes(NORMALISATION_MARKER)
  );
  assert.ok(statements.length >= 3, `expected >= 3 statements, found ${statements.length}`);
  for (const sql of statements) {
    const isInsert = /\binsert\s+into\b/i.test(sql);
    const boundOrStamped = isInsert
      ? /\bworkspace_id\b/i.test(sql)
      : /\bworkspace_id\s*=\s*\?/i.test(sql);
    assert.ok(
      boundOrStamped,
      `job_golive_receipts statement is not workspace-scoped:\n${sql}`
    );
  }
});

test("the deployment-wide exemption is only the failure_code normalisation", () => {
  const exempt = sqlBlocks.filter(
    (s) => /\b(from|into|update)\s+job_golive_receipts\b/i.test(s) && s.includes(NORMALISATION_MARKER)
  );
  assert.equal(exempt.length, 2, `expected exactly 2 marked statements, found ${exempt.length}`);
  for (const sql of exempt) {
    // Reads a constant, writes one non-identifying column: no candidate or job data
    // crosses a workspace boundary through either statement.
    assert.deepEqual(normalisationViolations(sql), [], `marked statement leaves the exemption:\n${sql}`);
  }
});

test("the exemption check fails on each bad shape and passes the real statements", () => {
  const MARK = `-- ${NORMALISATION_MARKER}`;
  // red: a marked SELECT that projects columns still mentions failure_code
  assert.equal(
    normalisationViolations(`SELECT job_id, workspace_id FROM job_golive_receipts ${MARK}
       WHERE failure_code IS NOT NULL LIMIT 1`).length,
    1
  );
  // red: a second column after failure_code (the old first-column regex never saw it)
  assert.equal(
    normalisationViolations(`UPDATE job_golive_receipts ${MARK}
       SET failure_code = 'X', job_id = ?
       WHERE failure_code IS NOT NULL`).length,
    1
  );
  // red: the same with no WHERE, so the list runs to the end of the statement
  assert.equal(
    normalisationViolations(`UPDATE job_golive_receipts ${MARK} SET failure_code = 'X', workspace_id = ?`).length,
    1
  );
  // green: the two statements the store really carries
  assert.deepEqual(
    normalisationViolations(`SELECT 1 FROM job_golive_receipts ${MARK}
       WHERE failure_code IS NOT NULL AND failure_code NOT IN (?, ?)
       LIMIT 1`),
    []
  );
  assert.deepEqual(
    normalisationViolations(`UPDATE job_golive_receipts ${MARK}
       SET failure_code = 'UNKNOWN'
       WHERE failure_code IS NOT NULL AND failure_code NOT IN (?, ?)`),
    []
  );
});

test("job_golive_receipts holds the opening's counters only — no column names a person", () => {
  openReceipt("job-receipt-shape", "ws-receipt-shape");
  const columns = (ensureDb().prepare(`PRAGMA table_info(job_golive_receipts)`).all() as { name: string }[])
    .map((c) => c.name)
    .sort();
  // ERASURE_EXEMPT["job_golive_receipts"] (db/pipeline.ts) rests on this set: the erasure
  // scrub is entry-keyed, so a candidate-keyed column added here would be undeletable.
  assert.deepEqual(columns, [
    "attempt",
    "failure_code",
    "finished_at",
    "job_id",
    "silver_medalists",
    "skipped",
    "sourced",
    "started_at",
    "state",
    "workspace_id",
  ]);
});

test("Store: openReceipt -> finishReceipt -> readReceipt returns done state (Acceptance 1)", () => {
  const ws = "ws-receipt-test-1";
  const jobId = "job-receipt-1";

  const opened = openReceipt(jobId, ws);
  assert.equal(opened.state, "sourcing");
  assert.equal(opened.attempt, 1);

  const initialRead = readReceipt(jobId, ws);
  assert.ok(initialRead);
  assert.equal(initialRead.state, "sourcing");
  assert.equal(initialRead.attempt, 1);

  const finished = finishReceipt(jobId, ws, 1, {
    state: "done",
    sourced: 2,
    skipped: 0,
    silverMedalists: 1,
  });
  assert.equal(finished, true);

  const afterFinish = readReceipt(jobId, ws);
  assert.ok(afterFinish);
  assert.equal(afterFinish.state, "done");
  assert.equal(afterFinish.sourced, 2);
  assert.equal(afterFinish.skipped, 0);
  assert.equal(afterFinish.silverMedalists, 1);
  assert.ok(afterFinish.finishedAt);
});

test("Stale finisher is dropped when attempt has moved (Acceptance 2)", () => {
  const ws = "ws-receipt-test-2";
  const jobId = "job-receipt-2";

  openReceipt(jobId, ws);
  // Mark abandoned so it can be resumed
  finishReceipt(jobId, ws, 1, { state: "abandoned" });

  const claimed = claimResume(jobId, ws, Date.now());
  assert.equal(claimed, 2);

  // Attempt 1 tries to finish now: changes 0 rows
  const staleFinish = finishReceipt(jobId, ws, 1, { state: "done" });
  assert.equal(staleFinish, false);

  const current = readReceipt(jobId, ws);
  assert.ok(current);
  assert.equal(current.attempt, 2);
  assert.equal(current.state, "sourcing");
});

test("CAS resume on abandoned and immediate second call (Acceptance 3)", () => {
  const ws = "ws-receipt-test-3";
  const jobId = "job-receipt-3";
  const now = Date.now();

  openReceipt(jobId, ws);
  finishReceipt(jobId, ws, 1, { state: "abandoned" });

  const attempt2 = claimResume(jobId, ws, now);
  assert.equal(attempt2, 2);

  // Immediate second claimResume: returns null because state is now 'sourcing' and fresh
  const secondClaim = claimResume(jobId, ws, now);
  assert.equal(secondClaim, null);
});

test("Resumability window: done -> null; 60s ago -> null; 30min ago -> attempt+1 (Acceptance 4)", () => {
  const ws = "ws-receipt-test-4";
  const jobId = "job-receipt-4";
  const now = Date.now();

  // 1. On 'done' -> null
  openReceipt(jobId, ws);
  finishReceipt(jobId, ws, 1, { state: "done" });
  assert.equal(claimResume(jobId, ws, now), null);

  // 2. On 'sourcing' started 60s ago -> null (still in flight)
  openReceipt(jobId, ws); // attempt 2
  const inFlightClaim = claimResume(jobId, ws, now + 60_000);
  assert.equal(inFlightClaim, null);

  // 3. On 'sourcing' started 30 min ago -> attempt+1 (interrupted)
  const thirtyMinLater = now + 30 * 60 * 1000;
  const resumedAttempt = claimResume(jobId, ws, thirtyMinLater);
  assert.equal(resumedAttempt, 3);
});

test("Tenancy isolation: workspace A receipt is invisible to workspace B (Acceptance 7)", () => {
  const jobId = "job-receipt-tenancy";
  openReceipt(jobId, "ws-alpha");
  finishReceipt(jobId, "ws-alpha", 1, { state: "abandoned" });

  assert.equal(readReceipt(jobId, "ws-beta"), null);
  assert.equal(claimResume(jobId, "ws-beta", Date.now()), null);
});
