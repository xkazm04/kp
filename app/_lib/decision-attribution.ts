// ANA3 — ONE auto/human attribution map for pipeline event kinds, imported by
// BOTH the DecisionLog badges (client) and the analytics automation rollup
// (server) so the per-row label and the aggregate can never drift. Extracted
// from DecisionLog's DECISION_META, then completed: the writers had outgrown
// the map (auto_rejected — the screening wave's own kind — plus scored, the
// comm/ack/reminder sends, manual moves, intake kinds…) and every unmapped kind
// rendered an UNKNOWN badge and fell out of any attribution math.
//
// Attribution semantics: `auto` = the system initiated the action (policy pass,
// fan-out, dispatched comm, sentinel); `human` = a person did (a recruiter
// click, a candidate reply). Browser-safe pure module — no DB imports.

export type DecisionMeta = { auto: boolean; tone: string };

export const DECISION_META: Record<string, DecisionMeta> = {
  // The advance split mirrors rejected/auto_rejected: actOnPipelineEntry writes
  // `advanced` for the human routes and `auto_advanced` when the caller passed
  // actor "system" — a recruiter's gate click must never badge AUTO in the log.
  advanced: { auto: false, tone: "text-moss" },
  auto_advanced: { auto: true, tone: "text-moss" },
  screening_hold: { auto: true, tone: "text-ink" },
  interview_scorecard: { auto: true, tone: "text-steel" },
  interview_prep_generated: { auto: true, tone: "text-steel" },
  offer_drafted: { auto: true, tone: "text-steel" },
  rematched: { auto: true, tone: "text-steel" },
  rematched_from: { auto: true, tone: "text-steel" },
  outreach_sent: { auto: true, tone: "text-steel" },
  rejection_sent: { auto: true, tone: "text-coral" },
  rejected: { auto: false, tone: "text-coral" },
  applied: { auto: false, tone: "text-steel" },
  re_applied: { auto: false, tone: "text-amber-600" },
  scheduled: { auto: false, tone: "text-steel" },
  interview_scheduled: { auto: false, tone: "text-moss" },
  offer_sent: { auto: false, tone: "text-steel" },
  offer_accepted: { auto: false, tone: "text-moss" },
  offer_declined: { auto: false, tone: "text-coral" },
  onboarding_started: { auto: false, tone: "text-moss" },
  // Completed coverage (previously UNKNOWN in the log, invisible to any rollup):
  auto_rejected: { auto: true, tone: "text-coral" },
  scored: { auto: true, tone: "text-steel" },
  acknowledgement_sent: { auto: true, tone: "text-steel" },
  interview_invite_sent: { auto: true, tone: "text-steel" },
  schedule_invite_sent: { auto: true, tone: "text-steel" },
  interview_reminder_sent: { auto: true, tone: "text-steel" },
  onboarding_failed: { auto: true, tone: "text-coral" },
  rejection_comms_failed: { auto: true, tone: "text-coral" },
  fairness_gate_unknown_archetype: { auto: true, tone: "text-coral" },
  observed_minted: { auto: true, tone: "text-steel" },
  matched: { auto: true, tone: "text-steel" },
  intake_degraded: { auto: true, tone: "text-coral" },
  comm_resent: { auto: false, tone: "text-steel" },
  moved: { auto: false, tone: "text-steel" },
  added: { auto: false, tone: "text-steel" },
  intake_resolved: { auto: false, tone: "text-moss" },
};

// Outcome state of one automation-pass decision (persisted in
// scheduler_runs.decisions_json). Rows persisted before the field existed are
// reconstructed from the reason prefixes executeAutomationPass has always
// written — the run history must distinguish an action that LANDED from one
// that failed, was CAS-skipped, or was refused by the fairness backstop.
export type DecisionOutcome = "applied" | "failed" | "skipped" | "fairness_blocked" | "queued";

const OUTCOMES: ReadonlySet<string> = new Set(["applied", "failed", "skipped", "fairness_blocked", "queued"]);

export function deriveDecisionOutcome(d: { outcome?: string; reason?: string }): DecisionOutcome {
  if (d.outcome && OUTCOMES.has(d.outcome)) return d.outcome as DecisionOutcome;
  const reason = d.reason ?? "";
  if (reason.startsWith("Apply failed:")) return "failed";
  if (reason.startsWith("Skipped:")) return "skipped";
  if (reason.startsWith("Auto-reject refused by fairness backstop") || reason.startsWith("Auto-reject would be refused by fairness backstop")) {
    return "fairness_blocked";
  }
  if (reason.startsWith("Queued for approval")) return "queued";
  return "applied";
}

// Three-state on purpose: in an auditable surface, defaulting an unrecognized
// kind to AUTO would misattribute accountability to the machine. Unknown kinds
// stay out of both badge labels and aggregate counts.
export function decisionAttribution(kind: string): "auto" | "human" | "unknown" {
  const meta = DECISION_META[kind];
  return meta ? (meta.auto ? "auto" : "human") : "unknown";
}

// The dispatched-communication kinds — what the rollup reports as "comms
// delivered". comm_resent counts too: a resend is a delivery (human-initiated,
// so it still lands in humanCount above).
export const COMM_SENT_KINDS = [
  "outreach_sent",
  "rejection_sent",
  "interview_invite_sent",
  "schedule_invite_sent",
  "interview_reminder_sent",
  "offer_sent",
  "acknowledgement_sent",
  "comm_resent",
] as const;

export type AutomationImpact = {
  autoCount: number;
  humanCount: number;
  autoAdvanced: number;
  autoRejected: number;
  // Distinct entries put on hold vs. those whose hold later got a decision
  // (advanced / rejected / auto-rejected after the first hold) — the "did a
  // human actually clear the queue the automation raised" signal.
  holdsRaised: number;
  holdsResolved: number;
  commsDelivered: number;
};

// Fold per-kind event counts through the attribution map. Pure — the DB layer
// supplies `kindCounts` (one GROUP BY kind) and the holds pair (its own
// per-entry query); everything else derives here, where it's testable.
export function summarizeAutomationImpact(
  kindCounts: Record<string, number>,
  holds: { raised: number; resolved: number }
): AutomationImpact {
  let autoCount = 0;
  let humanCount = 0;
  let commsDelivered = 0;
  const comms: ReadonlySet<string> = new Set(COMM_SENT_KINDS);
  for (const [kind, count] of Object.entries(kindCounts)) {
    const attribution = decisionAttribution(kind);
    if (attribution === "auto") autoCount += count;
    else if (attribution === "human") humanCount += count;
    if (comms.has(kind)) commsDelivered += count;
  }
  return {
    autoCount,
    humanCount,
    autoAdvanced: kindCounts["auto_advanced"] ?? 0,
    autoRejected: kindCounts["auto_rejected"] ?? 0,
    holdsRaised: holds.raised,
    holdsResolved: holds.resolved,
    commsDelivered,
  };
}
