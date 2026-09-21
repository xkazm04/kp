// Source pin: due ATS webhook retries run on the process clock, not only when an
// operator POSTs /api/ats/deliveries. The prune comment already believed a sibling
// sweep existed ("live retry work is never swept out from under the sweep beside it");
// this file is the tripwire that the sibling is actually called.
//
// NON-VACUITY: pre-change retryDueAtsDeliveries is absent from instrumentation-node.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const clockSrc = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "../../instrumentation-node.ts"),
  "utf8"
).replace(/\r\n/g, "\n");

test("the process clock retries due ATS deliveries beside pruning the ledger", () => {
  const pauseAt = clockSrc.indexOf("if (await clockIsPaused())");
  const pruneAt = clockSrc.indexOf("pruneAtsDeliveries(");
  const retryAt = clockSrc.indexOf("retryDueAtsDeliveries(");
  assert.ok(pauseAt >= 0, "the clock still has an autonomy pause");
  assert.ok(pruneAt >= 0, "the clock still prunes the ATS ledger");
  assert.ok(
    retryAt >= 0,
    "the clock must await retryDueAtsDeliveries — due retries used to wait for an operator POST"
  );
  assert.ok(
    pauseAt < retryAt,
    "the retry sits under the autonomy pause — a halted clock must not drain candidate PII"
  );
  assert.ok(
    Math.abs(retryAt - pruneAt) < 1200,
    "retry is the sibling of prune on the same tick, not a distant unrelated call"
  );
});
