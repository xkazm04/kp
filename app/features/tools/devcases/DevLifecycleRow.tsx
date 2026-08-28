"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlarmClock, Archive, Eye, RefreshCw } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { StatusChip } from "@/app/_components/StatusChip";
import { assignmentStageTone } from "@/app/_lib/status-tone";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { DevLifecycleReviewPanel } from "./DevLifecycleReviewPanel";
import { lifecycleStall } from "@/app/_lib/devcase-sla";
import { useStageLabel } from "./DevLabels";
import { LIFECYCLE_STEPS, LIVE_STAGES } from "./DevTypes";
import type { Lifecycle } from "./DevTypes";

export function LifecycleRow({
  lc,
  submissionCount = 0,
  onApprove,
  onChanged,
}: {
  lc: Lifecycle;
  // d8a0c4cf — submissions across this lifecycle's postings, for the stall check.
  submissionCount?: number;
  onApprove: () => void;
  onChanged?: () => void;
}) {
  const t = useTranslations("devcase");
  // Resolve API failures from the machine `code`, never from the server's
  // English `error` — see app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();
  // Stage ids are DB values. The lookup + its fallback live in one shared hook so
  // this row and the Cases table can never label the same stage differently.
  const stageLabel = useStageLabel();
  const mapped = lc.stage === "awaiting_approval" ? "designed" : lc.stage === "published" ? "collecting" : lc.stage;
  const idx = LIFECYCLE_STEPS.indexOf(mapped);
  const awaiting = lc.stage === "awaiting_approval";
  const done = lc.stage === "promoted";
  // W5-3 — human-gated close-out. Offered once the case is live (collecting or
  // beyond): wraps up non-promoted submitters with a courteous comm, closes the
  // postings (apply page + webhook answer honestly) and flips the lifecycle to
  // its terminal stage instead of parking at `promoted` forever.
  const closable = (LIVE_STAGES as readonly string[]).includes(lc.stage);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  // Themed confirm (shared stacked Modal, not window.confirm — see JobPostingModal):
  // closing fires unrecoverable wrap-up comms to every non-promoted submitter.
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // d8a0c4cf — flag a lifecycle that's been open and empty past the SLA (client
  // read of the pure rule; no cron). A stalled row offers a one-click re-source.
  // `now` is snapshotted once at mount (Date.now() is impure in render).
  const [nowMs] = useState(() => Date.now());
  const stall = lifecycleStall(
    { stage: lc.stage, updatedAt: lc.updatedAt, createdAt: lc.createdAt, submissionCount },
    nowMs
  );
  const [sourcing, setSourcing] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const reSource = async () => {
    if (sourcing || !lc.caseId) return;
    setSourcing(true);
    setSourceError(null);
    try {
      const r = await fetch("/api/devcase/source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId: lc.caseId }),
      });
      const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(payload, t("lifecycle.reSourceFailed")));
      onChanged?.();
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : t("lifecycle.reSourceFailed"));
    } finally {
      setSourcing(false);
    }
  };
  const closeCase = async () => {
    if (closing) return;
    setClosing(true);
    setCloseError(null);
    try {
      const r = await fetch(`/api/devcase/lifecycle/${encodeURIComponent(lc.id)}/close`, { method: "POST" });
      const payload = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(payload, t("lifecycle.closeFailed")));
      onChanged?.();
    } catch (caught) {
      setCloseError(caught instanceof Error ? caught.message : t("lifecycle.closeFailed"));
    } finally {
      setClosing(false);
    }
  };
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = t("lifecycle.railLabel", {
    steps: LIFECYCLE_STEPS.map((s, i) =>
      t("lifecycle.railStep", {
        step: stageLabel(s),
        state: t(`stepState.${i < idx ? "done" : i === idx ? "current" : "upcoming"}` as Parameters<typeof t>[0]),
      })
    ).join(", "),
  });
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:shadow-lg">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{lc.title || t("lifecycle.untitledRole")}</span>
        {/* ONE THREAD (gap 8) — this chip used to derive its own three-way tint
            (awaiting → amber, promoted → moss, else neutral) from the same two
            booleans the strip below reads. That is one more place the tone could
            disagree with the Assignments table it sits under; both now resolve the
            stage through app/_lib/status-tone.ts. `awaiting` / `done` stay: they
            still drive the review panel and the strip's own progress marker. */}
        <StatusChip tone={assignmentStageTone(lc.stage)} label={stageLabel(lc.stage)} className="uppercase" />
        {stall.stalled ? (
          <span
            title={t("lifecycle.stalledTitle", { days: stall.ageDays ?? 0 })}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-micro font-semibold uppercase text-coral"
          >
            <AlarmClock size={11} aria-hidden /> {t("lifecycle.stalledBadge", { days: stall.ageDays ?? 0 })}
          </span>
        ) : null}
        {stall.stalled && lc.caseId ? (
          <button
            type="button"
            onClick={reSource}
            disabled={sourcing}
            title={t("lifecycle.reSourceTitle")}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-coral/40 bg-white px-2.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            <RefreshCw size={12} /> {sourcing ? t("lifecycle.reSourcing") : t("lifecycle.reSource")}
          </button>
        ) : null}
        {awaiting ? (
          // W5-4 — the gate's primary action is REVIEW, not a blind sign-off:
          // the designed role/case/analysis were always persisted and served,
          // but the UI showed one detail line and an Approve button.
          <button
            type="button"
            onClick={() => setReviewOpen((o) => !o)}
            aria-expanded={reviewOpen}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md bg-moss px-2.5 text-micro font-semibold text-white hover:opacity-90"
          >
            <Eye size={12} /> {reviewOpen ? t("lifecycle.hideReview") : t("lifecycle.review")}
          </button>
        ) : null}
        {closable ? (
          <button
            type="button"
            onClick={() => setConfirmingClose(true)}
            disabled={closing}
            title={t("lifecycle.closeTitle")}
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-steel hover:border-coral/40 hover:text-ink disabled:opacity-50"
          >
            <Archive size={12} /> {closing ? t("lifecycle.closing") : t("lifecycle.close")}
          </button>
        ) : null}
      </div>
      {closeError || sourceError ? (
        <p role="alert" className="mt-1 text-micro text-red-700">
          {closeError ?? sourceError}
        </p>
      ) : null}
      {awaiting && reviewOpen ? (
        <DevLifecycleReviewPanel
          // Reseed the edit fields when a redesign lands a new case on the row.
          key={`${lc.id}:${lc.updatedAt ?? ""}`}
          lc={lc}
          onApprove={onApprove}
          onChanged={onChanged}
        />
      ) : null}
      <div className="mt-2 flex items-center" role="img" aria-label={railLabel}>
        {LIFECYCLE_STEPS.map((s, i) => (
          <div key={s} aria-hidden className={`flex items-center ${i < LIFECYCLE_STEPS.length - 1 ? "flex-1" : ""}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${i <= idx ? "bg-coral" : "bg-stone-200"}`} title={stageLabel(s)} />
            {i < LIFECYCLE_STEPS.length - 1 ? <span className={`h-0.5 flex-1 ${i < idx ? "bg-coral/40" : "bg-stone-200"}`} /> : null}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-micro text-steel">{lc.detail}</p>
      {confirmingClose ? (
        <Modal
          title={t("lifecycle.closeModalTitle")}
          onClose={() => setConfirmingClose(false)}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                {t("lifecycle.cancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  void closeCase();
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                {t("lifecycle.close")}
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            {t("lifecycle.closeConfirm")} {t("lifecycle.closeIrreversible")}
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
