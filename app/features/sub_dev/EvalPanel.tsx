"use client";

import { Check, Send } from "lucide-react";
import { formatPercent } from "@/app/_lib/format";
import { sourceLabel } from "./DevHelpers";
import { ScoreBar } from "./ScoreBar";
import type { EvalBundle } from "./DevTypes";

export function EvalPanel({ ev, onPromote, promoted }: { ev: EvalBundle; onPromote: () => void; promoted: boolean }) {
  const r = ev.reflection ?? {};
  const t = ev.tooling ?? {};
  const e = ev.evaluation ?? {};
  const x = ev.transfer ?? {};
  const dims = e.dimensionScores ?? {};
  return (
    <div className="mt-2 rounded-md border border-stone-200 bg-white p-2.5 text-micro text-ink">
      {/* capability scores */}
      <div className="mb-1 flex items-center gap-2">
        <span className="text-micro font-semibold uppercase tracking-wide text-steel">Capability scores</span>
        <span className="ml-auto text-micro uppercase text-steel">
          transfer <b className="text-ink">{x.transferScore ?? "—"}</b> · <span className={ev.source === "partial" ? "text-amber-700" : undefined}>{sourceLabel(ev.source)}</span> · {ev.commitCount ?? 0} commits
        </span>
      </div>
      <div className="space-y-1">
        {["framing", "tooling", "judgment", "architecture", "transfer"].map((k, i) => (
          <ScoreBar key={k} label={k} value={dims[k] ?? 0} index={i} />
        ))}
      </div>
      {e.summary ? <p className="mt-1.5 text-micro text-ink">{e.summary}</p> : null}
      <div className="mt-1 grid grid-cols-2 gap-2 text-micro">
        {(e.strengths ?? []).length ? <div><span className="font-semibold text-moss">+ </span>{(e.strengths ?? []).join("; ")}</div> : null}
        {(e.concerns ?? []).length ? <div><span className="font-semibold text-coral">! </span>{(e.concerns ?? []).join("; ")}</div> : null}
      </div>

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
