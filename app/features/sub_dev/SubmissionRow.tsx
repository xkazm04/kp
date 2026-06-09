"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Sparkles } from "lucide-react";
import { useTasks, useTaskResult } from "@/app/features/tasks/TasksProvider";
import { assertScore, scoreTone, type ScoreTone } from "@/app/_lib/format";
import { EvalPanel } from "./EvalPanel";
import type { EvalBundle, Submission } from "./DevTypes";

// The transfer-fit chip on the canonical score scale — scoreTone owns the 75/50
// cutoffs, so a fit score can never read strong-green here yet mid on a badge or
// dial elsewhere (the four-band 72/55/40 dev scale this replaced silently did).
// Solid `--color-score-*` fill with a legible foreground: white on the darker
// moss/coral bands, ink on the lighter amber mid band.
const CHIP_TONE: Record<ScoreTone, string> = {
  strong: "bg-score-strong text-white",
  mid: "bg-score-mid text-ink",
  weak: "bg-score-weak text-white",
  null: "bg-score-null text-white",
};

export function SubmissionRow({ submission, rank, isTop = false, onChanged }: { submission: Submission; rank: number | null; isTop?: boolean; onChanged: () => void }) {
  const { startTask } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState(false);
  const [promoting, setPromoting] = useState(false);
  // Server truth OR the local just-clicked flag: an already-promoted submission — earlier
  // this session before a reload, or auto-promoted by the lifecycle pipeline — must not
  // re-expose the Promote button, since a second promote re-sends the invite from the outbox.
  const isPromoted = promoted || submission.status === "promoted";
  const seen = useRef(false);
  // The poll omits the eval bundle; useTaskResult fetches it on demand once the
  // evaluate task finishes. `fresh` stays null during that brief fetch, falling
  // back to the submission's saved evaluation.
  const { status: evalStatus, full: evalFull } = useTaskResult(taskId);
  const busy = evalStatus === "running" || evalStatus === "queued";
  const fresh = evalStatus === "succeeded" ? ((evalFull?.result as EvalBundle | undefined) ?? null) : null;
  const ev = fresh ?? submission.evaluation ?? null;

  // reload postings once when the evaluate task lands (so the score persists into the list)
  useEffect(() => {
    if (evalStatus === "succeeded" && !seen.current) {
      seen.current = true;
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalStatus]);

  const evaluate = async () => {
    seen.current = false;
    const t = await startTask("evaluate_submission", { submissionId: submission.id, candidateRef: submission.candidateRef });
    if (t) setTaskId(t.id);
  };
  const promote = async () => {
    if (promoting || isPromoted) return; // in-flight + already-promoted double-promote guard
    setPromoting(true);
    try {
      const r = await fetch("/api/devcase/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId: submission.id }),
      });
      if (r.ok) setPromoted(true);
    } finally {
      setPromoting(false);
    }
  };

  const tsRaw = submission.transferScore ?? ev?.transfer?.transferScore ?? null;
  // Guard the 0..100 score domain before it tones/labels the fit chip.
  const ts = tsRaw == null ? null : assertScore(tsRaw, "transferScore");

  return (
    <li className={`rounded-md border p-2 ${isTop ? "border-moss/30 bg-moss/5 ring-1 ring-moss/40" : "border-stone-100 bg-paper/40"}`}>
      <div className="flex items-center gap-1.5 text-micro">
        {rank ? (
          <span className={`shrink-0 rounded px-1 text-micro font-bold text-white ${rank === 1 ? "bg-moss" : "bg-ink"}`}>#{rank}</span>
        ) : null}
        {isTop ? (
          <span className="shrink-0 rounded-full bg-moss/15 px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-moss">
            Top match
          </span>
        ) : null}
        <GitBranch size={11} className="shrink-0 text-steel" />
        <span className="font-semibold text-ink">{submission.candidateRef}</span>
        <span className="min-w-0 flex-1 truncate text-steel">{submission.repoRef}</span>
        {ts != null ? (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold nums ${CHIP_TONE[scoreTone(ts)]}`}
            aria-label={`Transfer fit score ${ts} of 100`}
          >
            {ts}<span className="opacity-70"> fit</span>
          </span>
        ) : null}
        <button type="button" onClick={evaluate} disabled={busy}
          className="focus-ring inline-flex h-6 shrink-0 items-center gap-1 rounded border border-stone-200 bg-white px-1.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50">
          <Sparkles size={10} /> {busy ? "Evaluating…" : ev ? "Re-evaluate" : "Evaluate"}
        </button>
      </div>
      {ev ? <EvalPanel ev={ev} onPromote={promote} promoted={isPromoted} promoting={promoting} /> : null}
    </li>
  );
}
