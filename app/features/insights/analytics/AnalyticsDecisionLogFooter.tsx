"use client";

import { useTranslations } from "next-intl";
import type { useInfiniteScroll } from "@/app/_lib/useInfiniteScroll";
import type { Decision } from "./analyticsDecisionLogTypes";

type Scroll = ReturnType<typeof useInfiniteScroll<Decision>>;

// The decision log's error-recovery + sentinel/manual "load more" footer. Split
// out of AnalyticsDecisionLog.tsx (formerly DecisionLog.tsx) to keep that file
// under the 200-line cap.
export function AnalyticsDecisionLogFooter({
  phase,
  error,
  hasMore,
  itemsCount,
  sentinelRef,
  loadMore,
}: {
  phase: Scroll["phase"];
  error: Scroll["error"];
  hasMore: Scroll["hasMore"];
  itemsCount: number;
  sentinelRef: Scroll["sentinelRef"];
  loadMore: Scroll["loadMore"];
}) {
  const t = useTranslations("analytics.log");
  return (
    <>
      {phase === "error" ? (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-md border border-coral/40 bg-coral/5 px-3 py-2">
          <p className="text-base text-coral">{error ?? t("loadFailed")}</p>
          <button
            type="button"
            onClick={() => void loadMore()}
            className="focus-ring shrink-0 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-ink hover:bg-paper"
          >
            {t("retry")}
          </button>
        </div>
      ) : null}

      {/* Sentinel + manual fallback. The observer drives auto-loading; the button
          covers keyboard users and environments without IntersectionObserver. */}
      {hasMore && phase !== "error" ? (
        <div ref={sentinelRef} className="mt-3 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={phase === "more"}
            className="focus-ring rounded-md border border-stone-300 bg-white px-4 py-1.5 text-sm font-medium text-steel transition-colors hover:bg-paper disabled:opacity-60"
          >
            {phase === "more" ? t("loading") : t("loadMore")}
          </button>
        </div>
      ) : !hasMore && itemsCount > 0 && phase === "idle" ? (
        <p className="mt-3 text-center text-sm text-steel">{t("endOfLog", { count: itemsCount })}</p>
      ) : null}
    </>
  );
}
