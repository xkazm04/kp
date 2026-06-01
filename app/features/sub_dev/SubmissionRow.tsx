"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Sparkles } from "lucide-react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { scoreColor, scoreTextColor } from "./DevHelpers";
import { EvalPanel } from "./EvalPanel";
import type { EvalBundle, Submission } from "./DevTypes";

export function SubmissionRow({ submission, caseId, rank, isTop = false, onChanged }: { submission: Submission; caseId: string | null; rank: number | null; isTop?: boolean; onChanged: () => void }) {
  const { startTask, tasks } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [promoted, setPromoted] = useState(false);
  const seen = useRef(false);
  const task = tasks.find((t) => t.id === taskId);
  const busy = task ? task.status === "running" || task.status === "queued" : false;
  const fresh = task?.status === "succeeded" ? (task.result as EvalBundle) : null;
  const ev = fresh ?? submission.evaluation ?? null;

  // reload postings once when the evaluate task lands (so the score persists into the list)
  useEffect(() => {
    if (task?.status === "succeeded" && !seen.current) {
      seen.current = true;
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.status]);

  const evaluate = async () => {
    seen.current = false;
    const t = await startTask("evaluate_submission", { submissionId: submission.id, candidateRef: submission.candidateRef });
    if (t) setTaskId(t.id);
  };
  const promote = async () => {
    const r = await fetch("/api/devcase/promote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissionId: submission.id }),
    });
    if (r.ok) setPromoted(true);
  };

  const ts = submission.transferScore ?? ev?.transfer?.transferScore ?? null;

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
            className={`shrink-0 rounded px-1.5 py-0.5 text-micro font-semibold nums ${scoreColor(ts)} ${scoreTextColor(ts)}`}
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
      {ev ? <EvalPanel ev={ev} onPromote={promote} promoted={promoted} /> : null}
    </li>
  );
}
