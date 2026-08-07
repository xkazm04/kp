"use client";

// Run the screening auto-reject wave for one role (DEC1) — but ALWAYS preview
// first (DEC2). The wave is irreversible (flips statuses + queues rejection
// emails), so this modal dry-runs on open and on every slider change, showing
// exactly who WOULD be rejected with rationales; the recruiter tunes the
// bottom-% / match threshold, watches the count update, then explicitly commits.
// The recruiter triggered this, so auto-reject is on for the run by default — but
// fairness shielding (early-career / unknown archetype) still applies server-side.
//
// State/fetch logic lives in useDecisionsScreenWave.ts; the reject/keep lists
// render via DecisionsScreenWaveLists — split out to keep this shell under 200
// lines.
import { AlertTriangle, Ban, Check, Loader2, ShieldCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { Checkbox } from "@/app/_components/Checkbox";
import { useDecisionsScreenWave } from "./useDecisionsScreenWave";
import { DecisionsScreenWaveLists } from "./DecisionsScreenWaveLists";
import { DecisionsScreenWaveConfirmModal } from "./DecisionsScreenWaveConfirmModal";

export function ScreenWaveModal({
  jobId,
  roleTitle,
  onClose,
  onCommitted,
}: {
  jobId: string;
  roleTitle: string;
  onClose: () => void;
  // Direction 2b — the commit summary rides back so the tab can keep a partial
  // commit's comms failures discoverable AFTER this modal closes (the per-row
  // badges here are modal-only). `failedLabels` names WHO from the same committed
  // result; each is also audited as a `rejection_comms_failed` event.
  onCommitted: (summary?: { commsFailures: number; failedLabels: string[] }) => void;
}) {
  const t = useTranslations("decisions.wave");
  const {
    enabled, setEnabled,
    bottomPercent, setBottomPercent,
    maxMatch, setMaxMatch,
    preview, loading, error, committing, committed,
    confirmOpen, setConfirmOpen,
    commit,
  } = useDecisionsScreenWave(jobId, onCommitted, t("previewFailed"), t("setChangedRepreview"), t("waveFailed"));

  const view = committed ?? preview;
  const rejects = view?.decisions.filter((d) => d.action === "reject") ?? [];
  const keeps = view?.decisions.filter((d) => d.action === "keep") ?? [];

  // Why the commit button is disabled — surfaced in an aria-live line beside the
  // button (finding SD-5), not just a `title` invisible to screen readers / touch.
  const commitDisabledReason = !enabled ? t("enableToCommit") : rejects.length === 0 ? t("nothingToReject") : null;

  const lists = view ? (
    <DecisionsScreenWaveLists rejects={rejects} keeps={keeps} committed={Boolean(committed)} dryRun={view.dryRun} maxMatch={maxMatch} t={t} />
  ) : null;

  return (
    <>
    <Modal
      title={t("title", { role: roleTitle })}
      subtitle={committed ? t("committedSubtitle") : t("previewSubtitle")}
      onClose={onClose}
      size="3xl"
      footer={
        committed ? (
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex h-9 items-center rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/90"
          >
            {t("done")}
          </button>
        ) : (
          <>
            {commitDisabledReason ? (
              <span role="status" aria-live="polite" className="mr-auto text-meta text-steel">
                {commitDisabledReason}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={committing || loading || commitDisabledReason !== null}
              title={commitDisabledReason ?? undefined}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              <Ban size={15} /> {committing ? t("rejecting") : t("rejectAndNotify", { count: rejects.length })}
            </button>
          </>
        )
      }
    >
      {committed ? (
        <div className="space-y-3">
          <p className="flex items-center gap-2 rounded-md border border-moss/40 bg-moss/5 p-3 text-base text-ink">
            <Check size={16} className="text-moss" />
            {t.rich("committedBanner", {
              rejected: committed.rejected,
              kept: committed.kept,
              cohort: committed.cohort,
              b: (chunks) => <span className="font-semibold">{chunks}</span>,
            })}
            {committed.commsFailures > 0 ? (
              <span className="text-amber-700"> {t("commsFailures", { count: committed.commsFailures })}</span>
            ) : null}
          </p>
          {lists}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Override controls — drive the live preview. */}
          <div className="rounded-md border border-stone-200 bg-paper p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <Checkbox checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              {t("autoRejectWeakest")}
            </label>
            <div className={`mt-3 space-y-3 ${enabled ? "" : "pointer-events-none opacity-40"}`}>
              <label className="block">
                <span className="flex items-center justify-between text-sm text-ink">
                  <span>{t("rejectBottom")}</span>
                  <span className="nums font-semibold">{bottomPercent}%</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={bottomPercent} onChange={(e) => setBottomPercent(Number(e.target.value))} className="mt-1 w-full accent-coral" />
              </label>
              <label className="block">
                <span className="flex items-center justify-between text-sm text-ink">
                  <span>{t("onlyIfBelow")}</span>
                  <span className="nums font-semibold">{maxMatch}</span>
                </span>
                <input type="range" min={0} max={100} step={5} value={maxMatch} onChange={(e) => setMaxMatch(Number(e.target.value))} className="mt-1 w-full accent-coral" />
              </label>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-meta text-steel">
              <ShieldCheck size={12} className="text-moss" /> {t("shieldNote")}
            </p>
          </div>

          {error ? (
            <p role="alert" className="flex items-center gap-2 rounded-md bg-red-50 p-2.5 text-sm text-red-700">
              <AlertTriangle size={14} /> {error}
            </p>
          ) : null}

          <p className="flex items-center gap-2 text-base text-ink" aria-live="polite">
            {loading ? <Loader2 size={15} className="animate-spin text-coral" /> : null}
            {view ? (
              <span>
                {t.rich("wouldReject", {
                  rejected: rejects.length,
                  cohort: view.cohort,
                  b: (chunks) => <span className="font-semibold text-coral">{chunks}</span>,
                })}{" "}
                · <span className="text-steel">{t("keptCount", { count: keeps.length })}</span>
              </span>
            ) : (
              <span className="text-steel">{t("computingPreview")}</span>
            )}
          </p>

          {lists}
        </div>
      )}
    </Modal>
    {/* Stacks over the preview via the shared Modal/useDialogA11y machinery. */}
    {confirmOpen ? (
      <DecisionsScreenWaveConfirmModal
        rejectCount={rejects.length}
        committing={committing}
        onClose={() => {
          if (!committing) setConfirmOpen(false);
        }}
        onConfirm={commit}
      />
    ) : null}
    </>
  );
}
