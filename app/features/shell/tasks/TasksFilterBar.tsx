"use client";

// DATA6 — the task-list filter bar (free text, kind select, terminal-status
// chips, clear), split out of TasksTab.tsx so it stays under the 200-line file
// cap. Verbatim markup — same client-side filter contract (PIPE2/RES3 pattern).
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { Select } from "@/app/_components/Select";
import type { TaskStatus } from "./TasksProvider";
import { FILTER_STATUSES } from "./tasksTabHelpers";

export function TasksFilterBar({
  textFilter,
  setTextFilter,
  kindFilter,
  setKindFilter,
  kinds,
  statusFilter,
  setStatusFilter,
  filtering,
  onClear,
}: {
  textFilter: string;
  setTextFilter: (v: string) => void;
  kindFilter: string;
  setKindFilter: (v: string) => void;
  kinds: string[];
  statusFilter: TaskStatus | null;
  setStatusFilter: (updater: (cur: TaskStatus | null) => TaskStatus | null) => void;
  filtering: boolean;
  onClear: () => void;
}) {
  const t = useTranslations("tasks");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="tasks-search" className="sr-only">
        {t("filter.searchLabel")}
      </label>
      <TextInput
        id="tasks-search"
        type="search"
        value={textFilter}
        onChange={(e) => setTextFilter(e.target.value)}
        placeholder={t("filter.searchPlaceholder")}
        sizeVariant="sm"
        className="min-w-[180px] flex-1"
      />
      <Select
        value={kindFilter}
        onChange={setKindFilter}
        ariaLabel={t("filter.kindAria")}
        size="sm"
        // A task KIND is a canonical wire slug (`jd_build`, `batch_screen`) — the
        // same identifier the row prints in mono type, not copy. It stays verbatim.
        options={[{ value: "", label: t("filter.allKinds") }, ...kinds.map((k) => ({ value: k, label: k }))]}
      />
      {FILTER_STATUSES.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
          aria-pressed={statusFilter === s}
          className={`focus-ring rounded-full border px-3 py-1 text-sm font-semibold transition-colors ${
            statusFilter === s ? "border-coral bg-coral/10 text-coral" : "border-stone-200 text-steel hover:border-coral/40"
          }`}
        >
          {t(`status.${s}`)}
        </button>
      ))}
      {filtering ? (
        <button
          type="button"
          onClick={onClear}
          className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
        >
          {t("filter.clear")}
        </button>
      ) : null}
    </div>
  );
}
