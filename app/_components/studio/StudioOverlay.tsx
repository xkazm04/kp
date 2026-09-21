"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Modal } from "@/app/_components/Modal";
import { BTN_GHOST, BTN_SECONDARY, NOTICE } from "@/app/_components/ui/recipes";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { useStudioTranslations } from "./useStudioTranslations";

// THE STUDIO — an open conversation, as a full-viewport workspace.
//
// It is `Modal size="full" bare`: the shared dialog primitive owns Escape, the
// focus trap, the scroll lock and the Escape stack (`useDialogA11y`; the contract
// is pinned by e2e/modal-escape.spec.ts), and `bare` means the CONSUMER draws the
// chrome — because a studio's header is not a title bar, it is the session's
// identity plus everything the reader can do to it. That header arrives as a
// slot; the kit draws only what every studio shares.
//
// ESCAPE IS NOT UNCONDITIONAL. A reply takes ~30–40 seconds live, and closing the
// dialog mid-turn does not cancel it — the exchange lands server-side and the
// reader is left on a ledger row that quietly gained a turn they never read.
// So while a turn is in flight (`sending`) the close asks once: Escape, the
// backdrop and the consumer's own close control (`useStudioOverlayClose()`) all
// route through the same gate. Everything else about the dialog's a11y contract
// is the primitive's and is not re-implemented here.
//
// Strings: `<ns>.<titleId>` (the dialog's accessible name; `titleValues` fills
// its ICU arguments), `<ns>.studio.closeBusy|closeStay|closeAnyway`.

const CloseContext = createContext<(() => void) | null>(null);

/** The gated close, for a control the consumer renders in its header slot. */
export function useStudioOverlayClose(): () => void {
  const requestClose = useContext(CloseContext);
  if (!requestClose) throw new Error("useStudioOverlayClose: rendered outside a StudioOverlay");
  return requestClose;
}

export type StudioOverlayProps = {
  open: boolean;
  onClose(): void;
  /** While a turn is in flight Escape asks for confirmation instead of closing. */
  sending: boolean;
  /** next-intl namespace the kit reads its own chrome strings from
   *  (`<ns>.studio.*`); intake passes its tab's branch, the seeker passes "me". */
  ns: string;
  /** Message id, relative to `ns`, of the dialog's accessible name. */
  titleId: string;
  children: ReactNode;
  /** ICU arguments for `titleId` (a session title, a candidate's name). */
  titleValues?: Record<string, string | number | Date>;
  /** The session's identity strip — drawn by the consumer, above the confirm band. */
  header?: ReactNode;
};

export function StudioOverlay({ open, onClose, sending, ns, titleId, children, titleValues, header }: StudioOverlayProps) {
  const t = useStudioTranslations(ns);
  const reduced = useReducedMotion();
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = useMemo(
    () => () => {
      if (sending) {
        setConfirmClose(true);
        return;
      }
      onClose();
    },
    [sending, onClose]
  );

  if (!open) return null;

  return (
    <CloseContext.Provider value={requestClose}>
      <Modal size="full" bare title={t(titleId, titleValues)} onClose={requestClose}>
        {header}

        {/* Disclosure sits between the identity and the work: it is about the whole
            session, and inside a leaf it would belong to that leaf. */}
        <div className="shrink-0 px-5">
          <AnimatePresence initial={false}>
            {confirmClose ? (
              <motion.div
                key="confirmClose"
                initial={{ opacity: reduced ? 1 : 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: reduced ? 1 : 0 }}
                transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
                role="alert"
                className={`${NOTICE("amber")} mt-3 flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm`}
              >
                <span>{t("studio.closeBusy")}</span>
                <span className="flex items-center gap-2">
                  <button type="button" className={`${BTN_SECONDARY} h-8 bg-white px-3 text-sm`} onClick={() => setConfirmClose(false)}>
                    {t("studio.closeStay")}
                  </button>
                  <button
                    type="button"
                    className={`${BTN_GHOST} h-8 px-3 text-sm`}
                    onClick={() => {
                      setConfirmClose(false);
                      onClose();
                    }}
                  >
                    {t("studio.closeAnyway")}
                  </button>
                </span>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        {children}
      </Modal>
    </CloseContext.Provider>
  );
}
