// The pipeline-lifecycle event taxonomy (icon/tone catalog + localized verb/
// relative-time hooks). Split out of PipelineShared.tsx — pure logic (plus two
// hooks with no JSX), no components.

import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpCircle,
  Ban,
  CalendarCheck,
  CheckSquare,
  CircleDot,
  CirclePlus,
  ClipboardList,
  Download,
  FileText,
  Gauge,
  GitBranch,
  Handshake,
  Hourglass,
  Link2,
  Lock,
  Mail,
  MailWarning,
  PauseCircle,
  Phone,
  Repeat,
  Scale,
  Send,
  Shuffle,
  Sparkles,
  Timer,
  Undo2,
  Unlock,
  UserCheck,
  UserPlus,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { relativeTimeBucket } from "./pipelineRenderDiet";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

// The FULL pipeline_events vocabulary — every kind any writer can put in front of the
// activity feed, not just the board-lifecycle subset this list used to hold.
//
// feed-events-speak-your-language: it used to stop at the 16 board kinds while the feed
// (listPipelineEvents) renders EVERY row in the table, so the automation kinds this
// file's own comment named — outreach_sent, offer_drafted, auto_rejected — fell through
// to a raw de-underscored ENGLISH label. 34 of the 50 kinds then reachable rendered in
// English regardless of locale; a Czech or German recruiter read "outreach sent".
//
// The list is not enumerated by eye. pipelineEventCatalog.test.ts derives the writer
// vocabulary from the code that owns it — DECISION_META + AUTOMATION_ALERT_KINDS
// (decision-attribution.ts, the declared one-source-of-truth for automation kinds) and
// ATS_EXPORT_EVENT_KIND — and fails if any of it is missing here; the remaining direct
// recordEvent/recordAutomationEvent literals carry their writer in a comment below.
// Because EVENT_CATALOG is Record<EventKind, …>, adding a kind here without a glyph is a
// COMPILE error, and the same test pins the i18n catalog to this set in all four locales.
//
// UAT LUC-ANA-6 — this list and DECISION_META are now SET-EQUAL, pinned from both sides
// (that test asserts DECISION_META ⊆ EVENT_KINDS, decision-attribution.test.ts asserts
// the converse). Before, the inclusion ran one way only, so a kind could reach the feed
// with a localized verb and still have no attribution: it rendered NEZNÁMÉ in the
// decision log, sat in neither filter, and counted in no rollup. Adding a kind to either
// map now fails the other's test until both know about it.
export const EVENT_KINDS = [
  "matched",
  "added",
  "applied",
  "re_applied",
  "scored",
  "advanced",
  "moved",
  "scheduled",
  "rejected",
  "intake_degraded",
  "intake_resolved",
  // A board-shape change moved this candidate: Settings → Hiring removed the step
  // they were standing on, and the operator named where everyone there should go.
  // Its own kind, not "moved": nobody chose to advance THIS candidate, and a
  // recruiter reading the trail three weeks later needs to know that.
  "stage_migrated",
  // d95fed6d — a recruiter's analysis disposition (advance/hold/pass on the
  // saved report) echoed onto the candidate's pipeline record.
  "disposition_set",
  // d95fed6d — a practice (simulator) interview noted on the record.
  "sim_attached",
  // rematch-story-navigable — the two sides of a re-engagement link (silver-medalist
  // rediscovery / automated rematch). `rematched` is stamped on the SOURCE entry (the
  // person was redirected to a new role); `rematched_from` on the TARGET (they were
  // re-engaged from an earlier application). The detail carries the counterpart entry,
  // which the drawer renders as a navigable affordance (see pipeline-rematch-link.ts).
  "rematched",
  "rematched_from",
  // The comparative group evaluation itself (group-eval-event-anchor, round 12) —
  // written at seal time on the crowned lead's entry; the detail is a machine
  // summary ("selection · 4/12"), no counterpart handle.
  "group_eval",

  // ---- the automation vocabulary (recordAutomationEvent + the policy pass) ----------
  // Every kind below reaches the SAME feed. The auto_* pair mirrors its human twin:
  // actOnPipelineEntry writes `advanced`/`rejected` for a recruiter click and
  // `auto_advanced`/`auto_rejected` when the caller is the system (db/pipeline.ts).
  "auto_advanced",
  "auto_rejected",
  "screening_hold",
  // screen-wave.ts — the wave DECLINED to auto-reject this candidate, to keep an
  // uncontaminated calibration arm. A machine decision about a person, so it is a feed
  // event like any other (UAT LUC-ANA-6).
  "screen_wave_holdout",
  // pipeline-entry-action.ts — the AI round passed and the hiring plan handed the
  // candidate to a human round. The human-oversight hand-off itself.
  "human_round_queued",
  // Generated artifacts (automation-run.ts): the scorecard/prep/offer/rejection drafts.
  "interview_scorecard",
  "interview_prep_generated",
  "rejection_drafted",
  "offer_drafted",
  // Outreach and the two ways it does NOT go out (comms-dispatch.ts, inbound webhook).
  "outreach_sent",
  "outreach_halted",
  "outreach_suppressed",
  // Dispatched candidate/interviewer comms (comms-dispatch.ts, resend route).
  "acknowledgement_sent",
  "rejection_sent",
  "interview_invite_sent",
  "schedule_invite_sent",
  "interview_reminder_sent",
  "interviewer_brief_sent",
  "interviewer_brief_skipped",
  "offer_sent",
  // comms-dispatch.ts — the offer-deadline nudge.
  "offer_reminder_sent",
  "comm_resent",
  // Scheduling / offer lifecycle transitions.
  "interview_scheduled",
  "offer_accepted",
  "offer_declined",
  "offer_expired",
  // automation-run.ts — an offer extended unattended (offer gate: auto); and
  // offer-finalize.ts — an acceptance that could not be honoured on a closed entry.
  "offer_auto_extended",
  "offer_accept_blocked",
  "rejection_comms_failed",
  // The fairness backstop + the policy pass's aging/stale nudges (AUTOMATION_ALERT_KINDS).
  "fairness_gate_unknown_archetype",
  "fairness_gate_blocked_reject",
  "aging_alert",
  "stale_alert",
  // Eligibility, role lifecycle and the human reversal of a machine reject.
  "ko_declined",
  // db/pipeline.ts — closing a role withdraws its candidates; reopening restores them.
  "role_closed",
  "role_reopened",
  "reinstated",
  // Evidence, links and exports attached to a candidate's record.
  "observed_minted",
  // db/pipeline.ts — a GitHub deep-dive attached to the entry (drawer / recruiter add).
  "github_evidence_attached",
  // api/ats/candidate/ats-candidate-audit.ts — ATS_EXPORT_EVENT_KIND.
  "ats_export",
  // api/apply/[id]/followup — the candidate answered their own profile gaps.
  "profile_enriched",
  // api/agents/* — the Personas agent bridge: an operator dispatches a persona request,
  // and Personas reports back on its token route when the persona goes live.
  "agent_dispatched",
  "agent_activated",
  // RETIRED WRITERS (decision-attribution.ts RETIRED_EVENT_KINDS). The post-hire
  // onboarding module is gone, but its rows are still in deployed databases and the feed
  // renders whatever the table holds — dropping the kinds would make real history read as
  // an unrecognized token. Kept so those rows keep a localized verb; nothing writes them.
  "onboarding_started",
  "onboarding_intake_submitted",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

type EventMeta = {
  // Glyph paired with a tone, so the row's state reads without relying on hue
  // alone (mirrors Badge's icon-plus-label-not-color doctrine). aria-hidden — the
  // adjacent row text already names the event for assistive tech.
  Icon: LucideIcon;
  tone: string;
};

// ONE source of truth mapping each event kind to its glyph and tone. The human
// VERB is localized via the `pipeline.events` catalog through useEventVerb (not
// baked in here). Because the type is Record<EventKind, …>, adding a kind to
// EVENT_KINDS without a row here is a compile error — a new kind can never ship
// half-styled (missing an icon), and a typo'd kind can't fall through to a raw
// enum value rendered at the user.
export const EVENT_CATALOG: Record<EventKind, EventMeta> = {
  matched: { Icon: Sparkles, tone: "text-steel" },
  added: { Icon: CirclePlus, tone: "text-steel" },
  applied: { Icon: UserPlus, tone: "text-steel" },
  re_applied: { Icon: Repeat, tone: "text-amber-600" },
  scored: { Icon: Gauge, tone: "text-steel" },
  advanced: { Icon: ArrowUpCircle, tone: "text-moss" },
  moved: { Icon: ArrowLeftRight, tone: "text-steel" },
  scheduled: { Icon: CalendarCheck, tone: "text-moss" },
  rejected: { Icon: XCircle, tone: "text-coral" },
  intake_degraded: { Icon: AlertTriangle, tone: "text-red-600" },
  intake_resolved: { Icon: Wrench, tone: "text-moss" },
  stage_migrated: { Icon: Shuffle, tone: "text-amber-600" },
  disposition_set: { Icon: CheckSquare, tone: "text-steel" },
  sim_attached: { Icon: Phone, tone: "text-steel" },
  rematched: { Icon: Shuffle, tone: "text-steel" },
  rematched_from: { Icon: Repeat, tone: "text-steel" },
  group_eval: { Icon: Sparkles, tone: "text-steel" },
  auto_advanced: { Icon: ArrowUpCircle, tone: "text-moss" },
  auto_rejected: { Icon: XCircle, tone: "text-coral" },
  screening_hold: { Icon: PauseCircle, tone: "text-amber-600" },
  screen_wave_holdout: { Icon: Scale, tone: "text-steel" },
  human_round_queued: { Icon: UserCheck, tone: "text-moss" },
  interview_scorecard: { Icon: ClipboardList, tone: "text-steel" },
  interview_prep_generated: { Icon: ClipboardList, tone: "text-steel" },
  rejection_drafted: { Icon: FileText, tone: "text-steel" },
  offer_drafted: { Icon: FileText, tone: "text-steel" },
  outreach_sent: { Icon: Send, tone: "text-steel" },
  outreach_halted: { Icon: PauseCircle, tone: "text-steel" },
  outreach_suppressed: { Icon: Ban, tone: "text-amber-600" },
  acknowledgement_sent: { Icon: Mail, tone: "text-steel" },
  rejection_sent: { Icon: Mail, tone: "text-coral" },
  interview_invite_sent: { Icon: Mail, tone: "text-steel" },
  schedule_invite_sent: { Icon: Mail, tone: "text-steel" },
  interview_reminder_sent: { Icon: Mail, tone: "text-steel" },
  interviewer_brief_sent: { Icon: Mail, tone: "text-steel" },
  interviewer_brief_skipped: { Icon: MailWarning, tone: "text-amber-600" },
  offer_sent: { Icon: Mail, tone: "text-steel" },
  offer_reminder_sent: { Icon: Mail, tone: "text-steel" },
  comm_resent: { Icon: Send, tone: "text-steel" },
  interview_scheduled: { Icon: CalendarCheck, tone: "text-moss" },
  offer_accepted: { Icon: Handshake, tone: "text-moss" },
  offer_declined: { Icon: XCircle, tone: "text-coral" },
  offer_expired: { Icon: Hourglass, tone: "text-amber-600" },
  offer_auto_extended: { Icon: Handshake, tone: "text-amber-600" },
  offer_accept_blocked: { Icon: Ban, tone: "text-amber-600" },
  rejection_comms_failed: { Icon: MailWarning, tone: "text-coral" },
  fairness_gate_unknown_archetype: { Icon: Scale, tone: "text-coral" },
  fairness_gate_blocked_reject: { Icon: Scale, tone: "text-coral" },
  aging_alert: { Icon: Timer, tone: "text-amber-600" },
  stale_alert: { Icon: Timer, tone: "text-amber-600" },
  ko_declined: { Icon: Ban, tone: "text-coral" },
  role_closed: { Icon: Lock, tone: "text-steel" },
  role_reopened: { Icon: Unlock, tone: "text-moss" },
  reinstated: { Icon: Undo2, tone: "text-moss" },
  observed_minted: { Icon: Link2, tone: "text-steel" },
  github_evidence_attached: { Icon: GitBranch, tone: "text-steel" },
  ats_export: { Icon: Download, tone: "text-steel" },
  profile_enriched: { Icon: UserCheck, tone: "text-steel" },
  agent_dispatched: { Icon: Send, tone: "text-steel" },
  agent_activated: { Icon: Sparkles, tone: "text-moss" },
  onboarding_started: { Icon: UserCheck, tone: "text-moss" },
  onboarding_intake_submitted: { Icon: ClipboardList, tone: "text-steel" },
};

// One documented fallback, now reserved for what it should always have covered: a
// LEGACY or otherwise unrecognized kind read off an old row. The automation kinds it
// used to absorb (outreach_sent, offer_drafted, auto_rejected, …) are first-class
// members of EVENT_KINDS above and get their own glyph and localized verb.
export const EVENT_FALLBACK: { Icon: LucideIcon; tone: string } = { Icon: CircleDot, tone: "text-steel" };

export function isEventKind(kind: string): kind is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(kind);
}

