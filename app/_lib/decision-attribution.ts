// ANA3 — ONE auto/human attribution map for pipeline event kinds, imported by
// BOTH the DecisionLog badges (client) and the analytics automation rollup
// (server) so the per-row label and the aggregate can never drift. Extracted
// from DecisionLog's DECISION_META, then completed: the writers had outgrown
// the map (auto_rejected — the screening wave's own kind — plus scored, the
// comm/ack/reminder sends, manual moves, intake kinds…) and every unmapped kind
// rendered an UNKNOWN badge and fell out of any attribution math.
//
import { parseRematchDetail } from "@/app/features/shared/pipelineRematchLink";

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
  // W2.3 — the two ways an outreach does NOT go out. Both are automated refusals, and
  // both must render in the log: "we chose not to contact this person" is a decision, and
  // an unmapped kind renders UNKNOWN and drops out of the attribution rollup entirely.
  outreach_halted: { auto: true, tone: "text-steel" },
  outreach_suppressed: { auto: true, tone: "text-amber-600" },
  rejection_sent: { auto: true, tone: "text-coral" },
  rejected: { auto: false, tone: "text-coral" },
  applied: { auto: false, tone: "text-steel" },
  re_applied: { auto: false, tone: "text-amber-600" },
  scheduled: { auto: false, tone: "text-steel" },
  interview_scheduled: { auto: false, tone: "text-moss" },
  offer_sent: { auto: false, tone: "text-steel" },
  offer_accepted: { auto: false, tone: "text-moss" },
  offer_declined: { auto: false, tone: "text-coral" },
  // Lapsed offer (deadline passed with no candidate response) — a SYSTEM transition
  // (auto), terminal-negative. Without this it rendered UNKNOWN + fell out of rollups.
  offer_expired: { auto: true, tone: "text-amber-600" },
  // Unattended offer extension (automation-run.ts:373, "offer gate: auto") — the machine
  // put an offer in front of a person with no human in the loop. Amber, not steel: an
  // unattended offer is the automation event a reviewer most wants to notice.
  offer_auto_extended: { auto: true, tone: "text-amber-600" },
  // An acceptance that could NOT be honoured (offer-finalize.ts:99 — accepted on a closed
  // entry, so never advanced to Hired). A machine refusal, and one a recruiter must chase.
  offer_accept_blocked: { auto: true, tone: "text-amber-600" },
  // Completed coverage (previously UNKNOWN in the log, invisible to any rollup):
  auto_rejected: { auto: true, tone: "text-coral" },
  // The calibration clean arm's marker (screen-wave.ts:325): the wave DECLINED to
  // auto-reject someone in order to keep an uncontaminated comparison group. Sparing a
  // candidate is a machine decision about that candidate, so it belongs in the operator's
  // audit trail with an attribution. (It stays excluded from the CANDIDATE-facing copy —
  // status-decisions.ts:44 — which is a separate, deliberate projection decision.)
  screen_wave_holdout: { auto: true, tone: "text-steel" },
  // Entry-less KO-gate discards (recordKnockoutDecline) — without a mapping each
  // one rendered an UNKNOWN badge, fell out of the kind filter and the rollup.
  ko_declined: { auto: true, tone: "text-coral" },
  scored: { auto: true, tone: "text-steel" },
  acknowledgement_sent: { auto: true, tone: "text-steel" },
  interview_invite_sent: { auto: true, tone: "text-steel" },
  schedule_invite_sent: { auto: true, tone: "text-steel" },
  interview_reminder_sent: { auto: true, tone: "text-steel" },
  // Interviewer brief (interview-prep #2): the assigned interviewer is emailed the
  // prep pack + an .ics hold on booking. `skipped` = assigned but no deliverable
  // address, so the brief never went — a gap the recruiter must close.
  interviewer_brief_sent: { auto: true, tone: "text-steel" },
  interviewer_brief_skipped: { auto: true, tone: "text-amber-600" },
  // The offer-deadline nudge the sweep dispatches (comms-dispatch.ts:588). A live writer
  // that reached the log as NEZNÁMÉ and counted in no rollup — including `commsDelivered`,
  // even though it is a real message to a real candidate (see COMM_SENT_KINDS below).
  offer_reminder_sent: { auto: true, tone: "text-steel" },
  // The generated rejection draft, sibling of offer_drafted (automation-run.ts).
  rejection_drafted: { auto: true, tone: "text-steel" },
  rejection_comms_failed: { auto: true, tone: "text-coral" },
  // Its offer-side sibling (pipeline-entry-action.ts): the offer was drafted and an
  // offer row minted, but the message did not go out, so the approval is left open
  // and re-approving re-sends the SAME link. Marked auto like every other
  // comms-failure marker: the delivery attempt the machine made is what failed, not
  // the recruiter's decision, which stands and is sealed on its own.
  offer_comms_failed: { auto: true, tone: "text-coral" },
  fairness_gate_unknown_archetype: { auto: true, tone: "text-coral" },
  // Policy-pass ALERT kinds (AUTOMATION_ALERT_KINDS below) — automation-authored
  // nudges + the fairness backstop's downgrade signal, written via
  // recordAutomationEvent's alert loop. Previously UNMAPPED: they rendered an
  // UNKNOWN badge and fell out of every attribution rollup, and the writer-coverage
  // test's hardcoded list hid the gap (bug-ui-scan §hiring-automation #4).
  aging_alert: { auto: true, tone: "text-amber-600" },
  stale_alert: { auto: true, tone: "text-amber-600" },
  fairness_gate_blocked_reject: { auto: true, tone: "text-coral" },
  observed_minted: { auto: true, tone: "text-steel" },
  matched: { auto: true, tone: "text-steel" },
  intake_degraded: { auto: true, tone: "text-coral" },
  comm_resent: { auto: false, tone: "text-steel" },
  moved: { auto: false, tone: "text-steel" },
  added: { auto: false, tone: "text-steel" },
  intake_resolved: { auto: false, tone: "text-moss" },
  // A recruiter reopening a closed role restores the candidates that role's close
  // withdrew — a HUMAN-initiated, positive restoration. Without a mapping it
  // rendered UNKNOWN in the decision log and fell out of any attribution rollup.
  role_reopened: { auto: false, tone: "text-moss" },
  // A recruiter reversing an auto-rejection (reconsider queue → reinstate): the
  // HUMAN counterweight to the machine's `auto_rejected`, and sealed into the same
  // tamper-evident chain (pipeline/[id] reinstate route). Attributed to the human
  // who overturned it — NEVER the machine — and tone-positive like the restoration
  // it is. Without this it rendered UNKNOWN and the reversal vanished from the
  // audit rollups even though its inverse (auto_rejected) was counted.
  reinstated: { auto: false, tone: "text-moss" },
  // UAT LUC-ANA-6 — the HUMAN-OVERSIGHT HAND-OFF (pipeline-entry-action.ts:267), and the
  // single row an Art. 22 reviewer looks for first. It was unmapped: NEZNÁMÉ in the log,
  // absent from both filters, in no rollup — the one event proving a person took the
  // wheel was the one the audit surface could not show.
  //
  // Attributed to the HUMAN on purpose, and it is not a close call in the direction that
  // matters (G6 — fail AWAY from the machine): it is written inside a recruiter's own
  // `accept` on an AI scorecard, and the seal emitted beside it on the same line already
  // credits `human:recruiter`. The plan chose the next GATE; the person chose to accept.
  human_round_queued: { auto: false, tone: "text-moss" },
  // A board-shape change (Settings → Hiring dropped a step) relocating everyone standing
  // on it. The move is executed by the system, but nobody decided anything about THIS
  // candidate — the accountable act is the operator's board edit, so it credits the human.
  stage_migrated: { auto: false, tone: "text-amber-600" },
  // Recruiter-authored record-keeping on a candidate: the disposition on a saved
  // analysis, a practice interview noted, GitHub evidence attached, an ATS export.
  disposition_set: { auto: false, tone: "text-steel" },
  sim_attached: { auto: false, tone: "text-steel" },
  github_evidence_attached: { auto: false, tone: "text-steel" },
  ats_export: { auto: false, tone: "text-steel" },
  // Role lifecycle — the twin of role_reopened, which was mapped while the close was not.
  role_closed: { auto: false, tone: "text-steel" },
  // The candidate answering their own profile gaps (api/apply/[id]/followup). `human`
  // covers a candidate's act as much as a recruiter's — see the semantics note above.
  profile_enriched: { auto: false, tone: "text-moss" },
  // Agent bridge: the operator dispatches a persona request to Personas (human), and
  // Personas calls back on its token route when the persona goes live (machine).
  agent_dispatched: { auto: false, tone: "text-steel" },
  agent_activated: { auto: true, tone: "text-moss" },
  // RETIRED WRITERS (see RETIRED_EVENT_KINDS) — the post-hire onboarding module is gone,
  // so nothing can write these again. They are MAPPED rather than filtered because the
  // rows are still in deployed databases (the seeded host has both), and an audit trail
  // that hides rows it no longer has a writer for is worse than one that labels them: a
  // dropped feature must not silently un-attribute history. The attributions are the
  // ones the writers had — the hand-off was recruiter-initiated, the intake was the
  // candidate's own submission.
  onboarding_started: { auto: false, tone: "text-moss" },
  onboarding_intake_submitted: { auto: false, tone: "text-steel" },
  // The comparative group evaluation itself (group-eval-event-anchor): group-eval seals
  // a group_eval_lead/advisory RECORD and now also writes a `group_eval` pipeline event
  // at seal time, keyed on the lead's entry. The eval is SYSTEM-initiated (auto) — a
  // background task synthesizing a ranking — so it credits the machine, not the recruiter
  // who opened the modal. Steel (neutral-informational): it informs a decision, it is not
  // itself an advance/reject. Without a mapping the event rendered UNKNOWN in the log and
  // fell out of every attribution rollup.
  group_eval: { auto: true, tone: "text-steel" },
};

