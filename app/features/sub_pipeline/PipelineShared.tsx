import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpCircle,
  CalendarCheck,
  CheckSquare,
  CircleDot,
  CirclePlus,
  Clock,
  Gauge,
  Phone,
  Repeat,
  Sparkles,
  Square,
  UserPlus,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { useScoreProvenanceText } from "@/app/_components/ScoreProvenanceLabel";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { canonicalScoreOf, provenanceOf } from "@/app/_lib/match-score";
import { ARCHETYPE_STYLE, daysSince, slaForStage, styleFor, type Entry, type PipelineEvent } from "./PipelineTypes";

// The pipeline-lifecycle event taxonomy that the activity feed renders richly.
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
};

// One documented fallback for kinds outside the catalog. The feed (listPipelineEvents)
// also surfaces automation kinds — outreach_sent, offer_drafted, auto_rejected, … —
// which carry their own rich label/attribution in DecisionLog's DECISION_META; here
// they degrade gracefully to a humanized label and a neutral glyph rather than a raw
// enum value or a hard crash on an unrecognized string from an older row.
const EVENT_FALLBACK: { Icon: LucideIcon; tone: string } = { Icon: CircleDot, tone: "text-steel" };

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
    }
  };
}

// Localized "time ago" for the feed (today / yesterday / Nd / Nw / Nmo). A hook so
// it reads the request locale; replaces the English-only relativeTime() at its
// call sites (feed rows, the drawer history, the scheduler's last-run line).
export function useRelativeTime(): (iso: string) => string {
  const t = useTranslations("pipeline.relTime");
  return (iso) => {
    const d = daysSince(iso);
    if (d == null) return "";
    if (d <= 0) return t("today");
    if (d === 1) return t("yesterday");
    if (d < 7) return t("daysAgo", { d });
    if (d < 30) return t("weeksAgo", { w: Math.floor(d / 7) });
    return t("monthsAgo", { mo: Math.floor(d / 30) });
  };
}

export function EventDot({ kind }: { kind: string }) {
  const { Icon, tone } = isEventKind(kind) ? EVENT_CATALOG[kind] : EVENT_FALLBACK;
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />;
}

