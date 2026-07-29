// "Explain fit" background-task wiring, split out of MatchCard.tsx: starts the
// reasoning task and consumes its result render-phase (guarded, once per task) so it
// paints in the same commit instead of one effect-frame later.
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTasks, useTaskResult } from "@/app/features/shell/tasks/TasksProvider";
import type { MatchRef, Reasoning, ReasoningState } from "@/app/features/shared/matchTypes";

export function useMatchCardReasoning(args: {
  t: ReturnType<typeof useTranslations>;
  matchRef: MatchRef;
  jobId: string;
  title: string;
}) {
  const { t, matchRef, jobId, title } = args;
  // MAT1 — the recruiter's active locale is the language the "Explain fit"
  // verdict/strengths/gaps narrative should come back in; ride it in the task
  // params (the detached task can't read the cookie).
  const locale = useLocale();
  const { startTask } = useTasks();
  const [reasoning, setReasoning] = useState<ReasoningState | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

  // Routed through the background-task system: tracked, dedup'd, refresh-safe.
  const explain = async () => {
    if (reasoning?.loading) return;
    setReasoning({ loading: true });
    const started = await startTask("reasoning", { ...matchRef, jobId, label: title, lang: locale });
    if (!started) {
      setReasoning({ error: t("card.startFailed") });
      return;
    }
    setTaskId(started.id);
  };

  const { status: reasoningStatus, error: reasoningError, full: reasoningFull } = useTaskResult(taskId);
  // Task completion is consumed DURING render (guarded: taskId is cleared in the
  // same pass, so this runs once per task) — the guarded render-phase pattern,
  // so the result paints in the same commit instead of one effect-frame later.
  if (taskId && reasoningStatus === "succeeded" && reasoningFull) {
    const p = reasoningFull.result as { reasoning?: Reasoning; source?: string; cached?: boolean; narrativeLang?: string } | null;
    setReasoning(p?.reasoning ? { data: p.reasoning, source: p.source, cached: p.cached, narrativeLang: p.narrativeLang } : { error: t("card.noReasoning") });
    setTaskId(null);
  } else if (taskId && (reasoningStatus === "failed" || reasoningStatus === "canceled" || reasoningStatus === "interrupted")) {
    setReasoning({ error: reasoningError ?? t("card.reasoningFailed") });
    setTaskId(null);
  }

  return { reasoning, explain };
}
