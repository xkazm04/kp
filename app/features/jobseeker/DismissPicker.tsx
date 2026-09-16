"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { BTN_PRIMARY, BTN_SECONDARY, CHIP_TOGGLE, FIELD, META_LABEL, PANEL_SUNKEN, POPOVER } from "@/app/_components/ui/recipes";
import type { DismissReason } from "@/app/_lib/jobseeker/types";
import { DISMISS_PICKER_REASONS } from "./feedModel";

// The dismiss confirm: a reason from the wire vocabulary (required by the PATCH
// route) and an optional note. The reason is what the feed LEARNS from: the fit
// dialog reads the last ten dismissals as the seeker's taste ("you dismissed three
// roles for salary; this one states no pay"), so the picker refuses to dismiss
// without one. The DevPublishConfirm shape: alertdialog, focus trapped, Escape
// cancels, the first radio takes focus.
//
// TWO SURFACES, one dialog. On the posting page it is an inline well under the header
// (`PANEL_SUNKEN`, the recipe the shell used to re-type by hand); in the feed's ledger
// it hangs off the row's action cell as the anchored pop layer (`POPOVER`), because a
// ledger row must not grow a panel underneath it. The reason buttons compose
// `CHIP_TOGGLE` rather than re-implementing the pill — the hand-rolled version was
// `border-ink bg-ink text-white`, an active state no other filter pill in the product
// wears, and it carried none of the Spark Dark structure the recipe owns.

export function DismissPicker({
  title,
  busy,
  surface = "inline",
  onConfirm,
  onCancel,
}: {
  title: string;
  busy: boolean;
  surface?: "inline" | "popover";
  onConfirm(reason: DismissReason, note: string): void;
  onCancel(): void;
}) {
  const t = useTranslations("me.jobs.dismiss");
  const ref = useRef<HTMLDivElement | null>(null);
  const [reason, setReason] = useState<DismissReason | null>(null);
  const [note, setNote] = useState("");
  useDialogA11y(ref, onCancel, { trap: true, lockScroll: false });
  const shell = surface === "popover" ? `${POPOVER} p-3` : `${PANEL_SUNKEN} mt-3 p-3`;
  return (
    <div ref={ref} role="alertdialog" aria-modal="true" aria-label={t("title", { title })} tabIndex={-1} className={shell}>
      <p className={META_LABEL}>{t("reasonLabel")}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("reasonLabel")}>
        {DISMISS_PICKER_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={reason === r}
            onClick={() => setReason(r)}
            className={CHIP_TOGGLE(reason === r)}
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
