// The approve route's PRECONDITION is the review stage, and it is re-asserted for
// every body (dev-lifecycle-cohort-outcomes #1, then /perfect 2026-09-03).
//
// Round 1 closed the EDIT case: the approve block is wrapped in
// `if (isAtReviewGate(lc.stage))` and had no else, so a lifecycle already past the gate
// (a second tab/reviewer approved, or a retry landed twice) skipped the edits, the probe
// gate and the audit while still returning { ok: true } - the reviewer's corrections
// vanished behind a false success.
//
// Round 2 closed the EDIT-LESS case, which that else-if did not reach: an approve with no
// body - what the studio's own button sends, and what a retried fetch replays - fell
// through to `startTask("lifecycle")` and answered ok. The walk designs, publishes and
// dispatches, and startTask's dedup only coalesces runs that are still ACTIVE, so a retry
// arriving after the first finished ran the whole thing a second time. The two branches
// are now ONE refusal, which is why the first test below drives the real handler instead
// of matching an else-if that no longer exists: the guarantee is behavioural, and pinning
// it to a control-flow shape is what let the edit-less twin of the same bug survive.
//
// This drives the REAL handler on a throwaway SQLite file; the timebox test below stays a
// source-level pin (its subject is the audit STRING the reviewer reads).
// Import the REAL native better-sqlite3 first (never a shim).
import "better-sqlite3";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH to a throwaway file at
// module-eval time and must run BEFORE any module that transitively touches db-path.
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { createLifecycle, getDevCase, updateLifecycle } from "../../../../../_lib/db/devcase.ts";

// Point next/server at the shared test shim BEFORE the route loads (hooks only affect
// later resolutions - hence the dynamic import inside approve()).
register(new URL("../../../../../_lib/testing/next-server-hooks.mjs", import.meta.url));

type ApproveBody = { ok?: boolean; code?: string; stage?: string; editsApplied?: boolean };

async function approve(id: string, body?: Record<string, unknown>): Promise<{ status: number; body: ApproveBody }> {
  const { POST } = await import("./route.ts");
  const request = new Request(`http://localhost/api/devcase/lifecycle/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const res = await POST(request, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as ApproveBody };
}

before(() => {
  getDevCase("__init__"); // force the full ensureDb() init
});
after(() => cleanupUnitDb());

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("an EDIT-LESS approve on a lifecycle past the gate is refused, not resumed", async () => {
  const lc = createLifecycle({ title: "already approved" }, true);
  // The exact shape of the race: the gate was passed a moment ago, by the other tab.
  updateLifecycle(lc.id, { stage: "approved" });

  const res = await approve(lc.id);

  // NON-VACUITY: pre-fix this answered 200 { ok: true, task } AND enqueued a second
  // lifecycle run - the red run did not even terminate, because the duplicate runner
  // it started went on spawning the pipeline.
  assert.equal(res.status, 409, "a request that approves nothing must not answer 200");
  assert.equal(res.body.code, "DEVCASE_LIFECYCLE_NOT_AT_GATE", "the reader localizes the refusal off the code");
  assert.equal(res.body.stage, "approved", "the stage rides along as DATA, so the panel can say where the case is");
  assert.ok(!res.body.ok, "no green flag on a refusal");
});

test("the refusal names the stage the lifecycle is ACTUALLY at", async () => {
  const lc = createLifecycle({ title: "still walking" }, true);
  // Fresh lifecycles sit at "intake" - the pre-approval half of the walk. Approving one
  // is as meaningless as approving one already past the gate, and used to start a
  // duplicate runner just the same.
  const res = await approve(lc.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.stage, "intake");
});

test("a body WITH edits is refused identically - the two paths share one precondition", async () => {
  const lc = createLifecycle({ title: "edited too late" }, true);
  updateLifecycle(lc.id, { stage: "collecting" });

  const res = await approve(lc.id, { case: { title: "a correction that arrives too late" } });
  assert.equal(res.status, 409);
  assert.equal(res.body.code, "DEVCASE_LIFECYCLE_NOT_AT_GATE");
  assert.equal(res.body.stage, "collecting");
  // The reviewer must learn their corrections did NOT land - the claim the edit branch
  // existed for, which collapsing the branches must not lose.
  assert.equal(res.body.editsApplied, false);
});

test("an unknown (or another team's) lifecycle still answers 404, never the stage", async () => {
  const res = await approve("lc_does_not_exist");
  assert.equal(res.status, 404, "a by-id door must never be an existence oracle");
  assert.equal(res.body.stage, undefined);
});

// The timebox is the cap on the candidate's UNPAID work (2h, UAT M8), enforced in the
// Python designer but NOT here: this validator accepted anything up to 80 hours, so a
// reviewer typo at the gate minted an over-policy exercise that renders verbatim to the
// candidate. The route can't be imported (Next only allows handler exports), so pin the
// contract on the source: the shared clamp, no re-typed literal, and the clamp surfaced
// in the audit reason the reviewer reads.
test("the approve gate clamps a reviewer-edited timebox to the shared cap", () => {
  assert.doesNotMatch(src, /timeboxHours\s*<=\s*80/, "the 80h ceiling must be gone");
  assert.match(src, /timeboxClamp/, "the timebox must go through the shared clamp");
  assert.match(src, /from "@\/app\/_lib\/devcase-timebox"/, "the bound must be imported, not re-typed");
  assert.match(src, /timeboxClamped/, "a clamped edit must be distinguishable from an accepted one");
  // The audit note is STRUCTURED, not an English sentence: `timebox_clamped from=<n> to=<n>`,
  // produced from the same { code, from, to } the review panel renders per locale. A raw
  // prose note is unqueryable and only readable in one language.
  assert.match(src, /timeboxClamped\.code/, "the clamp's machine code must reach the audit trail");
  assert.match(src, /from=\$\{/, "the audit note must carry the number the reviewer typed");
  assert.match(src, /to=\$\{/, "the audit note must carry the number the candidate gets");
  assert.doesNotMatch(src, /timebox clamped to the/, "the clamp note must not be English prose");
});
