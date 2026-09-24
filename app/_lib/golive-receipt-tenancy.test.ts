import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "./testing/unit-db.ts";

// The colocated tenancy proof for `job_golive_receipts` — the durable record of what a
// go-live's post-commit half (sourcing + the rediscovery raise) did for one TEAM.
// tenancy.ts lists it as VERIFIED workspace-scoped; this file is what earns that.
//
// NO by-id exemption: a job id is shared across teams for a corpus role (the seeded
// corpus is every team's), so a by-job-id read would hand one team another team's
// sourcing outcome, and a by-job-id claim would let one team re-run another team's
// sweep. The key is (job_id, workspace_id). The rows hold counts and a state only —
// never a candidate's identity — so erasure has nothing to find here.

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(here, "golive-receipt-store.ts"), "utf8");
const TABLE = "job_golive_receipts";

/** Mirrors tenancy-coverage.test.ts's bindsWorkspace: BOUND, not mentioned. */
function bindsWorkspace(sql: string): boolean {
  if (/workspace_id\s*(=|IN\b|IS\b)/i.test(sql)) return true;
  return /INSERT\s+INTO\s+[a-z_]+\s*\([^)]*\bworkspace_id\b[^)]*\)/i.test(sql);
}

const statements = [...SRC.matchAll(/`([^`]*)`/g)]
  .map((m) => m[1])
  .filter((s) => new RegExp(`\\b(from|into|update|join)\\s+${TABLE}\\b`, "i").test(s));

test("every job_golive_receipts statement binds workspace_id", () => {
  assert.ok(statements.length >= 4, `expected open + finish + claim + read, found ${statements.length}`);
  for (const sql of statements) {
    assert.ok(bindsWorkspace(sql), `a ${TABLE} statement does not BIND workspace_id:\n${sql.trim().slice(0, 240)}`);
  }
});

test("the key is (job_id, workspace_id), and the store writes through the core connection", () => {
  assert.match(SRC, /PRIMARY KEY \(job_id, workspace_id\)/);
  assert.equal(/PRIMARY KEY \(job_id\)/.test(SRC), false);
  // openReceipt runs INSIDE the go-live transaction; a private connection there is the
  // SQLITE_BUSY_SNAPSHOT shape publish-atomicity.test.ts pins. Comments stripped so a
  // note ABOUT the rule cannot satisfy or trip it.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.match(code, /ensureDb\(\)/);
  assert.equal(/\bopenStore\b/.test(code), false, "the receipt store must never open its own connection");
});

after(() => cleanupUnitDb());

test("behaviour: a receipt opened by team A is invisible and unclaimable to team B", async () => {
  const { ensureDb } = await import("./db/core.ts");
  const { createWorkspace } = await import("./db/workspaces.ts");
  const { openReceipt, finishReceipt, claimResume, readReceipt } = await import("./golive-receipt-store.ts");
  const A = createWorkspace("Receipts A").id;
  const B = createWorkspace("Receipts B").id;
  const jobId = "golive-tenancy-job";
  ensureDb().transaction(() => openReceipt(jobId, A))();
  finishReceipt(jobId, A, 1, { state: "abandoned" });
  assert.equal(readReceipt(jobId, B), null);
  assert.equal(claimResume(jobId, B, new Date()), null);
  assert.equal(finishReceipt(jobId, B, 1, { state: "done", sourced: 5 }), 0);
  assert.equal(readReceipt(jobId, A)?.state, "abandoned", "team B's writes never reached team A's row");
  // The same corpus job, taken live by team B, gets B's OWN receipt.
  assert.equal(ensureDb().transaction(() => openReceipt(jobId, B))(), 1);
  assert.equal(readReceipt(jobId, A)?.attempt, 1);
});
