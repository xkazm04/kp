// Attribution of llm_usage rows to a role run (ADR-0011): the nullable role_run_id
// column, stamped from the ambient llm-request-context scope on both write paths
// (the TS-direct insertLlmUsage and the Python sidecar fold). A row outside a scope
// keeps NULL — "not part of a role run" is the common case, not an error.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { cleanupUnitDb, UNIT_DB_DIR } from "../testing/unit-db.ts";
import { ensureDb } from "./core.ts";
import { ingestLlmUsageLog, insertLlmUsage } from "./llm.ts";
import { withLlmRoleRun } from "../llm-request-context.ts";

after(() => cleanupUnitDb());

const roleRunIds = (useCase: string): (string | null)[] =>
  (ensureDb().prepare(`SELECT role_run_id FROM llm_usage WHERE use_case = ? ORDER BY id`).all(useCase) as { role_run_id: string | null }[]).map(
    (r) => r.role_run_id
  );

test("insertLlmUsage stamps an explicit roleRunId, else the ambient one, else NULL", () => {
  insertLlmUsage({ useCase: "rr_direct", provider: "claude_cli", source: "llm", outcome: "ok", roleRunId: "run-explicit" });
  withLlmRoleRun("run-ambient", () => insertLlmUsage({ useCase: "rr_direct", provider: "claude_cli", source: "llm", outcome: "ok" }));
  insertLlmUsage({ useCase: "rr_direct", provider: "claude_cli", source: "llm", outcome: "ok" });
  assert.deepEqual(roleRunIds("rr_direct"), ["run-explicit", "run-ambient", null]);
});

test("the sidecar fold stamps the role run of the spawn, and leaves other spawns NULL", () => {
  const line = JSON.stringify({ use_case: "rr_fold", provider: "claude_cli", input_tokens: 10, output_tokens: 5, cost_usd: null, source: "llm" });
  const a = path.join(UNIT_DB_DIR, "rr-a.ndjson");
  const b = path.join(UNIT_DB_DIR, "rr-b.ndjson");
  writeFileSync(a, `${line}\n`, "utf-8");
  writeFileSync(b, `${line}\n`, "utf-8");
  assert.equal(ingestLlmUsageLog(a, "run-7"), 1);
  assert.equal(ingestLlmUsageLog(b), 1);
  assert.deepEqual(roleRunIds("rr_fold"), ["run-7", null]);
});
