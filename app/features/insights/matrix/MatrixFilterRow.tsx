"use client";

import type { useTranslations } from "next-intl";
import { CHIP_TOGGLE } from "@/app/_components/ui/recipes";

// The scoped-position badge (with its "show all" escape) or, when not scoped,
// the role-family filter chips. Split out of MatrixTab.tsx to keep that file
// under the 200-line cap.
export function MatrixFilterRow({
  scopedPositionTitle,
  clearJob,
  staleJob,
  families,
  family,
  setFamily,
  enumLabel,
  t,
}: {
  scopedPositionTitle: string | null;
  clearJob: () => void;
  staleJob: boolean;
  families: string[];
  family: string;
  setFamily: (f: string) => void;
  enumLabel: (kind: string, value: string) => string;
  t: ReturnType<typeof useTranslations<"matrix">>;
}) {
  if (scopedPositionTitle) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-coral/10 px-2.5 py-1 text-sm font-semibold text-coral">
          {t("rankingFor", { title: scopedPositionTitle })}
        </span>
        <button
          type="button"
          onClick={clearJob}
          className={`${CHIP_TOGGLE(false)} bg-white`}
        >
          {t("showAll")}
        </button>
      </div>
    );
  }
  if (!staleJob && families.length > 1) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {["all", ...families].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFamily(f)}
            aria-pressed={family === f}
            className={CHIP_TOGGLE(family === f)}
          >
            {f === "all" ? t("allFamilies") : enumLabel("family", f)}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
