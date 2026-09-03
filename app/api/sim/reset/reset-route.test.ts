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
import { __resetSimRunLocks, simRunActive } from "@/app/_lib/sim-store";

after(() => cleanupUnitDb());

register(new URL("../../../_lib/testing/next-server-hooks.mjs", import.meta.url));
const { POST, DELETE } = await import("./route.ts");
const { NextRequest } = await import("next/server");

/** POST with an optional body. `hold` claims the workspace's run lock for a walk. */
function post(body?: { hold?: boolean }) {
  return POST(
    new NextRequest("http://localhost:3000/api/sim/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  );
}

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

  const res = await post();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; cleared: Record<string, number> };
  assert.equal(body.ok, true);
  assert.ok(body.cleared.entries >= 1, `the caller's marked entry is counted (${JSON.stringify(body.cleared)})`);

  assert.equal(getPipelineEntry(mine.id, CALLER_WS), null, "the caller's own SIM row is gone");
  assert.ok(getPipelineEntry(theirs.id, OTHER_WS), "another tenant's SIM row must survive a reset it did not ask for");
  assert.ok(getPipelineEntry(real.id, CALLER_WS), "an unmarked, real row is never touched by the purge");
});

test("the reset is idempotent — a second call clears nothing and still succeeds", async () => {
  const res = await post();
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cleared: { entries: number } };
  assert.equal(body.cleared.entries, 0, "nothing left to clear, and that is a success, not an error");
});

test("a run holds the lock, so a SECOND start is refused instead of wiping the first", async () => {
  __resetSimRunLocks();
  const first = await post({ hold: true });
  assert.equal(first.status, 200, "the walk that got there first purges and keeps the lock");
  assert.equal(simRunActive(CALLER_WS).active, true);

  const second = await post({ hold: true });
  assert.equal(second.status, 409, "the second visitor is told, not served a wipe of someone else's tour");
  const body = (await second.json()) as { code: string; retryAfterSeconds: number };
  assert.equal(body.code, "SIM_RUN_ACTIVE");
  assert.ok(body.retryAfterSeconds > 0, "and told how long the holder's lease has left");

  // A manual reset is refused for the same reason while a walk is live.
  assert.equal((await post()).status, 409);

  const released = await DELETE();
  assert.equal(released.status, 200);
  assert.equal(simRunActive(CALLER_WS).active, false, "the run ended: the tenant is free");
  assert.equal((await post({ hold: true })).status, 200, "and the next visitor may start");
  __resetSimRunLocks();
});

test("a manual reset holds the lock only for its own purge", async () => {
  __resetSimRunLocks();
  assert.equal((await post()).status, 200);
  assert.equal(simRunActive(CALLER_WS).active, false, "no `hold`, no lease left behind — otherwise a reset locked the tenant for 5 minutes");
});

test("a failure answers the CODE, never the thrown store message", () => {
  assert.match(src, /safeJsonError\(error, "api:sim\/reset", "SIM_RESET_FAILED"\)/, "the catch must go through the chokepoint");
  assert.doesNotMatch(src, /error instanceof Error \? error\.message/, "no hand-rolled message forwarding");
});

test("the purge is scoped to the CALLER's tenant, not the default", () => {
  assert.match(src, /await currentWorkspace\(\)/, "the tenant comes from the session, never a hardcoded default");
  assert.match(src, /resetSim\(ws\)/, "and it is threaded into the purge");
  assert.match(src, /beginSimRun\(ws\)/, "the lock is per-workspace too");
});
