// THE LIFECYCLE BY-ID DOORS CHECK THE TENANT (/perfect 2026-09-02, api-devcase-1).
//
// `getLifecycle(id)` is a globally-unique point read: it returns another studio's row
// just as happily as your own. Three of the six by-id dev-case doors knew that and each
// carried its own three-line comparison (feedback, promote, publish). Approve, close and
// redesign carried NONE, so a known lifecycle id was enough to:
//
//   * approve another team's designed case into a live one (`approve/route.ts:60`),
//   * close their lifecycle — which dispatches a wrap-up REJECTION to every one of their
//     non-promoted candidates (`close/route.ts:17`),
//   * redesign their brief while debiting the CALLER's `case_designs` meter
//     (`redesign/route.ts:28`).
//
// All six now go through one producer, `ownedLifecycle` / `ownedSubmission` /
// `ownedDevCase` in ./devcase-owned-lifecycle.ts, and a cross-tenant id answers EXACTLY
// what a nonexistent one answers — the same 404, the same body. Anything else would make
// the route an existence oracle for other teams' ids.
//
// These drive the real handlers. `currentWorkspace()` reads cookies(), which throws
// outside a request and falls back to the default workspace, so "the caller" here is
// always the default tenant: a lifecycle built in a NON-default workspace is the
// cross-tenant case, and one built in the default workspace is the control that proves
// the guard is not over-broad.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

// Point next/server at the test shim BEFORE the routes load (hooks only affect LATER
// resolutions — hence the dynamic imports below). A junction-linked worktree otherwise
// resolves next/server through two module identities, leaving the handlers' own
// NextResponse.json undefined and every assertion here unreachable.
register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

const { createLifecycle, updateLifecycle, getLifecycle } = await import("../../_lib/db/devcase.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");
const { POST: approvePost } = await import("./lifecycle/[id]/approve/route.ts");
const { POST: closePost } = await import("./lifecycle/[id]/close/route.ts");
const { POST: redesignPost } = await import("./lifecycle/[id]/redesign/route.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "ws-other-studio";

function lifecycleIn(ws: string, stage: string, title = "Backend engineer"): string {
  const lc = createLifecycle({ title }, false, "en", ws);
  updateLifecycle(lc.id, { stage });
  return lc.id;
}

function post(
  handler: (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>,
  id: string,
  body?: unknown,
): Promise<Response> {
  return handler(
    new Request(`http://localhost/api/devcase/lifecycle/${id}/x`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    { params: Promise.resolve({ id }) },
  );
}

test("approve refuses ANOTHER studio's lifecycle — same 404 as a missing one, and nothing is approved", async () => {
  const id = lifecycleIn(OTHER_WS, "awaiting_approval");
  const res = await post(approvePost, id, { case: { title: "Hijacked brief" } });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "lifecycle not found" });
  // The row is untouched: still at the gate, still with no approved case.
  const after = getLifecycle(id);
  assert.equal(after?.stage, "awaiting_approval", "the other team's lifecycle was not advanced");
  assert.equal(after?.caseId ?? null, null, "no case was frozen out of it");

  // A nonexistent id is indistinguishable — never an existence oracle for other teams.
  const missing = await post(approvePost, "lc-does-not-exist", {});
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "lifecycle not found" });
});

test("close refuses ANOTHER studio's lifecycle — no stage flip, so none of their candidates is rejected", async () => {
  const id = lifecycleIn(OTHER_WS, "promoted");
  const res = await post(closePost, id);
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "lifecycle not found" });
  // The stage flip is what claims the close and releases the wrap-up rejections; it must
  // not have happened.
  assert.equal(getLifecycle(id)?.stage, "promoted", "the other team's lifecycle is still open");

  const missing = await post(closePost, "lc-does-not-exist");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "lifecycle not found" });
});

test("redesign refuses ANOTHER studio's lifecycle BEFORE the meter is debited", async () => {
  const id = lifecycleIn(OTHER_WS, "awaiting_approval");
  const res = await post(redesignPost, id, { feedback: "Make the brief harder." });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "lifecycle not found" });
  // Untouched: a landed redesign stamps its own detail and a fresh `case`.
  assert.equal(getLifecycle(id)?.detail, "created", "the row still carries its created detail");
  assert.equal(getLifecycle(id)?.case ?? null, null, "no regenerated case was written over it");

  const missing = await post(redesignPost, "lc-does-not-exist", { feedback: "Make the brief harder." });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "lifecycle not found" });
});

// The other half of a guard: it must not refuse the caller's OWN rows. Each control
// below reaches a refusal that only a lifecycle the guard ADMITTED can produce — the
// off-gate 409 — which is the cheapest proof that the ownership check passed without
// driving an LLM design pass or a runner task.
test("the guard is not over-broad: the caller's own lifecycle gets past it on all three doors", async () => {
  const approveId = lifecycleIn(DEFAULT_WORKSPACE_ID, "analyzing", "Own approve");
  const approveRes = await post(approvePost, approveId, { case: { title: "A reviewer edit" } });
  assert.equal(approveRes.status, 409, "an owned lifecycle reaches the off-gate 409, not the ownership 404");

  const redesignId = lifecycleIn(DEFAULT_WORKSPACE_ID, "analyzing", "Own redesign");
  const redesignRes = await post(redesignPost, redesignId, { feedback: "Make the brief harder." });
  assert.equal(redesignRes.status, 409, "…and so does the redesign door");

  const closeId = lifecycleIn(DEFAULT_WORKSPACE_ID, "promoted", "Own close");
  const closeRes = await post(closePost, closeId);
  assert.equal(closeRes.status, 200, "closing your own lifecycle still works");
  assert.equal(getLifecycle(closeId)?.stage, "closed");
});
