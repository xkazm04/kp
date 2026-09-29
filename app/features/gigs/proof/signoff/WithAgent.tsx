"use client";

import { useTranslations } from "next-intl";
import { canTransitionGig } from "@/app/_lib/gigs/transitions";
import type { Gig, GigAttempt } from "@/app/_lib/gigs/types";
import type { AfterWrite, SpecialistRow } from "../../logic/wire";
import { useGigsFormat } from "../../data/useGigsFormat";
import { useWrite } from "./useWrite";

// ---------------------------------------------------------------------------
// With the agent: in flight, sent back, or failed
// ---------------------------------------------------------------------------

export function Agent({
  gig,
  attempt,
  specialist,
  kind,
  now,
  onChanged,
}: {
  gig: Gig;
  attempt: GigAttempt | null;
  specialist: SpecialistRow | null;
  kind: "running" | "revision" | "failed";
  now: Date;
  onChanged: AfterWrite;
}) {
  const t = useTranslations("gigs");
  const fmt = useGigsFormat();
  const { busy, error, run } = useWrite();

  async function redispatch() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}/dispatch`, "POST", {});
    if (body) await onChanged(t("triageView.dispatchedFlash", { name: specialist?.name ?? t("desk.theAgent") }));
  }

  return (
    <div className="acts">
      {kind === "running" ? (
        <p className="hint">{t("signoff.running", { name: specialist?.name ?? t("desk.theAgent"), when: fmt.relative(attempt?.createdAt ?? null, now) ?? "" })}</p>
      ) : kind === "revision" ? (
        <p className="hint">
          <b>{t("agentView.revisionTitle")}.</b> {t("agentView.revisionBody")}
        </p>
      ) : (
        <p className="alert">
          <b>{t("agentView.failedTitle")}.</b> {t("agentView.failedReason", { reason: attempt?.fallbackReason ?? t("agentView.noReason") })}
        </p>
      )}
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      {kind !== "running" ? (
        <button type="button" className="btn block wrap" disabled={busy} onClick={() => void redispatch()}>
          {kind === "revision" ? t("agentView.dispatchWithNote") : t("agentView.dispatchAgain")}
        </button>
      ) : null}
    </div>
  );
}

/** Decline or withdraw, wherever the state machine still allows it and the panel above
 *  has not already offered it. */
export function OffLine({ gig, declineOffered, onChanged, onDecline }: { gig: Gig; declineOffered: boolean; onChanged: AfterWrite; onDecline: () => void }) {
  const t = useTranslations("gigs");
  const { busy, error, run } = useWrite();
  const canDecline = !declineOffered && canTransitionGig(gig.status, "declined");
  const canWithdraw = canTransitionGig(gig.status, "withdrawn");
  if (!canDecline && !canWithdraw) return null;

  async function withdraw() {
    const body = await run(`/api/gigs/${encodeURIComponent(gig.id)}`, "PATCH", { action: "withdraw" });
    if (body) await onChanged(t("work.withdrawnFlash"));
  }

  return (
    <div className="acts">
      <span className="caps dim">{t("detail.offLine")}</span>
      {error ? (
        <p role="alert" className="alert">
          {error}
        </p>
      ) : null}
      <div className="row-form">
        {canDecline ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={onDecline}>
            {t("detail.decline")}
          </button>
        ) : null}
        {canWithdraw ? (
          <button type="button" className="btn quiet" disabled={busy} onClick={() => void withdraw()}>
            {t("detail.withdraw")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
