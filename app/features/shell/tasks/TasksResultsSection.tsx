"use client";

// The in-progress/done results region (loading hold, empty state, or the two
// Group lists), split out of TasksTab.tsx so it stays under the 200-line file
// cap. Verbatim markup/logic — same Tier 2 loading-hold distinction between
// "not loaded yet" and "genuinely no tasks".
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import type { Task } from "./TasksProvider";
import { RECENT_WINDOW_DAYS } from "./tasksTabHelpers";
import { Group } from "./TasksGroup";
import { ActiveCard } from "./TasksActiveCard";
import { DoneRow } from "./TasksDoneRow";

export function TasksResultsSection({
  loaded,
  active,
  done,
  filtering,
  onCancel,
}: {
  loaded: boolean;
  active: Task[];
  done: Task[];
  filtering: boolean;
  onCancel: (id: string) => void;
}) {
  const t = useTranslations("tasks");
  if (!loaded && active.length === 0 && done.length === 0) {
    // Tier 2: the first poll hasn't landed yet — hold the list's height,
    // invisibly, rather than asserting "no recent background tasks" about
    // a window we haven't actually checked yet.
    return <div className="reveal-quiet min-h-[10rem]" aria-hidden />;
  }
  if (active.length === 0 && done.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 bg-paper p-8 text-center">
        <Clock size={20} className="mx-auto text-steel" />
        <p className="mt-2 text-base font-medium text-ink">
          {filtering ? t("results.emptyFilteredTitle") : t("results.emptyTitle")}
        </p>
        <p className="mx-auto mt-1 max-w-md text-sm text-steel">
          {filtering ? t("results.emptyFilteredBody") : t("results.emptyBody", { days: RECENT_WINDOW_DAYS })}
        </p>
      </div>
    );
  }
  return (
    <>
      <Group title={t("results.inProgress")} count={active.length}>
        {active.length === 0 ? (
          <p className="text-base text-steel">{t("results.nothingRunning")}</p>
        ) : (
          <ul className="space-y-3">
            {active.map((t) => (
              <ActiveCard key={t.id} task={t} onCancel={() => onCancel(t.id)} />
            ))}
          </ul>
        )}
      </Group>

      {done.length > 0 ? (
        <Group title={t("results.doneWindow", { days: RECENT_WINDOW_DAYS })} count={done.length}>
          <ul className="divide-y divide-stone-100">
            {done.map((t) => (
              <DoneRow key={t.id} task={t} />
            ))}
          </ul>
        </Group>
      ) : null}
    </>
  );
}
