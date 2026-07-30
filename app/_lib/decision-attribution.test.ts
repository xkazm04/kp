import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_ALERT_KINDS,
  COMM_SENT_KINDS,
  DECISION_META,
  decisionAttribution,
  summarizeAutomationImpact,
  parseCohortProvenance,
  parseSealTraceability,
  matchCohortProvenance,
  sealedReasonOf,
  parseRematchCounterpartId,
  waveReasonText,
  GROUP_EVAL_JOIN_WINDOW_MS,
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
    "interviewer_brief_sent", "interviewer_brief_skipped", "onboarding_reminder_sent",
    "outreach_sent", "rejection_sent", "rejection_comms_failed",
    "acknowledgement_sent", "comm_resent", "offer_drafted", "offer_sent",
    "offer_accepted", "offer_declined", "offer_expired", "onboarding_started", "onboarding_failed",
    "rematched", "rematched_from", "fairness_gate_unknown_archetype", "observed_minted",
    "ko_declined", "role_reopened", "reinstated",
    // group-eval-event-anchor — the comparative eval seals a lead/advisory record AND
    // writes a `group_eval` pipeline event at seal time (group-eval-run.ts). Without a
    // DECISION_META mapping it rendered UNKNOWN in the log and fell out of the rollup.
    "group_eval",
    // Policy-pass alert kinds — derived from the shared source the writer itself
    // consumes (not a hand-copied literal), so a NEW alert kind forces a
    // DECISION_META mapping instead of silently rendering UNKNOWN and falling out of
    // the attribution rollup (bug-ui-scan §hiring-automation #4).
    ...AUTOMATION_ALERT_KINDS,
  ];
  for (const kind of written) {
    assert.ok(DECISION_META[kind], `${kind} is written but unmapped — add it to DECISION_META`);
  }
});

