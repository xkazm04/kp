"use client";

// The checklist section of the onboarding run detail view. Split out of
// OnboardingRunDetailView.tsx to keep that file under the 200-line cap.

import { ListChecks } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/app/_components/Checkbox";
import type { OnboardingTask } from "@/app/_lib/onboarding";
import { useOnboardingLabels } from "./onboardingLabels";
import type { RunDetail } from "./onboardingRunDetailTypes";

export function OnboardingRunChecklist({
  tasks,
  doneIds,
  progress,
  onToggle,
}: {
  tasks: OnboardingTask[];
  doneIds: Set<string>;
  progress: RunDetail["progress"];
  onToggle: (taskId: string, done: boolean) => void;
}) {
  const t = useTranslations("onboarding");
  // F16 — a stored task carries a language-neutral id; the label is the fallback.
  const { taskLabel } = useOnboardingLabels();
  return (
    <section className="rounded-md border border-stone-200 bg-white p-4">
      <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
        <ListChecks size={13} /> {t("checklist")} · {t("progress", { done: progress.done, total: progress.total })}
      </p>
      <ul className="mt-3 space-y-2" role="list">
        {tasks.map((task) => {
          const done = doneIds.has(task.id);
          return (
            <li key={task.id}>
              <label className="flex cursor-pointer items-center gap-2.5 text-base text-ink">
                <Checkbox checked={done} onChange={(e) => onToggle(task.id, e.target.checked)} />
                <span className={done ? "text-steel line-through" : ""}>{taskLabel(task)}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
