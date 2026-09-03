"use client";

// PIPE1/P2-2/bdc7fc01 — the select-mode batch action bar: bulk move, bulk
// self-scheduling invite, bulk outreach draft (two-step confirm when a relay is
// configured/unknown), and bulk accept/reject of the awaiting-decision subset.
// Split out of PipelineTab.tsx; all state lives in usePipelineTabState.

import type { PipelineTabTranslator } from "./pipelineTranslator";
import { CalendarClock } from "lucide-react";
import { Select } from "@/app/_components/Select";
import { type Entry } from "@/app/features/shared/pipelineTypes";
import { DEFAULT_STAGE_AXIS, type StageDef } from "@/app/_lib/pipeline-stages";
import { bulkMoveTargetStages } from "./pipelineMoveTargets";
import { PipelineBulkDecideRow } from "./PipelineBulkDecideRow";
import { PipelineBulkOutreachButton } from "./PipelineBulkOutreachButton";
import type { BulkConfirmIntent } from "./pipelineBulkConfirm";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { capabilityAwareReason } from "@/app/_lib/useAddToPipeline";

type BulkResult = {
  ok: number;
  failed: number;
  verb: "moved" | "accepted" | "rejected" | "invited" | "drafted";
  /** Already localized by the hook (the whole-request refusal). */
  reason?: string | null;
  /** The SERVER's per-id refusal codes, resolved here through errors.<CODE>. */
  reasonCodes?: string[];
  /** The permission a whole-request FORBIDDEN_CAPABILITY refusal named, so the line
   *  can say WHICH one is missing instead of a flat "not permitted". */
  refusalCapability?: string | null;
};

