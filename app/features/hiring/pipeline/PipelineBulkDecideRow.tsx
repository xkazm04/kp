"use client";

// bdc7fc01 — bulk accept/reject the awaiting-decision subset of the selection,
// with a two-step confirm on reject (it emails everyone). Split out of
// PipelineBulkActionBar.tsx.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import type { Entry } from "@/app/features/shared/pipelineTypes";
import type { BulkConfirmIntent } from "./pipelineBulkConfirm";

export function PipelineBulkDecideRow({
  t,
  enumLabel,
  selectedAwaiting,
  awaitingKinds,
  bulkBusy,
  onBulkDecide,
  confirmingBulkReject,
  dispatchBulkConfirm,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  selectedAwaiting: Entry[];
  awaitingKinds: [string, number][];
  bulkBusy: boolean;
  onBulkDecide: (action: "accept" | "reject") => void;
  confirmingBulkReject: boolean;
  dispatchBulkConfirm: (action: BulkConfirmIntent) => void;
}) {
  if (selectedAwaiting.length === 0) return null;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 border-t border-coral/20 pt-2">
      <span className="text-sm text-steel">
        {t("bulkAwaiting", { count: selectedAwaiting.length })}
        {awaitingKinds.length > 0 ? (
          <span className="text-stone-400">
            {" · "}
            {awaitingKinds.map(([k, n]) => `${n} ${enumLabel("approvalKind", k)}`).join(" · ")}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        onClick={() => onBulkDecide("accept")}
        disabled={bulkBusy}
        className="focus-ring ml-auto rounded-md bg-moss px-3 py-1 text-sm font-semibold text-white hover:bg-moss/90 disabled:opacity-50"
      >
        {t("bulkAccept", { count: selectedAwaiting.length })}
      </button>
      {confirmingBulkReject ? (
        <>
          <span className="text-sm font-semibold text-coral">
            {t("bulkRejectConfirm", { count: selectedAwaiting.length })}
          </span>
          <button
            type="button"
            onClick={() => onBulkDecide("reject")}
            disabled={bulkBusy}
            className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
          >
            {bulkBusy ? t("bulkMoving") : t("bulkRejectConfirmYes")}
          </button>
          <button
            type="button"
            onClick={() => dispatchBulkConfirm({ type: "cancel" })}
            disabled={bulkBusy}
            className="focus-ring rounded-md px-2 py-1 text-sm font-semibold text-steel hover:text-ink disabled:opacity-50"
          >
            {t("bulkRejectCancel")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => dispatchBulkConfirm({ type: "arm", which: "reject" })}
          disabled={bulkBusy}
          className="focus-ring rounded-md border border-coral/40 bg-white px-3 py-1 text-sm font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
        >
          {t("bulkReject", { count: selectedAwaiting.length })}
        </button>
      )}
    </div>
  );
}
