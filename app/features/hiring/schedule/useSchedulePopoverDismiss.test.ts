// bug-ui-scan-2026-07-09 (interview-scheduling-prep-rubric #4) — the pure key
// predicate behind the shared popover dismissal. Non-vacuity: pre-fix, AddToCalendar
// had NO Escape handling at all (dismissal was a viewport-blanket <button>), so this
// predicate did not exist — the assertions can only pass against the fix.
//
// The hook's DOM behavior (outside-press without eating the click, focus-return,
// role="menu"/dialog semantics) is declarative/DOM-integration and is verified by
// tsc + structural review; `node --test` has no DOM to exercise it here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isDismissKey } from "./useSchedulePopoverDismiss.ts";

test("isDismissKey matches Escape (and the legacy Esc) only", () => {
  assert.equal(isDismissKey("Escape"), true);
  assert.equal(isDismissKey("Esc"), true);
  assert.equal(isDismissKey("Enter"), false);
  assert.equal(isDismissKey("Tab"), false);
  assert.equal(isDismissKey(" "), false);
  assert.equal(isDismissKey("a"), false);
});
