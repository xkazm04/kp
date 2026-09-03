// POST /api/sim/reset is the guided demo's FIRST call and had no test at all —
// while being the one door in the sim directory that runs DELETEs.
//
// Two things pinned here:
//   (1) BEHAVIOUR — the handler purges the caller's tenant and reports the counts,
//       and a run that only touched another tenant is untouched by it.
//   (2) CONTRACT — it answers a CODE on failure (SIM_RESET_FAILED), never the
//       thrown better-sqlite3 message, because the sim console paints the answer.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { register } from "node:module";
import { cleanupUnitDb } from "@/app/_lib/testing/unit-db";
import { createPipelineEntry, getPipelineEntry } from "@/app/_lib/db/pipeline";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { SIM_MARKER } from "@/app/features/shell/simulation/constants";

after(() => cleanupUnitDb());

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));
const { POST } = await import("./route.ts");

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

// No next/headers shim: `cookies()` throws outside a request scope, which is the
// documented fallback path in currentWorkspace() — the caller resolves to the
// DEFAULT workspace, exactly the operator-tab case.
const CALLER_WS = DEFAULT_WORKSPACE_ID;
const OTHER_WS = "team-not-the-caller";

function simEntry(id: string, workspaceId: string) {
  return createPipelineEntry({
    candidateId: `reset-${id}`,
    candidateLabel: `Candidate ${id}`,
    jobId: `reset-job-${id}`,
    jobTitle: `Backend Engineer ${SIM_MARKER}`,
    workspaceId,
    stage: "Accepted",
  }).entry;
}

test("the handler purges the caller's SIM rows and reports the counts", async () => {
  const mine = simEntry("mine", CALLER_WS);
  const theirs = simEntry("theirs", OTHER_WS);
  const real = createPipelineEntry({
    candidateId: "reset-real",
    candidateLabel: "Real Candidate",
    jobId: "reset-job-real",
    jobTitle: "Backend Engineer",
    workspaceId: CALLER_WS,
    stage: "Accepted",
  }).entry;

  const res = await POST();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; cleared: Record<string, number> };
  assert.equal(body.ok, true);
  assert.ok(body.cleared.entries >= 1, `the caller's marked entry is counted (${JSON.stringify(body.cleared)})`);

  assert.equal(getPipelineEntry(mine.id, CALLER_WS), null, "the caller's own SIM row is gone");
  assert.ok(getPipelineEntry(theirs.id, OTHER_WS), "another tenant's SIM row must survive a reset it did not ask for");
  assert.ok(getPipelineEntry(real.id, CALLER_WS), "an unmarked, real row is never touched by the purge");
});

test("the reset is idempotent — a second call clears nothing and still succeeds", async () => {
  const res = await POST();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cleared: { entries: number } };
  assert.equal(body.cleared.entries, 0, "nothing left to clear, and that is a success, not an error");
});

test("a failure answers the CODE, never the thrown store message", () => {
  assert.match(src, /safeJsonError\(error, "api:sim\/reset", "SIM_RESET_FAILED"\)/, "the catch must go through the chokepoint");
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/, "no hand-rolled message forwarding");
});

test("the purge is scoped to the CALLER's tenant, not the default", () => {
  assert.match(src, /await currentWorkspace\(\)/, "the tenant comes from the session, never a hardcoded default");
  assert.match(src, /resetSim\(ws\)/, "and it is threaded into the purge");
});
