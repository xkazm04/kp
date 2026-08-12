"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { useTaskResult } from "./useTaskResult";

// The shared "wait or leave" affordance for an action that now runs as a
// background task. Rendered under the button that started the task, it makes
// the contract visible in one line: the run continues if you navigate away, and
// its outcome lands in Background tasks (where the unread badge flags it).
// The CALLER owns reacting to the outcome (useTaskResult's `full`/`error`) —
// this component narrates the flight, nothing more, so every converted surface
// tells the same story without re-inventing the copy.
export function TaskFlightNote({
  watch,
  className = "",
}: {
  /** The caller's useTaskResult(taskId) — pass the whole return value. */
  watch: ReturnType<typeof useTaskResult>;
  className?: string;
}) {
  const t = useTranslations("tasks.flight");
  if (!watch.active && !watch.loading) return null;
  return (
    <p role="status" className={`flex items-start gap-1.5 text-sm text-steel ${className}`}>
      <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-coral" aria-hidden />
      <span>
        <span className="font-medium text-ink">
          {watch.progressMsg || (watch.status === "queued" ? t("queued") : t("running"))}
        </span>{" "}
        {t("leaveNote")}
      </span>
    </p>
  );
}
