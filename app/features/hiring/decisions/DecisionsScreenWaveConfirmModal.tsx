"use client";

// Explicit second confirmation before the irreversible, emailed, sealed reject
// dispatch (finding SD-5). The server approval-token gate covers a STALE set
// (409); this covers an accidental click on a FRESH one. Split out of
// DecisionsScreenWaveModal to keep that file under the 200-line cap.
import { AlertTriangle, Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";

export function DecisionsScreenWaveConfirmModal({
  rejectCount,
  committing,
  onClose,
  onConfirm,
}: {
  rejectCount: number;
  committing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("decisions.wave");
  return (
    <Modal
      title={t("confirmTitle", { count: rejectCount })}
      onClose={onClose}
      size="md"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={committing}
            className="focus-ring inline-flex h-9 items-center rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-stone-50 disabled:opacity-40"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={committing}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            <Ban size={15} /> {committing ? t("rejecting") : t("rejectAndNotify", { count: rejectCount })}
          </button>
        </>
      }
    >
      <p className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral" />
        <span>{t("confirmBody", { count: rejectCount })}</span>
      </p>
    </Modal>
  );
}
