"use client";

// The rebuild-from-a-newer-CV question, split out of ProfileTab.tsx. It is raised ONLY
// when the field-level merge (profileRebuildMerge.ts) has contested fields — edited by
// hand after the build AND changed by the newer CV — and it names exactly those fields
// instead of warning that "your edits will be overwritten". The view-model
// (rebuildDialogModel) decides which fields and which actions; this only renders it.
import { AlertTriangle } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CHIP_QUIET } from "@/app/_components/ui/recipes";
import { REBUILD_FIELD_LABEL_KEY, type RebuildAction } from "./profileRebuildMerge";
import type { RebuildWarn } from "./ProfileTabTypes";

export function ProfileTabRebuildWarnModal({
  rebuildWarn,
  onClose,
  onMerge,
  onKeep,
  onProceed,
}: {
  rebuildWarn: RebuildWarn;
  onClose: () => void;
  /** The default: the newer CV everywhere else, the recruiter's version of the contested fields. */
  onMerge: () => void;
  /** Keep the recruiter's version outright: open the existing profile as a plain edit. */
  onKeep: (profileId: string) => void;
  /** Take the newer analysis wholesale: hydrate from it as a first build would. */
  onProceed: (slug: string, profileId: string) => void;
}) {
  const t = useTranslations("profile.tab");
  const tLabel = useTranslations("profile");
  // The READER's locale, not the machine's (a bare toLocaleDateString() reads the OS):
  // "3/4/2026" inside a Czech sentence is a date a Czech reader will read as 3 April.
  const format = useFormatter();
  const { dialog, plan } = rebuildWarn;
  const fields = dialog.contestedFields;

  const button: Record<RebuildAction, { label: string; onClick: () => void }> = {
    merge: { label: t("rebuildActionMerge"), onClick: onMerge },
    keep: { label: t("rebuildActionKeep"), onClick: () => onKeep(rebuildWarn.profileId) },
    replace: { label: t("rebuildActionReplace"), onClick: () => onProceed(rebuildWarn.slug, rebuildWarn.profileId) },
  };
  const tone = (action: RebuildAction) =>
    action === dialog.default
      ? `${BTN_PRIMARY} h-9 px-4 text-sm`
      : action === "keep"
        ? `${BTN_SECONDARY} h-9 px-4 text-sm`
        : `${BTN_GHOST} h-9 px-3 text-sm`;

  return (
    <Modal
      size="md"
      title={t("rebuildMergeTitle")}
      onClose={onClose}
      footer={
        // Default action last (the primary slot) so the reading order ends on it.
        <div className="flex flex-wrap justify-end gap-2">
          {[...dialog.actions.filter((a) => a !== dialog.default), dialog.default].map((action) => (
            <button key={action} type="button" onClick={button[action].onClick} className={tone(action)}>
              {button[action].label}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 p-1.5 text-amber-800" aria-hidden>
          <AlertTriangle size={16} />
        </span>
        <div className="space-y-3 text-body text-steel">
          <p>
            {plan.mode === "unknown-baseline"
              ? t("rebuildUnknownBaseline", { count: fields.length })
              : t("rebuildContestedIntro", { count: fields.length })}
          </p>
          <ul className="flex flex-wrap gap-1.5" aria-label={t("rebuildContestedListLabel")}>
            {fields.map((field) => (
              <li key={field} className={CHIP_QUIET}>
                {tLabel(REBUILD_FIELD_LABEL_KEY[field])}
              </li>
            ))}
          </ul>
          <p>
            {rebuildWarn.editedAt
              ? t("rebuildMergeHint", { date: format.dateTime(new Date(rebuildWarn.editedAt), { dateStyle: "medium" }) })
              : t("rebuildMergeHintNoDate")}
          </p>
        </div>
      </div>
    </Modal>
  );
}
