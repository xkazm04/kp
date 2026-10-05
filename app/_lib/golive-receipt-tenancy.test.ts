import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
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

test("every SELECT/UPDATE/INSERT on job_golive_receipts carries workspace_id", () => {
  const statements = sqlBlocks.filter((s) =>
    /\b(from|into|update)\s+job_golive_receipts\b/i.test(s)
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
