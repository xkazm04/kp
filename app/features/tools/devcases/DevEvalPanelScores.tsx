"use client";

// Capability scores header (transfer chip, provenance strip, confidence,
// authenticity, per-dimension bars, strengths/concerns) — split out of
// DevEvalPanel.tsx.
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { assertScore, formatFraction } from "@/app/_lib/format";
import { findingsSource } from "./DevHelpers";
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
  const t = useTranslations("devcase.processTrace");
  const tr = useTranslations("devcase.evalPanel");
  const e = ev.evaluation ?? {};
  const x = ev.transfer ?? {};

  return (
    <>
      {/* capability scores */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-steel">{tr("capabilityScores")}</span>
        <span className="ml-auto text-micro uppercase text-steel">
          {tr("transfer")} <b className="text-ink">{x.transferScore != null ? assertScore(x.transferScore, "transferScore") : "—"}</b> ·{" "}
          {/* A Live Work Surface submission has no git history BY DESIGN, so the
              commit count is structurally 0 for it — and "0 commits" beside a score
              reads as a finding about the candidate rather than a property of the
              path. `tooling.signals` is emitted only by the observed path, so it is
              the tell. */}
          {ev.tooling?.signals ? t("inProductSession") : tr("commits", { count: ev.commitCount ?? 0 })}
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
            title={tr("confidenceTitle")}
            className={`text-micro uppercase ${e.confidence <= LOW_CONFIDENCE ? "font-semibold text-coral" : "text-steel"}`}
          >
            {tr("confidence", { pct: formatFraction(e.confidence, { label: "confidence" }) })}
          </span>
        ) : null}
        {/* ce28da40 — process-authenticity: genuine incremental work vs likely
            paste-from-LLM, from the git trace + reflection. Suspect holds the
            submission for the live ownership-verifying interview. */}
        {ev.authenticity ? (
          <span
            /* The `reasons` themselves stay English prose for now — they are
                constructed sentence-by-sentence in devcase-authenticity.ts and
                localizing them means a codes+params contract shared with the Python
                evidence[] producers. Tracked as a named gap in the feature doc; the
                FRAME around them is translated so the tooltip is not wholly English. */
            title={
              ev.authenticity.reasons.length
                ? tr("authenticityTitle", { score: ev.authenticity.score, reasons: ev.authenticity.reasons.join(" ") })
                : tr("authenticityCleanTitle", { score: ev.authenticity.score })
            }
            className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${
              ev.authenticity.band === "suspect"
                ? "bg-coral/15 text-coral"
                : ev.authenticity.band === "mixed"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-moss/15 text-moss"
            }`}
          >
            {tr("authenticity", { score: ev.authenticity.score })}
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
              <p className="font-semibold text-moss">{tr("strengths")}</p>
              <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-ink">
                {(e.strengths ?? []).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {(e.concerns ?? []).length ? (
            <div>
              <p className="font-semibold text-coral">{tr("concerns")}</p>
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
            {/* The findings come from the EVALUATE step, so the explanation for an
                empty set must read that step's provenance — not the whole run's.
                `source` is "partial" for any mix, and a partial run whose evaluate
                step really did call the LLM was told to "re-run with the LLM",
                relabelling a genuine LLM verdict as a template artifact. */}
            {findingsSource(ev) === "llm" ? tr("noFindingsLlm") : tr("noFindingsDeterministic")}
          </span>
        </div>
      )}
    </>
  );
}
