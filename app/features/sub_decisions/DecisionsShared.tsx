import { ChevronRight } from "lucide-react";
import { STAGES, styleFor, type Entry } from "./DecisionsTypes";

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-dashed border-stone-200 p-3 text-sm text-steel">{children}</p>;
}

export function NextStage({ stage }: { stage: string }) {
  const idx = STAGES.indexOf(stage);
  const next = STAGES[Math.min(idx + 1, STAGES.length - 1)];
  return (
    <span className="inline-flex items-center gap-1 text-sm text-steel">
      <span className="rounded bg-stone-100 px-1.5 py-0.5">{stage}</span>
      <ChevronRight size={12} />
      <span className="rounded bg-moss/10 px-1.5 py-0.5 font-semibold text-moss">{next}</span>
    </span>
  );
}

export function CandidateHead({ entry }: { entry: Entry }) {
  const s = styleFor(entry.archetype);
  const initials = entry.candidateLabel.split(" ").map((p) => p[0]).filter(Boolean).join("").slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <span className={`grid h-9 w-9 place-items-center rounded-full text-sm font-semibold text-white ${s.bg}`}>
        {initials}
      </span>
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink">{entry.candidateLabel}</p>
        <p className="truncate text-sm text-steel">
          {s.label} · {entry.jobTitle}
        </p>
      </div>
      {entry.matchScore != null ? (
        <span className="ml-auto rounded-md bg-paper px-2 py-1 text-center">
          <span className="block font-serif text-lg leading-none text-ink">{entry.matchScore}</span>
          <span className="text-sm uppercase text-steel">match</span>
        </span>
      ) : null}
    </div>
  );
}

export function MiniList({ title, items, tone }: { title: string; items: string[]; tone: "green" | "red" }) {
  const dot = tone === "green" ? "text-moss" : "text-coral";
  return (
    <div>
      <p className="text-sm font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 3).map((it, i) => (
          <li key={i} className="flex gap-1 text-sm text-ink">
            <span className={dot}>•</span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecBadge({ rec, confidence }: { rec?: string; confidence?: number }) {
  const tone =
    rec === "advance" ? "bg-moss/15 text-moss" : rec === "reject" ? "bg-coral/15 text-coral" : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm font-semibold uppercase ${tone}`}>
      {rec ?? "hold"}
      {typeof confidence === "number" ? ` · ${confidence}%` : ""}
    </span>
  );
}
