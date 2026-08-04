"use client";

import { Check, CircleDot, MessageCircleQuestion, Send, TriangleAlert, X, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatFraction } from "@/app/_lib/format";
import { describeSource } from "./DevHelpers";
import { useDimensionLabel, useProbeKindLabel, useProbeStatusLabel } from "./DevLabels";
import { FollowupQuestionItem } from "./DevShared";
import { DevEvalPanelScores } from "./DevEvalPanelScores";
import { DevEvalPanelProcessTrace } from "./DevEvalPanelProcessTrace";
import { DevEvalPanelIntegrity } from "./DevEvalPanelIntegrity";
import { DevEvalPanelChecks } from "./DevEvalPanelChecks";
import { PROBE_KINDS, RUBRIC_DIMENSION_NAMES } from "./DevTypes";
import type { DimensionScore, EvalBundle, ProbeOutcome, ProbeStatus } from "./DevTypes";

// Probe-kind TINT only. The label moved to the i18n catalog (useProbeKindLabel) —
// what stays here is presentation, which is the same in every language. Keyed by
// PROBE_KINDS so a kind added in design.py fails the vocabulary guard rather than
// silently losing its colour.
const PROBE_KIND_TINT: Record<(typeof PROBE_KINDS)[number], string> = {
  legacy_trap: "bg-coral/15 text-coral",
  verification_trap: "bg-amber-100 text-amber-700",
  ambiguity: "bg-blue-50 text-blue-700",
  underspecified: "bg-stone-100 text-steel",
};
const probeKindTint = (k?: string) =>
  PROBE_KIND_TINT[k as (typeof PROBE_KINDS)[number]] ?? "bg-stone-100 text-steel";

// `handledWell` is TRI-state and `detected` is independent of it, so four
// combinations carry distinct meaning and the old three-way collapse mislabelled
// one of them. The observed Live Work Surface path CANNOT grade handling and emits
// handledWell=null by design (DevTypes: "Consumers must treat null as 'unknown',
// not 'failed'") — reading that as `missed` reported an assessment that never ran
// as a finding against the candidate, on exactly the path the product considers its
// strongest evidence.
const PROBE_STATUS_TONE: Record<ProbeStatus, { cls: string; Icon: LucideIcon }> = {
  handled: { cls: "text-moss", Icon: Check },
  unhandled: { cls: "text-coral", Icon: TriangleAlert },
  detected: { cls: "text-amber-700", Icon: CircleDot },
  missed: { cls: "text-coral", Icon: X },
};
function probeStatus(o: ProbeOutcome): ProbeStatus {
  if (o.handledWell === true) return "handled";
  if (o.handledWell === false) return "unhandled";
  return o.detected ? "detected" : "missed";
}