// Policy-pass ALERT kinds — the aging/stale nudges evaluate_entry emits
// (pipeline/jobfit/automation.py) plus the TS fairness backstop's downgrade
// (FAIRNESS_BLOCKED_REJECT_ALERT). They flow through recordAutomationEvent's alert
// loop, so they are automation-authored (auto:true above). Exported as the ONE
// source of truth: automation-pass.ts consumes FAIRNESS_GATE_BLOCKED_REJECT from
// here, and decision-attribution.test.ts derives its writer-coverage list from
// AUTOMATION_ALERT_KINDS — so a new alert kind can't be written without a
// DECISION_META mapping (the drift this module exists to stop).
export const FAIRNESS_GATE_BLOCKED_REJECT = "fairness_gate_blocked_reject";
export const AUTOMATION_ALERT_KINDS = ["aging_alert", "stale_alert", FAIRNESS_GATE_BLOCKED_REJECT] as const;

// UAT LUC-ANA-6 — kinds that are MAPPED but have no live writer any more: the feature
// that wrote them was removed while its rows stayed in deployed databases. Declaring them
// here is the difference between "we decided to keep labelling these" and "nobody
// noticed": decision-attribution.test.ts asserts every member is still mapped AND that
// none of them has a writer again (a resurrected kind must be re-argued, not inherited).
//
// Removing a feature therefore has an explicit third option beside "map" and "forget":
// move its kinds here. Deleting a mapping outright is what produced this finding — the
// onboarding removal took `onboarding_started` out of DECISION_META and left one row of
// it in the seeded workspace, badging NEZNÁMÉ.
export const RETIRED_EVENT_KINDS = ["onboarding_started", "onboarding_intake_submitted"] as const;

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

