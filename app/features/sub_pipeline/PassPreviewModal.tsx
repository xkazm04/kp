"use client";

import { AlertTriangle, ArrowUpCircle, PauseCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { deriveDecisionOutcome } from "@/app/_lib/decision-attribution";
import type { Entry } from "./PipelineTypes";

type PreviewDecision = { entryId: string; action: string; toStage: string | null; reason: string; outcome?: string };
type Preview = {
  summary: { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number };
  decisions: PreviewDecision[];
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
          {changes > 0 ? (
            <button
              type="button"
              onClick={onCommit}
              disabled={committing}
              className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-3 text-base font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {/* No `rejected` param: a commit produces zero rejections, so the
                  button must not imply any (it used to pass the would-be-reject
                  count into a message that then had to stay silent about it). */}
              {committing ? t("runningPass") : t("previewApply", { count: changes })}
            </button>
          ) : (
            <span className="text-sm text-steel">{t("previewNothing")}</span>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {rejects.length > 0 ? (
          <section>
            <p className="flex items-center gap-1.5 text-meta uppercase tracking-wide text-coral">
              <XCircle size={13} aria-hidden /> {t("previewRejectsQueued", { count: rejects.length })}
            </p>
            <ul className="mt-1.5 space-y-1">
              {rejects.map((d) => (
                <li key={d.entryId} className="rounded-md border border-coral/30 bg-coral/5 px-3 py-1.5 text-sm">
                  <span className="font-semibold text-ink">{label(d.entryId)}</span>{" "}
                  <span className="text-steel">— {d.reason}</span>
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
                  <span className="text-steel">— {d.reason}</span>
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
                  <span className="text-steel">— {d.reason}</span>
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
                  <span className="text-steel">— {d.reason}</span>
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
