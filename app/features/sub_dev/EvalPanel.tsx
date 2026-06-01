"use client";

import { Check, Info, Send } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { ProvenanceStrip } from "./ProvenanceStrip";
import { ScoreBar } from "./ScoreBar";
import type { DimensionScore, EvalBundle } from "./DevTypes";

// Human labels for the legacy fallback only — current evaluations carry their own labels.
const LEGACY_LABELS: Record<string, string> = {
  framing: "Problem framing",
  tooling: "Tooling fluency",
  judgment: "Judgment",
  architecture: "Architecture",
  transfer: "Transfer",
};

export function EvalPanel({ ev, onPromote, promoted }: { ev: EvalBundle; onPromote: () => void; promoted: boolean }) {
  const r = ev.reflection ?? {};
  const t = ev.tooling ?? {};
  const e = ev.evaluation ?? {};
  const x = ev.transfer ?? {};
  const dims = e.dimensionScores ?? {};
  // Prefer the self-describing, weight-annotated breakdown emitted by the evaluator (ordered,
  // with labels + weights). Fall back to the legacy hardcoded order for bundles saved before
  // `dimensions` existed, so old evaluations still render.
  const breakdown: DimensionScore[] =
    e.dimensions && e.dimensions.length
      ? e.dimensions
      : Object.keys(LEGACY_LABELS).map((name) => ({ name, label: LEGACY_LABELS[name], weight: 0, score: dims[name] ?? 0, description: "" }));
  // Prefer the explicit flag; fall back to array length for bundles saved before it existed.
  const hasFindings = e.hasFindings ?? Boolean((e.strengths ?? []).length || (e.concerns ?? []).length);
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5 text-micro text-ink">
      {/* capability scores */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-steel">Capability scores</span>
        <span className="ml-auto text-micro uppercase text-steel">
          transfer <b className="text-ink">{x.transferScore ?? "—"}</b> · {ev.commitCount ?? 0} commits
        </span>
      </div>
      {/* per-step provenance: one consistent strip across the pipeline; muted/amber chips flag steps that fell back */}
      <ProvenanceStrip className="mb-1.5" perStepSources={ev.perStepSources} source={ev.source} />
      <div className="space-y-1">
        {breakdown.map((d, i) => (
          <ScoreBar key={d.name} label={d.label} value={d.score} weight={d.weight} title={d.description} index={i} />
        ))}
      </div>
      {e.summary ? <p className="mt-1.5 text-micro text-ink">{e.summary}</p> : null}
      {hasFindings ? (
        <div className="mt-1 grid grid-cols-2 gap-2 text-micro">
          {(e.strengths ?? []).length ? <div><span className="font-semibold text-moss">+ </span>{(e.strengths ?? []).join("; ")}</div> : null}
          {(e.concerns ?? []).length ? <div><span className="font-semibold text-coral">! </span>{(e.concerns ?? []).join("; ")}</div> : null}
        </div>
      ) : (
        <div className="mt-1 flex items-start gap-1.5 rounded bg-paper px-2 py-1 text-micro text-steel">
          <Info size={12} className="mt-px shrink-0" aria-hidden />
          <span>
            {ev.source === "llm"
              ? "No standout strengths or concerns surfaced for this submission."
              : "No strengths surfaced yet — re-run with the LLM for a richer read."}
          </span>
        </div>
      )}

      {/* trace + tooling (D5) */}
      <div className="mt-2 border-t border-stone-100 pt-2 text-micro text-steel">
        <span className="rounded bg-paper px-1.5 py-0.5 uppercase">{r.iterationPattern}</span>{" "}
        read-before-write <b className="text-ink">{formatPercent(r.readBeforeWrite ?? 0, { fraction: true })}</b>{" "}
        · fluency <b className="text-ink">{formatPercent(t.fluency ?? 0, { fraction: true })}</b>
        {(x.gaps ?? []).length ? <span> · gaps: {(x.gaps ?? []).join(", ")}</span> : null}
      </div>
      <p className="mt-1 text-micro italic text-steel">Code assumed LLM-generated — using AI is never penalised; judged on judgment + verification + transfer.</p>

      {ev.source === "partial" ? (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-micro text-amber-800">
          Degraded evaluation — some steps fell back to deterministic templates. Review before promoting.
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2">
        {promoted ? (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-moss"><Check size={13} /> In pipeline</span>
        ) : (
          <button type="button" onClick={onPromote}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-micro font-semibold text-white hover:opacity-90">
            <Send size={12} /> Promote to pipeline
          </button>
        )}
        <span className="text-micro text-steel">→ becomes a Decisions review card</span>
      </div>
    </div>
  );
}