/** The decision log's two column filters (Rozhodnutí = kind, Kdo = attribution) resolved
 *  to ONE kind set — the INTERSECTION, never a winner.
 *
 *  UAT LUC-ANA-12: the route used to read `if (kind) … else if (attribution)`, so a kind
 *  filter silently discarded the attribution filter while ColumnFilter kept that column's
 *  active dot lit. Lives here, beside the map it reads, so the semantics are unit-pinned
 *  rather than buried in a route handler nothing can call without a DB.
 *
 *  `matchesNothing` is the outcome an "empty kind list" cannot express: a contradictory
 *  pair (kind "advanced" + attribution "auto") selects NO rows, and the store reads an
 *  empty IN-list as "unfiltered" — so the caller must answer an empty page itself rather
 *  than pass one down. An unrecognized value on either axis is ignored (that axis is
 *  simply not applied), never an error and never a silent full-table read of the other. */
export type DecisionKindFilter = { kinds?: string[]; matchesNothing: boolean };

export function resolveDecisionKindFilter(kindRaw: string | null, attributionRaw: string | null): DecisionKindFilter {
  const kind = kindRaw && kindRaw in DECISION_META ? kindRaw : null;
  const attribution = attributionRaw === "auto" || attributionRaw === "human" ? attributionRaw : null;
  if (kind && attribution) {
    return DECISION_META[kind].auto === (attribution === "auto")
      ? { kinds: [kind], matchesNothing: false }
      : { matchesNothing: true };
  }
  if (kind) return { kinds: [kind], matchesNothing: false };
  if (attribution) {
    return {
      kinds: Object.entries(DECISION_META)
        .filter(([, meta]) => meta.auto === (attribution === "auto"))
        .map(([k]) => k),
      matchesNothing: false,
    };
  }
  return { matchesNothing: false };
}

