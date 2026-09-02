"use client";

import { Download, ListChecks } from "lucide-react";
import type { useTranslations } from "next-intl";
import { BTN_SECONDARY, CHIP, TOGGLE_GROUP, toggleBtn } from "@/app/_components/ui/recipes";
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
        <span className={`${CHIP} bg-paper px-2.5 py-1`}>
          {t("countLine", {
            cands: minFit > 0 ? t("ofCount", { shown: rowsLength, total: data.candidates.length }) : `${data.candidates.length}`,
            positions: colsLength,
          })}
        </span>
      ) : null}
      {/* Min-fit floor (MAT6): hide candidates whose best visible fit is
          below the threshold so a noisy grid shows only the promising rows. */}
      {data && data.candidates.length > 0 ? (
        <div className={`${TOGGLE_GROUP} bg-white text-sm font-semibold`} role="group" aria-label={t("minFit")}>
          <span className="px-2 py-1 text-steel">{t("minFit")}</span>
          {MIN_FIT_FLOORS.map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setMinFit(lvl)}
              aria-pressed={minFit === lvl}
              className={`focus-ring rounded px-2.5 py-1 ${toggleBtn(minFit === lvl)}`}
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
        className={`${BTN_SECONDARY} bg-white px-2.5 py-1 text-sm font-semibold`}
      >
        {t("sortLabel", { mode: sortCol != null ? t("sortByCol") : sortByFit ? t("sortBestFit") : t("sortAz") })}
      </button>
      {data && data.candidates.length > 0 ? (
        <button
          type="button"
          onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
          aria-pressed={selectMode}
          className={`${BTN_SECONDARY} px-2.5 py-1 text-sm font-semibold ${
            selectMode ? "border-coral bg-coral/10 text-coral" : "bg-white"
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
          className={`${BTN_SECONDARY} bg-white px-2.5 py-1 text-sm font-semibold`}
          title={t("exportTitle")}
        >
          <Download size={14} className="text-steel" /> {t("exportCsv")}
        </button>
      ) : null}
    </div>
  );
}
