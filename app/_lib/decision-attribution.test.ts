import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMM_SENT_KINDS,
  DECISION_META,
  decisionAttribution,
  summarizeAutomationImpact,
} from "./decision-attribution.ts";

test("attribution is three-state and never defaults an unknown kind to auto", () => {
  assert.equal(decisionAttribution("auto_rejected"), "auto");
  assert.equal(decisionAttribution("rejected"), "human");
  assert.equal(decisionAttribution("some_future_kind"), "unknown");
});

test("every comm-sent kind is a mapped kind (a delivery always has an attribution)", () => {
  for (const kind of COMM_SENT_KINDS) {
    assert.notEqual(decisionAttribution(kind), "unknown", `${kind} must be in DECISION_META`);
  }
});

test("the kinds the writers produce are all mapped (the drift this module exists to stop)", () => {
  // recordAutomationEvent call sites + db.ts recordEvent writers, as of W9-3.
  const written = [
    "matched", "added", "applied", "re_applied", "scored", "advanced", "auto_advanced", "moved",
    "scheduled", "rejected", "auto_rejected", "intake_degraded", "intake_resolved",
    "screening_hold", "interview_scorecard", "interview_prep_generated",
    "interview_scheduled", "interview_invite_sent", "schedule_invite_sent", "interview_reminder_sent",
    "outreach_sent", "rejection_sent", "rejection_comms_failed",
    "acknowledgement_sent", "comm_resent", "offer_drafted", "offer_sent",
    "offer_accepted", "offer_declined", "offer_expired", "onboarding_started", "onboarding_failed",
    "rematched", "rematched_from", "fairness_gate_unknown_archetype", "observed_minted",
    "ko_declined",
  ];
  for (const kind of written) {
    assert.ok(DECISION_META[kind], `${kind} is written but unmapped — add it to DECISION_META`);
  }
});

test("summarize folds counts through attribution and skips unknown kinds", () => {
  const impact = summarizeAutomationImpact(
    {
      advanced: 5,
      auto_advanced: 7,
      auto_rejected: 3,
      outreach_sent: 4,
      comm_resent: 1,
      rejected: 2,
      some_future_kind: 99,
    },
    { raised: 6, resolved: 4 }
  );
  // The actor split: a recruiter's gate click (`advanced`) is HUMAN; only the
  // policy/automation writers' `auto_advanced` credits the machine.
  // auto: auto_advanced 7 + auto_rejected 3 + outreach_sent 4 = 14;
  // human: advanced 5 + rejected 2 + comm_resent 1 = 8.
  assert.equal(impact.autoCount, 14);
  assert.equal(impact.humanCount, 8);
  assert.equal(impact.autoAdvanced, 7);
  assert.equal(impact.autoRejected, 3);
  assert.equal(impact.commsDelivered, 5); // outreach 4 + resend 1
  assert.equal(impact.holdsRaised, 6);
  assert.equal(impact.holdsResolved, 4);
});

test("summarize on an empty window is all zeros", () => {
  const impact = summarizeAutomationImpact({}, { raised: 0, resolved: 0 });
  assert.deepEqual(impact, {
    autoCount: 0,
    humanCount: 0,
    autoAdvanced: 0,
    autoRejected: 0,
    holdsRaised: 0,
    holdsResolved: 0,
    commsDelivered: 0,
  });
});
