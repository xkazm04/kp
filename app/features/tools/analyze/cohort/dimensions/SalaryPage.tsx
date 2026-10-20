"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { makeStops, Remainder, type PageProps } from "./dimensionParts";
import { salaryModel } from "./salaryModel";
import { SalaryRuler } from "./SalaryRuler";

/**
 * Salary: a ruler per currency and pay basis. The partition the cohort was rated in comes first;
 * every other partition stands on its own ruler headed "not comparable", never converted. No
 * leader, ever: a higher expectation is not a better candidate, and the claim strip says so.
 */
export function SalaryPage({ view, focusMemberId, onFocusMember, onOpenReport }: PageProps) {
  const t = useTranslations("analyzeCohort.pages.salary");
  const model = useMemo(() => salaryModel(view), [view]);
  const stops = makeStops();
  return (
    <div className="cd-salary">
      <p className="cd-salary__order">{t("order")}</p>
      {model.rulers.length ? (
        model.rulers.map((r) => <SalaryRuler key={r.key} ruler={r} focusId={focusMemberId} onFocusMember={onFocusMember} onOpenReport={onOpenReport} stops={stops} />)
      ) : (
        <p className="cd-focus__quiet">{t("none")}</p>
      )}
      <Remainder pending={model.pending} groups={model.absent} focusId={focusMemberId} onFocusMember={onFocusMember} stops={stops} />
    </div>
  );
}
