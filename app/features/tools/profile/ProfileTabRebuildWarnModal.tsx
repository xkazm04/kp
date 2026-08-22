"use client";

// The "profile diverged since it was built" confirm dialog, split out of ProfileTab.tsx.
import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import type { RebuildWarn } from "./ProfileTabTypes";

export function ProfileTabRebuildWarnModal({
  rebuildWarn,
  onClose,
  onKeep,
  onProceed,
}: {
  rebuildWarn: RebuildWarn;
  onClose: () => void;
  /** Keep the recruiter's hand-edits: open the existing profile as a plain edit. */
  onKeep: (profileId: string) => void;
  /** Overwrite with the newer analysis: hydrate from it as usual. */
  onProceed: (slug: string, profileId: string) => void;
}) {
  const t = useTranslations("profile.tab");
  // The READER's locale, not the machine's (a bare toLocaleDateString() reads the OS).
  // This date is the whole decision: it is how the recruiter recognizes the edits they
  // are about to let a rebuild overwrite, and "3/4/2026" inside a Czech sentence is a
  // date a Czech reader will read as 3 April.
  const format = useFormatter();
  return (
    <Modal
      size="md"
      title={t("rebuildWarnTitle")}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => onKeep(rebuildWarn.profileId)}
            className="focus-ring h-9 rounded-md border border-stone-200 px-4 text-sm font-semibold text-ink hover:bg-paper"
          >
            {t("rebuildWarnKeep")}
          </button>
          <button
            type="button"
            onClick={() => onProceed(rebuildWarn.slug, rebuildWarn.profileId)}
            className="focus-ring h-9 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-steel"
          >
            {t("rebuildWarnProceed")}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 p-1.5 text-amber-800" aria-hidden>
          <AlertTriangle size={16} />
        </span>
        <p className="text-body text-steel">
          {rebuildWarn.editedAt
            ? t("rebuildWarnBody", { date: format.dateTime(new Date(rebuildWarn.editedAt), { dateStyle: "medium" }) })
            : t("rebuildWarnBodyNoDate")}
        </p>
      </div>
    </Modal>
  );
}
