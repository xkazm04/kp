"use client";

import { useTranslations } from "next-intl";
import { Mark, Section, SettingRow } from "@/app/_components/kit";
import { Select } from "@/app/_components/Select";
import { strandedRows, type Composer } from "./hiringKitModel";

/**
 * Who this draft would leave off the board, and where they go instead. The one settings change
 * that can strand real people does not merely warn: the save stays refused until each removed
 * step has a destination still on the draft, and the move rides the same request as the removal
 * (useHiringComposer's applyAxis). A row without a destination wears the error state.
 */
export function HiringKitStranded({ c }: { c: Composer }) {
  const t = useTranslations("hiringPlan.steps");
  if (!c.axis || c.stranded.length === 0) return null;
  const stages = c.axis.stages;
  const options = [{ value: "", label: t("mapChoose") }, ...stages.map((s) => ({ value: s.id, label: s.label || s.id }))];

  return (
    <Section title={t("strandedTitle")} state={t("strandedHint")} tone="caution">
      {strandedRows(c.stranded, c.mapping, stages).map((r) => (
        <SettingRow
          key={r.id}
          mark={<Mark kind={r.unmapped ? "needs" : "ok"} />}
          name={t("strandedRow", { stage: r.label, count: r.count })}
          control={
            <Select
              sizeVariant="sm"
              className="w-full"
              ariaLabel={t("mapAria", { stage: r.label })}
              value={r.target}
              options={options}
              invalid={r.unmapped}
              onChange={(target) => c.setMapping(r.id, target)}
            />
          }
          state={r.unmapped ? ["error"] : ["changed"]}
        />
      ))}
    </Section>
  );
}
