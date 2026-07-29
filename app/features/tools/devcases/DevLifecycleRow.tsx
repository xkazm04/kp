"use client";

import { useState } from "react";
import { AlarmClock, Archive, Eye, RefreshCw } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { DevLifecycleReviewPanel } from "./DevLifecycleReviewPanel";
import { lifecycleStall } from "@/app/_lib/devcase-sla";
import { LIFECYCLE_STEPS, LIVE_STAGES, STAGE_LABEL } from "./DevTypes";
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
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? "Re-source failed.");
      onChanged?.();
    } catch (caught) {
      setSourceError(caught instanceof Error ? caught.message : "Re-source failed.");
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
      const payload = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(payload?.error ?? "Close failed.");
      onChanged?.();
    } catch (caught) {
      setCloseError(caught instanceof Error ? caught.message : "Close failed.");
    } finally {
      setClosing(false);
    }
  };
  // Describe the dot-rail for screen readers, since the steps are otherwise
  // conveyed purely by color/position.
  const railLabel = `Lifecycle progress — ${LIFECYCLE_STEPS.map(
    (s, i) => `${s}: ${i < idx ? "done" : i === idx ? "current" : "upcoming"}`
  ).join(", ")}`;
  return (
    <div className="animate-fade-in rounded-lg border border-stone-200 bg-white p-3 shadow-panel transition-shadow motion-reduce:animate-none hover:shadow-lg">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-base font-semibold text-ink">{lc.title || "Role"}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-micro font-semibold uppercase ${
            awaiting ? "bg-amber-100 text-amber-700" : done ? "bg-moss/15 text-moss" : "bg-paper text-steel"
          }`}
        >
          {STAGE_LABEL[lc.stage] ?? lc.stage}
        </span>
        {stall.stalled ? (
          <span
            title={`Open and empty for ${stall.ageDays} days — re-source the candidate pool or close the case.`}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-coral/15 px-2 py-0.5 text-micro font-semibold uppercase text-coral"
          >
            <AlarmClock size={11} aria-hidden /> stalled {stall.ageDays}d
          </span>
        ) : null}
        {stall.stalled && lc.caseId ? (
          <button
            type="button"
            onClick={reSource}
            disabled={sourcing}
            title="Rank the existing candidate DB against this role and seed the pipeline again"
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-coral/40 bg-white px-2.5 text-micro font-semibold text-coral hover:bg-coral/5 disabled:opacity-50"
          >
            <RefreshCw size={12} /> {sourcing ? "Re-sourcing…" : "Re-source"}
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
            <Eye size={12} /> {reviewOpen ? "Hide review" : "Review & approve"}
          </button>
        ) : null}
        {closable ? (
          <button
            type="button"
            onClick={() => setConfirmingClose(true)}
            disabled={closing}
            title="Wrap up non-promoted submitters and stop the apply link"
            className="focus-ring inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 text-micro font-semibold text-steel hover:border-coral/40 hover:text-ink disabled:opacity-50"
          >
            <Archive size={12} /> {closing ? "Closing…" : "Close case"}
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
            <span className={`h-2 w-2 shrink-0 rounded-full ${i <= idx ? "bg-coral" : "bg-stone-200"}`} title={s} />
            {i < LIFECYCLE_STEPS.length - 1 ? <span className={`h-0.5 flex-1 ${i < idx ? "bg-coral/40" : "bg-stone-200"}`} /> : null}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-micro text-steel">{lc.detail}</p>
      {confirmingClose ? (
        <Modal
          title="Close case"
          onClose={() => setConfirmingClose(false)}
          size="md"
          footer={
            <>
              <button
                type="button"
                onClick={() => setConfirmingClose(false)}
                className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-sm font-semibold text-steel hover:text-ink"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingClose(false);
                  void closeCase();
                }}
                className="focus-ring inline-flex h-9 items-center rounded-md bg-coral px-3 text-sm font-semibold text-white hover:opacity-90"
              >
                Close case
              </button>
            </>
          }
        >
          <p className="text-base text-steel">
            Close this case? Non-promoted submitters get a wrap-up note and the apply link stops accepting submissions. The wrap-up
            comms can&apos;t be unsent.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
