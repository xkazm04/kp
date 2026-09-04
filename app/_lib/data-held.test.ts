import { test } from "node:test";
import assert from "node:assert/strict";
import { heldDataCategories, renderableHeldCategories } from "./data-held.ts";

// bug-ui-scan-2026-07-09 (privacy-consent-provenance #5): the /data "what we hold"
// list must reflect what the entry ACTUALLY has, not a hardcoded five-item array
// that over-claims interview records / scores for a candidate who only applied.

test("a bare applicant is only told we hold their CV + answers", () => {
  assert.deepEqual(heldDataCategories({ hasContact: false, hasInterview: false, hasScore: false }), ["cv", "answers"]);
});

test("contact / interview / scores are listed only when captured, in a stable order", () => {
  assert.deepEqual(heldDataCategories({ hasContact: true, hasInterview: true, hasScore: true }), [
    "cv",
    "contact",
    "answers",
    "interview",
    "scores",
  ]);
  // partial capture: contact + score but never interviewed → no "interview" over-claim
  assert.deepEqual(heldDataCategories({ hasContact: true, hasInterview: false, hasScore: true }), [
    "cv",
    "contact",
    "answers",
    "scores",
  ]);
  // interviewed but no stored contact
  assert.deepEqual(heldDataCategories({ hasContact: false, hasInterview: true, hasScore: false }), [
    "cv",
    "answers",
    "interview",
  ]);
});

// Lot CP — the RENDER side of the same over-claim. The /data client used to do
// `view?.held ?? Object.keys(heldLabel)`, so a response that omitted the field (an
// older server, a truncated payload) told the candidate we hold all five categories
// — the hardcoded list heldDataCategories was written to remove, re-armed on the one
// surface where over-claiming is a transparency failure.
const LABELLED = ["cv", "contact", "answers", "interview", "scores"] as const;

test("a missing / malformed held field renders NOTHING, never everything", () => {
  assert.deepEqual(renderableHeldCategories(undefined, LABELLED), []);
  assert.deepEqual(renderableHeldCategories(null, LABELLED), []);
  // Not an array (a server that answered an object, or a string) is equally no evidence.
  assert.deepEqual(renderableHeldCategories({ cv: true }, LABELLED), []);
  assert.deepEqual(renderableHeldCategories("cv", LABELLED), []);
  assert.deepEqual(renderableHeldCategories([], LABELLED), []);
});

test("the API's own order is preserved; unlabelled and repeated keys are dropped", () => {
  assert.deepEqual(renderableHeldCategories(["cv", "answers"], LABELLED), ["cv", "answers"]);
  // A newer server naming a category this client has no label for.
  assert.deepEqual(renderableHeldCategories(["cv", "biometrics", "scores"], LABELLED), ["cv", "scores"]);
  // Non-strings and duplicates can never reach the list.
  assert.deepEqual(renderableHeldCategories(["cv", "cv", 7, null], LABELLED), ["cv"]);
});
