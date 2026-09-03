import test from "node:test";
import assert from "node:assert/strict";
import { POSTING_TAB_IDS, isPostingTabId } from "./jobsPostingModalTabs.ts";

// The job modal's seven tabs were a `role="tablist"` in name only: every button
// was a tab stop (no roving tabindex) and the arrow keys did nothing, so reaching
// "Agent fit" from "Posting" cost six Tabs through a strip whose ARIA promises one.
// The movement rule now lives in app/_components/ui/useTablist.ts and is pinned
// by useTablist.test.ts; what stays here is the vocabulary itself.

test("the tab vocabulary is a closed literal set with a runtime guard", () => {
  assert.equal(POSTING_TAB_IDS.length, 7);
  assert.equal(isPostingTabId("agentfit"), true);
  assert.equal(isPostingTabId("Posting"), false);
  assert.equal(isPostingTabId("billing"), false);
});
