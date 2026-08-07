// Pins the board move-menu's target-stage contract (bug-ui pipeline #1): the
// keyboard "Move to…" affordance must offer exactly the stages a manual set_stage
// move can succeed into, so the accessible twin of drag is never a dead control.
//
// Non-vacuity: `moveTargetStages` / this whole module did not exist before the
// fix — against pre-fix code the import below is ERR_MODULE_NOT_FOUND and the file
// errors out (RED). Beyond mere existence, the assertions below discriminate the
// fix's decisions (Hired dropped, current stage dropped, funnel order kept): a
// naive `return PIPELINE_STAGES.slice()` passes tsc but fails every case here.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PIPELINE_STAGES } from "@/app/_lib/pipeline-stages.ts";
import { bulkMoveTargetStages, moveStageSelectValues, moveTargetStages } from "./pipelineMoveTargets.ts";

test("never offers Hired as a target — the route 422s a manual move to Hired", () => {
  for (const stage of PIPELINE_STAGES) {
    assert.ok(
      !moveTargetStages(stage).includes("Hired"),
      `Hired must not be a move target from ${stage} (server rejects it)`
    );
  }
});

test("never offers the current stage (moving to the same column is a no-op)", () => {
  for (const stage of PIPELINE_STAGES) {
    assert.ok(!moveTargetStages(stage).includes(stage), `${stage} must not target itself`);
  }
});

test("from Accepted, offers Screened, Interview, Offer — in funnel order", () => {
  assert.deepEqual(moveTargetStages("Accepted"), ["Screened", "Interview", "Offer"]);
});

test("from Interview, offers Accepted, Screened, Offer — backward moves included", () => {
  assert.deepEqual(moveTargetStages("Interview"), ["Accepted", "Screened", "Offer"]);
});

