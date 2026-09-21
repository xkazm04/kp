import test from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import { isCandidateTab, nextCandidateView, schedEntryOf, type CandidateView } from "./candidateView";

// The candidate modal replaced the drawer, and the drawer's hardest-won property was
// that nothing ejects the recruiter from what they were reading: a stage move
// refreshes IN PLACE, prev/next keeps the cohort. These pin that for the modal's tab.

const entry = (id: string): Entry => ({ id, candidateLabel: id, stage: "Screened", status: "active" }) as Entry;

test("a fresh open lands on Overview with the board's cohort", () => {
  const a = entry("a");
  assert.deepEqual(nextCandidateView(null, a), { entry: a, cohort: null, tab: "overview" });
});

test("a refresh or a step keeps the tab and the cohort", () => {
  const cohort = [entry("a"), entry("b")];
  const open: CandidateView = { entry: cohort[0], cohort, tab: "record" };
  const next = nextCandidateView(open, cohort[1]);
  assert.equal(next?.tab, "record");
  assert.equal(next?.cohort, cohort);
});

test("explicit options win, including an explicit null cohort", () => {
  const open: CandidateView = { entry: entry("a"), cohort: [entry("a")], tab: "record" };
  const c = entry("c");
  assert.deepEqual(nextCandidateView(open, c, { cohort: null, tab: "overview" }), { entry: c, cohort: null, tab: "overview" });
});

test("closing is a null entry", () => {
  assert.equal(nextCandidateView({ entry: entry("a"), cohort: null, tab: "overview" }, null), null);
});

test("tab ids are a closed vocabulary", () => {
  assert.equal(isCandidateTab("activity"), true);
  assert.equal(isCandidateTab("drawer"), false);
  // The Actions tab is gone: every action lives in the modal's footer.
  assert.equal(isCandidateTab("actions"), false);
});

test("the transcript adapter never invents approval data", () => {
  const s = schedEntryOf(entry("a"));
  assert.equal(s.approvalKind, null);
  assert.equal(s.approvalDetail, null);
  assert.equal(s.matchScore, null);
});
