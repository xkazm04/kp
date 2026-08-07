"use client";

import { useTranslations } from "next-intl";
import { FAMILIES, SENIORITIES, MODES } from "./JobsTypes";
import { Select } from "./JobsShared";
import { Checkbox } from "@/app/_components/Checkbox";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import type { useJobsList } from "./useJobsList";

// The filter row (role family / seniority / work mode selects, entry-only +
// open-only checkboxes, free-text search) — extracted verbatim from
// JobsTab.tsx so that file stays under the 200-line split threshold.
export function JobsTabFilters({ list }: { list: ReturnType<typeof useJobsList> }) {
  const t = useTranslations("jobs.tab");
  const enumLabel = useEnumLabel();
  const { roleFamily, setRoleFamily, seniority, setSeniority, workMode, setWorkMode, entryOnly, setEntryOnly, openOnly, setOpenOnly, q, setQ } =
    list;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Select
        value={roleFamily}
        onChange={setRoleFamily}
        all={t("allFamilies")}
        label={t("filterFamily")}
        options={FAMILIES.map((f) => ({ value: f, label: enumLabel("family", f) }))}
      />
      <Select
        value={seniority}
        onChange={setSeniority}
        all={t("allSeniority")}
        label={t("filterSeniority")}
        options={SENIORITIES.map((s) => ({ value: s, label: enumLabel("seniority", s) }))}
      />
      <Select
        value={workMode}
        onChange={setWorkMode}
        all={t("allModes")}
        label={t("filterWorkMode")}
        options={MODES.map((m) => ({ value: m, label: enumLabel("workMode", m) }))}
      />
      <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-base text-ink">
        <Checkbox checked={entryOnly} onChange={(e) => setEntryOnly(e.target.checked)} />
        {t("entryOnly")}
      </label>
      {/* Lifecycle filter: hide drafts + closed roles (default off — the full catalog stays the baseline view). */}
      <label className="flex items-center gap-2 rounded-md border border-stone-200 px-3 py-2 text-base text-ink">
        <Checkbox checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
        {t("openOnly")}
      </label>
      <label htmlFor="jobs-search" className="sr-only">
        {t("searchLabel")}
      </label>
      <input
        id="jobs-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchPlaceholder")}
        className="focus-ring h-10 flex-1 min-w-[180px] rounded-md border border-stone-200 px-3 text-base"
      />
    </div>
  );
}
