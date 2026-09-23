// The command bar's execute loop must never overstate what it did. A bulk reject
// through this bar can lose entries to the expectedStage CAS (someone moved the
// candidate between preview and confirm), blow up on one entry, and fail to
// notify others — and before this test the response carried `count` alone, so
// all three were invisible: a nine-of-twelve reject still said "rejected 12".
//
// Driven with an ENTRY-ACTION double rather than a live board: the loop's only
// write door is runPipelineEntryAction (challenge-r05 pipeline-actions-commands/A),
// and applied / refused / held / threw / comms-blip cannot all be forced through
// one real pass. The contract under test is the ARITHMETIC (every target lands in
// exactly one bucket) and the MAPPING from the core's {status, body} to a bucket.
import "../../../_lib/testing/unit-db.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCommandTargets, type CommandExecutionDeps } from "./execute.ts";
import type { EntryActionInput, EntryActionResult } from "../../../_lib/pipeline-entry-action.ts";
import type { PipelineEntry } from "../../../_lib/db/core.ts";

function entry(id: string, stage = "Screened", approvalKind: string | null = null): PipelineEntry {
  return { id, stage, approvalKind, candidateLabel: id, matchScore: 10, jobTitle: "Role" } as unknown as PipelineEntry;
}

type Outcome = "ok" | "stale" | "terminal" | "throws" | "comms-fails" | "human-round";

/** A core double whose answer is chosen PER ENTRY ID, so one call can mix every
 *  outcome runPipelineEntryAction produces. Records every input it was handed. */
function core(plan: Record<string, Outcome>) {
  const calls: EntryActionInput[] = [];
  const runAction = (async (input: EntryActionInput): Promise<EntryActionResult> => {
    calls.push(input);
    switch (plan[input.id]) {
      case "throws":
        throw new Error("store blew up");
      case "stale":
        return { status: 409, body: { code: "PIPELINE_STAGE_CHANGED" } };
      case "terminal":
        return { status: 422, body: { code: "PIPELINE_TERMINAL_NOT_ADVANCE" } };
      case "comms-fails":
        return { status: 200, body: { entry: entry(input.id), commsFailed: true } };
      case "human-round":
        return { status: 200, body: { entry: entry(input.id), routedToHumanRound: true } };
      default:
        return { status: 200, body: { entry: entry(input.id) } };
    }
  }) as CommandExecutionDeps["runAction"];
  return { deps: { runAction } satisfies CommandExecutionDeps, calls };
}

const BASE = { workspaceId: "ws", origin: "http://localhost" };

test("a mixed batch {200, 409, 422, throw, 200+commsFailed} lands every target in exactly one bucket", async () => {
  const { deps } = core({ a: "ok", b: "stale", c: "terminal", d: "throws", e: "comms-fails" });
  const targets = ["a", "b", "c", "d", "e"].map((id) => entry(id));
  const counts = await executeCommandTargets({ ...BASE, kind: "reject_below", threshold: 40, targets }, deps);

  assert.equal(counts.count, 2, "a and e applied");
  assert.equal(counts.failed, 2, "the lost CAS (409) and the throw are both failures");
  assert.equal(counts.heldAtOffer, 1, "the terminal-guard 422 is a hold, not a failure");
  assert.equal(counts.commsFailed, 1, "e was rejected but the candidate was not told");
  assert.equal(counts.count + counts.failed + counts.heldAtOffer + counts.routedToHumanRound, targets.length);
});

test("reject_below hands the core the CAS stage, the workspace, the command-bar provenance and the typed threshold", async () => {
  const { deps, calls } = core({});
  await executeCommandTargets({ ...BASE, kind: "reject_below", threshold: 40, targets: [entry("a", "Interview")] }, deps);
  assert.equal(calls.length, 1);
  const [c] = calls;
  assert.equal(c.action, "reject");
  assert.equal(c.expectedStage, "Interview", "the expectedStage CAS is kept");
  assert.equal(c.workspaceId, "ws");
  assert.equal(c.via, "command_bar");
  assert.equal(c.threshold, 40);
  assert.equal(c.detail, "Command bar: below 40%");
  assert.equal(c.actor, undefined, "the bar never declares an actor: the core reads it from the session");
});

test("advance_top holds a drafted offer BEFORE calling the core (the bar never extends an offer unattended)", async () => {
  const { deps, calls } = core({ a: "ok" });
  const counts = await executeCommandTargets(
    { ...BASE, kind: "advance_top", targets: [entry("a"), entry("o", "Applied", "offer_review")] },
    deps
  );
  assert.equal(counts.count, 1);
  assert.equal(counts.heldAtOffer, 1);
  assert.deepEqual(calls.map((c) => c.id), ["a"], "the offer_review entry never reaches the core");
  assert.equal(calls[0].action, "accept");
});

test("an accept the core routed to the human round is not counted as advanced", async () => {
  const { deps } = core({ a: "ok", h: "human-round" });
  const counts = await executeCommandTargets({ ...BASE, kind: "advance_top", targets: [entry("a"), entry("h")] }, deps);
  assert.equal(counts.count, 1, "only a moved a column");
  assert.equal(counts.routedToHumanRound, 1, "h stays put and is queued for the human round");
  assert.equal(counts.failed, 0);
  assert.equal(counts.heldAtOffer, 0);
});