test("from Hired, offers every non-Hired stage (a card CAN move back out of Hired)", () => {
  assert.deepEqual(moveTargetStages("Hired"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("an unknown/legacy stage yields every non-Hired stage, in axis order", () => {
  assert.deepEqual(moveTargetStages("Sourced"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("targets are always a subset of the canonical axis (no invented stages)", () => {
  const axis = new Set<string>(PIPELINE_STAGES);
  for (const stage of [...PIPELINE_STAGES, "Sourced"]) {
    for (const target of moveTargetStages(stage)) assert.ok(axis.has(target), `${target} is not a real stage`);
  }
});

// bug-ui pipeline #2 — moveStageSelectValues is the drawer <Select>'s full option
// list: the current stage (so the control has a valid selected row) plus exactly
// the move targets the server accepts. Non-vacuity: this export did not exist
// before the fix (RED = named-export miss); a naive `PIPELINE_STAGES.slice()`
// (the pre-fix dropdown, which offered Hired) fails the "no Hired" case below.
test("the drawer move options never include Hired unless the candidate is AT Hired", () => {
  for (const stage of PIPELINE_STAGES) {
    const opts = moveStageSelectValues(stage);
    if (stage === "Hired") {
      assert.ok(opts.includes("Hired"), "a Hired candidate keeps Hired as the current/selected option");
    } else {
      assert.ok(!opts.includes("Hired"), `Hired must not be offered from ${stage} (server 422s it)`);
    }
  }
});

test("the drawer move options always include the current CANONICAL stage (a valid selected value)", () => {
  // Every stage on the axis stays selectable so the <Select value={entry.stage}>
  // has a matching option. (An off-axis legacy stage like "Sourced" is remapped by
  // migratePipelineStages() on boot, so the drawer never renders one — the same
  // assumption the pre-fix `PIPELINE_STAGES.map` made.)
  for (const stage of PIPELINE_STAGES) {
    assert.ok(moveStageSelectValues(stage).includes(stage), `${stage} must remain selectable as the current value`);
  }
});

test("from Screened, the drawer offers Accepted, Screened, Interview, Offer in funnel order (no Hired)", () => {
  assert.deepEqual(moveStageSelectValues("Screened"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("from Offer, the drawer offers up to Offer, never Hired", () => {
  assert.deepEqual(moveStageSelectValues("Offer"), ["Accepted", "Screened", "Interview", "Offer"]);
});

test("every non-current drawer option is an accepted move target (options match what the server accepts)", () => {
  for (const stage of PIPELINE_STAGES) {
    const targets = new Set(moveTargetStages(stage));
    for (const opt of moveStageSelectValues(stage)) {
      assert.ok(opt === stage || targets.has(opt), `${opt} offered from ${stage} is neither the current stage nor an accepted target`);
    }
  }
});

// retire-erroring-bulk-control — the BULK bar's stage list. Pre-fix it was built from
// the raw canonical axis (`STAGES.map(...)` in PipelineBulkActionBar.tsx), so it
// offered "Hired" and applying it returned N x 422 with the whole selection still
// selected. Non-vacuity: `bulkMoveTargetStages` did not exist before the fix (RED =
// named-export miss), and a naive `PIPELINE_STAGES.slice()` — literally the pre-fix
// list — fails the first two cases below.
test("the BULK move control never offers Hired (the server 422s every manual move to it)", () => {
  assert.ok(!bulkMoveTargetStages().includes("Hired"), "Hired must not be a bulk move target");
});

test("the BULK move list is exactly the canonical axis minus Hired, in funnel order", () => {
  // DERIVED from PIPELINE_STAGES, never hand-enumerated: adding a 6th stage to the
  // axis must extend the bulk control automatically, and this case must not be the
  // thing that has to be remembered.
  assert.deepEqual(
    bulkMoveTargetStages(),
    (PIPELINE_STAGES as readonly string[]).filter((s) => s !== "Hired")
  );
});

test("retiring Hired removes NO legitimate move target — every other stage survives", () => {
  // The over-correction guard: the fix must drop exactly one option. Set equality
  // against the canonical axis, both directions.
  const offered = new Set(bulkMoveTargetStages());
  const expected = new Set((PIPELINE_STAGES as readonly string[]).filter((s) => s !== "Hired"));
  assert.deepEqual([...offered].sort(), [...expected].sort(), "bulk targets must be exactly the non-Hired axis");
  for (const s of PIPELINE_STAGES) {
    if (s !== "Hired") assert.ok(offered.has(s), `${s} is a legitimate bulk target and must still be offered`);
  }
});

test("a bulk selection has no single current stage, so nothing but Hired is excluded", () => {
  // Documents the decision (the direction left it open): exclude Hired unconditionally,
  // do NOT attempt per-row current-stage exclusion. bulkMove already counts an
  // already-at-target card as moved with no round trip, so offering a stage part of the
  // selection sits in is harmless — offering Hired is not.
  for (const stage of PIPELINE_STAGES) {
    if (stage === "Hired") continue;
    assert.ok(
      bulkMoveTargetStages().includes(stage),
      `${stage} must stay offered even when some of the selection is already there`
    );
  }
});

test("the bulk bar routes through the helper — it must not rebuild the list from raw STAGES", () => {
  // The defect was a second, divergent source for the same list. Reading the component
  // is the only way to pin that it still goes through the shared helper; the assertions
  // above cannot see a regression that re-hardcodes the axis in the .tsx.
  const bar = readFileSync(new URL("./PipelineBulkActionBar.tsx", import.meta.url), "utf8");
  assert.match(bar, /bulkMoveTargetStages\(\)/, "the bulk stage <Select> must derive its options from the helper");
  assert.ok(
    !/\bSTAGES\.map\b/.test(bar),
    "the bulk bar must not map the raw canonical axis into stage options again"
  );
});

test("the drawer's 'open full match' is gated on candidateId, like its sibling", () => {
  // Same defect class, smaller: the button rendered unconditionally and its handler
  // no-opped when the entry had no linked candidate — a control that silently does
  // nothing. Both links are now behind the same guard.
  const links = readFileSync(new URL("./PipelineDrawerFooterLinks.tsx", import.meta.url), "utf8");
  assert.equal(
    (links.match(/\{candidateId \? \(/g) ?? []).length,
    2,
    "both footer links must be gated on candidateId"
  );
  assert.ok(
    !/if \(candidateId\) router\.push/.test(links),
    "the no-op-inside-the-handler pattern must be gone — gate the control, don't swallow the click"
  );
});