// Minimal structural shape of a next-intl `analytics.log`-namespace translator
// (the value from `useTranslations("analytics.log")`). Generic over the next-intl
// `Translator` (whose call signature only accepts its own message keys, not a
// bare string) so this pure module stays free of a next-intl import; the loose
// `key: string` is cast to the translator's key type internally.
type KindTranslator = { (key: never): string };

// The dispatched-communication kinds — what the rollup reports as "comms
// delivered". comm_resent counts too: a resend is a delivery (human-initiated,
// so it still lands in humanCount above).
export const COMM_SENT_KINDS = [
  "outreach_sent",
  "rejection_sent",
  "interview_invite_sent",
  "schedule_invite_sent",
  "interview_reminder_sent",
  "interviewer_brief_sent",
  // UAT LUC-ANA-6 — the offer-deadline nudge is a dispatched candidate message like any
  // other, so it counts as a delivery in the rollup and takes the honest
  // `kindsQueued.*` label when no relay is configured. It was in neither list.
  "offer_reminder_sent",
  "offer_sent",
  "acknowledgement_sent",
  "comm_resent",
] as const;

const COMM_SENT_SET: ReadonlySet<string> = new Set(COMM_SENT_KINDS);

// ONE "decision kind -> human label" resolver, shared by the DecisionLog rows /
// CSV / filter and the RoiLedger CSV (ANA). A kind present in DECISION_META reads
// its `kinds.<kind>` catalog entry; an unmapped kind degrades to the de-snaked raw
// value (instead of rendering the raw catalog KEY or throwing). Callers pass their
// own `analytics.log` translator instance so the namespace is resolved once.
//
// REC-10 honesty: the historical `*_sent` labels ("Rejection sent", "Offer
// sent") claim a delivery the channel layer never performs when no relay is
// configured — every message is then a terminal `queued` row in the local
// outbox. Callers that know the capability bit (useDeliveryCapability /
// isRelayConfigured) pass it in: a definite `false` swaps every dispatched-comm
// kind to its `kindsQueued.<kind>` variant ("… recorded in Outbox — not
// delivered"). `true`/unknown keeps the classic labels — never accuse a
// configured relay of dropping mail. The variant catalog is membership-locked
// by comms-truth.test.ts.
export function kindLabel<T extends KindTranslator>(
  t: T,
  kind: string,
  opts?: { relayConfigured?: boolean | null }
): string {
  if (kind in DECISION_META) {
    if (opts?.relayConfigured === false && COMM_SENT_SET.has(kind)) {
      return t(`kindsQueued.${kind}` as Parameters<T>[0]);
    }
    return t(`kinds.${kind}` as Parameters<T>[0]);
  }
  return kind.replace(/_/g, " ");
}

// ---- log-tells-the-whole-story: sealed-record joins for the decision log ----------
//
// Three structural blind spots in the decision log are closed by JOINING the log's
// pipeline_events rows to the sealed decision-record store (per candidateRef), never
// by adding event columns. These pure helpers hold the join/parse/localize logic so
// the route stays a thin DB-orchestration shell and the honesty rules are unit-pinned.

// (a) Group-eval cohort provenance. group-eval seals a `group_eval_lead` /
// `group_eval_advisory` record (candidateRef = the crowned lead's entry id) whose
// inputs carry cohortSource ("selection" | "top") + cohortSize (the full field) and
// `candidates` (the compared cohort). A lead crowned over a recruiter-picked four ≠
// one crowned over the whole fit-ranked field — this makes that provenance visible.
export type CohortProvenance = { source: "selection" | "top"; compared: number; field: number };

// The sealed record kinds that carry cohort provenance.
const GROUP_EVAL_RECORD_KINDS: ReadonlySet<string> = new Set(["group_eval_lead", "group_eval_advisory"]);

