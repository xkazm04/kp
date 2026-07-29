"use client";

import { AlertTriangle, ArrowUpCircle, PauseCircle, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { deriveDecisionOutcome } from "@/app/_lib/decision-attribution";
import { useDeliveryCapability } from "@/app/features/shell/useDeliveryCapability";
import type { Entry } from "@/app/features/shared/pipelineTypes";

type PreviewDecision = { entryId: string; action: string; toStage: string | null; reason: string; outcome?: string };
type Preview = {
  summary: { advanced: number; rejected: number; held: number; alerts: number; errors: number; evaluated: number };
  decisions: PreviewDecision[];
};

// AUTO3 — the look-before-commit gate for the policy pass. The pass
// auto-rejects AND emails candidates in the same breath; like the screening
// wave (DEC2), nothing irreversible happens until the explicit commit here.
// Rejects render first and loudest — they're the irreversible, email-sending
// rows the preview exists for.
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
  // REC-10 — "(sends rejection emails)" is only promised when a relay exists;
  // without one a committed reject records an outbox row nothing delivers.
  const relayConfigured = useDeliveryCapability();
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
              {committing ? t("runningPass") : t("previewApply", { count: changes, rejected: rejects.length })}
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
              <XCircle size={13} aria-hidden />{" "}
              {t(relayConfigured === false ? "previewRejectsQueued" : "previewRejects", { count: rejects.length })}
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