export function PipelineBulkActionBar({
  t,
  enumLabel,
  axis = DEFAULT_STAGE_AXIS,
  relayConfigured,
  selectedIds,
  selectedOutsideCount,
  filteredCount,
  onSelectAllVisible,
  onClearSelection,
  bulkStage,
  onBulkStageChange,
  onBulkMove,
  bulkBusy,
  selectedActive,
  onBulkInvite,
  confirmingBulkOutreach,
  dispatchBulkConfirm,
  onBulkOutreach,
  outreachTaskActive,
  bulkResult,
  selectedAwaiting,
  awaitingKinds,
  onBulkDecide,
  confirmingBulkReject,
}: {
  t: PipelineTabTranslator;
  enumLabel: (kind: string, value: string) => string;
  /** The workspace's own resolved axis. Without it the bulk Move <Select> offered the
   *  compile-time stages, so on a composed board every target 400'd `Unknown stage` for
   *  the WHOLE cohort while the columns actually on screen could not be reached at all. */
  axis?: readonly StageDef[];
  relayConfigured: boolean | null;
  selectedIds: ReadonlySet<string>;
  /** How many SELECTED rows the current filter hides (bulk-acts-on-what-you-see).
   *  The board keeps the selection across filter changes on purpose, so the bar owes
   *  the recruiter this number before any bulk action runs. */
  selectedOutsideCount: number;
  filteredCount: number;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  bulkStage: string;
  onBulkStageChange: (s: string) => void;
  onBulkMove: () => void;
  bulkBusy: boolean;
  selectedActive: Entry[];
  onBulkInvite: () => void;
  confirmingBulkOutreach: boolean;
  dispatchBulkConfirm: (action: BulkConfirmIntent) => void;
  onBulkOutreach: () => void;
  outreachTaskActive: boolean;
  bulkResult: BulkResult | null;
  selectedAwaiting: Entry[];
  awaitingKinds: [string, number][];
  onBulkDecide: (action: "accept" | "reject") => void;
  confirmingBulkReject: boolean;
}) {
  // Per-id refusal codes are resolved HERE, at the render, so the recruiter reads
  // them in their own language (api-contracts.md 1.1) instead of the server's English.
  const errMsg = useErrorMessage();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-coral/30 bg-coral/5 px-3 py-2">
      <span className="text-sm font-semibold text-ink" aria-live="polite">
        {t("selectedCount", { count: selectedIds.size })}
      </span>
      {/* bulk-acts-on-what-you-see — "12 selected" reads as "12 rows on screen" when
          some of them are behind the current filter. Every action on this bar (move,
          invite, outreach, accept/reject) acts on the WHOLE selection, so the
          out-of-filter count is stated before any of them can run. role="status" so a
          screen reader hears it when a filter change creates the divergence. */}
      {selectedOutsideCount > 0 ? (
        <span role="status" className="text-sm font-semibold text-coral">
          {t("selectedOutsideFilter", { count: selectedOutsideCount })}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onSelectAllVisible}
        className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
      >
        {t("selectAllVisible", { count: filteredCount })}
      </button>
      {selectedIds.size > 0 ? (
        <button
          type="button"
          onClick={onClearSelection}
          className="focus-ring rounded-full border border-stone-200 bg-white px-2.5 py-0.5 text-sm font-semibold text-steel hover:border-coral/40 hover:text-ink"
        >
          {t("bulkClear")}
        </button>
      ) : null}
      <label className="ml-auto flex items-center gap-1.5 text-sm font-medium text-steel">
        {t("bulkMoveLabel")}
        <Select
          ariaLabel={t("bulkMoveLabel")}
          value={bulkStage}
          onChange={onBulkStageChange}
          size="sm"
          className="h-8"
          // retire-erroring-bulk-control — through the SAME helper drag, the row menu
          // and the drawer use, so the bulk bar can't offer a stage the server refuses
          // (it offered "Hired", which set_stage unconditionally 422s: N failures with
          // everything still selected).
          options={[
            { value: "", label: "—" },
            // Same label rule as the board header and the row menu: a workspace's own
            // label wins, and a shipped stage (label === id) still resolves through the
            // localized enums catalog.
            ...bulkMoveTargetStages(axis).map((id) => {
              const stage = axis.find((st) => st.id === id);
              return { value: id, label: stage && stage.label !== stage.id ? stage.label : enumLabel("stage", id) };
            }),
          ]}
        />
      </label>
      <button
        type="button"
        onClick={onBulkMove}
        disabled={bulkBusy || !bulkStage || selectedIds.size === 0}
        className="focus-ring rounded-md bg-coral px-3 py-1 text-sm font-semibold text-white hover:bg-coral/90 disabled:opacity-50"
      >
        {bulkBusy ? t("bulkMoving") : t("bulkApply", { count: selectedIds.size })}
      </button>
      {/* P2-2 — send self-scheduling links to the selected active cohort. */}
      {selectedActive.length > 0 ? (
        <button
          type="button"
          onClick={onBulkInvite}
          disabled={bulkBusy}
          className="focus-ring inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1 text-sm font-semibold text-ink hover:border-coral/40 disabled:opacity-50"
        >
          <CalendarClock size={13} aria-hidden /> {t("bulkInvite", { count: selectedActive.length })}
        </button>
      ) : null}
      <PipelineBulkOutreachButton
        t={t}
        relayConfigured={relayConfigured}
        selectedActive={selectedActive}
        bulkBusy={bulkBusy}
        confirmingBulkOutreach={confirmingBulkOutreach}
        dispatchBulkConfirm={dispatchBulkConfirm}
        onBulkOutreach={onBulkOutreach}
        outreachTaskActive={outreachTaskActive}
      />
      {bulkResult ? (
        <span role="status" className="text-sm">
          <span className="font-semibold text-moss">
            {t(
              bulkResult.verb === "moved"
                ? "bulkMoved"
                : bulkResult.verb === "accepted"
                  ? "bulkAccepted"
                  : bulkResult.verb === "invited"
                    ? relayConfigured === false
                      ? "bulkInvitedQueued"
                      : "bulkInvited"
                    : bulkResult.verb === "drafted"
                      ? relayConfigured === false
                        ? "bulkDraftedQueued"
                        : "bulkDrafted"
                      : "bulkRejected",
              { count: bulkResult.ok }
            )}
          </span>
          {bulkResult.failed > 0 ? (
            <span className="font-semibold text-coral">
              {" · "}
              {t(bulkResult.verb === "drafted" ? "bulkDraftFailed" : "bulkFailed", { count: bulkResult.failed })}
            </span>
          ) : null}
          {/* The server's own reason for the refusals (409 concurrency vs 422
              forbidden transition) — so a bulk failure says WHY and what to do, not
              just a count. Resolved from the CODE in the reader's language: this
              line used to paint the server's English sentence onto every locale. */}
          {bulkResult.reason ? <span className="block text-steel">{bulkResult.reason}</span> : null}
          {!bulkResult.reason && bulkResult.reasonCodes?.length ? (
            <span className="block text-steel">
              {bulkResult.reasonCodes
                .map((code) =>
                  capabilityAwareReason(errMsg, { code, capability: bulkResult.refusalCapability }, t("bulkRequestFailed"))
                )
                .join(" · ")}
            </span>
          ) : null}
        </span>
      ) : null}
      {/* bdc7fc01 — accept/reject the awaiting cohort in one pass. Only the
          selected entries that need a human decision are actionable; the
          per-kind breakdown makes a mixed selection obvious before acting. */}
      <PipelineBulkDecideRow
        t={t}
        enumLabel={enumLabel}
        selectedAwaiting={selectedAwaiting}
        awaitingKinds={awaitingKinds}
        bulkBusy={bulkBusy}
        onBulkDecide={onBulkDecide}
        confirmingBulkReject={confirmingBulkReject}
        dispatchBulkConfirm={dispatchBulkConfirm}
      />
    </div>
  );
}
