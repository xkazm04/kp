"use client";

// The population controls, OUTSIDE the cards.
//
// Role family, seniority and source used to be printed on every candidate card —
// three lines of metadata per person, repeated hundreds of times, and still no way
// to ask "show me only the senior engineers". They are questions about the whole
// population, so one control each up here replaces N copies down there: strictly
// less ink AND strictly more capability.

import { Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Select } from "@/app/_components/Select";
import { FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import type { CandidateFilters } from "./candidateMatrixView";

type Facet = { value: string; label: string };

export function CandidateMatrixFilterBar({
  filters,
  onFilters,
  families,
  seniorities,
  shown,
  total,
  filtered,
  onClear,
}: {
  filters: CandidateFilters;
  onFilters: (patch: Partial<CandidateFilters>) => void;
  families: Facet[];
  seniorities: Facet[];
  shown: number;
  total: number;
  /** Whether any filter is SET (hasActiveFilters) — not whether it changed the
   *  count. A filter that happens to match everyone is still on, and still needs
   *  its Clear button. */
  filtered: boolean;
  onClear: () => void;
}) {
  const t = useTranslations("profile.matrix");

  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="relative flex-1 min-w-[12rem]">
        <span className="sr-only">{t("filterName")}</span>
        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" aria-hidden />
        <input
          value={filters.q}
          onChange={(e) => onFilters({ q: e.target.value })}
          placeholder={t("filterName")}
          className={`${FIELD} w-full py-1.5 pl-8 text-sm`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={META_LABEL}>{t("colFamily")}</span>
        <Select
          ariaLabel={t("colFamily")}
          value={filters.family}
          onChange={(family) => onFilters({ family })}
          options={[{ value: "", label: t("filterAllFamilies") }, ...families]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={META_LABEL}>{t("colSeniority")}</span>
        <Select
          ariaLabel={t("colSeniority")}
          value={filters.seniority}
          onChange={(seniority) => onFilters({ seniority })}
          options={[{ value: "", label: t("filterAllSeniorities") }, ...seniorities]}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={META_LABEL}>{t("colSource")}</span>
        <Select
          ariaLabel={t("colSource")}
          value={filters.source}
          onChange={(source) => onFilters({ source })}
          options={[
            { value: "", label: t("filterAllSources") },
            { value: "profile", label: t("sourceProfile") },
            { value: "analysis", label: t("sourceAnalysis") },
          ]}
        />
      </label>

      {/* The count reads off the FILTERED set with the total beside it, so a
          narrowed view never looks like a population that lost people. */}
      <p className="ml-auto flex items-center gap-2 pb-1.5 text-sm text-steel">
        {shown !== total ? t("countFiltered", { shown, total }) : t("groupCount", { count: total })}
        {filtered ? (
          <button
            type="button"
            onClick={onClear}
            className="focus-ring inline-flex items-center gap-1 rounded-full border border-stone-200 px-2 py-0.5 text-sm text-steel hover:border-coral/40 hover:text-ink"
          >
            <X size={12} aria-hidden /> {t("clearFilters")}
          </button>
        ) : null}
      </p>
    </div>
  );
}
