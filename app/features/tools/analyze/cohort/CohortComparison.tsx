"use client";

// The comparison itself: the quiet progress line above, then the chosen world (or, below
// COHORT_NARROW_PX, the card list). A running cohort is drawn by the world as it lands — never
// replaced by a spinner. A failed cohort keeps whatever landed and offers a new run with the
// same members (the retry is the caller's: it starts a NEW cohort).
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { LoadingGap } from "@/app/_components/ui/LoadingGap";
import { BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import type { CohortVariant, CohortView, CohortWorldProps } from "./cohortTypes";
import { CohortProgress } from "./CohortProgress";
import { CohortCardList } from "./CohortCardList";
import { useNarrowStudio } from "./useNarrowStudio";

const quiet = () => <LoadingGap className="min-h-[24rem]" />;
const WORLDS: Record<Exclude<CohortVariant, "v1">, React.ComponentType<CohortWorldProps>> = {
  lineup: dynamic(() => import("./worlds/lineup/LineupWorld").then((m) => ({ default: m.LineupWorld })), { loading: quiet }),
};

/** The full single-candidate report, in a new tab so the comparison stays where it was. */
const openReport = (slug: string) => {
  window.open(`/history/${encodeURIComponent(slug)}`, "_blank", "noopener");
};

export function CohortComparison({
  view,
  variant,
  onRetry,
  retrying = false,
  retryError = null,
}: {
  view: CohortView;
  variant: Exclude<CohortVariant, "v1">;
  /** A new run with the same members; absent where no run can be started (a fixture). */
  onRetry?: () => void;
  retrying?: boolean;
  /** The retry's own failure, already localized. */
  retryError?: string | null;
}) {
  const t = useTranslations("analyzeCohort.shell.compare");
  const narrow = useNarrowStudio();
  const World = WORLDS[variant];
  return (
    <section aria-label={t("label")} className="space-y-4">
      <CohortProgress view={view} />
      {view.status === "failed" ? (
        <div role="alert" className={`${NOTICE("critical")} flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-body`}>
          <span>{t("failed", { landed: view.progress.done, total: view.progress.total })}</span>
          {onRetry ? (
            <button type="button" onClick={onRetry} disabled={retrying} className={`${BTN_SECONDARY} h-9 bg-white px-4 text-body`}>
              {retrying ? t("retrying") : t("retry")}
            </button>
          ) : null}
          {retryError ? <span className="basis-full text-body">{retryError}</span> : null}
        </div>
      ) : null}
      {narrow ? <CohortCardList view={view} onOpenReport={openReport} /> : <World view={view} onOpenReport={openReport} />}
    </section>
  );
}