export function EvalPanel({ ev, onPromote, promoted, promoting = false }: { ev: EvalBundle; onPromote: () => void; promoted: boolean; promoting?: boolean }) {
  const tr = useTranslations("devcase.evalPanel");
  const dimensionLabel = useDimensionLabel();
  const probeKindLabel = useProbeKindLabel();
  const probeStatusLabel = useProbeStatusLabel();
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
      : RUBRIC_DIMENSION_NAMES.map((name) => ({ name, label: dimensionLabel(name), weight: 0, score: dims[name] ?? 0, description: "" }));
  // Prefer the explicit flag; fall back to array length for bundles saved before it existed.
  const hasFindings = e.hasFindings ?? Boolean((e.strengths ?? []).length || (e.concerns ?? []).length);
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5 text-micro text-ink">
      <DevEvalPanelScores ev={ev} breakdown={breakdown} hasFindings={hasFindings} />

      {/* trace + tooling (D5) */}
      <div className="mt-2 border-t border-stone-100 pt-2 text-micro text-steel">
        <span className="rounded bg-paper px-1.5 py-0.5 uppercase">{r.iterationPattern}</span>{" "}
        {tr("readBeforeWrite")} <b className="text-ink">{formatFraction(r.readBeforeWrite ?? 0, { label: "readBeforeWrite" })}</b>{" "}
        · {tr("fluency")} <b className="text-ink">{formatFraction(t.fluency ?? 0, { label: "fluency" })}</b>
        {(x.gaps ?? []).length ? <span> · {tr("gaps", { gaps: (x.gaps ?? []).join(", ") })}</span> : null}{" "}
        {/* Live Work Surface (moonshot E): was tooling WATCHED (in-product session)
            or RECONSTRUCTED from a git log? Observed > inferred. */}
        <span
          title={String(ev.perStepSources?.tooling) === "observed" ? tr("observedTitle") : tr("inferredTitle")}
          className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
            String(ev.perStepSources?.tooling) === "observed" ? "bg-moss/10 text-moss" : "bg-stone-100 text-steel"
          }`}
        >
          {String(ev.perStepSources?.tooling) === "observed" ? tr("observed") : tr("inferred")}
        </span>
      </div>

      <DevEvalPanelProcessTrace ev={ev} />

      {/* The anti-delegation controls' own findings. `integrity` is written only for
          a live in-product session (devcase-run.ts sets it from the `session:` repoRef
          branch), so it is also the reliable "was this watched?" tell for the checks
          panel below. Bundles saved before either field existed carry neither and
          render nothing at all — an old evaluation must not claim checks it never ran. */}
      {ev.integrity ? <DevEvalPanelIntegrity integrity={ev.integrity} /> : null}
      {ev.observedChecks ? <DevEvalPanelChecks checks={ev.observedChecks} live={ev.integrity != null} /> : null}

      {/* probe results (D5) — self-contained from denormalized kind/where, no case re-join */}
      {(t.probeOutcomes ?? []).length ? (
        <div className="mt-2 border-t border-stone-100 pt-2">
          <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-steel">{tr("probeResults")}</p>
          <ul className="space-y-1">
            {(t.probeOutcomes ?? []).map((o, i) => {
              const status = probeStatus(o);
              const tone = PROBE_STATUS_TONE[status];
              return (
                <li key={o.probeId ?? i} title={o.note || undefined} className="flex items-center gap-1.5 text-micro text-ink">
                  <span className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${probeKindTint(o.kind)}`}>
                    {probeKindLabel(o.kind)}
                  </span>
                  {o.where ? <span className="truncate text-steel">{tr("probeWhere", { where: o.where })}</span> : null}
                  <span
                    className={`ml-auto inline-flex shrink-0 items-center gap-1 font-semibold ${tone.cls}`}
                    /* `detected` means the area was worked but handling was never graded
                       (observed path) — say so, so an amber chip can't read as a failure. */
                    title={status === "detected" ? tr("probeStatusDetectedTitle") : undefined}
                  >
                    <tone.Icon size={12} /> {probeStatusLabel(status)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* interview follow-ups — the evaluation's actionable output: the artifact alone can be
          wholly LLM-produced, so each question verifies LIVE that the candidate owns one of
          the submission's observed decisions. listenFor/redFlag are interviewer-internal. */}
      {(ev.followups?.questions ?? []).length ? (
        <div className="mt-2 rounded-md border border-blue-200 bg-blue-50/60 p-2.5">
          <p className="flex items-center gap-1 text-micro font-semibold uppercase tracking-wide text-blue-700">
            <MessageCircleQuestion size={11} /> {tr("followupsTitle")}
          </p>
          <ol className="mt-1 list-decimal space-y-1.5 pl-4">
            {(ev.followups?.questions ?? []).map((q, i) => (
              <li key={q.id ?? i} className="text-micro text-ink">
                <FollowupQuestionItem q={q} index={i} showDecision />
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <p className="mt-1 text-micro italic text-steel">{tr("fairnessNote")}</p>

      {describeSource(ev.source).isDegraded ? (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-micro text-amber-800">{tr("degraded")}</p>
      ) : null}

      <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2">
        {promoted ? (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-moss"><Check size={13} /> {tr("inPipeline")}</span>
        ) : (
          <button type="button" onClick={onPromote} disabled={promoting}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-micro font-semibold text-white hover:opacity-90 disabled:opacity-50">
            <Send size={12} /> {promoting ? tr("promoting") : tr("promote")}
          </button>
        )}
        <span className="text-micro text-steel">{tr("promoteHint")}</span>
      </div>
    </div>
  );
}
