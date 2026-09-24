// The boot list of late-bound implementations (late-bound-boot.ts) — the one function
// instrumentation-node.ts calls at server start and unit-db.ts calls per test process.
//
// What is pinned:
//   • COVERAGE — every kind tasks.ts delegates to `externalRunner("…")` is registered
//     here, read off the HANDLERS source so a kind moved onto the seam without a
//     registration fails now rather than as a failed task in production;
//   • WIRING — each registered implementation is the real one, reached with the task's
//     params: the interview kit and letter runners answer their own "not found" for the
//     id the params carried, and the stage hook's door is the real mint (its own
//     "pipeline entry not found"). No Python, no model, no network.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerLateBoundImplementations } from "./late-bound-boot.ts";
import { _resetTaskRunnersForTests, externalRunner, type ExternalTaskCtx } from "./task-external-runners.ts";
import { _resetStageHookInviteForTests, stageHookInvite } from "./stage-hooks-invite.ts";

after(() => cleanupUnitDb());

function ctx(params: Record<string, unknown>, workspaceId = "team-late-bound"): ExternalTaskCtx {
  return { workspaceId, signal: new AbortController().signal, progress: () => {}, params };
}

/** The kinds tasks.ts hands to the late-bound registry — parsed, because importing
 *  tasks.ts is exactly the handler graph this seam keeps light. */
function delegatedKinds(): string[] {
  const src = readFileSync(fileURLToPath(new URL("./tasks.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  return [...new Set([...src.matchAll(/externalRunner\("([a-z_]+)"\)/g)].map((m) => m[1]))].sort();
}

test("every kind tasks.ts delegates to externalRunner is registered by the boot list", () => {
  const kinds = delegatedKinds();
  // Non-vacuity: the three kinds on the seam today.
  assert.deepEqual(kinds, ["interview_kit", "interview_letter", "jobseeker_scan"]);
  _resetTaskRunnersForTests();
  for (const kind of kinds) assert.throws(() => externalRunner(kind), /not registered/, `${kind} starts unregistered`);
  registerLateBoundImplementations();
  for (const kind of kinds) assert.equal(typeof externalRunner(kind), "function", `${kind} is registered at boot`);
});

test("the stage hook's interview-invite door is registered by the boot list", () => {
  _resetStageHookInviteForTests();
  assert.throws(() => stageHookInvite(), /not registered.*instrumentation-node\.ts/);
  registerLateBoundImplementations();
  assert.equal(typeof stageHookInvite(), "function");
});

test("the interview_kit runner is the real one and reads params.jobId", async () => {
  registerLateBoundImplementations();
  await assert.rejects(externalRunner("interview_kit")(ctx({ jobId: "late-bound-no-such-job" })), /job not found: late-bound-no-such-job/);
});

test("the interview_letter runner is the real one and reads params.letterId", async () => {
  registerLateBoundImplementations();
  await assert.rejects(
    externalRunner("interview_letter")(ctx({ letterId: "late-bound-no-such-letter" })),
    /interview letter not found: late-bound-no-such-letter/
  );
});

test("the stage hook's door is the real mint", async () => {
  registerLateBoundImplementations();
  await assert.rejects(stageHookInvite()({ entryId: "late-bound-no-such-entry", workspaceId: "team-late-bound" }), /pipeline entry not found/);
});

test("registering twice replaces rather than throws (the dev server re-runs instrumentation)", () => {
  registerLateBoundImplementations();
  registerLateBoundImplementations();
  assert.equal(typeof externalRunner("interview_kit"), "function");
  assert.equal(typeof stageHookInvite(), "function");
});
