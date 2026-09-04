// The command bar's execute loop must never overstate what it did. A bulk reject
// through this bar can lose entries to the expectedStage CAS (someone moved the
// candidate between preview and confirm), blow up on one entry, and fail to
// notify others — and before this test the response carried `count` alone, so
// all three were invisible: a nine-of-twelve reject still said "rejected 12".
//
// Driven with a store DOUBLE rather than a live board: applied / refused / threw
// / comms-blip cannot all be forced through one real pass, and the contract under
// test is the ARITHMETIC (every target lands in exactly one bucket), not SQLite.
import "../../../_lib/testing/unit-db.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCommandTargets, type CommandExecutionDeps } from "./execute.ts";
import { DEFAULT_STAGE_AXIS } from "../../../_lib/pipeline-stages.ts";
import type { PipelineEntry } from "../../../_lib/db/core.ts";

const AXIS = DEFAULT_STAGE_AXIS;
const OFFER_STAGE = AXIS.find((s) => s.role === "offer")!.id;

function entry(id: string, stage = "Screened"): PipelineEntry {
  return { id, stage, candidateLabel: id, matchScore: 10, jobTitle: "Role" } as unknown as PipelineEntry;
}

/** A store double whose behavior is chosen PER ENTRY ID, so one call can mix
 *  every outcome the real store produces. */
function deps(plan: Record<string, "ok" | "refused" | "throws" | "comms-fails">) {
  const events: string[] = [];
  const dispatched: string[] = [];
  const d: CommandExecutionDeps = {
    actOn: ((id: string) => {
      const how = plan[id];
      if (how === "throws") throw new Error("store blew up");
      if (how === "refused") return null;
      return entry(id);
    }) as CommandExecutionDeps["actOn"],
    dispatchRejection: (async (e: PipelineEntry) => {
      if (plan[e.id] === "comms-fails") throw new Error("relay down");
      dispatched.push(e.id);
    }) as CommandExecutionDeps["dispatchRejection"],
    recordEvent: ((id: string, kind: string) => {
      events.push(`${id}:${kind}`);
      return null;
    }) as unknown as CommandExecutionDeps["recordEvent"],
  };
  return { d, events, dispatched };
}

test("reject_below counts applied, refused, thrown and un-notified separately", async () => {
  const { d, events, dispatched } = deps({
    a: "ok",
    b: "refused", // the CAS lost in the gap — NOT a rejection
    c: "throws", // one entry's blow-up never aborts the batch, but it is a failure
    e: "comms-fails", // rejected, candidate NOT told
    f: "ok",
  });
  const counts = await executeCommandTargets(
    { kind: "reject_below", threshold: 50, targets: ["a", "b", "c", "e", "f"].map((id) => entry(id)), axis: AXIS, workspaceId: "ws" },
    d
  );

  assert.equal(counts.count, 3, "only a, e and f actually rejected");
  assert.equal(counts.failed, 2, "the CAS refusal and the throw are both failures");
  assert.equal(counts.commsFailed, 1, "e was rejected but never notified");
  assert.equal(counts.heldAtOffer, 0);
  assert.deepEqual(dispatched, ["a", "f"]);
  assert.deepEqual(events, ["e:rejection_comms_failed"], "the un-notified candidate is flagged for a manual nudge");
});

test("advance_top holds offer-stage targets and counts refusals apart from them", async () => {
  const { d } = deps({ a: "ok", b: "refused", c: "ok" });
  const counts = await executeCommandTargets(
    {
      kind: "advance_top",
      targets: [entry("a"), entry("b"), entry("c"), entry("d", OFFER_STAGE)],
      axis: AXIS,
      workspaceId: "ws",
    },
    d
  );

  assert.equal(counts.count, 2);
  assert.equal(counts.failed, 1, "a refused advance is reported, not swallowed");
  assert.equal(counts.heldAtOffer, 1, "the offer-stage target is held, and held is not failed");
  assert.equal(counts.commsFailed, 0, "advance never emails");
});

test("every target lands in exactly one bucket", async () => {
  const { d } = deps({ a: "ok", b: "refused", c: "throws" });
  const targets = [entry("a"), entry("b"), entry("c"), entry("d", OFFER_STAGE)];
  const counts = await executeCommandTargets({ kind: "advance_top", targets, axis: AXIS, workspaceId: "ws" }, d);
  assert.equal(counts.count + counts.failed + counts.heldAtOffer, targets.length);
});
