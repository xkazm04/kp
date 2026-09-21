import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROMOTE_OPTIONS, coatEditable, toggleColumn, type IntakeColumnKey } from "./studioContract";
import type { IntakeSession } from "../jdsIntakeLogic";

// The coat vocabulary this file used to pin is gone: Atelier is the only surface,
// so there is no closed set of directions and no stored preference to guard. What
// remains are the two rules the consolidation was NOT allowed to change — what a
// promote click buys, and when the brief may be written — plus the fold guard the
// desk's only persisted preference runs through.

test("the promote defaults the consolidation must not change", () => {
  // The captioned checkboxes and the glyph toggles bought the same thing: the
  // work-sample case is opt-IN, the salary read is opt-OUT. Deleting the
  // captioned path was paint; it may never change what a click costs.
  assert.deepEqual(DEFAULT_PROMOTE_OPTIONS, { caseDesign: false, marketResearch: true });
});

test("only an open session is editable — complete and promoted are not", () => {
  const at = (status: IntakeSession["status"]) => coatEditable({ status } as IntakeSession);
  assert.equal(at("open"), true);
  assert.equal(at("complete"), false);
  assert.equal(at("promoted"), false);
});

test("the desk never folds to nothing", () => {
  const all: IntakeColumnKey[] = ["draft", "chat", "brief"];
  assert.deepEqual(toggleColumn(all, "chat"), ["draft", "brief"], "a zone folds while others are open");
  assert.deepEqual(toggleColumn(["brief"], "brief"), ["brief"], "the last open zone refuses to fold");
  assert.deepEqual(toggleColumn(["brief"], "draft"), ["brief", "draft"], "a folded zone re-opens");
});
