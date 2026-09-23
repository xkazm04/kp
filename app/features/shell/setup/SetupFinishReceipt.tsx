"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Check, Copy, RotateCcw } from "lucide-react";
import { toast } from "@/app/_components/toast-store";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, INTRO, NOTICE, PANEL } from "@/app/_components/ui/recipes";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { describeSetupFailures, type SetupFinishPart, type SetupFinishReceipt as Receipt } from "./setupFinishOutcome";
import { SETUP_PROSE } from "./setupProse";

/**
 * The finish receipt - what the wizard shows INSTEAD of closing when finish() left
 * the operator something to act on (setupFinishOutcome.ts, finishReceipt).
 *
 * Two things earn it. An invite that landed: kp sends no invitation mail (the route
 * mints a tokenized accept link and nothing else), so the link on this pane is the
 * only way the teammate will hear of it - it is shown here, to the operator who
 * minted it, and nowhere else: never logged, never put in a URL, never sent to
 * telemetry. A copy failure says so and leaves the link on screen to select.
 * And a part that did not land: named with its reason in the reader's language,
 * with Retry offered only when some failure is one a retry can fix, and running
 * only those parts (finishRemainder).
 *
 * The completed stamp and the draft clear wait for Done, so a partial finish no
 * longer throws the answers away under a toast.
 *
 * Replaces the card's body exactly like SetupLeaveConfirm (and for the same
 * reasons: one dialog on the stack, the card keeps its height).
 */
export function SetupFinishReceipt({
  heightClass,
  receipt,
  retrying,
  startsTour,
  onRetry,
  onDone,
}: {
  heightClass: string;
  receipt: Receipt;
  retrying: boolean;
  startsTour: boolean;
  onRetry: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("setup");
  const resolveError = useErrorMessage();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Focus lands on the heading, as on every step change (SetupWizardStepPane): the
  // step's controls just unmounted, and the heading is what a screen reader reads.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(done);
    } catch {
      // NOT logged: the text is a live capability link into the org. The link
      // stays on screen, so the operator can select it by hand.
      toast.error(t("receipt.copyFailed"));
    }
  }

  const lines = describeSetupFailures(
    receipt.failures,
    (part: SetupFinishPart) => t(`finish.part.${part}`),
    (code) => resolveError({ code }, t("finish.reasonUnknown")),
    (p) => t("finish.line", p),
    (p) => t("finish.lineWithAddresses", p)
  );
  const partial = receipt.failures.length > 0;

  return (
    <div className={`flex ${heightClass} min-w-0 flex-col p-6 sm:p-8`}>
      <div className="-mx-3 -my-1 min-w-0 flex-1 overflow-y-auto px-3 py-1">
        <div className={SETUP_PROSE}>
          <span
            aria-hidden
            className={`grid h-12 w-12 place-items-center rounded-full border-2 border-stone-200 bg-white shadow-sticker-xs dark:-rotate-2 ${
              partial ? "text-coral" : "text-moss"
            }`}
          >
            {partial ? <AlertTriangle size={22} /> : <Check size={22} />}
          </span>
          <h2 ref={headingRef} tabIndex={-1} className="focus-ring mt-4 inline-block rounded-sm font-serif text-h2 text-ink">
            {partial ? t("receipt.titlePartial") : t("receipt.titleSaved")}
          </h2>

          {receipt.links.length > 0 ? (
            <section className="mt-6">
              <h3 className={EYEBROW}>{t("receipt.linksTitle", { count: receipt.links.length })}</h3>
              <p className={`mt-1.5 ${INTRO}`}>{t("receipt.linksBody")}</p>
              <ul className="mt-3 space-y-2">
                {receipt.links.map((link) => (
                  <li key={link.email} className={`${PANEL} flex items-center gap-3 p-3`}>
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-semibold text-ink">{link.email}</p>
                      <p className="select-all break-all font-mono text-xs text-steel">{link.url}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void copy(link.url, t("receipt.copied"))}
                      aria-label={t("receipt.copyFor", { email: link.email })}
                      className={`${BTN_SECONDARY} h-9 shrink-0 bg-white px-3 text-sm`}
                    >
                      <Copy size={14} aria-hidden /> {t("receipt.copy")}
                    </button>
                  </li>
                ))}
              </ul>
              {receipt.links.length > 1 ? (
                <button
                  type="button"
                  onClick={() =>
                    void copy(receipt.links.map((l) => `${l.email} ${l.url}`).join("\n"), t("receipt.copiedAll"))
                  }
                  className={`${BTN_SECONDARY} mt-2 h-9 bg-white px-3 text-sm`}
                >
                  <Copy size={14} aria-hidden /> {t("receipt.copyAll")}
                </button>
              ) : null}
            </section>
          ) : null}

          {receipt.unshareable > 0 ? (
            <p role="status" className={`${NOTICE("info")} mt-4 px-3 py-2 text-sm`}>
              {t("receipt.unshareable", { count: receipt.unshareable })}
            </p>
          ) : null}

          {partial ? (
            <section className="mt-6">
              <h3 className={EYEBROW}>{t("receipt.failuresTitle")}</h3>
              <div role="alert" className={`${NOTICE("critical")} mt-2 px-3 py-2 text-sm`}>
                <ul className="space-y-2">
                  {receipt.failures.map((f, i) => (
                    <li key={`${f.part}-${i}`}>
                      <p>{lines[i]}</p>
                      <p className="text-xs opacity-80">{f.retryable ? t("receipt.retryable") : t("receipt.permanent")}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          ) : null}
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2 border-t border-stone-200 pt-4">
        {receipt.canRetry ? (
          <button type="button" onClick={onRetry} disabled={retrying} className={`${BTN_SECONDARY} h-10 bg-white px-4`}>
            <RotateCcw size={16} aria-hidden /> {retrying ? t("receipt.retrying") : t("receipt.retry")}
          </button>
        ) : null}
        <div className="flex-1" />
        <button type="button" onClick={onDone} disabled={retrying} className={`${BTN_PRIMARY} h-10 px-5`}>
          {startsTour ? t("receipt.doneTour") : t("receipt.done")}
        </button>
      </div>
    </div>
  );
}
