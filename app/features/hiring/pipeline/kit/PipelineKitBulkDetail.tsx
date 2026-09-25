"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/app/_components/kit";
import { useEnumLabel } from "@/app/_lib/use-enum-label";
import { capabilityAwareReason } from "@/app/_lib/useAddToPipeline";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { movePreviewParts, type MovePreviewSummary } from "../pipelineBulkMovePreview";
import type { PipelineTabState } from "../usePipelineTabState";

/**
 * The bulk bar's detail line: the decide row for the awaiting subset (per-kind breakdown, Accept,
 * Reject armed by a second click because it notifies everyone), then the last result: the move
 * preview while its confirm stands, what landed, what departed, what was held back, what failed and
 * the server's refusal reasons, resolved from their CODES in the reader's language.
 */
export function PipelineKitBulkDetail({ s, preview }: { s: PipelineTabState; preview: MovePreviewSummary | null }) {
  const tt = useTranslations("pipeline.tab");
  const enumLabel = useEnumLabel();
  const errMsg = useErrorMessage();
  const r = s.bulkResult;
  const awaiting = s.selectedAwaiting.length;
  if (!awaiting && !r) return null;
  const done =
    r && r.verb !== "departed" && r.verb !== "previewed"
      ? tt(
          r.verb === "moved" ? "bulkMoved"
            : r.verb === "accepted" ? "bulkAccepted"
              : r.verb === "invited" ? (s.relayConfigured === false ? "bulkInvitedQueued" : "bulkInvited")
                : r.verb === "drafted" ? (s.relayConfigured === false ? "bulkDraftedQueued" : "bulkDrafted")
                  : "bulkRejected",
          { count: r.ok }
        )
      : null;

  return (
    <>
      {awaiting ? (
        <>
          <span>
            {tt("bulkAwaiting", { count: awaiting })}
            {s.awaitingKinds.length ? ` · ${s.awaitingKinds.map(([kind, n]) => `${n} ${enumLabel("approvalKind", kind)}`).join(" · ")}` : null}
          </span>
          <span className="k-push" />
          <Button label={tt("bulkAccept", { count: awaiting })} variant="affirm" size="sm" disabled={s.bulkBusy} onClick={() => void s.bulkDecide("accept")} />
          {s.confirmingBulkReject ? (
            <>
              <b className="k-bad">{tt("bulkRejectConfirm", { count: awaiting })}</b>
              <Button label={tt("bulkRejectConfirmYes")} loading={s.bulkBusy} loadingLabel={tt("bulkMoving")} variant="danger" size="sm" onClick={() => void s.bulkDecide("reject")} />
              <Button label={tt("bulkRejectCancel")} variant="ghost" size="sm" disabled={s.bulkBusy} onClick={() => s.dispatchBulkConfirm({ type: "cancel" })} />
            </>
          ) : (
            <Button label={tt("bulkReject", { count: awaiting })} variant="danger" size="sm" disabled={s.bulkBusy} onClick={() => s.dispatchBulkConfirm({ type: "arm", which: "reject" })} />
          )}
        </>
      ) : null}
      {r ? (
        <span role="status" className="k-bulkbar__result">
          {preview ? <b>{movePreviewParts(preview).map((p) => tt(p.key, { count: p.count })).join(" · ")}</b> : null}
          {done ? <span className="k-good">{done}</span> : null}
          {r.departed ? <span>{r.verb !== "departed" ? " · " : null}{tt("selectionDeparted", { count: r.departed })}</span> : null}
          {r.heldBack ? <span className="k-bad"> · {tt("bulkMoveOfferHeld", { count: r.heldBack })}</span> : null}
          {r.failed > 0 ? <span className="k-bad"> · {tt(r.verb === "drafted" ? "bulkDraftFailed" : "bulkFailed", { count: r.failed })}</span> : null}
          {r.reason ? <span className="k-bulkbar__why">{r.reason}</span> : null}
          {!r.reason && r.reasonCodes?.length ? (
            <span className="k-bulkbar__why">
              {r.reasonCodes.map((code) => capabilityAwareReason(errMsg, { code, capability: r.refusalCapability }, tt("bulkRequestFailed"))).join(" · ")}
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );
}