// A candidate in a position cell: full name + a prominent status dot (~2x the
// old avatar corner dot). The name navigates to the analyzed profile; a hover
// affordance opens the AI-actions drawer.
// PIPE1: in select mode the row becomes a checkbox (role=checkbox on the name
// button, glyph before the dot) and its navigation/actions are suppressed — the
// MatrixTab selectMode interaction grammar.
export function CandidateRow({
  entry,
  pending = false,
  stale = false,
  onOpen,
  onActions,
  selectMode = false,
  selected = false,
  onToggleSelect,
  draggable = false,
  onDragStart,
  onDragEnd,
}: {
  entry: Entry;
  pending?: boolean;
  stale?: boolean;
  onOpen: () => void;
  onActions?: () => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  // cea12908 — pointer drag-and-drop of a candidate between stage columns. Off by
  // default; the board enables it when not in select mode. The keyboard path stays
  // the row's open/select button + the bulk-move bar (drag is pointer-only).
  draggable?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  const provenanceText = useScoreProvenanceText();
  const style = styleFor(entry.archetype);
  const archLabel = enumLabel("archetype", entry.archetype);
  const days = daysSince(entry.stageChangedAt);
  // Canonical match-score read path (REC-01): the badge shows THE same number as
  // the drawer header and the decisions queue; its provenance rides the tooltip.
  const score = canonicalScoreOf(entry);
  const scoreProvenance = provenanceText(provenanceOf(entry));
  // Intake degraded is a data-integrity problem (a non-matchable stub), so it
  // outranks every other cue: degraded (red triangle) > pending (coral pulse) >
  // aging (amber) > archetype color. State never rides on color alone — each
  // level has its own glyph.
  const degraded = !!entry.intakeDegraded;
  const dotClass = degraded ? "bg-red-600" : pending ? "bg-coral animate-pulse" : stale ? "bg-amber-400" : style.bg;
  const dotTitle = degraded
    ? `${t("candidateRow.intakeDegraded")}${entry.intakeDegradedReason ? t("candidateRow.degradedReasonSuffix", { reason: entry.intakeDegradedReason }) : ""}`
    : pending
      ? t("candidateRow.awaitingDecision")
      : stale
        ? t("candidateRow.aging", { days: slaForStage(entry.stage), stage: enumLabel("stage", entry.stage) })
        : archLabel;
  const StatusIcon = degraded
    ? AlertTriangle
    : pending
      ? AlertCircle
      : stale
        ? Clock
        : style.icon;
  const title = `${t("candidateRow.cardTitle", { name: entry.candidateLabel, archetype: archLabel })}${score != null ? `${t("candidateRow.matchSuffix", { score })}${scoreProvenance ? ` (${scoreProvenance})` : ""}` : ""}${days != null ? t("candidateRow.daysInStage", { days }) : ""}${degraded ? t("candidateRow.degradedSuffix") : ""}`;
  const selecting = selectMode && onToggleSelect;
  // Drag only outside select mode (in select mode the row is a checkbox).
  const dragOn = draggable && !selecting;
  return (
    <div
      draggable={dragOn || undefined}
      onDragStart={
        dragOn
          ? (ev) => {
              // A payload makes the drag valid across the cell drop targets; the
              // board reads the dragged entry from its own state, not this string.
              ev.dataTransfer.setData("text/plain", entry.id);
              ev.dataTransfer.effectAllowed = "move";
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={dragOn ? () => onDragEnd?.() : undefined}
      className={`group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-paper ${selecting && selected ? "bg-coral/5" : ""} ${dragOn ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span
        role="img"
        aria-label={dotTitle}
        title={dotTitle}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${dotClass}`}
      >
        <StatusIcon className="h-2.5 w-2.5" aria-hidden />
      </span>
      <button
        type="button"
        onClick={selecting ? onToggleSelect : onOpen}
        role={selecting ? "checkbox" : undefined}
        aria-checked={selecting ? selected : undefined}
        title={selecting ? t("candidateRow.selectCandidate", { name: entry.candidateLabel }) : `${title}${t("candidateRow.openProfileSuffix")}`}
        className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 truncate text-left text-base font-medium text-ink hover:text-coral"
      >
        {selecting ? (
          selected ? (
            <CheckSquare size={14} className="shrink-0 text-coral" aria-hidden />
          ) : (
            <Square size={14} className="shrink-0 text-steel" aria-hidden />
          )
        ) : null}
        <span className="min-w-0 truncate">{entry.candidateLabel}</span>
      </button>
      {/* Right-aligned fit score in the shared score→color language (moss/amber/coral),
          so a lane can be triaged at a glance without hovering for the title tooltip.
          Canonical number (REC-01) — provenance rides the row tooltip above. */}
      <span className="shrink-0" title={scoreProvenance ?? undefined}>
        <ScoreBadge score={score} />
      </span>
      {onActions && !selecting ? (
        <button
          type="button"
          onClick={onActions}
          aria-label={t("candidateRow.aiActionsFor", { name: entry.candidateLabel })}
          title={t("candidateRow.aiActions")}
          className="focus-ring shrink-0 rounded p-0.5 text-steel opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
        >
          <Sparkles size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function Legend() {
  const t = useTranslations("pipeline");
  const enumLabel = useEnumLabel();
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-steel">
      {Object.entries(ARCHETYPE_STYLE).map(([id, s]) => (
        <span key={id} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-full ${s.bg}`} />
          {enumLabel("archetype", id)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
        {t("legend.awaitingDecision")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        {t("legend.aging")}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle className="h-2 w-2" aria-hidden />
        </span>
        {t("legend.intakeDegraded")}
      </span>
    </div>
  );
}
