"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { ActionLine } from "@/app/_components/kit/ActionLine";
import { toast } from "@/app/_components/toast-store";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { postPipelineBatch } from "@/app/_lib/useAddToPipeline";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { PipelineTabState } from "../usePipelineTabState";
import type { PipelineKit } from "./usePipelineKit";
import { entryBatchItems, entryColumnCohort } from "./pipelineKitMoves";

/**
 * The picked role's own actions: the retired Subway row's title (open the job), "Rank candidates"
 * (the Fit matrix scoped to the job) and its context menu over the role's NEW arrivals (the entry
 * column): Accept all, Reject all (armed by a second click, because it notifies everyone) and AI
 * evaluate (one background batch_screen task). Outcomes come back as a toast in the reader's
 * language; the board reloads behind it. Shown only while a role is picked.
 */
export function PipelineKitRole({ s, k }: { s: PipelineTabState; k: PipelineKit }) {
  const t = useTranslations("pipeline.board");
  const tm = useTranslations("pipeline.board.lineMenu");
  const errMsg = useErrorMessage();
  const { startTask } = useTasks();
  const [armed, setArmed] = useState<string | null>(null);
  const role = k.role;
  if (!role) return null;
  const jobId = k.entries.find((e) => (e.jobTitle ?? "") === role && e.jobId)?.jobId ?? null;
  const cohort = entryColumnCohort(role, k.entries, s.axis);
  const n = cohort.length;

  const batch = async (action: "acceptAll" | "rejectAll") => {
    setArmed(null);
    const res = await postPipelineBatch(entryBatchItems(cohort, action, s.axis));
    if (!res.ok) {
      toast.error(errMsg({ code: res.code ?? undefined }, tm("failed")));
      return;
    }
    const ok = res.results.filter((r) => r.ok).length;
    const msg = tm(action === "acceptAll" ? "accepted" : "rejected", { ok, total: res.results.length });
    if (ok < res.results.length) toast.error(msg);
    else toast.success(msg);
    void s.load();
  };
  const evaluate = async () => {
    const started = await startTask("batch_screen", { entryIds: cohort.map((e) => e.id) });
    if (started) toast.info(tm("evaluating", { count: n }));
  };

  return (
    <ActionLine label={tm("aria", { count: n })}>
      {jobId ? <Button label={t("openJd")} variant="link" size="sm" onClick={() => s.openJob(jobId)} /> : null}
      {jobId ? <Button label={t("rankCandidates")} variant="link" size="sm" onClick={() => s.openPositionRanking(jobId)} /> : null}
      <span className="k-actline__sep" aria-hidden />
      <span className="k-actline__lead">{tm("scope", { count: n })}</span>
      <Button label={tm("acceptAll")} variant="secondary" size="sm" disabled={!n} onClick={() => void batch("acceptAll")} />
      <Button
        label={armed === role ? tm("confirmRejectAll", { count: n }) : tm("rejectAll")}
        variant="danger"
        size="sm"
        disabled={!n}
        onClick={() => (armed === role ? void batch("rejectAll") : setArmed(role))}
      />
      <Button label={tm("aiEvaluate")} variant="ghost" size="sm" disabled={!n} onClick={() => void evaluate()} />
    </ActionLine>
  );
}
