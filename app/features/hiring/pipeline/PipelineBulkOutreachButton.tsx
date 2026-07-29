"use client";

// Draft tailored outreach for the whole selected-active cohort at once — the
// same per-candidate action the drawer offers, batched. Backgrounded: the
// drafts land in the Outbox to review + release. With NO relay that is
// terminal (nothing sends); with a relay configured dispatchOutreach relays
// each letter immediately, so "draft N" IS "send N" — the click arms a
// two-step confirm in that case (unknown capability fails safe).
// Split out of PipelineBulkActionBar.tsx.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { Mail } from "lucide-react";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { BulkConfirmEvent } from "./pipelineBulkConfirm";

export function PipelineBulkOutreachButton({
  t,
  relayConfigured,
  selectedActive,
  bulkBusy,
  confirmingBulkOutreach,
  dispatchBulkConfirm,
  onBulkOutreach,
  outreachTaskActive,
}: {
  t: PipelineTabTranslator;
  relayConfigured: boolean | null;
  selectedActive: Entry[];
  bulkBusy: boolean;
  confirmingBulkOutreach: boolean;
  dispatchBulkConfirm: (action: BulkConfirmEvent) => void;
  onBulkOutreach: () => void;
  outreachTaskActive: boolean;
}) {
  if (selectedActive.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          if (relayConfigured !== false && !confirmingBulkOutreach) {
            dispatchBulkConfirm({ type: "arm", which: "outreach" });
            return;
          }
          onBulkOutreach();
        }}
        disabled={bulkBusy || outreachTaskActive}
        className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-sm font-semibold disabled:opacity-50 ${
          confirmingBulkOutreach
            ? "border-dial-amber/50 bg-dial-amber/15 text-ink hover:bg-dial-amber/25"
            : "border-stone-200 bg-white text-ink hover:border-coral/40"
        }`}
      >
        <Mail size={13} aria-hidden />{" "}
        {outreachTaskActive
          ? t("bulkDrafting")
          : confirmingBulkOutreach
            ? t("bulkDraftOutreachConfirm", { count: selectedActive.length })
            : t("bulkDraftOutreach", { count: selectedActive.length })}
      </button>
      {/* Explicit back-out for the armed confirm, mirroring the reject
          confirm's Yes/Cancel idiom (a lone toggling button gave the
          recruiter no way to disarm without changing the selection). */}
      {confirmingBulkOutreach ? (
        <button
          type="button"
          onClick={() => dispatchBulkConfirm({ type: "cancel" })}
          disabled={bulkBusy}
          className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
        >
          {t("bulkRejectCancel")}
        </button>
      ) : null}
    </span>
  );
}
