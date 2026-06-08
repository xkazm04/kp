import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpCircle,
  CalendarCheck,
  CircleDot,
  CirclePlus,
  Clock,
  Repeat,
  Sparkles,
  UserPlus,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ARCHETYPE_STYLE, daysSince, STALE_DAYS, styleFor, type Entry, type PipelineEvent } from "./PipelineTypes";

// The pipeline-lifecycle event taxonomy that the activity feed renders richly.
// These are the kinds recordEvent() emits in db.ts. Promoted from a bare string
// to a string-literal union so EVENT_CATALOG below can be checked exhaustively.
export const EVENT_KINDS = [
  "matched",
  "added",
  "applied",
  "re_applied",
  "advanced",
  "moved",
  "scheduled",
  "rejected",
  "intake_degraded",
  "intake_resolved",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

type EventMeta = {
  // Human verb for the feed row ("<candidate> <verb> · <job>"). A builder, not a
  // bare string, so kinds that carry a target stage or detail can fold them in.
  verb: (ev: PipelineEvent) => string;
  // Glyph paired with a tone, so the row's state reads without relying on hue
  // alone (mirrors Badge's icon-plus-label-not-color doctrine). aria-hidden — the
  // adjacent row text already names the event for assistive tech.
  Icon: LucideIcon;
  tone: string;
};

// ONE source of truth mapping each event kind to its verb, glyph and tone. This
// replaces the old eventVerb/eventDotCue switch pair that had to be kept in sync
// by hand. Because the type is Record<EventKind, …>, adding a kind to EVENT_KINDS
// without a row here is a compile error — a new kind can never ship half-styled
// (missing a label or an icon), and a typo'd kind can't fall through to a raw
// enum value rendered at the user. eventVerb/EventDot are now table lookups.
export const EVENT_CATALOG: Record<EventKind, EventMeta> = {
  matched: { verb: () => "was matched", Icon: Sparkles, tone: "text-steel" },
  added: { verb: () => "was added to the pipeline", Icon: CirclePlus, tone: "text-steel" },
  applied: { verb: () => "applied via the application link", Icon: UserPlus, tone: "text-steel" },
  re_applied: { verb: () => "applied again (already in the pipeline)", Icon: Repeat, tone: "text-amber-600" },
  advanced: { verb: (ev) => `advanced to ${ev.toStage}`, Icon: ArrowUpCircle, tone: "text-moss" },
  moved: { verb: (ev) => `was moved to ${ev.toStage} by a recruiter`, Icon: ArrowLeftRight, tone: "text-steel" },
  scheduled: {
    verb: (ev) => `interview scheduled${ev.detail ? ` (${ev.detail})` : ""}`,
    Icon: CalendarCheck,
    tone: "text-moss",
  },
  rejected: { verb: () => "was rejected", Icon: XCircle, tone: "text-coral" },
  intake_degraded: {
    verb: (ev) => `applied, but intake couldn't be auto-profiled${ev.detail ? ` (${ev.detail})` : ""}`,
    Icon: AlertTriangle,
    tone: "text-red-600",
  },
  intake_resolved: { verb: () => "intake captured manually", Icon: Wrench, tone: "text-moss" },
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

export function eventVerb(ev: PipelineEvent): string {
  return isEventKind(ev.kind) ? EVENT_CATALOG[ev.kind].verb(ev) : ev.kind.replace(/_/g, " ");
}

export function EventDot({ kind }: { kind: string }) {
  const { Icon, tone } = isEventKind(kind) ? EVENT_CATALOG[kind] : EVENT_FALLBACK;
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />;
}

// A candidate in a position cell: full name + a prominent status dot (~2x the
// old avatar corner dot). The name navigates to the analyzed profile; a hover
// affordance opens the AI-actions drawer.
export function CandidateRow({
  entry,
  pending = false,
  stale = false,
  onOpen,
  onActions,
}: {
  entry: Entry;
  pending?: boolean;
  stale?: boolean;
  onOpen: () => void;
  onActions?: () => void;
}) {
  const style = styleFor(entry.archetype);
  const days = daysSince(entry.stageChangedAt);
  // Intake degraded is a data-integrity problem (a non-matchable stub), so it
  // outranks every other cue: degraded (red triangle) > pending (coral pulse) >
  // aging (amber) > archetype color. State never rides on color alone — each
  // level has its own glyph.
  const degraded = !!entry.intakeDegraded;
  const dotClass = degraded ? "bg-red-600" : pending ? "bg-coral animate-pulse" : stale ? "bg-amber-400" : style.bg;
  const dotTitle = degraded
    ? `Intake degraded — needs manual profile capture${entry.intakeDegradedReason ? ` · ${entry.intakeDegradedReason}` : ""}`
    : pending
      ? "Awaiting your decision"
      : stale
        ? `Aging >${STALE_DAYS}d in stage`
        : style.label;
  const StatusIcon = degraded
    ? AlertTriangle
    : pending
      ? AlertCircle
      : stale
        ? Clock
        : style.icon;
  const title = `${entry.candidateLabel} · ${style.label}${entry.matchScore != null ? ` · match ${entry.matchScore}` : ""}${
    days != null ? ` · ${days}d in stage` : ""
  }${degraded ? " · intake degraded" : ""}`;
  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-paper">
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
        onClick={onOpen}
        title={`${title} · open analyzed profile`}
        className="focus-ring min-w-0 flex-1 truncate text-left text-base font-medium text-ink hover:text-coral"
      >
        {entry.candidateLabel}
      </button>
      {/* Right-aligned fit score in the shared score→color language (moss/amber/coral),
          so a lane can be triaged at a glance without hovering for the title tooltip. */}
      <span className="shrink-0">
        <ScoreBadge score={entry.matchScore} />
      </span>
      {onActions ? (
        <button
          type="button"
          onClick={onActions}
          aria-label={`AI actions for ${entry.candidateLabel}`}
          title="AI actions"
          className="focus-ring shrink-0 rounded p-0.5 text-steel opacity-0 transition-opacity hover:text-coral group-hover:opacity-100"
        >
          <Sparkles size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-steel">
      {Object.values(ARCHETYPE_STYLE).map((s) => (
        <span key={s.label} className="inline-flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-full ${s.bg}`} />
          {s.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-coral" />
        Awaiting your decision
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        Aging &gt;{STALE_DAYS}d in stage
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-3 w-3 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle className="h-2 w-2" aria-hidden />
        </span>
        Intake degraded — needs manual capture
      </span>
    </div>
  );
}
