"use client";

// The row context menu's handlers: Accept all / Reject all through the same batch
// route the bulk bar uses (one POST, per-item guards), AI evaluate as ONE background
// `batch_screen` task over the named cohort. Outcomes reach the recruiter as a toast
// in their language; the board reloads behind it.

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import type { StageDef } from "@/app/_lib/pipeline-stages";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { postPipelineBatch } from "@/app/_lib/useAddToPipeline";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { Entry, Position } from "@/app/features/shared/pipelineTypes";
import { entryColumnCohort, lineBatchItems } from "./lineActions";
import type { LineAction } from "./map/mapTypes";

export function useLineActions({
  entries,
  axis,
  reload,
}: {
  entries: readonly Entry[] | null;
  axis: readonly StageDef[];
  reload: () => void;
}) {
  const t = useTranslations("pipeline.board.lineMenu");
  const errMsg = useErrorMessage();
  const { startTask } = useTasks();

  return useCallback(
    async (position: Position, action: LineAction) => {
      const cohort = entryColumnCohort(position, entries ?? [], axis);
      if (cohort.length === 0) {
        toast.info(t("nothingToDo"));
        return;
      }
      if (action === "aiEvaluate") {
        const started = await startTask("batch_screen", { entryIds: cohort.map((e) => e.id) });
        if (started) toast.info(t("evaluating", { count: cohort.length }));
        return;
      }
      const res = await postPipelineBatch(lineBatchItems(cohort, action, axis));
      if (!res.ok) {
        toast.error(errMsg({ code: res.code ?? undefined }, t("failed")));
        return;
      }
      const ok = res.results.filter((r) => r.ok).length;
      const failed = res.results.length - ok;
      const msg = t(action === "acceptAll" ? "accepted" : "rejected", { ok, total: res.results.length });
      if (failed > 0) toast.error(msg);
      else toast.success(msg);
      reload();
    },
    [entries, axis, reload, startTask, errMsg, t],
  );
}
