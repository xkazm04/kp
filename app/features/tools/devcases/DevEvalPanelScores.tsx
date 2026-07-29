"use client";

// Capability scores header (transfer chip, provenance strip, confidence,
// authenticity, per-dimension bars, strengths/concerns) — split out of
// DevEvalPanel.tsx.
import { Info } from "lucide-react";
import { assertScore, formatFraction } from "@/app/_lib/format";
import { ProvenanceStrip } from "./DevProvenanceStrip";
import { ScoreBar } from "./DevScoreBar";
import { LOW_CONFIDENCE } from "./DevTypes";
import type { DimensionScore, EvalBundle } from "./DevTypes";

export function DevEvalPanelScores({
  ev,
  breakdown,
  hasFindings,
}: {
  ev: EvalBundle;
  breakdown: DimensionScore[];
  hasFindings: boolean;
}) {
  const e = ev.evaluation ?? {};
  const x = ev.transfer ?? {};

  return (
    <>
      {/* capability scores */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-steel">Capability scores</span>
        <span className="ml-auto text-micro uppercase text-steel">
          transfer <b className="text-ink">{x.transferScore != null ? assertScore(x.transferScore, "transferScore") : "—"}</b> · {ev.commitCount ?? 0} commits
        </span>
      </div>
      {/* per-step provenance + the propagated decision-confidence: muted/amber chips flag steps that
          fell back, and the conf badge (the min of the upstream reflection/tooling confidences) warns
          when the evaluation rests on thin/degraded evidence. Tinted coral at/below LOW_CONFIDENCE so a
          deterministic-fallback decision can't read as authoritative. Older bundles omit it (no badge). */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <ProvenanceStrip perStepSources={ev.perStepSources} source={ev.source} />
        {e.confidence != null ? (
          <span
            title="How much to trust this evaluation — the minimum confidence of the reflection + tooling signals it was built from."
            className={`text-micro uppercase ${e.confidence <= LOW_CONFIDENCE ? "font-semibold text-coral" : "text-steel"}`}
          >
            conf {formatFraction(e.confidence, { label: "confidence" })}
          </span>
        ) : null}
        {/* ce28da40 — process-authenticity: genuine incremental work vs likely
            paste-from-LLM, from the git trace + reflection. Suspect holds the
            submission for the live ownership-verifying interview. */}
        {ev.authenticity ? (
          <span
            title={
              ev.authenticity.reasons.length
                ? `Process authenticity ${ev.authenticity.score}/100 — ${ev.authenticity.reasons.join(" ")}`
                : `Process authenticity ${ev.authenticity.score}/100 — genuine incremental work.`
            }
            className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${
              ev.authenticity.band === "suspect"
                ? "bg-coral/15 text-coral"
                : ev.authenticity.band === "mixed"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-moss/15 text-moss"
            }`}
          >
            authenticity {ev.authenticity.score}
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        {breakdown.map((d, i) => (
          <ScoreBar key={d.name} label={d.label} value={d.score} weight={d.weight} title={d.description} index={i} />
        ))}
      </div>
      {e.summary ? <p className="mt-1.5 text-micro text-ink">{e.summary}</p> : null}
      {hasFindings ? (
        // bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #5): stack to one
        // column below `sm` (the two micro columns were unreadable in the embedded
        // recruiter drawer), and render each set as a REAL <ul> of <li> instead of a
        // `join("; ")` run-on so screen readers get list semantics and each item is
        // scannable on its own line.
        <div className="mt-1 grid grid-cols-1 gap-2 text-micro sm:grid-cols-2">
          {(e.strengths ?? []).length ? (
            <div>
              <p className="font-semibold text-moss">+ Strengths</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
                {(e.strengths ?? []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(e.concerns ?? []).length ? (
            <div>
              <p className="font-semibold text-coral">! Concerns</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
                {(e.concerns ?? []).map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
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
    </>
  );
}
