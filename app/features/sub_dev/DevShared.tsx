import type { ReactNode } from "react";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { formatFraction } from "@/app/_lib/format";
import type { LoadState } from "@/app/_lib/useLoader";
import type { CoverProbe, RubricDim } from "./DevTypes";

// Shared shell for the Dev studio's list sections (lifecycle, approved cases,
// postings, outbox). Owns the empty-vs-failed guard — an empty+healthy section
// renders nothing, an empty+failed one surfaces the outage (never an
// indistinguishable blank) — and the section header (icon, title, the `· count`
// chip, and the stale-data pill), so each caller supplies only its list body as
// children. `icon` is passed pre-styled so each section keeps its own glyph + accent.
export function DevSection({
  icon,
  title,
  count,
  state,
  label,
  children,
}: {
  icon: ReactNode;
  title: string;
  count: number;
  state: LoadState;
  label: string;
  children: ReactNode;
}) {
  if (count === 0) return <LoadStatus state={state} label={label} />;
  return (
    <section>
      <h3 className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        {icon} {title} <span className="text-coral">· {count}</span>
        <LoadStatus state={state} label={label} variant="pill" />
      </h3>
      {children}
    </section>
  );
}

export function MiniList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="text-micro font-semibold uppercase tracking-wide text-steel">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.slice(0, 5).map((it, i) => (
          <li key={i} className="flex gap-1 text-micro text-ink"><span className="text-moss">•</span><span>{it}</span></li>
        ))}
        {items.length === 0 ? <li className="text-micro text-steel">—</li> : null}
      </ul>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-micro font-semibold uppercase tracking-wide text-steel">{label}</span>
      {children}
    </label>
  );
}

// One internal covert-probe line — an uppercased kind chip, the `@where`/`where`
// location, and the `reveals` note — shared by the three internal panels that
// render it (CaseDetail, AnalysisView design preview, ReviewPanel). `tone` keeps
// the per-surface tint (amber for the live internal panels, stone for the review
// drawer) so the chip can stay color-coded to its context. `showDecisionSpace`
// adds CaseDetail's lettered (A./B./…) decision options below the line.
const PROBE_TONE = {
  amber: "bg-amber-100 text-amber-700",
  stone: "bg-stone-100 text-steel",
} as const;
export function ProbeRow({
  probe,
  tone = "amber",
  showDecisionSpace = false,
}: {
  probe: CoverProbe;
  tone?: keyof typeof PROBE_TONE;
  showDecisionSpace?: boolean;
}) {
  return (
    <>
      <p className="text-micro text-ink">
        <span className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${PROBE_TONE[tone]}`}>
          {(probe.kind ?? "probe").replace(/_/g, " ")}
        </span>{" "}
        {probe.where ? (
          <>
            <span className="text-steel">@ {probe.where}</span> —{" "}
          </>
        ) : null}
        {probe.reveals}
      </p>
      {showDecisionSpace && (probe.decisionSpace ?? []).length ? (
        <ul className="mt-1.5 space-y-0.5 border-l-2 border-amber-200 pl-2">
          {(probe.decisionSpace ?? []).map((opt, j) => (
            <li key={j} className="text-micro text-steel">
              <span className="font-semibold text-amber-700">{String.fromCharCode(65 + j)}.</span> {opt}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// One rubric-dimension chip — the label/name + its weight via the formatFraction
// range guard — shared by the CaseDetail and AnalysisView design-preview lists.
// `tone` keeps the two wrapper treatments (the bare `bg-paper` pill vs CaseDetail's
// ring + `title={description}`).
export function RubricChip({ dim, tone = "paper" }: { dim: RubricDim; tone?: "paper" | "amber" }) {
  const cls =
    tone === "amber"
      ? "rounded-full bg-white px-2 py-0.5 text-micro text-ink ring-1 ring-amber-200/70"
      : "rounded-full bg-paper px-2 py-0.5 text-micro text-ink";
  return (
    <span className={cls} title={tone === "amber" ? dim.description : undefined}>
      {dim.label ?? dim.name} <span className="text-steel">{formatFraction(dim.weight ?? 0, { label: "rubric weight" })}</span>
    </span>
  );
}
