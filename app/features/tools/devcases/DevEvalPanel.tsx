"use client";

import { Check, CircleDot, MessageCircleQuestion, Send, X, type LucideIcon } from "lucide-react";
import { formatFraction } from "@/app/_lib/format";
import { describeSource } from "./DevHelpers";
import { FollowupQuestionItem } from "./DevShared";
import { DevEvalPanelScores } from "./DevEvalPanelScores";
import { DevEvalPanelProcessTrace } from "./DevEvalPanelProcessTrace";
import { DevEvalPanelIntegrity } from "./DevEvalPanelIntegrity";
import { DevEvalPanelChecks } from "./DevEvalPanelChecks";
import type { DimensionScore, EvalBundle, ProbeOutcome } from "./DevTypes";

// Human labels for the legacy fallback only — current evaluations carry their own labels.
const LEGACY_LABELS: Record<string, string> = {
  framing: "Problem framing",
  tooling: "Tooling fluency",
  judgment: "Judgment",
  architecture: "Architecture",
  transfer: "Transfer",
};

// Probe kind -> readable label + on-palette tint, so the results panel is
// scannable and color-coded by kind without re-joining to the case's cover_probes.
const PROBE_KIND: Record<string, { label: string; cls: string }> = {
  legacy_trap: { label: "Legacy trap", cls: "bg-coral/15 text-coral" },
  verification_trap: { label: "Verification trap", cls: "bg-amber-100 text-amber-700" },
  ambiguity: { label: "Ambiguity", cls: "bg-blue-50 text-blue-700" },
  underspecified: { label: "Underspecified", cls: "bg-stone-100 text-steel" },
};
const probeKind = (k?: string) => PROBE_KIND[k ?? ""] ?? { label: (k || "probe").replace(/_/g, " "), cls: "bg-stone-100 text-steel" };

function probeStatus(o: ProbeOutcome): { label: string; cls: string; Icon: LucideIcon } {
  if (o.handledWell) return { label: "handled", cls: "text-moss", Icon: Check };
  if (o.detected) return { label: "detected", cls: "text-amber-700", Icon: CircleDot };
  return { label: "missed", cls: "text-coral", Icon: X };
}

export function EvalPanel({ ev, onPromote, promoted, promoting = false }: { ev: EvalBundle; onPromote: () => void; promoted: boolean; promoting?: boolean }) {
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
      <DevEvalPanelScores ev={ev} breakdown={breakdown} hasFindings={hasFindings} />

      {/* trace + tooling (D5) */}
      <div className="mt-2 border-t border-stone-100 pt-2 text-micro text-steel">
        <span className="rounded bg-paper px-1.5 py-0.5 uppercase">{r.iterationPattern}</span>{" "}
        read-before-write <b className="text-ink">{formatFraction(r.readBeforeWrite ?? 0, { label: "readBeforeWrite" })}</b>{" "}
        · fluency <b className="text-ink">{formatFraction(t.fluency ?? 0, { label: "fluency" })}</b>
        {(x.gaps ?? []).length ? <span> · gaps: {(x.gaps ?? []).join(", ")}</span> : null}{" "}
        {/* Live Work Surface (moonshot E): was tooling WATCHED (in-product session)
            or RECONSTRUCTED from a git log? Observed > inferred. */}
        <span
          title={
            String(ev.perStepSources?.tooling) === "observed"
              ? "Tooling watched live in the in-product work surface."
              : "Tooling reconstructed from the submitted git log."
          }
          className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
            String(ev.perStepSources?.tooling) === "observed" ? "bg-moss/10 text-moss" : "bg-stone-100 text-steel"
          }`}
        >
          {String(ev.perStepSources?.tooling) === "observed" ? "observed" : "inferred"}
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
          <p className="mb-1 text-micro font-semibold uppercase tracking-wide text-steel">Probe results</p>
          <ul className="space-y-1">
            {(t.probeOutcomes ?? []).map((o, i) => {
              const k = probeKind(o.kind);
              const s = probeStatus(o);
              return (
                <li key={o.probeId ?? i} title={o.note || undefined} className="flex items-center gap-1.5 text-micro text-ink">
                  <span className={`rounded px-1 py-0.5 text-micro font-semibold uppercase ${k.cls}`}>{k.label}</span>
                  {o.where ? <span className="truncate text-steel">in {o.where}</span> : null}
                  <span className={`ml-auto inline-flex shrink-0 items-center gap-1 font-semibold ${s.cls}`}>
                    <s.Icon size={12} /> {s.label}
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
            <MessageCircleQuestion size={11} /> Interview follow-ups — verify authorship live
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

      <p className="mt-1 text-micro italic text-steel">
        Code assumed LLM-generated — using AI is never penalised. Scores are hypotheses from the artifact;
        the interview follow-ups above are what verifies them.
      </p>

      {describeSource(ev.source).isDegraded ? (
        <p className="mt-2 rounded bg-amber-50 px-2 py-1 text-micro text-amber-800">
          Degraded evaluation — some steps fell back to deterministic templates. Review before promoting.
        </p>
      ) : null}

      <div className="mt-2 flex items-center gap-2 border-t border-stone-100 pt-2">
        {promoted ? (
          <span className="inline-flex items-center gap-1 text-micro font-semibold text-moss"><Check size={13} /> In pipeline</span>
        ) : (
          <button type="button" onClick={onPromote} disabled={promoting}
            className="focus-ring inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-micro font-semibold text-white hover:opacity-90 disabled:opacity-50">
            <Send size={12} /> {promoting ? "Promoting…" : "Promote to pipeline"}
          </button>
        )}
        <span className="text-micro text-steel">→ becomes a Decisions review card</span>
      </div>
    </div>
  );
}
