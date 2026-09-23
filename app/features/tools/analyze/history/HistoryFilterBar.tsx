"use client";

// Search + role-family/seniority/disposition filter row, split out of HistoryTab.tsx.
import { useLocale, useTranslations } from "next-intl";
import { TextInput } from "@/app/_components/TextInput";
import { Select } from "@/app/_components/Select";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { DISPOSITION_STYLE, sortOptionsByLabel } from "./HistoryTypes";

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
  answersFilter,
  shownCount,
  truncated,
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
  /** The recruiter is narrowing right now (the Clear control). */
  filtering: boolean;
  /** The rows on screen answer a narrowed query (the matched count). */
  answersFilter: boolean;
  /** Rows on screen: the server's answer, never a client-side subset of it. */
  shownCount: number;
  /** More groups match than are on screen (the route's exact cap+1 answer). */
  truncated?: boolean;
  onClear: () => void;
  dispLabel: (d: string) => string;
}) {
  const t = useTranslations("history");
  const enumLabel = useEnumLabel();
  // The dropdowns list LOCALIZED labels, so they must be ordered by those labels
  // in the active locale — not by the canonical English slug behind them. See
  // sortOptionsByLabel for the two orderings this replaces.
  const locale = useLocale();

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
        sizeVariant="sm"
        options={[
          { value: "", label: t("allFamilies") },
          ...sortOptionsByLabel(families.map((f) => ({ value: f, label: enumLabel("family", f) })), locale),
        ]}
      />
      <Select
        ariaLabel={t("filterSeniority")}
        value={seniority}
        onChange={setSeniority}
        sizeVariant="sm"
        options={[
          { value: "", label: t("allSeniority") },
          ...sortOptionsByLabel(seniorities.map((s) => ({ value: s, label: enumLabel("seniority", s) })), locale),
        ]}
      />
      <Select
        ariaLabel={t("filterDisposition")}
        value={disposition}
        onChange={setDisposition}
        sizeVariant="sm"
        options={[
          { value: "", label: t("allDispositions") },
          ...Object.keys(DISPOSITION_STYLE).map((d) => ({ value: d, label: dispLabel(d) })),
          { value: "undecided", label: t("dispositionUndecided") },
        ]}
      />
      {truncated || answersFilter ? (
        // The server filtered the whole workspace, so a count here is an answer, not a
        // subset of a loaded slice. A cut page names no total: it says more are older.
        <span className="text-sm text-steel" aria-live="polite">
          {truncated ? t("showingFirst", { count: shownCount }) : t("showingMatched", { count: shownCount })}
        </span>
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
