import { ARCHETYPE_STYLE, daysSince, STALE_DAYS, styleFor, type Entry, type PipelineEvent } from "./PipelineTypes";

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

export function EventDot({ kind }: { kind: string }) {
  const tone =
    kind === "rejected"
      ? "bg-coral"
      : kind === "advanced" || kind === "scheduled"
        ? "bg-moss"
        : "bg-steel";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />;
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
  const cls = `relative inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ${style.bg} ${ring}`;
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

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-steel">
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
