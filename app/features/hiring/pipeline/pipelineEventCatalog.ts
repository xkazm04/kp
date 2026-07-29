// The pipeline-lifecycle event taxonomy (icon/tone catalog + localized verb/
// relative-time hooks). Split out of PipelineShared.tsx — pure logic (plus two
// hooks with no JSX), no components.

import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpCircle,
  CalendarCheck,
  CheckSquare,
  CircleDot,
  CirclePlus,
  Gauge,
  Phone,
  Repeat,
  Shuffle,
  Sparkles,
  UserPlus,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { relativeTimeBucket } from "./pipelineRenderDiet";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

// These are the kinds recordEvent() emits in db.ts. Promoted from a bare string
// to a string-literal union so EVENT_CATALOG below can be checked exhaustively.
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
  disposition_set: { Icon: CheckSquare, tone: "text-steel" },
  sim_attached: { Icon: Phone, tone: "text-steel" },
  rematched: { Icon: Shuffle, tone: "text-steel" },
  rematched_from: { Icon: Repeat, tone: "text-steel" },
  group_eval: { Icon: Sparkles, tone: "text-steel" },
};

// One documented fallback for kinds outside the catalog. The feed (listPipelineEvents)
// also surfaces automation kinds — outreach_sent, offer_drafted, auto_rejected, … —
// which carry their own rich label/attribution in DecisionLog's DECISION_META; here
// they degrade gracefully to a humanized label and a neutral glyph rather than a raw
// enum value or a hard crash on an unrecognized string from an older row.
export const EVENT_FALLBACK: { Icon: LucideIcon; tone: string } = { Icon: CircleDot, tone: "text-steel" };

export function isEventKind(kind: string): kind is EventKind {
  return (EVENT_KINDS as readonly string[]).includes(kind);
}

// Localized feed verb for an event. The `pipeline.events` catalog holds one entry
// per kind; advanced/moved interpolate the localized stage, scheduled/
// intake_degraded carry a detail variant, and an unknown (older) kind degrades to
// a humanized raw label. A HOOK (not a pure fn) so it reads the request locale.
export function useEventVerb(): (ev: PipelineEvent) => string {
  const t = useTranslations("pipeline.events");
  const enumLabel = useEnumLabel();
  return (ev) => {
    if (!isEventKind(ev.kind)) return ev.kind.replace(/_/g, " ");
    switch (ev.kind) {
      case "advanced":
        return t("advanced", { stage: enumLabel("stage", ev.toStage) });
      case "moved":
        return t("moved", { stage: enumLabel("stage", ev.toStage) });
      case "scheduled":
        return ev.detail ? t("scheduledDetail", { detail: ev.detail }) : t("scheduled");
      case "intake_degraded":
        return ev.detail ? t("intakeDegradedDetail", { detail: ev.detail }) : t("intake_degraded");
      case "matched":
        return t("matched");
      case "added":
        return t("added");
      case "applied":
        return t("applied");
      case "re_applied":
        return t("re_applied");
      case "scored":
        return ev.detail ? t("scoredDetail", { detail: ev.detail }) : t("scored");
      case "rejected":
        return t("rejected");
      case "intake_resolved":
        return t("intake_resolved");
      case "disposition_set":
        return ev.detail ? t("dispositionSetDetail", { detail: ev.detail }) : t("disposition_set");
      case "sim_attached":
        return ev.detail ? t("simAttachedDetail", { detail: ev.detail }) : t("sim_attached");
      // The rematch details encode the counterpart entry id (an internal handle) — the
      // FEED shows the verb only; the drawer turns the parsed detail into a navigable
      // link (the public projection nulls the detail for these kinds outright).
      case "rematched":
        return t("rematched");
      case "rematched_from":
        return t("rematched_from");
      case "group_eval":
        return t("group_eval");
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