// Localized feed verb for an event. The `pipeline.events` catalog holds one entry per
// EVENT_KINDS member — pinned by set equality in pipelineEventCatalog.test.ts, across all
// four locales, so a key deleted from every locale (which `i18n:check`'s parity test
// cannot see) still fails a gate. A few kinds want more than the bare verb: advanced/
// moved interpolate the localized stage, and scored/scheduled/intake_degraded/
// disposition_set/sim_attached have a detail variant. Everything else resolves by key.
//
// A HOOK (not a pure fn) so it reads the request locale.
export function useEventVerb(): (ev: PipelineEvent) => string {
  const t = useTranslations("pipeline.events");
  const enumLabel = useEnumLabel();
  return (ev) => {
    // An unrecognized kind — a legacy row, or a writer that shipped ahead of this
    // catalog. It still degrades safely, but through a LOCALIZED frame that names it as
    // unrecognized and shows the raw machine token: it must not be mistakable for a
    // first-class label the way a de-underscored English kind was.
    if (!isEventKind(ev.kind)) return t("unknownKind", { kind: ev.kind });
    switch (ev.kind) {
      case "advanced":
        return t("advanced", { stage: enumLabel("stage", ev.toStage) });
      case "auto_advanced":
        return t("auto_advanced", { stage: enumLabel("stage", ev.toStage) });
      case "moved":
        return t("moved", { stage: enumLabel("stage", ev.toStage) });
      case "scheduled":
        return ev.detail ? t("scheduledDetail", { detail: ev.detail }) : t("scheduled");
      case "intake_degraded":
        return ev.detail ? t("intakeDegradedDetail", { detail: ev.detail }) : t("intake_degraded");
      case "scored":
        return ev.detail ? t("scoredDetail", { detail: ev.detail }) : t("scored");
      case "disposition_set":
        return ev.detail ? t("dispositionSetDetail", { detail: ev.detail }) : t("disposition_set");
      case "sim_attached":
        return ev.detail ? t("simAttachedDetail", { detail: ev.detail }) : t("sim_attached");
      // Every remaining kind is a bare localized verb. Resolved by key rather than by a
      // 40-arm switch — EventKind is a closed union and the catalog is set-equal to it,
      // so this call can only reach a key that exists.
      //
      // The rematch details encode the counterpart entry id (an internal handle), which
      // is exactly why they take this branch: the FEED shows the verb only; the drawer
      // turns the parsed detail into a navigable link.
      default:
        return t(ev.kind);
    }
  };
}

// Localized "time ago" for the feed (today / yesterday / Nd / Nw / Nmo). A hook so
// it reads the request locale; replaces the English-only relativeTime() at its
// call sites (feed rows, the drawer history, the scheduler's last-run line). The
// day-bucket cut points are single-sourced from relativeTimeBucket (pipeline-render-
// diet), the SAME classifier eventSignature folds — so the rendered label and the
// feed's re-render signature can never disagree on when "2d" becomes "3d".
export function useRelativeTime(): (iso: string) => string {
  const t = useTranslations("pipeline.relTime");
  return (iso) => {
    const b = relativeTimeBucket(iso);
    switch (b.unit) {
      case "none":
        return "";
      case "today":
        return t("today");
      case "yesterday":
        return t("yesterday");
      case "day":
        return t("daysAgo", { d: b.n });
      case "week":
        return t("weeksAgo", { w: b.n });
      case "month":
        return t("monthsAgo", { mo: b.n });
    }
  };
}
