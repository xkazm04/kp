"use client";

// "Retire this archetype?" — the confirm that used to not exist.
//
// Retiring pulled the archetype out of every picker on ONE click, with no question and
// no idea of the blast radius: the profiles already routed to it keep scoring against
// its weights, and nothing on screen said how many that was. The count is the whole
// point of the dialog — "Retire Returner" reads very differently at 0 profiles and at
// 34 — so it is fetched before the question is answerable, and shown as pending until
// it lands rather than guessed at.
import { Archive } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";

export function ArchetypeArchiveConfirmModal({
  label,
  routedCount,
  busy,
  onClose,
  onConfirm,
}: {
  label: string;
  /** Profiles currently routed to this archetype; null while the count is in flight. */
  routedCount: number | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations("profile.archetypes");
  return (
    <Modal
      size="md"
      title={t("archiveConfirmTitle", { label })}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="focus-ring h-9 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel disabled:opacity-50"
          >
            <Archive size={13} /> {busy ? t("saving") : t("archive")}
          </button>
        </div>
      }
    >
      <p className="text-body text-steel">
        {routedCount === null ? t("archiveConfirmCounting") : t("archiveConfirmBody", { count: routedCount })}
      </p>
      <p className="mt-2 text-sm text-steel">{t("archiveConfirmNote")}</p>
    </Modal>
  );
}
