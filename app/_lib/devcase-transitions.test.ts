// The dev-case stage machine, and the compare-and-set that enforces it.
//
// `dev_lifecycle.stage` was a free-text column: `updateLifecycle` wrote whatever it
// was handed, over whatever was there. Two consequences this file pins —
//
//   (1) the LEGAL MOVES are now written down (devcase-transitions.ts) instead of
//       living as a comment claiming the walk is "monotonic and acyclic";
//   (2) a caller that declares the stage it READ gets that stage re-asserted in the
//       UPDATE's WHERE, so an advance computed across a minutes-long LLM step is
//       DROPPED when a human moved the lifecycle meanwhile — the compensating
//       precondition half of the repo's read→compute→write rule.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  canTransition,
  isLifecycleStage,
  IllegalLifecycleTransition,
  LIFECYCLE_STAGES,
  LIFECYCLE_TRANSITION_ERROR,
} from "./devcase-transitions.ts";
import { createLifecycle, getLifecycle, updateLifecycle } from "./db/devcase.ts";

after(() => cleanupUnitDb());

test("the walk the orchestrator drives is legal end to end, and nothing else forward is", () => {
  // The happy path, stage by stage — the exact sequence runLifecycle writes.
  const walk = ["intake", "analyzed", "designed", "approved", "collecting", "ranked", "promoted"];
  for (let i = 0; i < walk.length - 1; i += 1) {
    assert.ok(canTransition(walk[i], walk[i + 1]), `${walk[i]} → ${walk[i + 1]} must be legal`);
  }
  // The human gate and the redesign loop.
  assert.ok(canTransition("designed", "awaiting_approval"));
  assert.ok(canTransition("awaiting_approval", "approved"));
  assert.ok(canTransition("awaiting_approval", "designed"), "a reviewer may send a case back for redesign");
  // Backwards is never legal (except the redesign edge above), and neither is a skip.
  assert.ok(!canTransition("ranked", "collecting"));
  assert.ok(!canTransition("promoted", "ranked"));
  assert.ok(!canTransition("intake", "published"), "no stage may be skipped");
  assert.ok(!canTransition("collecting", "collecting"), "a self-move is not an advance");
});

test("closing is legal from every live stage and terminal once done", () => {
  for (const stage of LIFECYCLE_STAGES) {
    assert.equal(canTransition(stage, "closed"), stage !== "closed", `close from ${stage}`);
    assert.ok(!canTransition("closed", stage), `nothing leaves closed (tried ${stage})`);
  }
});

test("an unknown stage string is never a legal endpoint of a move", () => {
  assert.ok(!isLifecycleStage("shipped"));
  assert.ok(!isLifecycleStage(undefined));
  assert.ok(!canTransition("intake", "shipped"));
  assert.ok(!canTransition("shipped", "analyzed"));
});

test("expectedStage is a compare-and-set: the stale writer's advance is dropped", () => {
  const lc = createLifecycle({ title: "raced" }, true);
  // The runner read `intake` and then spent minutes in runNeedAnalysis…
  const readStage = getLifecycle(lc.id)!.stage;
  assert.equal(readStage, "intake");
  // …while a human closed the lifecycle from the UI.
  updateLifecycle(lc.id, { stage: "closed" });

  // NON-VACUITY: without the precondition this UPDATE succeeded and the closed
  // lifecycle was silently re-opened at `analyzed`, with the close's rejection
  // batch already sent.
  const wrote = updateLifecycle(lc.id, { stage: "analyzed", detail: "reality reflection done" }, { expectedStage: readStage });
  assert.equal(wrote, false, "the advance must not be saved");
  assert.equal(getLifecycle(lc.id)?.stage, "closed", "the human's decision stands");
  assert.notEqual(getLifecycle(lc.id)?.detail, "reality reflection done", "…and no field of the stale patch landed");
});

test("expectedStage that still holds writes normally and reports it", () => {
  const lc = createLifecycle({ title: "uncontended" }, true);
  const wrote = updateLifecycle(lc.id, { stage: "analyzed", detail: "reality reflection done" }, { expectedStage: "intake" });
  assert.equal(wrote, true);
  assert.equal(getLifecycle(lc.id)?.stage, "analyzed");
  assert.equal(getLifecycle(lc.id)?.detail, "reality reflection done");
});

test("an illegal move is refused with a code, not persisted", () => {
  const lc = createLifecycle({ title: "impossible" }, true);
  assert.throws(
    () => updateLifecycle(lc.id, { stage: "promoted" }, { expectedStage: "intake" }),
    (err: unknown) => {
      assert.ok(err instanceof IllegalLifecycleTransition);
      assert.equal(err.code, LIFECYCLE_TRANSITION_ERROR);
      assert.equal(err.from, "intake");
      assert.equal(err.to, "promoted");
      return true;
    }
  );
  assert.equal(getLifecycle(lc.id)?.stage, "intake", "nothing was written");
});

test("an undeclared caller keeps the historical unconditional write", () => {
  // Tests and maintenance paths place a lifecycle at an arbitrary stage on purpose;
  // enforcement rides on expectedStage because a caller that never read the stage
  // cannot honestly claim to know where the row is coming from.
  const lc = createLifecycle({ title: "placed by hand" }, true);
  assert.equal(updateLifecycle(lc.id, { stage: "collecting" }), true);
  assert.equal(getLifecycle(lc.id)?.stage, "collecting");
});

test("the refusal code is spelled the same in the store layer and the route registry", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const registry = readFileSync(path.join(here, "api-response.ts"), "utf8");
  assert.ok(
    registry.includes(`  ${LIFECYCLE_TRANSITION_ERROR}: "`),
    "REFUSAL_ERRORS must carry the code IllegalLifecycleTransition throws, or the reader localizes nothing"
  );
});
