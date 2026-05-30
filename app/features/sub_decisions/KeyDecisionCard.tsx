"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles, X } from "lucide-react";
import { useTasks } from "@/app/features/tasks/TasksProvider";
import { CandidateHead, MiniList, NextStage } from "./DecisionsShared";
import type { Entry, Reasoning } from "./DecisionsTypes";

export function KeyDecisionCard({
  entry,
  onAccept,
  onReject,
}: {
  entry: Entry;
  onAccept: () => void;
  onReject: () => void;
}) {
  const { startTask, tasks } = useTasks();
  const [reasoning, setReasoning] = useState<{ loading?: boolean; data?: Reasoning; error?: string } | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  const explain = async () => {
    if (reasoning?.loading || reasoning?.data) return;
    setReasoning({ loading: true });
    const t = await startTask("reasoning", { profileId: entry.candidateId, jobId: entry.jobId, label: entry.candidateLabel });
    if (!t) {
      setReasoning({ error: "Couldn't start the fit analysis." });
      return;
    }
    setTaskId(t.id);
  };

  useEffect(() => {
    if (!taskId) return;
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return;
    if (t.status === "succeeded") {
      const d = t.result as { reasoning?: Reasoning } | null;
      setReasoning(d?.reasoning ? { data: d.reasoning } : { error: "No reasoning returned." });
      setTaskId(null);
    } else if (t.status === "failed" || t.status === "canceled" || t.status === "interrupted") {
      setReasoning({ error: "Couldn't load the fit for this candidate." });
      setTaskId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, taskId]);

  return (
    <article className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel">
      <CandidateHead entry={entry} />
      <div className="mt-2">
        <NextStage stage={entry.stage} />
      </div>

      {reasoning?.data ? (
        <div className="mt-3 rounded-md border border-stone-200 bg-paper/50 p-2.5">
          <p className="text-base text-ink">{reasoning.data.verdict}</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <MiniList title="Strengths" items={reasoning.data.strengths} tone="green" />
            <MiniList title="Gaps" items={reasoning.data.gaps} tone="red" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={explain}
          disabled={reasoning?.loading}
          className="focus-ring mt-3 inline-flex items-center gap-1 rounded-md border border-stone-200 px-2 py-1 text-sm font-semibold text-coral hover:bg-paper disabled:opacity-50"
        >
          <Sparkles size={13} />
          {reasoning?.loading ? "Reading the fit…" : "Why this candidate?"}
        </button>
      )}
      {reasoning?.error ? <p className="mt-2 text-sm text-red-700">{reasoning.error}</p> : null}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          className="focus-ring inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-md bg-moss text-base font-semibold text-white hover:opacity-90"
        >
          <Check size={16} /> Advance
        </button>
        <button
          type="button"
          onClick={onReject}
          className="focus-ring inline-flex h-9 items-center justify-center gap-1 rounded-md border border-stone-200 px-3 text-base font-semibold text-coral hover:bg-coral/5"
        >
          <X size={16} /> Reject
        </button>
      </div>
    </article>
  );
}
