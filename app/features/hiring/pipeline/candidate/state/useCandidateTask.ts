"use client";

// An AI task on the candidate (screen, prep, scorecard, offer, outreach, rejection,
// rematch), run through the background-task system: it survives closing the modal,
// and a duplicate click reuses the in-flight task. Completion is consumed DURING
// render (guarded — pendingId clears in the same pass, so it runs once per task);
// only the parent notification and the toast, which touch state outside this
// component, live in effects.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useTaskResult, useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { scorecardTaskNotes, type Result, type TaskId } from "../../PipelineCandidateDrawerTypes";

/** Outcomes that changed the entry — the board behind the modal must reload. */
const APPLIED = ["advanced", "held_for_review", "scorecard_ready", "offer_ready", "rematched"];

export function useCandidateTask({
  entry,
  onChanged,
}: {
  entry: { id: string; candidateLabel: string };
  onChanged: () => void;
}) {
  const t = useTranslations("pipeline.drawer");
  const { startTask } = useTasks();
  const [busy, setBusy] = useState<TaskId | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The runner's own ENGLISH diagnostic (no code to resolve): never the sentence a
  // recruiter reads, only a tooltip on the localized error line.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // OO-L2-12 — one-shot trigger for the give-up toast (bumped in render, consumed in an effect).
  const [resultLostCount, setResultLostCount] = useState(0);

  /** `note` is the LIVE recruiter note (unsaved edits included); only the scorecard
   *  synthesis consumes it (note-truth-unification). */
  const run = async (task: TaskId, note: string) => {
    setBusy(task);
    setError(null);
    setErrorDetail(null);
    setResult(null);
    setPendingId(null);
    const started = await startTask("automation", {
      entryId: entry.id,
      task,
      notes: scorecardTaskNotes(task, note),
      entryLabel: entry.candidateLabel,
    });
    if (!started) {
      setError(t("taskStartFailed"));
      setBusy(null);
      return;
    }
    setPendingId(started.id);
  };

  const { status, error: actionError, full, resultUnavailable } = useTaskResult(pendingId);
  if (pendingId && status === "succeeded" && full) {
    const data = full.result as { result: Record<string, unknown>; source: string; applied: string } | null;
    const sub = (((full.params as { task?: string } | null)?.task ?? busy) ?? "screen") as TaskId;
    if (data) setResult({ task: sub, data: data.result, source: data.source, applied: data.applied });
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && (status === "failed" || status === "canceled" || status === "interrupted")) {
    setError(t("taskIncomplete"));
    setErrorDetail(actionError);
    setBusy(null);
    setPendingId(null);
  } else if (pendingId && resultUnavailable) {
    // Finished server-side, but the result record cannot be fetched: resolve the
    // spinner and say so; the unlocked button is the retry.
    setError(t("resultLoadFailed"));
    setErrorDetail(null);
    setBusy(null);
    setPendingId(null);
    setResultLostCount((n) => n + 1);
  }

  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  });
  useEffect(() => {
    if (resultLostCount > 0) toast.error(tRef.current("resultLoadFailed"));
  }, [resultLostCount]);
  // Keyed on the consumed result object: a fresh object per completion → one reload.
  const appliedResult = result && APPLIED.includes(result.applied) ? result : null;
  useEffect(() => {
    if (appliedResult) onChangedRef.current();
  }, [appliedResult]);

  return { busy, error, errorDetail, result, run };
}