test("every policy-pass alert kind attributes to automation (never UNKNOWN)", () => {
  // aging_alert / stale_alert (evaluate_entry) + fairness_gate_blocked_reject (the
  // fairness backstop) are automation-authored — they must fold into the auto count,
  // not render an UNKNOWN badge and vanish from the rollup.
  for (const kind of AUTOMATION_ALERT_KINDS) {
    assert.equal(decisionAttribution(kind), "auto", `${kind} must attribute to automation`);
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

// ---- log-tells-the-whole-story: the sealed-record joins --------------------------

const groupEvalPayload = (o: Record<string, unknown>) => JSON.stringify({ inputs: o });

test("parseCohortProvenance reads selection/top provenance and rejects bad shapes", () => {
  assert.deepEqual(
    parseCohortProvenance(groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 })),
    { source: "selection", compared: 4, field: 12 }
  );
  assert.deepEqual(
    parseCohortProvenance(groupEvalPayload({ cohortSource: "top", candidates: 8, cohortSize: 8 })),
    { source: "top", compared: 8, field: 8 }
  );
  // Missing / invalid provenance → null (never a fabricated cohort).
  assert.equal(parseCohortProvenance(groupEvalPayload({ candidates: 4, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance(groupEvalPayload({ cohortSource: "bogus", candidates: 4, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance(groupEvalPayload({ cohortSource: "top", candidates: 0, cohortSize: 12 })), null);
  assert.equal(parseCohortProvenance("not json"), null);
});

// W0.3 — Art. 12 traceability: a sealed group-eval record must be reconstructible, i.e.
// carry the prompt version that produced the reasoning and the model's own words about
// the lead it crowned. Before this, both were computed and discarded.
test("parseSealTraceability reads the prompt version and the lead's raw model reasoning", () => {
  const t = parseSealTraceability(
    groupEvalPayload({
      cohortSource: "top",
      candidates: 4,
      cohortSize: 9,
      promptVersion: ["match-reasoning-v2"],
      leadReasoning: { verdict: "Strongest on payments depth", strengths: ["ran a migration"], gaps: ["no K8s"] },
    })
  );
  assert.deepEqual(t, {
    promptVersion: ["match-reasoning-v2"],
    leadReasoning: { verdict: "Strongest on payments depth", strengths: ["ran a migration"], gaps: ["no K8s"] },
  });
});

test("parseSealTraceability keeps a MIXED prompt-version set rather than collapsing it", () => {
  // A cache straddling a prompt bump legitimately produces two; reporting one would
  // claim a single prompt ranked the cohort when two did.
  const t = parseSealTraceability(groupEvalPayload({ promptVersion: ["match-reasoning-v1", "match-reasoning-v2"] }));
  assert.deepEqual(t?.promptVersion, ["match-reasoning-v1", "match-reasoning-v2"]);
  assert.equal(t?.leadReasoning, null);
});

test("parseSealTraceability reports ABSENCE rather than an empty shell", () => {
  // Pre-W0.3 seals, and deterministic runs where no model spoke: "not recorded" must be
  // distinguishable from "recorded, and the model said nothing".
  assert.equal(parseSealTraceability(groupEvalPayload({ cohortSource: "top", candidates: 4, cohortSize: 9 })), null);
  assert.equal(parseSealTraceability(groupEvalPayload({ promptVersion: [], leadReasoning: { verdict: "", strengths: [], gaps: [] } })), null);
  assert.equal(parseSealTraceability("not json"), null);
});

test("parseSealTraceability ignores non-string junk inside the reasoning arrays", () => {
  const t = parseSealTraceability(
    groupEvalPayload({ promptVersion: ["v2", 7, null], leadReasoning: { verdict: 5, strengths: ["ok", {}], gaps: null } })
  );
  assert.deepEqual(t?.promptVersion, ["v2"]);
  assert.deepEqual(t?.leadReasoning, { verdict: "", strengths: ["ok"], gaps: [] });
});

test("matchCohortProvenance picks the nearest group-eval record within the window", () => {
  const t0 = "2026-07-15T12:00:00.000Z";
  const near = { kind: "group_eval_lead", reasonCode: "lead", createdAt: "2026-07-15T12:05:00.000Z", payloadJson: groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 }) };
  const far = { kind: "group_eval_advisory", reasonCode: "advisory", createdAt: "2026-07-15T11:30:00.000Z", payloadJson: groupEvalPayload({ cohortSource: "top", candidates: 6, cohortSize: 20 }) };
  // Nearest (5 min) wins over the 30-min-away record.
  assert.deepEqual(matchCohortProvenance(t0, [far, near]), { source: "selection", compared: 4, field: 12 });
  // A non-eval record for the same candidate is ignored.
  const noise = { kind: "auto_rejected", reasonCode: "reject", createdAt: t0, payloadJson: groupEvalPayload({ cohortSource: "selection", candidates: 4, cohortSize: 12 }) };
  assert.equal(matchCohortProvenance(t0, [noise]), null);
  // Outside the window → no match (never guess a stale eval).
  const stale = { ...near, createdAt: new Date(Date.parse(t0) + GROUP_EVAL_JOIN_WINDOW_MS + 1000).toISOString() };
  assert.equal(matchCohortProvenance(t0, [stale]), null);
});

test("sealedReasonOf returns the latest reason of a kind with its params", () => {
  const records = [
    { kind: "auto_rejected", reasonCode: "reject", createdAt: "t2", payloadJson: groupEvalPayload({ pct: 20, n: 10, count: 2, rank: 9, score: 41, threshold: 55, tieAdjusted: 0 }) },
    { kind: "scored", reasonCode: "", createdAt: "t1", payloadJson: "{}" },
  ];
  assert.deepEqual(sealedReasonOf(records, "auto_rejected"), {
    reasonCode: "reject",
    reasonParams: { pct: 20, n: 10, count: 2, rank: 9, score: 41, threshold: 55, tieAdjusted: 0 },
  });
  assert.equal(sealedReasonOf(records, "group_eval_lead"), null);
});

test("parseRematchCounterpartId parses both writers' detail formats", () => {
  // rematched (source side): "<srcJob> -> <tgtJob> (<targetEntryId>)"
  assert.equal(parseRematchCounterpartId("rematched", "job_a -> job_b (entry_tgt)"), "entry_tgt");
  // rematched_from (target side): "<priorEntryId> (<priorJobId>)"
  assert.equal(parseRematchCounterpartId("rematched_from", "entry_prior (job_a)"), "entry_prior");
  // Unparseable / wrong kind → null (honest plain text downstream).
  assert.equal(parseRematchCounterpartId("rematched", "malformed"), null);
  assert.equal(parseRematchCounterpartId("advanced", "entry_x (job_a)"), null);
});

test("waveReasonText localizes through a decisions.wave translator, null for unmapped", () => {
  // A fake next-intl translator scoped to decisions.wave.
  const catalog: Record<string, string> = {
    "reasons.rejectDid": "Auto-rejected · bottom {pct}% of {n}.",
    "reasons.tieAdjustedNote": "(tie-adjusted from {from})",
    "reasons.aboveCutoff": "above the bottom cutoff",
  };
  const t = ((key: string, params?: Record<string, string | number>) =>
    (catalog[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ""))) as never;
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in catalog;

  assert.equal(
    waveReasonText(t, { reasonCode: "reject", reasonParams: { pct: 20, n: 10, tieAdjusted: 8 } }),
    "Auto-rejected · bottom 20% of 10. (tie-adjusted from 8)"
  );
  assert.equal(waveReasonText(t, { reasonCode: "aboveCutoff", reasonParams: {} }), "above the bottom cutoff");
  assert.equal(waveReasonText(t, { reasonCode: "unmapped_code", reasonParams: {} }), null);
});
