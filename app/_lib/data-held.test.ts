import { test } from "node:test";
import assert from "node:assert/strict";
import { heldDataCategories } from "./data-held.ts";

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
