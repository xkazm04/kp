"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { BTN_GHOST, BTN_SECONDARY, INTRO } from "@/app/_components/ui/recipes";
import { SETUP_PROSE } from "./setupProse";

/**
 * "Leave setup?" — asked once, in live mode only, before the skip stamp is written.
 *
 * WHY A PANE AND NOT A MODAL. The obvious build is `<Modal>` from
 * `_components/Modal.tsx`, and it does not work here, for two independent reasons:
 *
 *  1. Modal renders through a portal to `document.body` at `z-50`, and the wizard
 *     overlay sits at `z-[var(--z-onboarding)]` = 60 (app/globals.css). The
 *     confirmation would be painted UNDERNEATH the thing it is confirming.
 *  2. Stacking a second `useDialogA11y` over the wizard's own leaves the step's
 *     inputs mounted and Tab-reachable behind it — the shared trap gates Escape and
 *     Tab on the top of the stack, but it does not make the layer below inert, and
 *     `role="dialog"` inside `role="dialog"` is a stack the wizard's card was never
 *     shaped for.
 *
 * Replacing the card's body answers both: ONE dialog stays on the stack (the
 * wizard's), the step's controls leave the DOM so the trap contains exactly the two
 * buttons here, and Escape keeps meaning "back out of the frontmost thing" — the
 * wizard routes it to `cancelLeave` while this pane is up.
 *
 * The card keeps its height (`heightClass`, the same one the step pane uses) so
 * asking a question does not resize the surface underneath it.
 */
export function SetupLeaveConfirm({
  heightClass,
  onConfirm,
  onCancel,
}: {
  heightClass: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("setup.leave");
  // Focus moves to the heading, exactly as it does on every step change
  // (SetupWizardStepPane): the pane replaces the step's controls, so without this
  // the focused element is unmounted and focus falls to <body>, outside the dialog
  // — and landing on the heading is what makes a screen reader read the question
  // instead of just naming a button.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className={`grid ${heightClass} place-items-center p-6 sm:p-8`}>
      <div className={`${SETUP_PROSE} mx-auto text-center`}>
        <span
          aria-hidden
          className="mx-auto grid h-12 w-12 place-items-center rounded-full border-2 border-stone-200 bg-white text-coral shadow-sticker-xs dark:-rotate-2"
        >
          <AlertTriangle size={22} />
        </span>
        {/* inline-block so the focus ring hugs the question instead of drawing a
            full-width box across the pane — the step headings are left-aligned
            blocks, this one is centred. */}
        <h2 ref={headingRef} tabIndex={-1} className="focus-ring mt-5 inline-block rounded-sm font-serif text-h2 text-ink">
          {t("title")}
        </h2>
        <p className={`mx-auto mt-3 max-w-xl ${INTRO}`}>{t("body")}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
          {/* "Keep setting up" is the recommended half and reads first. It is
              BTN_SECONDARY rather than BTN_PRIMARY on purpose: the wizard's own
              Continue is the surface's coral action, and a second coral button
              appearing where Continue used to be would be pressed by muscle
              memory — which is the same reflex that opened this pane. */}
          <button type="button" onClick={onCancel} className={`${BTN_SECONDARY} h-10 bg-white px-5`}>
            {t("cancel")}
          </button>
          {/* The departure is the quiet half — offered plainly, never recommended. */}
          <button type="button" onClick={onConfirm} className={`${BTN_GHOST} h-10 px-4`}>
            {t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
