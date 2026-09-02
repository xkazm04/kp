import test from "node:test";
import assert from "node:assert/strict";
import { INTERVIEW_PLAN_DEFAULT, PIPELINE_STAGES_DEFAULT, type PipelineStagesRule } from "@/app/_lib/decision-config-schema";
import { draftFromStored, removeStage, renameStage, type AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import {
  deriveComposerState,
  migrateMapFor,
  restoreDrafts,
  runComposerSave,
  type ComposerInputs,
} from "./composerState";
import type { PipelinePlan } from "./pipelineComposerModel";

const SAVED_AXIS: PipelineStagesRule = PIPELINE_STAGES_DEFAULT;
const SAVED_PLAN = INTERVIEW_PLAN_DEFAULT;
/** A saved column the drafts below remove, with somebody standing on it. */
const DROPPED = SAVED_AXIS.stages[1].id;

function inputs(over: Partial<ComposerInputs> = {}): ComposerInputs {
  return {
    axis: draftFromStored(SAVED_AXIS),
    savedAxis: SAVED_AXIS,
    plan: SAVED_PLAN as PipelinePlan,
    savedPlan: SAVED_PLAN,
    counts: {},
    countsLoaded: true,
    mapping: {},
    ...over,
  };
}

const withoutDropped = (): AxisDraft => removeStage(draftFromStored(SAVED_AXIS), DROPPED);

test("a clean draft is neither dirty nor blocked", () => {
  const s = deriveComposerState(inputs());
  assert.equal(s.dirty, false);
  assert.equal(s.blocked, false);
  assert.equal(s.blockedReason, null);
});

test("a failed occupancy read blocks a REMOVAL and names occupancy, not 'problems'", () => {
  const s = deriveComposerState(inputs({ axis: withoutDropped(), countsLoaded: false }));
  assert.equal(s.blocked, true);
  assert.equal(s.blockedReason, "occupancy");
  // The reason must not be reported as a draft problem: there are none.
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.stranded, []);
});

test("a failed occupancy read does NOT block an edit that removes nothing", () => {
  const draft = renameStage(draftFromStored(SAVED_AXIS), SAVED_AXIS.stages[0].id, "Inbox");
  const s = deriveComposerState(inputs({ axis: draft, countsLoaded: false }));
  assert.equal(s.dirty, true);
  assert.equal(s.blocked, false);
});

test("an occupied removal with no destination blocks as 'unmapped', and answering it unblocks", () => {
  const base = inputs({ axis: withoutDropped(), counts: { [DROPPED]: 3 } });
  const blockedState = deriveComposerState(base);
  assert.equal(blockedState.blockedReason, "unmapped");
  assert.equal(blockedState.stranded.length, 1);
  assert.equal(blockedState.stranded[0].count, 3);

  const answered = deriveComposerState({ ...base, mapping: { [DROPPED]: SAVED_AXIS.stages[0].id } });
  assert.equal(answered.blocked, false);
  // A destination that is not on the draft is not an answer.
  const bogus = deriveComposerState({ ...base, mapping: { [DROPPED]: "not-a-step" } });
  assert.equal(bogus.blockedReason, "unmapped");
});

test("a draft problem outranks the other reasons", () => {
  const empty = renameStage(draftFromStored(SAVED_AXIS), SAVED_AXIS.stages[0].id, "  ");
  const s = deriveComposerState(inputs({ axis: empty, countsLoaded: false }));
  assert.equal(s.blockedReason, "problems");
  assert.ok(s.problems.length > 0);
});

test("the migrate map is pruned to the stranded stages", () => {
  const stranded = [{ stage: { id: DROPPED, label: "x", role: "screening" } as never, count: 2 }];
  const map = migrateMapFor(stranded, { [DROPPED]: "applied", "put-back": "applied" });
  assert.deepEqual(map, { [DROPPED]: "applied" });
});

test("discard restores BOTH drafts and clears the mapping", () => {
  const dirtyAxis = withoutDropped();
  const dirtyPlan = { ...SAVED_PLAN, steps: [] } as unknown as PipelinePlan;
  const out = restoreDrafts(SAVED_PLAN, SAVED_AXIS, { plan: dirtyPlan, axis: dirtyAxis });
  assert.deepEqual(out.mapping, {});
  assert.equal(out.plan, SAVED_PLAN);
  assert.deepEqual(
    out.axis?.stages.map((s) => s.id),
    SAVED_AXIS.stages.map((s) => s.id)
  );
});

test("a write failure is reported as a write failure and skips the refresh", async () => {
  const calls: string[] = [];
  const out = await runComposerSave(
    { axisDirty: true, planDirty: true },
    {
      applyAxis: async () => {
        calls.push("axis");
        throw new Error("nope");
      },
      writePlan: async () => void calls.push("plan"),
      refresh: async () => {
        calls.push("refresh");
        return {};
      },
    }
  );
  assert.equal(out.kind, "write-failed");
  // The plan write never happens when the axis write fails, and nothing is re-read.
  assert.deepEqual(calls, ["axis"]);
});

test("a failed post-save refresh still reports the writes as SAVED", async () => {
  const calls: string[] = [];
  const out = await runComposerSave(
    { axisDirty: true, planDirty: true },
    {
      applyAxis: async () => void calls.push("axis"),
      writePlan: async () => void calls.push("plan"),
      refresh: async () => {
        throw new Error("re-read blew up");
      },
    }
  );
  assert.deepEqual(calls, ["axis", "plan"]);
  assert.equal(out.kind, "saved");
  assert.equal(out.kind === "saved" && out.refresh, "failed");
});

test("a clean save carries the refreshed data back", async () => {
  const out = await runComposerSave(
    { axisDirty: false, planDirty: true },
    {
      applyAxis: async () => assert.fail("a clean axis must not be written"),
      writePlan: async () => {},
      refresh: async () => ({ counts: { applied: 4 } }),
    }
  );
  assert.equal(out.kind === "saved" && out.refresh, "ok");
  assert.deepEqual(out.kind === "saved" && out.refresh === "ok" ? out.data.counts : null, { applied: 4 });
});
