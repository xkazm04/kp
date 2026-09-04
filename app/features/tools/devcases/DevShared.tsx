"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { LoadStatus } from "@/app/_components/LoadStatus";
import { useProbeKindLabel } from "./DevLabels";
import { formatFraction } from "@/app/_lib/format";
import type { LoadState } from "@/app/_lib/useLoader";
import type { CoverProbe, FollowupQuestion, RubricDim } from "./DevTypes";

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
  // Tier 2 (docs/design/loading-choreography.md): distinguish "the first fetch hasn't
  // landed yet" from "genuinely nothing here" — the former holds the section's
  // space invisibly instead of collapsing straight to nothing.
  if (count === 0 && state.lastUpdated == null && !state.failed) {
    return <div className="reveal-quiet min-h-[6rem]" aria-hidden />;
  }
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
  // The kind chip through the SAME hook the eval panel uses. De-underscoring the raw
  // enum here while the panel one screen over localized it is exactly the split
  // DevLabels exists to make impossible; `useProbeKindLabel` also owns the
  // "kind absent" word, so the `?? "probe"` placeholder goes with it.
  const probeKind = useProbeKindLabel();
  return (
    <>
      <p className="text-micro text-ink">
        <span className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${PROBE_TONE[tone]}`}>
          {probeKind(probe.kind)}
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

// One interview follow-up question with its interviewer-internal "Listen for" /
// "Red flag" notes — shared by EvalPanel's `<ol>` and InterviewKit's `<ol>`.
// `showDecision` adds EvalPanel's `[decision]` prefix. listenFor/redFlag are
// must-never-be-candidate-facing notes, so both surfaces render them identically.
export function FollowupQuestionItem({
  q,
  index,
  showDecision = false,
}: {
  q: FollowupQuestion;
  index: number;
  showDecision?: boolean;
}) {
  // The two interviewer-internal leads. They read as labels rather than copy, which is
  // how they stayed English on both surfaces that render them — including the interview
  // kit's exported Markdown, whose scaffolding is otherwise entirely in the reader's
  // language (devcase-interview-kit.ts).
  const t = useTranslations("devcase.followup");
  // EvalPanel renders the question inline (with an optional `[decision]` prefix)
  // and its notes as `block` spans inside one `<li>`; InterviewKit renders a
  // numbered `<p>` then `<p>` notes inside a card `<li>`. Branch on `showDecision`
  // so each surface keeps its exact markup.
  if (showDecision) {
    return (
      <>
        {q.decision ? <span className="text-steel">[{q.decision}] </span> : null}
        {q.question}
        {q.listenFor ? (
          <span className="block text-micro text-steel">{t("listenFor", { note: q.listenFor })}</span>
        ) : null}
        {q.redFlag ? (
          <span className="block text-micro text-coral/80">{t("redFlag", { note: q.redFlag })}</span>
        ) : null}
      </>
    );
  }
  return (
    <>
      <p className="font-medium text-ink">
        {index + 1}. {q.question}
      </p>
      {q.listenFor ? <p className="mt-0.5 text-steel">{t("listenFor", { note: q.listenFor })}</p> : null}
      {q.redFlag ? <p className="mt-0.5 text-coral/80">{t("redFlag", { note: q.redFlag })}</p> : null}
    </>
  );
}
