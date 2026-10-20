// cohort-drift-forces-a-fresh-review — the bulk selection as ONE pure reducer.
//
// The defects these pin (challenge-r06 pipeline-move-bulk-operations/A):
//   1. bulkMove ended with `setSelectedIds(failures)` and dispatched nothing, so an
//      armed reject/outreach confirm outlived the cohort change its own settle caused.
//   2. armedConfirm compared only the visible SCOPE. The 30s poll keeps running in
//      select mode, so a reject armed over 2 awaiting candidates fired on however many
//      were awaiting at click time - and a stage/decision drift of a named person
//      went unnoticed too. A confirm now SIGNS the cohort it names.
//   3. A selected entry closed by another actor drops off the board (the list excludes
//      terminal rows) while its id stayed selected - counted as "hidden by the current
//      filter" forever.
//   4. The failures-stay-selected + whole-request-refusal fold was written three times
//      (move, decide, invite) and a failed outreach task reported `selectedIds.size` at
//      COMPLETION, not the cohort it started with.
//
// Runner: Node's built-in test runner (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_BULK_SELECTION,
  armedBulkConfirm,
  bulkSelectionReducer,
  cohortSignature,
  foldBatchSettle,
  reconcileSelection,
  type BulkSelectionState,
  type CohortRow,
} from "./pipelineBulkSelection.ts";
import { selectionOutsideVisible } from "./pipelineSelectionScope.ts";

const S = "scope-s";
const row = (id: string, stage: string, approvalKind: string | null, status = "active"): CohortRow => ({
  id,
  stage,
  approvalKind,
  status,
});
const state = (over: Partial<BulkSelectionState>): BulkSelectionState => ({ ...EMPTY_BULK_SELECTION, ...over });
const ids = (s: ReadonlySet<string>) => [...s].sort();

test("a settle is a selection change: an armed confirm does not survive it (was: bulkMove dispatched nothing)", () => {
  const entries = [row("a", "Screened", "screening_review"), row("b", "Screened", "screening_review")];
  const selected = new Set(["a", "b", "c", "d"]);
  const sig = cohortSignature(selected, entries, "reject");
  const armed = state({ selected, confirm: { which: "reject", scope: S, cohort: sig } });
  assert.equal(armedBulkConfirm(armed, S, entries), "reject", "armed before the settle");
  const next = bulkSelectionReducer(armed, {
    type: "settled",
    keep: new Set(["c"]),
    result: { ok: 3, failed: 1, verb: "moved" },
  });
  assert.equal(next.confirm, null, "the settle disarms");
  assert.deepEqual(ids(next.selected), ["c"], "only the kept ids stay selected");
  assert.equal(next.busy, false);
});

test("membership drift: a poll that makes a third selected row awaiting disarms the reject that named 2", () => {
  const selected = new Set(["a", "b", "c"]);
  const before = [row("a", "Screened", "screening_review"), row("b", "Screened", "screening_review"), row("c", "Screened", null)];
  let s = state({ selected });
  s = bulkSelectionReducer(s, { type: "arm", which: "reject", scope: S, cohort: cohortSignature(selected, before, "reject") });
  assert.equal(armedBulkConfirm(s, S, before), "reject");
  // The poll: c now awaits a screening decision too. Same scope, same selection.
  const after = [before[0], before[1], row("c", "Screened", "screening_review")];
  assert.equal(armedBulkConfirm(s, S, after), null, "the next click re-arms naming 3 instead of firing on 3");
});

test("status drift: a named row moving Screened -> Interview (still awaiting) invalidates the signed set", () => {
  const selected = new Set(["a", "b"]);
  const before = [row("a", "Screened", "screening_review"), row("b", "Screened", "screening_review")];
  const s = bulkSelectionReducer(state({ selected }), {
    type: "arm",
    which: "reject",
    scope: S,
    cohort: cohortSignature(selected, before, "reject"),
  });
  const after = [before[0], row("b", "Interview", "scorecard_review")];
  assert.equal(armedBulkConfirm(s, S, after), null);
  // A drift OUTSIDE the actionable cohort (a non-awaiting selected row moving) is not a
  // change to the people the reject names, so it does not nag.
  const sel3 = new Set(["a", "b", "x"]);
  const base3 = [...before, row("x", "Applied", null)];
  const s3 = bulkSelectionReducer(state({ selected: sel3 }), {
    type: "arm",
    which: "reject",
    scope: S,
    cohort: cohortSignature(sel3, base3, "reject"),
  });
  assert.equal(armedBulkConfirm(s3, S, [...before, row("x", "Screened", null)]), "reject");
  // …and a signature minted for the OTHER action never arms this one (fails closed).
  const crossed = bulkSelectionReducer(state({ selected }), {
    type: "arm",
    which: "reject",
    scope: S,
    cohort: cohortSignature(selected, before, "outreach"),
  });
  assert.equal(armedBulkConfirm(crossed, S, before), null);
});

