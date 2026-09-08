"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Modal } from "@/app/_components/Modal";
import { BTN_GHOST, BTN_SECONDARY, CHIP_QUIET, EYEBROW, NOTICE } from "@/app/_components/ui/recipes";
import { companionFallbackClass } from "@/app/_lib/companion-turn";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { IntakeStudioActions } from "./IntakeStudioActions";
import { IntakeStudioDesk } from "./IntakeStudioDesk";
import type { useAppMasterLogic } from "./jdsIntakeAppMaster";
import type { IntakeLogic, IntakeSession } from "./jdsIntakeLogic";

// THE INTAKE STUDIO — the open conversation, as a full-viewport workspace.
//
// The session used to be a second view of the Job-intake TAB: the ledger swapped
// itself out for the desk, under the tab's own header, its mode switcher and its
// intro paragraph. Two things were wrong with that. The desk had to fit in what
// was left of the page, which on a 1280px screen is about half a viewport for
// three panes that are meant to be read together; and the tab was answering two
// questions at once — "which conversations do I have" and "this one" — with the
// second one silently replacing the first. The tab is now the LEDGER, and opening
// a session opens this.
//
// It is `Modal size="full" bare`: the shared dialog primitive owns Escape, the
// focus trap, the scroll lock and the Escape stack (`useDialogA11y`; the contract
// is pinned by e2e/modal-escape.spec.ts), and `bare` means this file draws the
// chrome — because the header here is not a title bar, it is the session's
// identity plus everything the requestor can do to it.
//
// ESCAPE IS NOT UNCONDITIONAL. A reply takes ~30–40 seconds live, and closing the
// dialog mid-turn does not cancel it — the exchange lands server-side and the
// requestor is left on a ledger row that quietly gained a turn they never read.
// So while a turn is in flight the close asks once. Everything else about the
// dialog's a11y contract is the primitive's and is not re-implemented here.

const SHAPE_KEY = {
  power_unit: "shape.powerUnit",
  story: "shape.story",
  app_master: "shape.appMaster",
} as const;

/** One class string for every refusal line on this surface. */
const RED = "text-body text-red-700";

export function IntakeStudioOverlay({
  active,
  logic,
  appMaster,
}: {
  active: IntakeSession;
  logic: IntakeLogic;
  appMaster: ReturnType<typeof useAppMasterLogic>;
}) {
  const t = useTranslations("library.tab.intake");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const reduced = useReducedMotion();
  // An API failure is shown from its machine `code`, never from the server's
  // English `error` string (docs/architecture/api-contracts.md §1.1).
  const resolveError = useErrorMessage();
  const [confirmClose, setConfirmClose] = useState(false);

  const requestClose = () => {
    if (logic.sending) {
      setConfirmClose(true);
      return;
    }
    logic.closeSession();
  };

  // The degraded line says WHICH degradation: "no model configured" is a settings
  // trip, "the model did not answer" is worth one retry, and an unrecognised
  // diagnostic keeps the generic sentence rather than being guessed at.
  const fallbackClass = logic.degradation ? companionFallbackClass(logic.degradation.reason) : null;
  const degradedText =
    fallbackClass === "noProvider"
      ? t("degradedNoProvider")
      : fallbackClass === "providerFailed"
        ? t("degradedProviderFailed")
        : t("degradedNote");
  // The scripted path is written in four locales; a session opened in a fifth is
  // SERVED one of them, and Intl.DisplayNames names it in the reader's own
  // language so no catalog carries a list of language names.
  const standInLanguage =
    logic.degradation?.lang && logic.degradation.lang !== locale
      ? t("standInLanguage", {
          language:
            new Intl.DisplayNames([locale], { type: "language" }).of(logic.degradation.lang) ?? logic.degradation.lang,
        })
      : null;

  const error = logic.error;
  const notices = [
    logic.degraded ? { key: "degraded", cls: "text-meta text-steel", text: degradedText } : null,
    // The stand-in language is its own fact, not a flavour of the one above: the
    // checklist DID answer, just not in the language this session was opened in.
    standInLanguage ? { key: "standIn", cls: "text-meta text-steel", text: standInLanguage } : null,
    logic.voiceNote === "stored" ? { key: "voiceStored", cls: "text-meta text-steel", text: t("voice.storedNote") } : null,
    // The server's refusal CODE decides the sentence; the per-affordance string is
    // only the fallback for a failure that carries none (an offline fetch).
    error?.kind === "send" ? { key: "send", cls: RED, text: resolveError(error, t("sendError")) } : null,
    error?.kind === "promote" ? { key: "promote", cls: RED, text: resolveError(error, t("promoteError")) } : null,
    error?.kind === "saveBrief" ? { key: "saveBrief", cls: RED, text: resolveError(error, t("edit.saveError")) } : null,
    error?.kind === "reopen" ? { key: "reopen", cls: RED, text: resolveError(error, t("reopen.error")) } : null,
    error?.kind === "attachment" ? { key: "attachment", cls: RED, text: resolveError(error, t("attachments.error")) } : null,
  ].filter((n): n is { key: string; cls: string; text: string } => n !== null);

  const heading = active.title || t("untitled");

  return (
    <Modal size="full" bare title={t("studio.dialogLabel", { title: heading })} onClose={requestClose}>
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-stone-200 px-5 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <span className={EYEBROW}>{active.shape ? t(SHAPE_KEY[active.shape]) : t("studio.eyebrow")}</span>
          <span className="min-w-0 truncate font-serif text-h3 text-ink">{heading}</span>
          <span className={CHIP_QUIET}>{t(`status.${active.status}`)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <IntakeStudioActions active={active} logic={logic} />
          <button
            type="button"
            onClick={requestClose}
            aria-label={tCommon("close")}
            className="focus-ring rounded-md p-1 text-steel hover:bg-stone-100 hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      </header>

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
                    logic.closeSession();
                  }}
                >
                  {t("studio.closeAnyway")}
                </button>
              </span>
            </motion.div>
          ) : null}
          {active.status === "complete" ? (
            <motion.p
              key="closedNote"
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              className="mt-3 text-meta text-steel"
            >
              {t("studio.closedNote")}
            </motion.p>
          ) : null}
          {notices.map((n) => (
            <motion.p
              key={n.key}
              initial={{ opacity: reduced ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reduced ? 1 : 0 }}
              transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }}
              className={`mt-2 ${n.cls}`}
            >
              {n.text}
            </motion.p>
          ))}
        </AnimatePresence>
      </div>

      <div className="flex min-h-0 flex-1 flex-col p-5">
        <IntakeStudioDesk active={active} logic={logic} appMaster={appMaster} />
      </div>
    </Modal>
  );
}
