"use client";

// UAT LUC-GEF-L1-08 (recurrence 2) — why this dialog exists.
//
// A reject issued from inside the group-eval modal used to seal with NO basis:
// DecisionsModals called `act(e, action)` without the `detail` argument, so
// pipeline-entry-action.ts:316 fell back to its template ("Recruiter reject from
// Screened.") and the sealed record carried `inputs.detail: null`. That template
// is a tautology — the reason recorded for a rejection was that a recruiter
// rejected — and it is what an auditor reads FIRST, in the Odůvodnění column of
// the decision-records table. The analysis path two lines away has always passed
// the recruiter's reason, so the quality of a permanent, tamper-evident record
// depended on which button the recruiter happened to use.
//
// So the reason is MANDATORY here, and it rides in front of a confirm step: a
// reject is irreversible, emailed and sealed, and one stray click inside a
// bulk-comparison surface should not be able to issue it (the same guard
// DecisionsScreenWaveConfirmModal gives the bulk screening wave).
//
// Fast by construction — friction that buys nothing is the recruiter's pet
// peeve: the presets are one click and fill the field, so the common path is
// preset → Confirm, and Enter-to-confirm works from the textarea (⌘/Ctrl+Enter).
// G2/G3 hold: nothing here touches the sealed bytes or the actor attribution —
// it only fills the rationale slot the seal already carries.
import { useState } from "react";
import { AlertTriangle, Ban } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextArea } from "@/app/_components/TextArea";
import { BTN_GHOST, CHIP_TOGGLE } from "@/app/_components/ui/recipes";

// The preset rationales, as catalog keys. Deliberately the four grounds this
// comparison surface actually produces (the modal ranks a field against ONE
// role's requirements, band and evidence) — not a generic list. Picking one
// fills the field, which stays editable: the sealed text is always whatever the
// recruiter can see in the box, never a hidden code.
export const GROUP_EVAL_REJECT_PRESETS = ["mustHave", "weakerField", "salaryBand", "evidence"] as const;

export function DecisionsGroupEvalRejectModal({
  candidateLabel,
  roleTitle,
  onCancel,
  onConfirm,
}: {
  candidateLabel: string;
  roleTitle?: string;
  onCancel: () => void;
  /** Called with the trimmed, non-empty rationale — the caller forwards it to
   *  act() as `detail`, which becomes the sealed record's rationale. */
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations("decisions.groupEval.rejectConfirm");
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const ready = trimmed.length > 0;
  const confirm = () => {
    if (!ready) return;
    onConfirm(trimmed);
  };

  return (
    <Modal
      size="md"
      title={t("title", { name: candidateLabel })}
      subtitle={roleTitle}
      onClose={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} className={`${BTN_GHOST} h-9 px-4 text-sm`}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!ready}
            className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            <Ban size={15} /> {t("confirm")}
          </button>
        </>
      }
    >
      <p className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-coral" aria-hidden />
        <span>{t("body")}</span>
      </p>

      <div className="mt-4">
        <p className="text-meta uppercase tracking-wide text-steel">{t("presetsLabel")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {GROUP_EVAL_REJECT_PRESETS.map((p) => {
            const text = t(`presets.${p}`);
            return (
              <button key={p} type="button" aria-pressed={trimmed === text} onClick={() => setReason(text)} className={CHIP_TOGGLE(trimmed === text)}>
                {text}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="group-eval-reject-reason" className="text-meta uppercase tracking-wide text-steel">
          {t("reasonLabel")} <span className="font-normal normal-case text-coral">{t("reasonRequired")}</span>
        </label>
        <TextArea
          id="group-eval-reject-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            // ⌘/Ctrl+Enter commits — a plain Enter must stay a newline in a
            // free-text rationale, so the shortcut is the modified one.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) confirm();
          }}
          rows={3}
          autoFocus
          placeholder={t("placeholder")}
          sizeVariant="sm"
          className="mt-1.5"
        />
        <p className="mt-1.5 text-meta text-steel">{t("sealNote")}</p>
      </div>
    </Modal>
  );
}
