// Pure state logic for the board's two destructive bulk-confirms. The round-5
// defect these pin: a confirm armed for one cohort must NOT survive a change to the
// selection (or it fires against a cohort the recruiter never confirmed). Because
// the reducer is pure, the invariants are provable here with no React.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armedConfirm, bulkConfirmReducer, type BulkConfirm } from "./pipelineBulkConfirm.ts";

// The board's visible-scope signature at arm time (bulk-acts-on-what-you-see). These
// cases hold the scope CONSTANT so they isolate the selection-side invariants; the
// scope-side ones live in pipelineSelectionScope.test.ts.
const SCOPE = "scope-a";

test("selectionChanged disarms EITHER armed confirm — the defect", () => {
  // This is the exact bug: arm a confirm, grow/shrink the selection, and the next
  // click must NOT act on a confirm from the old cohort.
  for (const armed of ["reject", "outreach"] as const) {
    const state: BulkConfirm = bulkConfirmReducer(null, { type: "arm", which: armed, scope: SCOPE });
    assert.equal(armedConfirm(state, SCOPE), armed, "arming sets the confirm");
    assert.equal(
      bulkConfirmReducer(state, { type: "selectionChanged" }),
      null,
      `a selection change disarms the ${armed} confirm`
    );
  }
});

test("arming one confirm disarms the other (single-slot state)", () => {
  const reject = bulkConfirmReducer(null, { type: "arm", which: "reject", scope: SCOPE });
  assert.equal(armedConfirm(bulkConfirmReducer(reject, { type: "arm", which: "outreach", scope: SCOPE }), SCOPE), "outreach");
  const outreach = bulkConfirmReducer(null, { type: "arm", which: "outreach", scope: SCOPE });
  assert.equal(armedConfirm(bulkConfirmReducer(outreach, { type: "arm", which: "reject", scope: SCOPE }), SCOPE), "reject");
});

test("cancel and fired both disarm", () => {
  for (const armed of ["reject", "outreach"] as const) {
    const state = bulkConfirmReducer(null, { type: "arm", which: armed, scope: SCOPE });
    assert.equal(bulkConfirmReducer(state, { type: "cancel" }), null, "cancel disarms");
    assert.equal(bulkConfirmReducer(state, { type: "fired" }), null, "firing disarms");
  }
});

test("disarming events are no-ops from the already-disarmed state", () => {
  for (const ev of [{ type: "selectionChanged" }, { type: "cancel" }, { type: "fired" }] as const) {
    assert.equal(bulkConfirmReducer(null, ev), null);
  }
});
