"use client";

// Starts the board's cohort drafter (`batch_outreach`) for a picked cohort and, when the run
// finishes, hands back the entries it drafted a held letter for, so the bulk dry-run sheet
// (BulkOutreachSheet) can open on them. The task only DRAFTS (comms scope C2): nothing is
// sent from here, and the release stays the sheet's per-letter doors.

import { useCallback, useState } from "react";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import { draftedEntryIds } from "./outreachBulk";
import { useTaskResult } from "@/app/features/shell/tasks/useTaskResult";

export type BatchOutreachPhase = "idle" | "running" | "failed" | "none";

export function useBatchOutreach() {
  const { startTask } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [phase, setPhase] = useState<BatchOutreachPhase>("idle");
  const [sheet, setSheet] = useState<string[] | null>(null);
  const task = useTaskResult(taskId);

  // Settled during render (once per run), not in an effect: a pure state hand-off.
  if (taskId) {
    if (task.status === "failed" || task.status === "interrupted" || task.status === "canceled" || task.resultUnavailable) {
      setTaskId(null);
      setPhase("failed");
    } else if (task.full && task.full.id === taskId) {
      const drafted = draftedEntryIds(task.full.result);
      setTaskId(null);
      setPhase(drafted.length > 0 ? "idle" : "none");
      if (drafted.length > 0) setSheet(drafted);
    }
  }

  const start = useCallback(
    async (entryIds: readonly string[]) => {
      if (taskId || entryIds.length === 0) return;
      setPhase("running");
      const started = await startTask("batch_outreach", { entryIds: [...entryIds] });
      if (started) setTaskId(started.id);
      else setPhase("failed");
    },
    [startTask, taskId]
  );
  const closeSheet = useCallback(() => setSheet(null), []);

  return { start, phase, running: phase === "running", sheet, closeSheet };
}
