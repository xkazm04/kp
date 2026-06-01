import {
  AlertCircle,
  ArrowUpCircle,
  Briefcase,
  CalendarCheck,
  CircleDot,
  CirclePlus,
  Clock,
  GraduationCap,
  Repeat,
  Sparkles,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { ScoreBadge } from "@/app/_components/ScoreBadge";
import { ARCHETYPE_STYLE, daysSince, STALE_DAYS, styleFor, type Entry, type PipelineEvent } from "./PipelineTypes";

// Archetype → glyph, so the candidate-row status reads without relying on hue
// alone (mirrors Badge's icon-plus-label-not-color doctrine).
const ARCHETYPE_ICON: Record<string, LucideIcon> = {
  bau: Briefcase,
  student: GraduationCap,
  career_switcher: Repeat,
};

export function eventVerb(ev: PipelineEvent): string {
  switch (ev.kind) {
    case "matched":
      return "was matched";
    case "added":
      return "was added to the pipeline";
    case "advanced":
      return `advanced to ${ev.toStage}`;
    case "scheduled":
      return `interview scheduled${ev.detail ? ` (${ev.detail})` : ""}`;
    case "rejected":
      return "was rejected";
    default:
      return ev.kind;
  }
}

// A glyph + color (not color alone) for each activity kind. The adjacent row
// text already names the event for assistive tech, so the icon stays aria-hidden.
function eventDotCue(kind: string): { Icon: LucideIcon; tone: string } {
  switch (kind) {
    case "rejected":
      return { Icon: XCircle, tone: "text-coral" };
    case "advanced":
      return { Icon: ArrowUpCircle, tone: "text-moss" };
    case "scheduled":
      return { Icon: CalendarCheck, tone: "text-moss" };
    case "matched":
      return { Icon: Sparkles, tone: "text-steel" };
    case "added":
      return { Icon: CirclePlus, tone: "text-steel" };
    default:
      return { Icon: CircleDot, tone: "text-steel" };
  }
}

export function EventDot({ kind }: { kind: string }) {
  const { Icon, tone } = eventDotCue(kind);
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} aria-hidden />;
}

export function Kpi({
  icon,
  label,
  value,
  tone = "neutral",
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "coral" | "amber";
  onClick?: () => void;
}) {
  const border =
    tone === "coral" ? "border-coral/30 bg-coral/5" : tone === "amber" ? "border-amber-300/50 bg-amber-50" : "border-stone-200 bg-white";
  const accent = tone === "coral" ? "text-coral" : tone === "amber" ? "text-amber-700" : "text-steel";
  const valueColor = tone === "coral" ? "text-coral" : tone === "amber" ? "text-amber-700" : "text-ink";
  const cls = `rounded-lg border p-3 text-left shadow-panel ${border} ${
    onClick ? "focus-ring transition-colors hover:border-coral/50" : ""
  }`;
  const body = (
    <>
      <div className="flex items-center gap-2 text-steel">
        <span className={accent}>{icon}</span>
        <span className="text-meta uppercase">{label}</span>
      </div>
      <p className={`mt-1 font-serif text-3xl ${valueColor}`}>{value}</p>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} block w-full`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function Avatar({
  entry,
  pending = false,
  stale = false,
  onClick,
}: {
  entry: Entry;
  pending?: boolean;
  stale?: boolean;
  onClick?: () => void;
}) {
  const style = styleFor(entry.archetype);
  const initials = entry.candidateLabel
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const days = daysSince(entry.stageChangedAt);
  const title = `${entry.candidateLabel} · ${style.label}${entry.matchScore != null ? ` · match ${entry.matchScore}` : ""}${
    days != null ? ` · ${days}d in stage` : ""
  }`;
  // pending (coral, pulsing) takes visual priority; otherwise show an amber aging ring.
  const ring = pending ? `ring-2 ring-offset-1 ${style.ring}` : stale ? "ring-2 ring-offset-1 ring-amber-400" : "";
  const cls = `relative inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold text-white ${style.bg} ${ring}`;
  const dot = pending ? (
    <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border border-white bg-coral" />
  ) : stale ? (
    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-amber-400" />
  ) : null;
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={`${title} · open`} className={`focus-ring ${cls} cursor-pointer hover:opacity-90`}>
        {initials}
        {dot}
      </button>
    );
  }
  return (
    <span title={title} className={cls}>
      {initials}
      {dot}
    </span>
  );
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
  // pending (coral pulse) > aging (amber) > archetype color.
  const dotClass = pending ? "bg-coral animate-pulse" : stale ? "bg-amber-400" : style.bg;
  const dotTitle = pending ? "Awaiting your decision" : stale ? `Aging >${STALE_DAYS}d in stage` : style.label;
  // Non-color cue inside the status dot: pending/aging get a distinct glyph,
  // otherwise the archetype icon — so state never rides on color alone.
  const StatusIcon = pending ? AlertCircle : stale ? Clock : ARCHETYPE_ICON[entry.archetype ?? "bau"] ?? Briefcase;
  const title = `${entry.candidateLabel} · ${style.label}${entry.matchScore != null ? ` · match ${entry.matchScore}` : ""}${
    days != null ? ` · ${days}d in stage` : ""
  }`;
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
    </div>
  );
}
