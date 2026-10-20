// The go-live receipt's failure_code is a CLOSED vocabulary, and this file is what
// makes that true rather than asserted: job_golive_receipts is listed in ERASURE_EXEMPT
// (db/pipeline.ts) because it is job-keyed counters, and failure_code is the one column
// on it that is free-text SHAPED. It used to receive the sourcing child's error message
// — stderr, or an output tail — from a child fed every candidate profile in the
// workspace. The column-name pin in golive-receipt-tenancy.test.ts can see a column but
// never a value, so the value's vocabulary is pinned here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import {
  openReceipt,
  readReceipt,
  finishReceipt,
  GOLIVE_FAILURE_CODES,
  GOLIVE_FALLBACK_FAILURE_CODE,
  coerceGoliveFailureCode,
  isGoliveFailureCode,
} from "./golive-receipt-store.ts";
import { PYTHON_ERROR_CODES, ENGINE_BUSY_CODE } from "./python-runner.ts";

after(() => cleanupUnitDb());

const WS = "ws-golive-failure-code";

test("the vocabulary covers KP's own codes and every engine code, upper-cased", () => {
  // The store keeps these as literals so it does not import the process runner; this is
  // the pin that stops the two copies drifting (python-runner.ts says the same of
  // ENGINE_BUSY_CODE's message). A code added to PYTHON_ERROR_CODES fails here until the
  // store's vocabulary names it, instead of silently collapsing to SOURCING_FAILED.
  for (const code of PYTHON_ERROR_CODES) {
    assert.ok(
      isGoliveFailureCode(code.toUpperCase()),
      `PYTHON_ERROR_CODES has ${code}, GOLIVE_FAILURE_CODES has no ${code.toUpperCase()}`
    );
  }
  assert.ok(isGoliveFailureCode(ENGINE_BUSY_CODE));
  assert.ok(isGoliveFailureCode("ABORTED"));
  assert.ok(isGoliveFailureCode(GOLIVE_FALLBACK_FAILURE_CODE));
  // No member is free text waiting to happen.
  for (const code of GOLIVE_FAILURE_CODES) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/);
  }
});

test("coerceGoliveFailureCode keeps null, keeps a code, collapses anything else", () => {
  assert.equal(coerceGoliveFailureCode(null), null);
  assert.equal(coerceGoliveFailureCode(undefined), null);
  assert.equal(coerceGoliveFailureCode("ABORTED"), "ABORTED");
  assert.equal(
    coerceGoliveFailureCode("Traceback (most recent call last): Jane Example cand-123"),
    GOLIVE_FALLBACK_FAILURE_CODE
  );
  assert.equal(coerceGoliveFailureCode("aborted"), GOLIVE_FALLBACK_FAILURE_CODE);
});

test("finishReceipt never stores a value outside the vocabulary", () => {
  const jobId = "job-failcode-write";
  const receipt = openReceipt(jobId, WS);
  finishReceipt(jobId, WS, receipt.attempt, {
    state: "sourcing_failed",
    // Deliberately ill-typed at the boundary: a future caller that forgets the
    // vocabulary must not be able to write prose through this door.
    failureCode: "stderr: Jane Example <jane@example.com> cand-123" as never,
  });

  const raw = ensureDb()
    .prepare(`SELECT failure_code FROM job_golive_receipts WHERE job_id = ? AND workspace_id = ?`)
    .get(jobId, WS) as { failure_code: string | null };
  assert.equal(raw.failure_code, GOLIVE_FALLBACK_FAILURE_CODE);
  assert.ok(isGoliveFailureCode(readReceipt(jobId, WS)?.failureCode));
});

test("a legacy free-text row is normalised when the table is ensured, and never read back as text", () => {
  const jobId = "job-failcode-legacy";
  const legacy = "Python returned non-JSON output — stderr: …Traceback: Jane Example cand-123.";
  openReceipt(jobId, WS);
  // Write the pre-vocabulary shape the way the old build did, past the store's doors.
  ensureDb()
    .prepare(
      `UPDATE job_golive_receipts SET state = 'sourcing_failed', failure_code = ?
       WHERE job_id = ? AND workspace_id = ?`
    )
    .run(legacy, jobId, WS);

  // Any store call ensures the table, which runs the normalisation.
  const after1 = readReceipt(jobId, WS);
  assert.equal(after1?.failureCode, GOLIVE_FALLBACK_FAILURE_CODE);

  const raw = ensureDb()
    .prepare(`SELECT failure_code FROM job_golive_receipts WHERE job_id = ? AND workspace_id = ?`)
    .get(jobId, WS) as { failure_code: string | null };
  assert.equal(raw.failure_code, GOLIVE_FALLBACK_FAILURE_CODE);
  assert.ok(!raw.failure_code?.includes("Jane Example"));

  // Idempotent: a second ensure leaves the normalised value alone and does not touch
  // the legitimate codes of other rows.
  const other = "job-failcode-legacy-sibling";
  openReceipt(other, WS);
  finishReceipt(other, WS, 1, { state: "abandoned", failureCode: "ABORTED" });
  assert.equal(readReceipt(jobId, WS)?.failureCode, GOLIVE_FALLBACK_FAILURE_CODE);
  assert.equal(readReceipt(other, WS)?.failureCode, "ABORTED");
});
