"use client";

import type { useTranslations } from "next-intl";

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
          className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-1 text-sm font-semibold text-steel hover:border-coral/40"
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
            className={`focus-ring rounded-full px-2.5 py-1 text-sm font-semibold transition-colors ${
              family === f ? "bg-ink text-white" : "border border-stone-200 bg-white text-steel hover:border-coral/40"
            }`}
          >
            {f === "all" ? t("allFamilies") : enumLabel("family", f)}
          </button>
        ))}
      </div>
    );
  }
  return null;
}
