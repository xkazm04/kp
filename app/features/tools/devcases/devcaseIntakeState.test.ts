// Closed intake reads closed (challenge-r09 devcase-lifecycle/B).
//
// The assignment detail used to decide "published" as `casePostings.length > 0`, so a
// case whose every posting was closed - by the lifecycle's close-out, by the r07 fence
// withdrawing a just-minted token, or by the new stop door - still read as live: the
// header said Published and was disabled, and a closed case could never be reopened.
// The state now comes from the postings' STATUS, and which intake action the header
// offers is one pure rule the server's stop door shares (lifecycleOwnsIntake).
//
// The rule lives in DevCaseDetail.publish.ts - the detail's existing pure sibling - and
// not in a new module: app/page.tsx reaches this reader through next/dynamic and sits
// at its module ceiling in perf-budget.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { intakeAction, intakeOf, lifecycleOwnsIntake } from "./DevCaseDetail.publish.ts";

test("intakeOf reads the postings' status: none, some open, all closed", () => {
  assert.deepEqual(intakeOf([]), { state: "unpublished" });
  assert.deepEqual(intakeOf([{ status: "open" }, { status: "closed" }]), { state: "live", open: 1, closed: 1 });
  assert.deepEqual(intakeOf([{ status: "closed" }]), { state: "closed", open: 0, closed: 1 });
  assert.deepEqual(intakeOf([{ status: "closed" }, { status: "closed" }]), { state: "closed", open: 0, closed: 2 });
});

test("intakeAction: stop a manual live case, leave a running lifecycle's to its own Close, reopen a closed one", () => {
  const live = intakeOf([{ status: "open" }]);
  const closed = intakeOf([{ status: "closed" }]);
  const none = intakeOf([]);
  assert.equal(intakeAction(live, null), "stop");
  assert.equal(intakeAction(live, "collecting"), null, "the lifecycle row's Close owns intake (it wraps submitters up)");
  assert.equal(intakeAction(live, "closed"), "stop", "a posting reopened after close-out has only this door");
  assert.equal(intakeAction(closed, null), "reopen");
  assert.equal(intakeAction(closed, "closed"), "reopen");
  assert.equal(intakeAction(closed, "collecting"), null, "a running lifecycle owns its intake either way");
  assert.equal(intakeAction(none, null), "publish");
  assert.equal(intakeAction(none, "approved"), "publish");
});

test("lifecycleOwnsIntake is the ONE rule the stop door and the header share", () => {
  assert.equal(lifecycleOwnsIntake(null), false);
  assert.equal(lifecycleOwnsIntake(undefined), false);
  assert.equal(lifecycleOwnsIntake("closed"), false);
  for (const stage of ["intake", "approved", "collecting", "ranked", "promoted"]) {
    assert.equal(lifecycleOwnsIntake(stage), true, stage);
  }
});
