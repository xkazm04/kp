// The Settings toggle's READ, folded (WP3). Three states, not two: `null` means the
// server has not told us yet, and the control stays disabled there — because the
// compliance row is written WHOLESALE beside the jurisdiction, so a click from an
// unread state would post a placeholder regime over a saved one to flip an unrelated
// flag. Rendering OFF for an unread config would look identical to a workspace that
// chose OFF, which is the same defect the-compliance-posture-never-guesses closed for
// the jurisdiction itself.
//
//   node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --test app/features/hiring/decisions/decisionsRecordingOffer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { foldRecordingOffered } from "./decisionsComplianceFold.ts";

test("a read that never landed is UNKNOWN, never off", () => {
  assert.equal(foldRecordingOffered(false, null), null);
  assert.equal(foldRecordingOffered(false, { configs: { compliance: { interviewRecordingOffered: true } } }), null);
});

test("a landed read answers the stored flag, and ABSENT is off", () => {
  assert.equal(foldRecordingOffered(true, { configs: { compliance: { jurisdiction: "eu", interviewRecordingOffered: true } } }), true);
  assert.equal(foldRecordingOffered(true, { configs: { compliance: { jurisdiction: "eu", interviewRecordingOffered: false } } }), false);
  // The key is OMITTED by design on a workspace that never made the offer
  // (decision-config-schema.ts), so its absence is a real, read `false`.
  assert.equal(foldRecordingOffered(true, { configs: { compliance: { jurisdiction: "eu" } } }), false);
});

test("a body with no compliance section at all is UNKNOWN", () => {
  // Not `false`: a payload that carries no compliance config is a read that did not
  // answer the question, and the toggle must stay disabled rather than invite a write.
  assert.equal(foldRecordingOffered(true, { configs: {} }), null);
  assert.equal(foldRecordingOffered(true, {}), null);
  assert.equal(foldRecordingOffered(true, null), null);
  assert.equal(foldRecordingOffered(true, { configs: { compliance: null } }), null);
});

test("a non-boolean value is off, never truthy", () => {
  for (const junk of ["true", 1, {}, []]) {
    assert.equal(
      foldRecordingOffered(true, { configs: { compliance: { jurisdiction: "eu", interviewRecordingOffered: junk } } }),
      false,
      `${JSON.stringify(junk)} must not switch candidate audio on`
    );
  }
});
