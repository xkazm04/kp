"use client";

import { useState } from "react";
import { AlertTriangle, ArrowUpCircle, PauseCircle, RotateCcw, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { NOTICE } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { capabilityAwareReason } from "@/app/_lib/useAddToPipeline";
import { deriveDecisionOutcome } from "@/app/_lib/decision-attribution";
import { approvedFromPreview, type ApprovedDecision, type CommitReport } from "@/app/_lib/automation-commit-plan";
import { usePassReasonText } from "./passReasonText";
import type { Entry } from "@/app/features/shared/pipelineTypes";

type PreviewDecision = { entryId: string; action: string; toStage: string | null; reason: string; outcome?: string };
type Preview = {
  summary: { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number; scoringDeferred?: number };
  decisions: PreviewDecision[];
  /** TENANCY (a43408d) — `summary` is the GLOBAL sweep (the pass really did evaluate that
   *  many entries, across every team), while `decisions` is already filtered to the caller's
   *  own workspace by /api/automation/run. These two fields are what the route ships so this
   *  modal can say which is which instead of pairing a global headline with a partial list.
   *  Absent (simulation fixtures, older payloads) → the modal reads exactly as before. */
  workspaceDecisionCount?: number;
  decisionsWorkspace?: string | null;
};

// AUTO3 — the look-before-commit gate for the policy pass. Like the screening
// wave (DEC2), nothing lands until the explicit commit here.
//
// PREVIEW/COMMIT PARITY: the pass does NOT auto-reject. Every reject it computes
// is queued as a rejection_review on the Decisions gate for a human click — the
// commit records zero rejections and sends zero rejection emails (UAT M6 / GDPR
// Art. 22). The would-be rejects still render first and loudest: they are the
// rows that will land in the recruiter's approval queue, and the reason each one
// carries says so ("Would be queued for approval: …").
/** A refused commit, as the machine half the route answered with (never its English
 *  sentence). gated-doors-clients-read-the-refusal: POST /api/automation/run is
 *  capability-gated, and this modal - the screen the commit button lives on - said
 *  nothing at all when the gate refused; the click simply did nothing. */
export type PassCommitRefusal = { code?: string | null; capability?: string | null } | null;

/** One advance / would-be-reject row with its opt-out. Ticked by default: the preview
 *  is still a proposal to apply, and the recruiter unticks what they disagree with. */
function SelectableRow({
  name,
  reason,
  checked,
  onToggle,
  toggleLabel,
  tone,
}: {
  name: string;
  reason: string;
  checked: boolean;
  onToggle: () => void;
  toggleLabel: string;
  tone: "coral" | "moss";
}) {
  const box = tone === "coral" ? "border-coral/30 bg-coral/5" : "border-moss/30 bg-moss/5";
  return (
    <li className={`rounded-md border px-3 py-1.5 text-sm ${checked ? box : "border-stone-200 bg-paper/50 opacity-70"}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          aria-label={toggleLabel}
          className={`focus-ring mt-0.5 h-4 w-4 shrink-0 ${tone === "coral" ? "accent-coral" : "accent-moss"}`}
        />
        <span>
          <span className={`font-semibold text-ink ${checked ? "" : "line-through"}`}>{name}</span>{" "}
          <span className="text-steel">— {reason}</span>
        </span>
      </label>
    </li>
  );
}

export function PassPreviewModal({
  preview,
  entries,
  committing,
  commitError,
  report,
  onCommit,
  onRepreview,
  onClose,
}: {
  preview: Preview;
  entries: Entry[];
  committing: boolean;
  /** The last commit refusal, resolved to the reader's language here. */
  commitError?: PassCommitRefusal;
  /** What the commit said about the selection, when there is something to say (a row
   *  changed since the preview, or the click joined a pass already in flight). */
  report?: CommitReport | null;
  /** Commit exactly the rows still ticked (automation-commit-plan.ts). */
  onCommit: (approved: ApprovedDecision[]) => void;
  onRepreview?: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.tab");
  const errMsg = useErrorMessage();
  // The sealed English `reason` is the fallback; the structured code renders localized.
  const passReason = usePassReasonText();
  const labelById = new Map(entries.map((e) => [e.id, e.candidateLabel]));
  const label = (id: string) => labelById.get(id) ?? id;
  // Per-row opt-out. The rows the recruiter UNticked, so a fresh preview starts all-on.
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(() => new Set());
  // A re-preview hands a NEW preview to the same mounted modal: start it all-on again,
  // so an id unticked in the last review cannot silently carry into this one.
  const [shownPreview, setShownPreview] = useState(preview);
  if (shownPreview !== preview) {
    setShownPreview(preview);
    setUnticked(new Set());
  }
  const toggle = (id: string) =>
    setUnticked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rejects = preview.decisions.filter((d) => d.action === "reject");
  const advances = preview.decisions.filter((d) => d.action === "advance");
  // A fairness-backstop refusal is a WOULD-BE REJECT the guard intercepted —
  // the regression signal this preview exists to surface. It must not hide
  // among routine holds in a collapsed <details>.
  const allHolds = preview.decisions.filter((d) => d.action === "hold");
  const fairnessBlocked = allHolds.filter((d) => deriveDecisionOutcome(d) === "fairness_blocked");
  const holds = allHolds.filter((d) => deriveDecisionOutcome(d) !== "fairness_blocked");
  const changes = rejects.length + advances.length;
  const selected = [...rejects, ...advances].filter((d) => !unticked.has(d.entryId)).length;

  // TENANCY HONESTY. On a multi-tenant install the header counts describe the WHOLE
  // sweep while the rows below are only this team's, so the modal could show
  // "evaluated 40" above four rows and — worse — hide the commit button entirely when
  // every pending change belonged to another team, even though a commit applies the
  // pass installation-wide. Both are labeled from the fields the route already ships.
  //
  // Single-tenant installs are the common case and must stay noise-free: mine === total
  // there, so `partial` is false and nothing extra renders.
  const mine = preview.workspaceDecisionCount ?? preview.decisions.length;
  const total = preview.summary.evaluated;
  const partial = preview.workspaceDecisionCount != null && mine !== total;
  // The pass's global change count (advances + would-be rejects), from the summary that
  // deliberately stays installation-wide. When this team has none but the run does, say
  // so - but offer NO commit: a commit carries this team's selection and is scoped to
  // this team's rows, so one team's button never applies another team's advances (it
  // used to, from a "(all teams)" button). Those rows wait for their own team or the clock.
  const globalChanges = preview.summary.advanced + preview.summary.rejected;
  const othersOnly = partial && changes === 0 && globalChanges > 0;

  return (
    <Modal
      title={t("previewTitle")}
      subtitle={t("previewSubtitle", { evaluated: preview.summary.evaluated })}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {/* A refused commit is named on the screen that asked for it, from its CODE
              in the reader's language - a capability refusal also names the
              permission the operator has to ask for. */}
          {commitError ? (
            <p role="alert" className="mr-auto basis-full text-sm font-semibold text-coral">
              {capabilityAwareReason(errMsg, commitError, t("previewCommitFailed"))}
            </p>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-steel hover:text-ink"
          >
            {t("previewCancel")}
          </button>
          {report ? (
            // After a commit that has something to report, the only next move is to
            // look again: the rows below the report are the live board's, not the preview's.
            onRepreview ? (
              <button
                type="button"
                onClick={onRepreview}
                disabled={committing}
                className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
              >
                <RotateCcw size={14} aria-hidden /> {t("previewRepreview")}
              </button>
            ) : null
          ) : othersOnly ? (
            /* Only-other-teams-have-changes: named, never applied from here. */
            <span className="mr-auto text-sm text-steel">{t("previewOtherTeamsOnly", { count: globalChanges })}</span>
          ) : changes > 0 ? (
            <button
              type="button"
              onClick={() => onCommit(approvedFromPreview(preview.decisions, unticked))}
              disabled={committing || selected === 0}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {/* No `rejected` param: a commit produces zero rejections, so the
                  button must not imply any (it used to pass the would-be-reject
                  count into a message that then had to stay silent about it). */}
              {committing
                ? t("runningPass")
                : selected === changes
                  ? t("previewApply", { count: changes })
                  : t("previewApplySelected", { count: selected, total: changes })}
            </button>
          ) : (
            <span className="text-sm text-steel">{t("previewNothing")}</span>
          )}
        </div>
      }
    >
      {report ? (
        <div className="space-y-4">
          {/* A click that JOINED a pass already in flight: that pass ran without this
              selection, so its result is not presented as this click's. */}
          {report.selectionHonored ? null : (
            <p role="alert" className={`${NOTICE("amber")} px-3 py-1.5 text-sm`}>
              <AlertTriangle size={14} className="mr-1 inline-block align-text-bottom" aria-hidden />
              {t("previewSelectionNotHonored")}
            </p>
          )}
          {report.drifted.length > 0 ? (
            <section>
              <p role="status" className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-amber-700">
                <AlertTriangle size={13} aria-hidden /> {t("previewDriftedTitle", { count: report.drifted.length })}
              </p>
              <ul className="mt-1.5 space-y-1">
                {report.drifted.map((r) => (
                  <li key={r.entryId} className={`${NOTICE("amber")} px-3 py-1.5 text-sm`}>
                    <span className="font-semibold text-ink">{label(r.entryId)}</span>{" "}
                    <span className="text-steel">
                      —{" "}
                      {t("previewDriftedRow", {
                        approved: t("previewDriftAction", { action: r.approvedAction }),
                        now: t("previewDriftAction", { action: r.action }),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {report.selectionHonored ? <p className="text-sm text-steel">{t("previewDriftedNote")}</p> : null}
        </div>
      ) : (
      <div className="space-y-4">
        {/* The header/subtitle counts are the whole installation's; the rows below are
            this team's. Say the ratio out loud rather than letting the two disagree. */}
        {partial ? (
          <p className="rounded-md border border-stone-200 bg-paper/50 px-3 py-1.5 text-sm text-steel">
            {t("previewScope", { mine, total })}
          </p>
        ) : null}
        {preview.summary.scoringDeferred ? (
          <p role="status" className={`${NOTICE("amber")} px-3 py-1.5 text-sm`}>
            <AlertTriangle size={14} className="mr-1 inline-block align-text-bottom" aria-hidden />
            {t("previewScoringDeferred", { count: preview.summary.scoringDeferred })}
          </p>
        ) : null}
        {rejects.length > 0 ? (
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <XCircle size={13} aria-hidden /> {t("previewRejectsQueued", { count: rejects.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {rejects.map((d) => (
                <SelectableRow
                  key={d.entryId}
                  tone="coral"
                  name={label(d.entryId)}
                  reason={passReason(d)}
                  checked={!unticked.has(d.entryId)}
                  onToggle={() => toggle(d.entryId)}
                  toggleLabel={t("previewRowToggle", { name: label(d.entryId) })}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {advances.length > 0 ? (
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-moss">
              <ArrowUpCircle size={13} aria-hidden /> {t("previewAdvances", { count: advances.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {advances.map((d) => (
                <SelectableRow
                  key={d.entryId}
                  tone="moss"
                  name={label(d.entryId)}
                  reason={passReason(d)}
                  checked={!unticked.has(d.entryId)}
                  onToggle={() => toggle(d.entryId)}
                  toggleLabel={t("previewRowToggle", { name: label(d.entryId) })}
                />
              ))}
            </ul>
          </section>
        ) : null}
        {fairnessBlocked.length > 0 ? (
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-amber-700">
              <AlertTriangle size={13} aria-hidden /> {t("previewFairnessBlocked", { count: fairnessBlocked.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {fairnessBlocked.map((d) => (
                <li key={d.entryId} className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-ink">{label(d.entryId)}</span>{" "}
                  <span className="text-steel">— {passReason(d)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {holds.length > 0 ? (
          <details>
            <summary className="focus-ring flex cursor-pointer items-center gap-1.5 text-meta uppercase tracking-wide text-steel">
              <PauseCircle size={13} aria-hidden /> {t("previewHeld", { count: holds.length })}
            </summary>
            <ul className="mt-1.5 space-y-1">
              {holds.map((d) => (
                <li key={d.entryId} className="rounded-md border border-stone-200 bg-paper/50 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-ink">{label(d.entryId)}</span>{" "}
                  <span className="text-steel">— {passReason(d)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {changes > 0 ? <p className="text-sm text-steel">{t("previewSelectionNote")}</p> : null}
        <p className="text-sm text-steel">{t("previewNote")}</p>
      </div>
      )}
    </Modal>
  );
}
