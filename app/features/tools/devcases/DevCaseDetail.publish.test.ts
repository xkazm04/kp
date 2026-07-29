import { test } from "node:test";
import assert from "node:assert/strict";
import { isDegradedPublish, canConfirmPublish, degradedReasons } from "./DevCaseDetail.publish.ts";

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
  assert.equal(degradedReasons({ scenarioDegraded: true, seedDegraded: false }).length, 1);
  assert.equal(degradedReasons({ scenarioDegraded: true, seedDegraded: true }).length, 2);
});