// The LOG-row kinds a group-eval decision manifests as: the crowned lead being moved
// forward. Gating to these kinds means an unrelated event for the same candidate can
// never inherit a provenance it didn't produce (never guess).
export const GROUP_EVAL_OUTCOME_KINDS: ReadonlySet<string> = new Set(["advanced", "auto_advanced"]);

// group-eval-event-anchor — the DIRECT provenance anchor. group-eval now writes a
// `group_eval` pipeline event at seal time (group-eval-run.ts, BOTH the recommendation
// and advisory branches), keyed on the lead's entry. Because that event is written in the
// same call as the sealed group_eval_lead/advisory record, matchCohortProvenance over the
// event's OWN createdAt resolves the cohort at a ~0-delta match — a deterministic anchor,
// not a time-window guess. It also gives provenance a visible log row when the lead is
// never advanced (an advisory/committee run) or is advanced hours later by someone else —
// the two blind spots the advance-only window join could not cover.
//
// PRECEDENCE (implemented in api/analytics/decisions enrichPage): a group_eval EVENT row
// is enriched DIRECTLY from its own seal moment. An advance OUTCOME row PREFERS that direct
// anchor — when its entry has a group_eval event, the advance row does NOT window-join
// (the group_eval row already carries the chip; a duplicate/possibly-mismatched chip is
// avoided). It falls back to the 6h nearest-seal window ONLY for pre-existing data: leads
// advanced before this event kind existed, whose sole provenance signal is the old window.
export const GROUP_EVAL_EVENT_KIND = "group_eval";

// Proximity window for the group-eval FALLBACK join (pre-existing data with no direct
// anchor). The crowned lead is advanced in the same review session as the eval; a wider
// window would risk pairing an unrelated later advance with a stale eval. Nearest sealed
// record within the window wins.
export const GROUP_EVAL_JOIN_WINDOW_MS = 6 * 60 * 60 * 1000;

/** Read cohort provenance out of a sealed record's payload_json, or null when the
 *  shape is absent/invalid (older seals, non-eval kinds) — so a malformed record shows
 *  nothing rather than a fabricated cohort. */
export function parseCohortProvenance(payloadJson: string): CohortProvenance | null {
  let inputs: unknown;
  try {
    inputs = (JSON.parse(payloadJson) as { inputs?: unknown }).inputs;
  } catch {
    return null;
  }
  if (!inputs || typeof inputs !== "object") return null;
  const o = inputs as Record<string, unknown>;
  const source = o.cohortSource;
  if (source !== "selection" && source !== "top") return null;
  const field = Number(o.cohortSize);
  const compared = Number(o.candidates);
  if (!Number.isFinite(field) || field <= 0) return null;
  if (!Number.isFinite(compared) || compared <= 0) return null;
  return { source, compared, field };
}

