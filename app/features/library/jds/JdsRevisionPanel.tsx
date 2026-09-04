"use client";

import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { NOTICE } from "@/app/_components/ui/recipes";
import type { JdRevision } from "./jdsEditClient";
import { JdRevisionList } from "./JdsRevisionList";

// The edit-history BODY, shared by both editors (the ledger's in-modal
// JdModalEditor and the public JD page's JdActions) so the four states of a
// history load are decided once.
//
// The state that was missing is the third one. Both hosts rendered
// loading → (no revisions ? "no history yet" : the list), and the hook answered a
// FAILED fetch with an empty array — so a dropped request, a 500 and a JD nobody
// has ever edited all produced the identical "no edit history yet". A recruiter
// deciding whether a JD had been touched was reading a sentence the app could not
// actually support. Now: loading / could-not-load (with a retry) / empty / list.
export function JdRevisionPanel({
  revisions,
  revLoading,
  revError,
  onRetry,
  reverting,
  gateBlocked = false,
  onRevert,
  gateReason,
  loadingLabel,
  emptyLabel,
  viewLabel,
  hideLabel,
  revertLabel,
  revertingLabel,
}: {
  revisions: JdRevision[] | null;
  revLoading: boolean;
  revError: boolean;
  onRetry: () => void;
  reverting: number | null;
  gateBlocked?: boolean;
  onRevert: (id: number) => void;
  gateReason?: string;
  loadingLabel: string;
  emptyLabel: string;
  viewLabel: string;
  hideLabel: string;
  revertLabel: string;
  revertingLabel: string;
}) {
  // The two states this component OWNS (the failure line and its retry) read from
  // one shared namespace: they say the same thing on both hosts, and duplicating
  // them into `library.tab` and `jdPublic` is how two surfaces drift apart.
  const t = useTranslations("jdRevisions");

  if (revLoading && revisions === null) return <p className="text-sm text-steel">{loadingLabel}</p>;

  if (revError) {
    return (
      <div className={`${NOTICE("critical")} flex flex-wrap items-center gap-2 px-3 py-2 text-sm`} role="alert">
        <span>{t("loadFailed")}</span>
        <button
          type="button"
          onClick={onRetry}
          disabled={revLoading}
          className="focus-ring inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-2 py-0.5 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          <RefreshCw size={12} aria-hidden /> {revLoading ? t("retrying") : t("retry")}
        </button>
      </div>
    );
  }

  if (!revisions || revisions.length === 0) return <p className="text-sm text-steel">{emptyLabel}</p>;

  return (
    <JdRevisionList
      revisions={revisions}
      reverting={reverting}
      gateBlocked={gateBlocked}
      onRevert={onRevert}
      gateReason={gateReason}
      viewLabel={viewLabel}
      hideLabel={hideLabel}
      revertLabel={revertLabel}
      revertingLabel={revertingLabel}
    />
  );
}
