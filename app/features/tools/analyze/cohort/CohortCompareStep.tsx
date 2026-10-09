"use client";

// Act 3, live: one cohort read (and re-read while it runs) and drawn in the chosen world. Tells
// the flow what it learned (status, size, role) so the call sheet stays true, and tells it once
// when the run settles (the recent strip re-reads). A failed cohort's retry is a NEW run with
// the same members; a read that cannot be made says so with its code and a way to try again.
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { CohortRunRequest, CohortStatus, CohortVariant } from "./cohortTypes";
import { retryRequest } from "./cohortProposalEdits";
import { useCohortView } from "./useCohortView";
import { useCohortRun } from "./useCohortRun";
import { CohortComparison } from "./CohortComparison";

export function CohortCompareStep({
  cohortId,
  variant,
  onStatus,
  onSettled,
  onRestarted,
}: {
  cohortId: string;
  variant: Exclude<CohortVariant, "v1">;
  onStatus: (status: CohortStatus, castCount: number, roleTitle: string) => void;
  onSettled: () => void;
  onRestarted: (cohortId: string, request: CohortRunRequest, jdTitle: string) => void;
}) {
  const t = useTranslations("analyzeCohort.shell.compare");
  const errorMessage = useErrorMessage();
  const { view, failure, retry } = useCohortView({ kind: "live", cohortId });
  const jdTitle = view?.jdTitle ?? "";
  const rerun = useCohortRun((id, req) => onRestarted(id, req, jdTitle));

  const status = view?.status ?? null;
  const size = view?.members.length ?? 0;
  useEffect(() => {
    if (status) onStatus(status, size, jdTitle);
  }, [status, size, jdTitle, onStatus]);
  // Settled = it reached done/failed WHILE drawn here (a reopened finished cohort is not news).
  const seenLive = useRef(false);
  useEffect(() => {
    if (status === "queued" || status === "running") seenLive.current = true;
    else if (status && seenLive.current) {
      seenLive.current = false;
      onSettled();
    }
  }, [status, onSettled]);

  if (!view) {
    if (failure?.stopped) {
      return (
        <div role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body`}>
          {errorMessage(failure.failure, t("loadFailed"))}
          {failure.failure.status === 404 ? null : (
            <button type="button" onClick={retry} className={`${BTN_SECONDARY} h-9 bg-white px-4 text-body`}>
              {t("reload")}
            </button>
          )}
        </div>
      );
    }
    return <LoadingGap className="min-h-[24rem]" label={t("loading")} />;
  }
  return (
    <div className="space-y-3">
      {failure?.stopped ? (
        <p role="alert" className="flex flex-wrap items-center gap-3 text-body text-coral">
          {t("stale")}
          <button type="button" onClick={retry} className={`${BTN_SECONDARY} h-9 px-4 text-body`}>
            {t("reload")}
          </button>
        </p>
      ) : null}
      <CohortComparison
        view={view}
        variant={variant}
        onRetry={() => void rerun.start(retryRequest(view))}
        retrying={rerun.starting}
        retryError={rerun.failure ? errorMessage(rerun.failure, t("retryFailed"), rerun.failure.values) : null}
      />
    </div>
  );
}
