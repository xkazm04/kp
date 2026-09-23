"use client";

import { useTranslations } from "next-intl";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { apiErrorPayload, LocalizedFailure } from "./analyticsFetchError";
import { InlineNumberSave } from "./AnalyticsInlineNumberSave";
import { cadenceFailureMessage, cadenceSaveRequest } from "./stageCadenceSavePlan";

// One column's TEAM cadence, set in place from the dwell band (challenge-r05
// analytics-metrics/B). The value is team data on the workspace axis (`slaDays`), the
// same number the board's cadence editor writes and the one aging clock reads, so
// setting it here re-judges the board, the sidebar badge and the automation pass too.
//
// The field shows the team's value, or "—" when the column ages on its role default
// (named beside it). Emptying the field clears the team's value. The request and the
// refusal mapping are pure (stageCadenceSavePlan.ts, executed by its test); this file
// is the wiring: the hook-bound resolvers and the reload.
export function StageCadenceInput({
  stage,
  stageLabel,
  teamDays,
  defaultDays,
  onSaved,
}: {
  stage: string;
  stageLabel: string;
  /** The team's cadence for this column, or null when it ages on the role default. */
  teamDays: number | null;
  /** The cadence in force when the team has set none. */
  defaultDays: number;
  onSaved: () => void;
}) {
  const t = useTranslations("analytics");
  const errMsg = useErrorMessage();
  const id = `cadence-${stage}`;
  return (
    <span className="inline-flex items-center gap-2 text-meta text-steel">
      <InlineNumberSave
        id={id}
        value={teamDays}
        width="w-14"
        inputType="number"
        ariaLabel={t("stageCadenceLabel", { stage: stageLabel })}
        failedTitle={t("stageCadenceFailed")}
        announceFailure
        onSave={async (days) => {
          const req = cadenceSaveRequest(stage, days);
          const res = await fetch(req.url, req.init);
          if (!res.ok) {
            throw new LocalizedFailure(
              cadenceFailureMessage(await apiErrorPayload(res), errMsg, t("stageCadenceInvalid"), t("stageCadenceFailed"))
            );
          }
          onSaved();
        }}
      />
      <label htmlFor={id}>
        {teamDays != null ? t("stageCadenceUnitTeam") : t("stageCadenceUnitDefault", { days: defaultDays })}
      </label>
    </span>
  );
}
