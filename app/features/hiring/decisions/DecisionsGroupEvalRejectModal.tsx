"use client";

// UAT LUC-GEF-L1-08 (recurrence 2) + group-eval accept rationale.
//
// A decision issued from inside the group-eval modal used to seal with NO basis:
// DecisionsModals called `act(e, action)` without the `detail` argument, so
// pipeline-entry-action.ts fell back to its template ("Recruiter accept/reject
// from Screened.") and the sealed record carried `inputs.detail: null`. That
// template is a tautology — the reason recorded was that a recruiter clicked —
// and it is what an auditor reads FIRST, in the Odůvodnění column. Reject was
// gated first; advance now shares this confirm+reason dialog with
// action-specific presets (strongest field, must-haves, scorecard).
//
// Fast by construction: the presets are one click and fill the field, so the
// common path is preset → Confirm, and ⌘/Ctrl+Enter commits from the textarea.
// G2/G3 hold: nothing here touches the sealed bytes or the actor attribution —
// it only fills the rationale slot the seal already carries.
import { useState } from "react";
import { AlertTriangle, ArrowRight, Ban, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/app/_components/Modal";
import { TextArea } from "@/app/_components/TextArea";
import { BTN_AFFIRM, BTN_GHOST, CHIP_TOGGLE } from "@/app/_components/ui/recipes";

// Reject grounds this comparison surface actually produces. Picking one fills
// the field, which stays editable: the sealed text is always whatever the
// recruiter can see in the box, never a hidden code.
export const GROUP_EVAL_REJECT_PRESETS = ["mustHave", "weakerField", "salaryBand", "evidence"] as const;
// Advance grounds: named basis for crowning/advancing, not a tautology.
export const GROUP_EVAL_ACCEPT_PRESETS = ["strongestField", "mustHaves", "scorecard"] as const;

export function DecisionsGroupEvalRejectModal({
  action,
  candidateLabel,
  roleTitle,
  onCancel,
  onConfirm,
}: {
  action: "accept" | "reject";
  candidateLabel: string;
  roleTitle?: string;
  onCancel: () => void;
  /** Called with the trimmed, non-empty rationale — the caller forwards it to
   *  act() as `detail`, which becomes the sealed record's rationale. */
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations(action === "reject" ? "decisions.groupEval.rejectConfirm" : "decisions.groupEval.acceptConfirm");
  const [reason, setReason] = useState("");
  const trimmed = reason.trim();
  const ready = trimmed.length > 0;
  const confirm = () => {
    if (!ready) return;
    onConfirm(trimmed);
  };
  const presets = action === "reject" ? GROUP_EVAL_REJECT_PRESETS : GROUP_EVAL_ACCEPT_PRESETS;
  const ConfirmIcon = action === "reject" ? Ban : Check;
  const BodyIcon = action === "reject" ? AlertTriangle : ArrowRight;
  const reasonId = action === "reject" ? "group-eval-reject-reason" : "group-eval-advance-reason";

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
            className={
              action === "reject"
                ? "focus-ring inline-flex h-9 items-center gap-1.5 rounded-md bg-coral px-4 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-40"
                : `${BTN_AFFIRM} h-9 px-4 text-sm`
            }
          >
            <ConfirmIcon size={15} /> {t("confirm")}
          </button>
        </>
      }
    >
      <p className="flex items-start gap-2 text-sm text-ink">
        <BodyIcon size={16} className={`mt-0.5 shrink-0 ${action === "reject" ? "text-coral" : "text-moss"}`} aria-hidden />
        <span>{t("body")}</span>
      </p>

      <div className="mt-4">
        <p className="text-meta uppercase tracking-wide text-steel">{t("presetsLabel")}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {presets.map((p) => {
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
        <label htmlFor={reasonId} className="text-meta uppercase tracking-wide text-steel">
          {t("reasonLabel")} <span className="font-normal normal-case text-coral">{t("reasonRequired")}</span>
        </label>
        <TextArea
          id={reasonId}
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
