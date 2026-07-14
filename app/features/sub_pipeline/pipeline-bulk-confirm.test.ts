// Pure state logic for the board's two destructive bulk-confirms. The round-5
// defect these pin: a confirm armed for one cohort must NOT survive a change to the
// selection (or it fires against a cohort the recruiter never confirmed). Because
// the reducer is pure, the invariants are provable here with no React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bulkConfirmReducer, type BulkConfirm } from "./pipeline-bulk-confirm.ts";

test("selectionChanged disarms EITHER armed confirm — the defect", () => {
  // This is the exact bug: arm a confirm, grow/shrink the selection, and the next
  // click must NOT act on a confirm from the old cohort.
  for (const armed of ["reject", "outreach"] as const) {
    const state: BulkConfirm = bulkConfirmReducer(null, { type: "arm", which: armed });
    assert.equal(state, armed, "arming sets the confirm");
    assert.equal(
      bulkConfirmReducer(state, { type: "selectionChanged" }),
      null,
      `a selection change disarms the ${armed} confirm`
    );
  }
});

test("arming one confirm disarms the other (single-slot state)", () => {
  const reject = bulkConfirmReducer(null, { type: "arm", which: "reject" });
  assert.equal(bulkConfirmReducer(reject, { type: "arm", which: "outreach" }), "outreach");
  const outreach = bulkConfirmReducer(null, { type: "arm", which: "outreach" });
  assert.equal(bulkConfirmReducer(outreach, { type: "arm", which: "reject" }), "reject");
});

test("cancel and fired both disarm", () => {
  for (const armed of ["reject", "outreach"] as const) {
    const state = bulkConfirmReducer(null, { type: "arm", which: armed });
    assert.equal(bulkConfirmReducer(state, { type: "cancel" }), null, "cancel disarms");
    assert.equal(bulkConfirmReducer(state, { type: "fired" }), null, "firing disarms");
  }
});

test("disarming events are no-ops from the already-disarmed state", () => {
  for (const ev of [{ type: "selectionChanged" }, { type: "cancel" }, { type: "fired" }] as const) {
    assert.equal(bulkConfirmReducer(null, ev), null);
  }
});
