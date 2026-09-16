"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD, META_LABEL } from "@/app/_components/ui/recipes";
import type { DismissReason } from "@/app/_lib/jobseeker/types";
import { DISMISS_PICKER_REASONS } from "./feedModel";

// The dismiss confirm: a reason from the wire vocabulary (required by the PATCH
// route) and an optional note. The reason is what the feed LEARNS from: the fit
// dialog reads the last ten dismissals as the seeker's taste ("you dismissed three
// roles for salary; this one states no pay"), so the picker refuses to dismiss
// without one. Inline panel under the card, the DevPublishConfirm shape: alertdialog,
// focus trapped, Escape cancels, the first radio takes focus.

export function DismissPicker({ title, busy, onConfirm, onCancel }: { title: string; busy: boolean; onConfirm(reason: DismissReason, note: string): void; onCancel(): void }) {
  const t = useTranslations("me.jobs.dismiss");
  const ref = useRef<HTMLDivElement | null>(null);
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [note, setNote] = useState("");
  useDialogA11y(ref, onCancel, { trap: true, lockScroll: false });
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label={t("title", { title })} tabIndex={-1} className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <p className={META_LABEL}>{t("reasonLabel")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("reasonLabel")}>
        {DISMISS_PICKER_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={`focus-ring rounded-full border px-3 py-1 text-sm transition-colors ${reason === r ? "border-ink bg-ink text-white" : "border-stone-200 bg-white text-steel hover:text-ink"}`}
          >
            {t(`reason.${r}`)}
          </button>
        ))}
      </div>
      <label className="mt-3 block">
        <span className={META_LABEL}>{t("noteLabel")}</span>
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t("notePlaceholder")} className={`${FIELD} mt-1 w-full`} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${BTN_PRIMARY} h-9 px-3 text-sm`} disabled={!reason || busy} onClick={() => reason && onConfirm(reason, note.trim())}>
          {t("confirm")}
        </button>
        <button type="button" className={`${BTN_SECONDARY} h-9 px-3 text-sm`} onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