test("ghost ids of entries closed elsewhere prune from the selection and stop counting as hidden", () => {
  const entries = [{ id: "a" }, { id: "b" }];
  const r = reconcileSelection(new Set(["a", "b", "g"]), entries);
  assert.deepEqual(ids(r.selected), ["a", "b"]);
  assert.deepEqual(r.pruned, ["g"]);
  assert.equal(selectionOutsideVisible(r.selected, entries).length, 0, "g is no longer 'hidden by the current filter'");
  // Nothing to prune returns the SAME set (no re-render churn on every poll).
  const same = new Set(["a"]);
  assert.equal(reconcileSelection(same, entries).selected, same);
  // Through the reducer: the prune is disclosed once on the status line.
  const s = bulkSelectionReducer(state({ selected: new Set(["a", "g", "h"]) }), { type: "reconcile", entries });
  assert.deepEqual(ids(s.selected), ["a"]);
  assert.equal(s.result?.departed, 2);
  const unchanged = state({ selected: new Set(["a"]) });
  assert.equal(bulkSelectionReducer(unchanged, { type: "reconcile", entries }), unchanged, "a no-op poll is the same state");
});

test("foldBatchSettle: failures + untouched stay selected, per-id codes deduped", () => {
  const f = foldBatchSettle({
    attempted: ["a", "b", "c"],
    untouched: ["d"],
    response: {
      ok: true,
      results: [
        { id: "a", ok: true },
        { id: "b", ok: false, code: "PIPELINE_MOVE_CONFLICT" },
        { id: "c", ok: false, code: "PIPELINE_MOVE_CONFLICT" },
      ],
    },
  });
  assert.deepEqual(ids(f.keep), ["b", "c", "d"]);
  assert.equal(f.ok, 1);
  assert.equal(f.failed, 2);
  assert.deepEqual(f.reasonCodes, ["PIPELINE_MOVE_CONFLICT"]);
  assert.equal(f.reasonKey, null);
});

test("foldBatchSettle: a whole-request refusal overrides per-id codes; a transport blip names the client line", () => {
  const refused = foldBatchSettle({
    attempted: ["a", "b"],
    untouched: ["d"],
    response: { ok: false, status: 403, code: "FORBIDDEN_CAPABILITY", capability: "pipeline:write" },
  });
  assert.deepEqual(ids(refused.keep), ["a", "b", "d"]);
  assert.deepEqual(refused.reasonCodes, ["FORBIDDEN_CAPABILITY"]);
  assert.equal(refused.refusalCapability, "pipeline:write");
  assert.equal(refused.reasonKey, null);
  assert.equal(refused.failed, 2);

  const blip = foldBatchSettle({ attempted: ["a"], untouched: [], response: { ok: false } });
  assert.equal(blip.reasonKey, "bulkRequestFailed");
  assert.deepEqual(blip.reasonCodes, []);
  assert.deepEqual(ids(blip.keep), ["a"]);

  const gate = foldBatchSettle({ attempted: ["a"], untouched: [], response: { ok: false, status: 401 } });
  assert.equal(gate.reasonKey, "bulkNotPermitted", "an uncoded 401/403 is the gate, not a blip");
});

test("a failed outreach task reports the cohort it STARTED with, not the selection at completion", () => {
  let s = state({ selected: new Set(["a", "b", "c"]) });
  s = bulkSelectionReducer(s, { type: "fired" });
  s = bulkSelectionReducer(s, { type: "outreachStarted", taskId: "t1", cohort: ["a", "b", "c"] });
  // The recruiter narrows the selection while the letters are being drafted.
  s = bulkSelectionReducer(s, { type: "toggle", id: "b" });
  s = bulkSelectionReducer(s, { type: "toggle", id: "c" });
  assert.equal(s.selected.size, 1);
  s = bulkSelectionReducer(s, {
    type: "outreachSettled",
    taskId: "t1",
    failure: { reason: "task incomplete", diagnostic: "boom" },
  });
  assert.equal(s.result?.failed, 3, "failed = the 3 the task was started with");
  assert.equal(s.result?.verb, "drafted");
  assert.equal(s.outreach, null);
  // A late duplicate completion for the same task is a no-op.
  assert.equal(bulkSelectionReducer(s, { type: "outreachSettled", taskId: "t1", failure: null, results: [] }), s);
});
