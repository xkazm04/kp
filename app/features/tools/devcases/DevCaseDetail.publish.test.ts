import { test } from "node:test";
import assert from "node:assert/strict";
import { DEGRADED_REASONS, isDegradedPublish, canConfirmPublish, degradedReasons } from "./DevCaseDetail.publish.ts";

// bug-ui-scan-2026-07-09 (dev-case-authoring-publishing #3). The one-click Publish
// used to fire on a single unguarded click and stayed enabled on a known-degraded
// case. The gate below now requires a confirm step, and a DEGRADED case additionally
// requires an explicit acknowledgement. These pin that pure logic.

test("isDegradedPublish: true when EITHER the scenario or the seed fell back", () => {
  assert.equal(isDegradedPublish({ scenarioDegraded: false, seedDegraded: false }), false);
  assert.equal(isDegradedPublish({ scenarioDegraded: true, seedDegraded: false }), true);
  assert.equal(isDegradedPublish({ scenarioDegraded: false, seedDegraded: true }), true);
  assert.equal(isDegradedPublish({ scenarioDegraded: true, seedDegraded: true }), true);
});

test("canConfirmPublish: a HEALTHY case may publish from the confirm step alone", () => {
  // NON-VACUITY: pre-fix there was NO gate at all — the button fired publish on a
  // single click regardless of degraded state. A gate that blocked a healthy publish
  // (or allowed a degraded one un-acknowledged) would fail the assertions here.
  assert.equal(
    canConfirmPublish({ scenarioDegraded: false, seedDegraded: false, acknowledgedDegraded: false }),
    true,
    "a healthy case needs no extra acknowledgement",
  );
});

test("canConfirmPublish: a DEGRADED case is BLOCKED until acknowledged", () => {
  assert.equal(
    canConfirmPublish({ scenarioDegraded: true, seedDegraded: false, acknowledgedDegraded: false }),
    false,
    "degraded + not acknowledged → cannot publish",
  );
  assert.equal(
    canConfirmPublish({ scenarioDegraded: false, seedDegraded: true, acknowledgedDegraded: false }),
    false,
    "degraded seed + not acknowledged → cannot publish",
  );
  assert.equal(
    canConfirmPublish({ scenarioDegraded: true, seedDegraded: true, acknowledgedDegraded: true }),
    true,
    "degraded + explicitly acknowledged → may publish anyway",
  );
});

test("degradedReasons: lists exactly the failing halves", () => {
  assert.deepEqual(degradedReasons({ scenarioDegraded: false, seedDegraded: false }), []);
  assert.deepEqual(degradedReasons({ scenarioDegraded: true, seedDegraded: false }), ["scenario"]);
  assert.deepEqual(degradedReasons({ scenarioDegraded: false, seedDegraded: true }), ["seed"]);
  assert.deepEqual(degradedReasons({ scenarioDegraded: true, seedDegraded: true }), ["scenario", "seed"]);
});

test("degradedReasons returns CODES, never prose", () => {
  // This module is pure TS with no reader attached, so the two English sentences it
  // used to return were shipped verbatim into a four-locale product — and they were
  // also the last place on this surface that still called the entity a "case", where
  // no vocabulary guard could see them. The confirm dialog resolves each code through
  // `devcase.studio.degradedReason.<code>`; the set is covered ×4 locales in
  // devcase-studio-i18n.test.ts.
  for (const reason of degradedReasons({ scenarioDegraded: true, seedDegraded: true })) {
    assert.match(reason, /^[a-z]+$/, `"${reason}" reads like prose, not a machine code`);
    assert.ok(!reason.includes(" "), `"${reason}" reads like prose, not a machine code`);
  }
  assert.deepEqual([...DEGRADED_REASONS], ["scenario", "seed"]);
});
