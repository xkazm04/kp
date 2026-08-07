"use client";

import { AlertTriangle, ArrowUpCircle, PauseCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { deriveDecisionOutcome } from "@/app/_lib/decision-attribution";
import { usePassReasonText } from "./passReasonText";
import type { Entry } from "@/app/features/shared/pipelineTypes";

type PreviewDecision = { entryId: string; action: string; toStage: string | null; reason: string; outcome?: string };
type Preview = {
  summary: { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number };
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
export function PassPreviewModal({
  preview,
  entries,
  committing,
  onCommit,
  onClose,
}: {
  preview: Preview;
  entries: Entry[];
  committing: boolean;
  onCommit: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("pipeline.tab");
  // The sealed English `reason` is the fallback; the structured code renders localized.
  const passReason = usePassReasonText();
  const labelById = new Map(entries.map((e) => [e.id, e.candidateLabel]));
  const label = (id: string) => labelById.get(id) ?? id;

  const rejects = preview.decisions.filter((d) => d.action === "reject");
  const advances = preview.decisions.filter((d) => d.action === "advance");
  // A fairness-backstop refusal is a WOULD-BE REJECT the guard intercepted —
  // the regression signal this preview exists to surface. It must not hide
  // among routine holds in a collapsed <details>.
  const allHolds = preview.decisions.filter((d) => d.action === "hold");
  const fairnessBlocked = allHolds.filter((d) => deriveDecisionOutcome(d) === "fairness_blocked");
  const holds = allHolds.filter((d) => deriveDecisionOutcome(d) !== "fairness_blocked");
  const changes = rejects.length + advances.length;

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
  // deliberately stays installation-wide. When this team has none but the run does, the
  // commit is still a real, consequential action — so it is offered and labeled as one,
  // never silently replaced by "nothing to apply".
  const globalChanges = preview.summary.advanced + preview.summary.rejected;
  const othersOnly = partial && changes === 0 && globalChanges > 0;

  return (
    <Modal
      title={t("previewTitle")}
      subtitle={t("previewSubtitle", { evaluated: preview.summary.evaluated })}
      onClose={onClose}
      footer={
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 bg-white px-3 text-base font-semibold text-steel hover:text-ink"
          >
            {t("previewCancel")}
          </button>
          {/* Only-other-teams-have-changes: name it. The commit affordance stays (a
              commit was always installation-wide — hiding it was the misleading part),
              labeled with the global count so the click can't read as "apply my 0". */}
          {othersOnly ? <span className="mr-auto text-sm text-steel">{t("previewOtherTeamsOnly", { count: globalChanges })}</span> : null}
          {changes > 0 || othersOnly ? (
            <button
              type="button"
              onClick={onCommit}
              disabled={committing}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {/* No `rejected` param: a commit produces zero rejections, so the
                  button must not imply any (it used to pass the would-be-reject
                  count into a message that then had to stay silent about it). */}
              {committing ? t("runningPass") : othersOnly ? t("previewApplyGlobal", { count: globalChanges }) : t("previewApply", { count: changes })}
            </button>
          ) : (
            <span className="text-sm text-steel">{t("previewNothing")}</span>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* The header/subtitle counts are the whole installation's; the rows below are
            this team's. Say the ratio out loud rather than letting the two disagree. */}
        {partial ? (
          <p className="rounded-md border border-stone-200 bg-paper/50 px-3 py-1.5 text-sm text-steel">
            {t("previewScope", { mine, total })}
          </p>
        ) : null}
        {rejects.length > 0 ? (
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <XCircle size={13} aria-hidden /> {t("previewRejectsQueued", { count: rejects.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {rejects.map((d) => (
                <li key={d.entryId} className="rounded-md border border-coral/30 bg-coral/5 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-ink">{label(d.entryId)}</span>{" "}
                  <span className="text-steel">— {passReason(d)}</span>
                </li>
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
                <li key={d.entryId} className="rounded-md border border-moss/30 bg-moss/5 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-ink">{label(d.entryId)}</span>{" "}
                  <span className="text-steel">— {passReason(d)}</span>
                </li>
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
        <p className="text-sm text-steel">{t("previewNote")}</p>
      </div>
    </Modal>
  );
}
