// Commit the pass you previewed (challenge-r02 pipeline-actions-events/B) - the pure
// half: the per-entry verdicts, the team scoping, the body validation and the report.
// The executed half (what the commit loop writes) lives in automation-pass.test.ts.
//
// Runner: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  approvedFromPreview,
  commitReport,
  parseApprovedSelection,
  planCommit,
  type PlannedDecision,
} from "./automation-commit-plan.ts";

const advance = (entryId: string, toStage = "Interview", workspaceId = "ws-a") => ({ entryId, action: "advance", toStage, workspaceId });

test("case 1: a ticked advance the pass still decides is applied", () => {
  const plan = planCommit([advance("e1")], [{ entryId: "e1", action: "advance", toStage: "Interview" }], "ws-a");
  assert.equal(plan.get("e1"), "apply");
});

test("case 2 (plan): an advance the recruiter unticked is declined", () => {
  const plan = planCommit([advance("e2")], [], "ws-a");
  assert.equal(plan.get("e2"), "declined");
});

test("case 3 (plan): a ticked advance the pass now holds has drifted", () => {
  const plan = planCommit(
    [{ entryId: "e3", action: "hold", toStage: null, workspaceId: "ws-a" }],
    [{ entryId: "e3", action: "advance", toStage: "Interview" }],
    "ws-a",
  );
  assert.equal(plan.get("e3"), "drifted");
});

test("an advance to a DIFFERENT stage than the one previewed has drifted too", () => {
  const plan = planCommit([advance("e1", "Offer")], [{ entryId: "e1", action: "advance", toStage: "Interview" }], "ws-a");
  assert.equal(plan.get("e1"), "drifted");
});

test("case 4 (plan): another team's row is foreign even when its id is in the selection", () => {
  const plan = planCommit(
    [advance("x", "Interview", "ws-b")],
    [{ entryId: "x", action: "advance", toStage: "Interview" }],
    "ws-a",
  );
  assert.equal(plan.get("x"), "foreign", "one team's selection neither applies nor holds back another team's row");
});

test("holds and nones are autonomous: nobody was asked about them", () => {
  const plan = planCommit(
    [
      { entryId: "h", action: "hold", toStage: null, workspaceId: "ws-a" },
      { entryId: "n", action: "none", toStage: null, workspaceId: "ws-a" },
    ],
    [],
    "ws-a",
  );
  assert.equal(plan.get("h"), "autonomous");
  assert.equal(plan.get("n"), "autonomous");
});

test("case 8: a malformed selection is refused; an absent one is not a selection", () => {
  const cap = 3;
  assert.equal(parseApprovedSelection(undefined, cap), null, "no field = today's behaviour");
  assert.deepEqual(parseApprovedSelection("e1", cap), { ok: false }, "not an array");
  assert.deepEqual(parseApprovedSelection([{ entryId: "e1", action: "hold", toStage: null }], cap), { ok: false }, "hold is not selectable");
  assert.deepEqual(parseApprovedSelection([{ entryId: "e1", action: "none", toStage: null }], cap), { ok: false });
  assert.deepEqual(
    parseApprovedSelection(
      Array.from({ length: cap + 1 }, (_, i) => ({ entryId: `e${i}`, action: "advance", toStage: "Interview" })),
      cap,
    ),
    { ok: false },
    "more rows than the pass can hold",
  );
  assert.deepEqual(
    parseApprovedSelection(
      [
        { entryId: "e1", action: "advance", toStage: "Interview" },
        { entryId: "e1", action: "reject", toStage: null },
      ],
      cap,
    ),
    { ok: false },
    "a duplicate id is refused, not guessed at",
  );
  assert.deepEqual(parseApprovedSelection([], cap), { ok: true, approved: [] }, "an empty selection is a real one: hold everything back");
  assert.deepEqual(parseApprovedSelection([{ entryId: "e1", action: "reject" }], cap), {
    ok: true,
    approved: [{ entryId: "e1", action: "reject", toStage: null }],
  });
});

test("the modal posts back every selectable row it showed, minus the unticked ones", () => {
  const shown = [
    { entryId: "a", action: "advance", toStage: "Interview" },
    { entryId: "b", action: "reject", toStage: null },
    { entryId: "c", action: "hold", toStage: null },
    { entryId: "d", action: "advance", toStage: "Offer" },
  ];
  assert.deepEqual(approvedFromPreview(shown, new Set(["d"])), [
    { entryId: "a", action: "advance", toStage: "Interview" },
    { entryId: "b", action: "reject", toStage: null },
  ]);
});

test("case 3 (report): the drifted row is named with what was approved and what the pass decided", () => {
  const decisions: PlannedDecision[] = [
    { entryId: "e3", action: "none", toStage: null, commitVerdict: "drifted", plannedAction: "hold", plannedToStage: null },
    { entryId: "e2", action: "none", toStage: null, commitVerdict: "declined", plannedAction: "advance", plannedToStage: "Interview" },
    { entryId: "e1", action: "advance", toStage: "Interview", commitVerdict: "apply" },
  ];
  const report = commitReport(decisions, [{ entryId: "e3", action: "advance", toStage: "Interview" }, { entryId: "e1", action: "advance", toStage: "Interview" }], false);
  assert.equal(report.selectionHonored, true);
  assert.deepEqual(report.drifted, [
    { entryId: "e3", approvedAction: "advance", approvedToStage: "Interview", action: "hold", toStage: null },
  ]);
  assert.equal(report.declined, 1);
});

test("case 6 (report): a selection that JOINED an in-flight pass is reported as not honoured", () => {
  const report = commitReport([{ entryId: "e1", action: "advance", toStage: "Interview" }], [{ entryId: "e1", action: "advance", toStage: "Interview" }], true);
  assert.deepEqual(report, { selectionHonored: false, drifted: [], declined: 0 });
});
