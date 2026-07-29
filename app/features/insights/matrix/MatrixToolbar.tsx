"use client";

import { Download, ListChecks } from "lucide-react";
import type { useTranslations } from "next-intl";
import { MIN_FIT_FLOORS } from "./matrixStats";
import type { Matrix } from "./matrixTabTypes";

// The Fit Matrix header's right-side controls: the visible count, the min-fit
// floor toggle (MAT6), the sort toggle, the shortlist-select toggle (MAT3), and
// the CSV export (MAT4). Split out of MatrixTab.tsx to keep that file under the
// 200-line cap.
export function MatrixToolbar({
  data,
  rowsLength,
  colsLength,
  minFit,
  setMinFit,
  sortCol,
  sortByFit,
  setSortByFit,
  setSortCol,
  selectMode,
  setSelectMode,
  exitSelect,
  exportCsv,
  t,
}: {
  data: Matrix | null;
  rowsLength: number;
  colsLength: number;
  minFit: number;
  setMinFit: (n: number) => void;
  sortCol: number | null;
  sortByFit: boolean;
  setSortByFit: (updater: (v: boolean) => boolean) => void;
  setSortCol: (n: number | null) => void;
  selectMode: boolean;
  setSelectMode: (v: boolean) => void;
  exitSelect: () => void;
  exportCsv: () => void;
  t: ReturnType<typeof useTranslations<"matrix">>;
}) {
  return (
    <div className="flex items-center gap-2">
      {data ? (
        <span className="rounded-md border border-stone-200 bg-paper px-2.5 py-1 text-sm text-steel">
          {t("countLine", {
            cands: minFit > 0 ? t("ofCount", { shown: rowsLength, total: data.candidates.length }) : `${data.candidates.length}`,
            positions: colsLength,
          })}
        </span>
      ) : null}
      {/* Min-fit floor (MAT6): hide candidates whose best visible fit is
          below the threshold so a noisy grid shows only the promising rows. */}
      {data && data.candidates.length > 0 ? (
        <div className="inline-flex items-center overflow-hidden rounded-md border border-stone-200 bg-white text-sm font-semibold">
          <span className="px-2 py-1 text-steel">{t("minFit")}</span>
          {MIN_FIT_FLOORS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setMinFit(lvl)}
              aria-pressed={minFit === lvl}
              className={`focus-ring border-l border-stone-200 px-2.5 py-1 ${minFit === lvl ? "bg-ink text-white" : "text-ink hover:bg-paper"}`}
            >
              {lvl === 0 ? t("off") : `≥${lvl}`}
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => {
          setSortCol(null); // an explicit fit/A–Z choice overrides a column sort
          setSortByFit((v) => !v);
        }}
        className="focus-ring rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
      >
        {t("sortLabel", { mode: sortCol != null ? t("sortByCol") : sortByFit ? t("sortBestFit") : t("sortAz") })}
      </button>
      {data && data.candidates.length > 0 ? (
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          aria-pressed={selectMode}
          className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm font-semibold ${
            selectMode ? "border-coral bg-coral/10 text-coral" : "border-stone-200 bg-white text-ink hover:border-coral/40"
          }`}
          title={t("shortlistTitle")}
        >
          <ListChecks size={14} /> {selectMode ? t("doneSelecting") : t("shortlist")}
        </button>
      ) : null}
      {data && data.candidates.length > 0 && rowsLength > 0 ? (
        <button
          type="button"
          onClick={exportCsv}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-ink hover:border-coral/40"
          title={t("exportTitle")}
        >
          <Download size={14} className="text-steel" /> {t("exportCsv")}
        </button>
      ) : null}
    </div>
  );
}
