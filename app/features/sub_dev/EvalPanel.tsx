"use client";

import { Check, CircleDot, Info, MessageCircleQuestion, Send, X, type LucideIcon } from "lucide-react";
import { assertScore, formatFraction } from "@/app/_lib/format";
import { describeSource } from "./DevHelpers";
import { ProvenanceStrip } from "./ProvenanceStrip";
import { ScoreBar } from "./ScoreBar";
import { LOW_CONFIDENCE } from "./DevTypes";
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
        read-before-write <b className="text-ink">{formatFraction(r.readBeforeWrite ?? 0, { label: "readBeforeWrite" })}</b>{" "}
        · fluency <b className="text-ink">{formatFraction(t.fluency ?? 0, { label: "fluency" })}</b>
        {(x.gaps ?? []).length ? <span> · gaps: {(x.gaps ?? []).join(", ")}</span> : null}
      </div>

      {/* process trace (DEVP6) — persisted "so the decisions-log contract is checkable
          later instead of taken on faith"; this strip is where it finally is. Keeping
          the DECISIONS log is a mandated task of the case (coral when skipped); cadence
          is a how-they-worked signal, deliberately framed neutrally, not as a verdict. */}
      {ev.processTrace ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-micro">
          <span
            className={`rounded px-1.5 py-0.5 font-semibold uppercase ${
              ev.processTrace.decisionsLogPresent ? "bg-moss/10 text-moss" : "bg-coral/15 text-coral"
            }`}
          >
            DECISIONS log: {ev.processTrace.decisionsLogPresent ? "kept" : "missing"}
          </span>
          {ev.processTrace.cadence?.spanHours != null ? (
            <span className="text-steel">
              {ev.processTrace.commitCount ?? ev.commitCount ?? 0} commits over{" "}
              {Math.round(ev.processTrace.cadence.spanHours * 10) / 10} h
            </span>
          ) : null}
          {ev.processTrace.cadence?.bursty === true ? (
            <span className="rounded bg-paper px-1.5 py-0.5 text-steel" title="Commits landed in one tight burst — how they worked, not a verdict">
              single sitting
            </span>
          ) : null}
        </div>
      ) : null}

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
                {q.decision ? <span className="text-steel">[{q.decision}] </span> : null}
                {q.question}
                {q.listenFor ? (
                  <span className="block text-micro text-steel">Listen for: {q.listenFor}</span>
                ) : null}
                {q.redFlag ? (
                  <span className="block text-micro text-coral/80">Red flag: {q.redFlag}</span>
                ) : null}
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
