import { test } from "node:test";
import assert from "node:assert/strict";
import { disclosureNotes, DEGRADED_STAGES } from "./groupEvalDisclosure.ts";
import type { GroupEvalPayload } from "@/app/features/shared/groupEvalTypes";

// group-eval-run.ts records two honesty facts on every saved evaluation —
// `consentExcluded` (members withheld for an erasure or a lapsed consent) and
// `degradedStages` (AI stages that fell back to their deterministic twin). Both
// were persisted and NEITHER reached a reader, which is the same defect in two
// places: a field that shrank for a consent reason read as a field that simply had
// fewer applicants, and an evaluation whose ranking, narrative and rationales had
// all fallen back looked exactly like a full AI comparison.

test("a clean evaluation owes the reader nothing", () => {
  assert.deepEqual(disclosureNotes({}), { consentExcluded: null, degraded: null });
  assert.deepEqual(disclosureNotes({ consentExcluded: null, degradedStages: null }), {
    consentExcluded: null,
    degraded: null,
  });
});

test("a legacy payload that predates both fields does not throw", () => {
  // The fields are additive on a PERSISTED payload, so an older row omits them. A
  // full payload is also assignable without a cast — that is why the fold's input is
  // structural rather than a GroupEvalPayload import.
  const legacy: GroupEvalPayload = { candidates: [], recommendedOrder: [] };
  assert.deepEqual(disclosureNotes(legacy), { consentExcluded: null, degraded: null });
});

test("consent exclusions surface as a COUNT, and zero is not a sentence", () => {
  assert.equal(disclosureNotes({ consentExcluded: { count: 2 } }).consentExcluded, 2);
  assert.equal(disclosureNotes({ consentExcluded: { count: 0 } }).consentExcluded, null, "zero excluded is noise, not news");
  assert.equal(disclosureNotes({ consentExcluded: { count: -1 } }).consentExcluded, null);
  assert.equal(disclosureNotes({ consentExcluded: { count: "2" } }).consentExcluded, null, "a non-number is not a count");
});

test("degraded stages are reported in a FIXED order, never the order they were pushed", () => {
  const notes = disclosureNotes({
    degradedStages: [
      { stage: "reasoning", reason: "failed" },
      { stage: "ranking", reason: "failed" },
    ],
  });
  assert.deepEqual(notes.degraded, { stages: ["ranking", "reasoning"], timedOut: false });
});

test("a stage repeated across entries is named once", () => {
  const notes = disclosureNotes({
    degradedStages: [
      { stage: "reasoning", reason: "failed" },
      { stage: "reasoning", reason: "failed" },
    ],
  });
  assert.deepEqual(notes.degraded!.stages, ["reasoning"]);
});

test("a timeout is distinguished from a plain failure", () => {
  assert.equal(disclosureNotes({ degradedStages: [{ stage: "comparison", reason: "failed" }] }).degraded!.timedOut, false);
  assert.equal(disclosureNotes({ degradedStages: [{ stage: "comparison", reason: "timeout" }] }).degraded!.timedOut, true);
  assert.equal(
    disclosureNotes({
      degradedStages: [
        { stage: "ranking", reason: "failed" },
        { stage: "comparison", reason: "timeout" },
      ],
    }).degraded!.timedOut,
    true,
    "any timed-out stage makes the stricter word true",
  );
});

test("an unrecognised stage name is dropped, and cannot smuggle in the timeout wording", () => {
  const notes = disclosureNotes({ degradedStages: [{ stage: "sealing", reason: "timeout" }] });
  assert.equal(notes.degraded, null, "a stage this build has no label for must not render as an empty list");
});

test("a malformed degradedStages value is tolerated, not thrown on", () => {
  assert.equal(disclosureNotes({ degradedStages: "ranking" }).degraded, null);
  assert.equal(disclosureNotes({ degradedStages: [null, { stage: "ranking" }] }).degraded!.stages.length, 1);
});

test("every stage in the closed vocabulary can actually be reported", () => {
  for (const stage of DEGRADED_STAGES) {
    assert.deepEqual(disclosureNotes({ degradedStages: [{ stage, reason: "failed" }] }).degraded!.stages, [stage]);
  }
});
