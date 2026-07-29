"use client";

// Search + role-family/seniority/disposition filter row, split out of HistoryTab.tsx.
import { useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DISPOSITION_STYLE } from "./HistoryTypes";

export function HistoryFilterBar({
  q,
  setQ,
  roleFamily,
  setRoleFamily,
  seniority,
  setSeniority,
  disposition,
  setDisposition,
  families,
  seniorities,
  filtering,
  filteredCount,
  totalCount,
  onClear,
  dispLabel,
}: {
  q: string;
  setQ: (v: string) => void;
  roleFamily: string;
  setRoleFamily: (v: string) => void;
  seniority: string;
  setSeniority: (v: string) => void;
  disposition: string;
  setDisposition: (v: string) => void;
  families: string[];
  seniorities: string[];
  filtering: boolean;
  filteredCount: number;
  totalCount: number;
  onClear: () => void;
  dispLabel: (d: string) => string;
}) {
  const t = useTranslations("history");
  const enumLabel = useEnumLabel();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor="history-search" className="sr-only">{t("searchLabel")}</label>
      <TextInput
        id="history-search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("searchPlaceholder")}
        sizeVariant="sm"
        className="min-w-[200px] flex-1"
      />
      <Select
        ariaLabel={t("filterFamily")}
        value={roleFamily}
        onChange={setRoleFamily}
        size="sm"
        options={[{ value: "", label: t("allFamilies") }, ...families.map((f) => ({ value: f, label: enumLabel("family", f) }))]}
      />
      <Select
        ariaLabel={t("filterSeniority")}
        value={seniority}
        onChange={setSeniority}
        size="sm"
        options={[{ value: "", label: t("allSeniority") }, ...seniorities.map((s) => ({ value: s, label: enumLabel("seniority", s) }))]}
      />
      <Select
        ariaLabel={t("filterDisposition")}
        value={disposition}
        onChange={setDisposition}
        size="sm"
        options={[
          { value: "", label: t("allDispositions") },
          ...Object.keys(DISPOSITION_STYLE).map((d) => ({ value: d, label: dispLabel(d) })),
          { value: "undecided", label: t("dispositionUndecided") },
        ]}
      />
      {filtering ? (
        <span className="text-sm text-steel" aria-live="polite">{t("showing", { shown: filteredCount, total: totalCount })}</span>
      ) : null}
      {filtering ? (
        <button
          type="button"
          onClick={onClear}
          className="focus-ring inline-flex items-center gap-1 rounded-full border border-coral/40 bg-coral/5 px-2.5 py-0.5 text-sm font-semibold text-coral hover:bg-coral/10"
        >
          {t("clear")}
        </button>
      ) : null}
    </div>
  );
}