// (a2) AI Act Art. 12 traceability (W0.3). A sealed group-eval record states the
// OUTCOME (who led, over what cohort, how separated). Reconstructing the decision also
// needs the two things that produced it: WHICH prompt version generated the reasoning,
// and what the model actually SAID about the candidate it crowned. Both are now written
// into `inputs` at seal time (group-eval-run.ts); this reads them back.
//
// Absent on pre-W0.3 seals and on runs where no LLM produced reasoning — the honest
// answer there is "not recorded", never a reconstruction after the fact, so the parser
// returns null rather than inventing an empty-but-present block.
export type SealTraceability = {
  /** Reasoning prompt version(s) behind the cohort. Plural: a cache straddling a prompt
   *  bump can legitimately mix two, and collapsing that would misreport the record. */
  promptVersion: string[];
  /** The model's own words for the crowned lead, verbatim (clipped at seal time). */
  leadReasoning: { verdict: string; strengths: string[]; gaps: string[] } | null;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/** Read Art. 12 traceability out of a sealed record's payload_json, or null when the
 *  record predates it / carried no model reasoning. */
export function parseSealTraceability(payloadJson: string): SealTraceability | null {
  let inputs: unknown;
  try {
    inputs = (JSON.parse(payloadJson) as { inputs?: unknown }).inputs;
  } catch {
    return null;
  }
  if (!inputs || typeof inputs !== "object") return null;
  const o = inputs as Record<string, unknown>;
  const promptVersion = strList(o.promptVersion);
  const lr = o.leadReasoning;
  const leadReasoning =
    lr && typeof lr === "object"
      ? {
          verdict: typeof (lr as Record<string, unknown>).verdict === "string" ? ((lr as Record<string, unknown>).verdict as string) : "",
          strengths: strList((lr as Record<string, unknown>).strengths),
          gaps: strList((lr as Record<string, unknown>).gaps),
        }
      : null;
  // A block with neither a prompt version nor any model text carries no traceability —
  // report its absence instead of an empty shell that reads as "recorded, but blank".
  const hasReasoning = !!leadReasoning && (leadReasoning.verdict !== "" || leadReasoning.strengths.length > 0 || leadReasoning.gaps.length > 0);
  if (promptVersion.length === 0 && !hasReasoning) return null;
  return { promptVersion, leadReasoning: hasReasoning ? leadReasoning : null };
}

// The minimal structural shape of a sealed record this module needs — declared
// locally so this pure module never imports the server-side decision-record-store.
type SealedRecordLike = { kind: string; reasonCode: string; createdAt: string; payloadJson: string };

/** Nearest group-eval record (by |Δt|) to an event, within `windowMs`, or null. Pure
 *  over (eventCreatedAt, records) so the join is testable without a DB. */
export function matchCohortProvenance(
  eventCreatedAt: string,
  records: readonly SealedRecordLike[],
  windowMs: number = GROUP_EVAL_JOIN_WINDOW_MS
): CohortProvenance | null {
  const et = Date.parse(eventCreatedAt);
  if (Number.isNaN(et)) return null;
  let best: CohortProvenance | null = null;
  let bestDelta = Infinity;
  for (const r of records) {
    if (!GROUP_EVAL_RECORD_KINDS.has(r.kind)) continue;
    const rt = Date.parse(r.createdAt);
    if (Number.isNaN(rt)) continue;
    const delta = Math.abs(rt - et);
    if (delta > windowMs || delta >= bestDelta) continue;
    const prov = parseCohortProvenance(r.payloadJson);
    if (!prov) continue;
    best = prov;
    bestDelta = delta;
  }
  return best;
}

// (b) The sealed auto-reject reason. The screen wave seals an `auto_rejected` record
// carrying reasonCode "reject" + the decisive numbers (reasonParams). The reconsider
// queue already reads this; the log row saw only the free-text detail.
export type SealedReason = { reasonCode: string; reasonParams: Record<string, string | number> };

/** The latest sealed reason for `forKind` among a candidate's records (records arrive
 *  seq-DESC, so the first match is the most recent), or null. Same read the reconsider
 *  route does — reasonCode + the record's inputs as the interpolation params. */
export function sealedReasonOf(records: readonly SealedRecordLike[], forKind: string): SealedReason | null {
  const rec = records.find((r) => r.kind === forKind);
  if (!rec) return null;
  let params: Record<string, string | number> = {};
  try {
    const inputs = (JSON.parse(rec.payloadJson) as { inputs?: unknown }).inputs;
    if (inputs && typeof inputs === "object") params = inputs as Record<string, string | number>;
  } catch {
    /* unreadable payload — fall back to the bare code with no interpolation */
  }
  return { reasonCode: rec.reasonCode, reasonParams: params };
}

// A next-intl translator scoped to "decisions.wave" (loosely typed so this pure module
// stays free of a next-intl import — kindLabel uses the same trick).
type WaveReasonTranslator = { (key: never, params?: never): string; has(key: never): boolean };

/** The Art. 22 approver sentence appended to a sealed ADVERSE reason.
 *
 *  UAT CS-L1-004 (rec 2) — the approver was sealed into `payloadJson.inputs.approvedBy`
 *  and rendered nowhere, so the compliance reviewer had to open raw JSON to learn who
 *  signed off an automated rejection. This puts the name in the rationale she reads
 *  first, using the same shape AnalyticsThresholdHistoryStrip already renders for a
 *  threshold change ("Approved by {who}").
 *
 *  Absent approver ⇒ the "not identified" sentence, NOT a silent omission and NOT a
 *  defaulted person (guardrail G3): a record with no named approver must say so, because
 *  "no line" and "approved by nobody in particular" read identically to an auditor. */
function approverNote<T extends WaveReasonTranslator>(t: T, approvedBy: unknown): string {
  const who = typeof approvedBy === "string" ? approvedBy.trim() : "";
  if (who) return t.has("reasons.approvedByNote" as never) ? ` ${t("reasons.approvedByNote" as never, { who } as never)}` : "";
  return t.has("reasons.approverUnidentified" as never) ? ` ${t("reasons.approverUnidentified" as never)}` : "";
}

/** Localize a sealed screening reason through the decisions.wave.reasons.* catalog —
 *  the ONE resolver shared by the reconsider queue (DecisionsTab), the decision-records
 *  panel, and the decision log, so all three read a sealed reason identically. A sealed
 *  record is always committed, so "reject" uses the "did" phrasing + the tie note, the
 *  approver sentence, and nothing else; an unmapped code returns null so the caller falls
 *  back (plain text / English rationale). */
export function waveReasonText<T extends WaveReasonTranslator>(t: T, reason: SealedReason): string | null {
  const p = reason.reasonParams;
  if (reason.reasonCode === "reject") {
    if (!t.has("reasons.rejectDid" as never)) return null;
    const base = t("reasons.rejectDid" as never, p as never);
    const tie = Number(p.tieAdjusted) > 0 ? ` ${t("reasons.tieAdjustedNote" as never, { from: Number(p.tieAdjusted) } as never)}` : "";
    // Only the adverse decision carries it: this is the record a rejected candidate (or a
    // regulator on their behalf) can demand a human reviewer for.
    return base + tie + approverNote(t, p.approvedBy);
  }
  const key = `reasons.${reason.reasonCode}`;
  return t.has(key as never) ? t(key as never, p as never) : null;
}

// ---- (d) Who acted (UAT LUC-ANA-4) ------------------------------------------------
//
// pipeline_events.actor carries the decision-chain vocabulary: "auto:<engine>" for a
// machine and "human:<who>" for a person. `<who>` is either a ROLE token — all the
// deployment could assert when the session carried no identity — or the natural person's
// name. Keeping both in one column (rather than adding a second nullable name column
// nobody would remember to write) means every existing writer's string stays valid and
// the parse below is the only place that has to know the difference.

/** The `human:` suffixes that are ROLES, not people. Derived from the tokens the writers
 *  actually emit, so a rename here is a compile-time-visible single edit. */
export const HUMAN_ROLE_TOKENS = ["recruiter", "operator", "system", "candidate"] as const;
const HUMAN_ROLE_SET: ReadonlySet<string> = new Set(HUMAN_ROLE_TOKENS);

export type EventActor = {
  /** "auto" (a machine acted), "human" (a person acted), "unknown" (the row predates the
   *  actor column, or its writer could not name one). */
  kind: "auto" | "human" | "unknown";
  /** The engine id for "auto" ("screen-wave"), the person's name for an IDENTIFIED human,
   *  and null for a human known only by role — the "a person did this, we cannot say
   *  which one" state a surface must render as "not identified" (guardrail G3). */
  name: string | null;
};

/** Parse a stored `pipeline_events.actor` into its class + the person behind it.
 *
 *  Never guesses in either direction: an absent/blank/unparseable actor is "unknown"
 *  (not "auto", and not the operator), and a role token yields a null `name` rather than
 *  being promoted to a person. The log's "Who" column reads this instead of deriving a
 *  class from `kind`, which is all it could ever show before the column existed. */
export function parseEventActor(actor: string | null | undefined): EventActor {
  const raw = (actor ?? "").trim();
  const sep = raw.indexOf(":");
  if (sep <= 0) return { kind: "unknown", name: null };
  const prefix = raw.slice(0, sep).toLowerCase();
  const rest = raw.slice(sep + 1).trim();
  if (!rest) return { kind: "unknown", name: null };
  if (prefix === "auto") return { kind: "auto", name: rest };
  if (prefix === "human") return { kind: "human", name: HUMAN_ROLE_SET.has(rest.toLowerCase()) ? null : rest };
  return { kind: "unknown", name: null };
}

// (c) Rematch counterpart. rematched/rematched_from rows carry the counterpart pipeline
// entry id inside their detail string, but no link. The detail wire format is OWNED by
// pipeline-rematch-link.ts (the drawer's parser, shipped the same round) — this is a
// thin adapter over that ONE parser so the two surfaces can never drift on the format.
export function parseRematchCounterpartId(kind: string, detail: string | null): string | null {
  return parseRematchDetail(kind, detail)?.entryId ?? null;
}

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
