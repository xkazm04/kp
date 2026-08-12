"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useTranslations } from "next-intl";
import KandidateMark from "@/app/landing/_components/KandidateMark";
import { useReducedMotion } from "@/app/_lib/useReducedMotion";
import { BTN_GHOST, BTN_PRIMARY, EYEBROW, INTRO } from "@/app/_components/ui/recipes";
import { CompanyStep } from "./SetupCompanyStep";
import { FirstRoleStep } from "./SetupFirstRoleStep";
import { InviteEditor } from "./SetupInviteEditor";
import { WelcomeStep } from "./SetupWelcomeStep";
import { SetupHandoffSummary } from "./SetupHandoffSummary";
import { SETUP_STEPS, type OnboardingCtrl } from "./setupSteps";

// Spotlight Wizard — the first-run setup as a centered takeover. A branded left
// rail carries the vertical stepper; the right pane devotes the whole space to
// ONE step at a time (Welcome → Company → Team → First role → Hand-off), each
// crossfaded. The visual register runs marketing → functional: Welcome opens
// with the landing's stamp/pop energy (display face, sticker tiles), the middle
// steps are calm forms, and the hand-off lands in the app's plain voice — the
// wizard IS the transition from the Spark landing tone into the product tone.
// The background mask is per-theme (see below): a dark ink veil in Studio
// Light, a deep paper veil in Spark Dark — because `ink` flips light in dark
// mode, a single mask would wash the screen out instead of dimming it.
export function OnboardingWizard({ ctrl }: { ctrl: OnboardingCtrl }) {
  const t = useTranslations("setup");
  const reduced = useReducedMotion();
  const step = SETUP_STEPS[ctrl.stepIndex];
  const isWelcome = step.id === "welcome";
  const isHandoff = step.id === "handoff";
  const canSkipStep = step.id === "team" || step.id === "firstRole";

  return (
    <div className="absolute inset-0 grid place-items-center bg-ink/55 p-4 backdrop-blur-sm dark:bg-paper/90">
      <div className="relative w-full max-w-[58rem] overflow-hidden rounded-xl border-2 border-stone-300 bg-white shadow-pop dark:rounded-2xl">
        {ctrl.mode === "preview" ? (
          <p className="border-b border-dashed border-stone-300 bg-limewash/40 px-4 py-1.5 text-center text-sm text-ink">
            {t("previewRibbon")}
          </p>
        ) : null}
        <button
          type="button"
          onClick={ctrl.onClose}
          className="focus-ring absolute right-2.5 top-2.5 z-10 rounded-full p-1.5 text-steel transition-colors hover:bg-stone-100 hover:text-ink"
          aria-label={t("aria.skip")}
          title={t("aria.skip")}
        >
          <X size={18} aria-hidden />
        </button>

        <div className="grid md:grid-cols-[13rem_1fr]">
          {/* Left rail — brand + vertical stepper */}
          <div className="hidden flex-col gap-6 border-r border-stone-200 bg-paper p-5 md:flex">
            <div className="flex items-center gap-2">
              <KandidateMark className="h-8 w-8 text-ink [--k-accent:var(--color-coral)] [--k-fg:var(--color-paper)]" />
              <span className="font-serif text-h3 text-ink">{t("rail.brand")}</span>
            </div>
            <ol className="space-y-1">
              {SETUP_STEPS.map((p, i) => {
                const done = ctrl.stepIndex > i;
                const active = ctrl.stepIndex === i;
                // Mirrors the host's goTo gate: back to anything reached, forward
                // one step only when the current step's required inputs hold — so
                // the rail can't bypass what the Continue button enforces.
                const reachable =
                  i <= Math.max(ctrl.maxVisited, ctrl.stepIndex) || (i === ctrl.stepIndex + 1 && ctrl.canAdvance);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => ctrl.goTo(i)}
                      disabled={!reachable}
                      aria-current={active ? "step" : undefined}
                      className={`focus-ring flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors ${
                        reachable ? "hover:bg-white" : "cursor-not-allowed opacity-45"
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                          active
                            ? "bg-coral text-white"
                            : done
                              ? "bg-moss/15 text-moss"
                              : "border border-stone-300 bg-white text-steel"
                        }`}
                      >
                        {done ? <Check size={13} /> : i + 1}
                      </span>
                      <span className={`text-sm ${active ? "font-semibold text-ink" : done ? "text-moss" : "text-steel"}`}>
                        {t(`steps.${p.id}.label`)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="nums mt-auto text-meta uppercase tracking-wide text-steel">
              {t("rail.stepOf", { current: ctrl.stepIndex + 1, total: SETUP_STEPS.length })}
            </p>
          </div>

          {/* Right pane — one step at a time (body scrolls, footer pinned). The
              height is FIXED (not content-driven) so the card doesn't shrink and
              expand as steps swap; the tallest step scrolls instead. The scroll
              container gets negative-margin + matching padding so the coral
              focus ring of edge-hugging inputs isn't clipped by overflow-y. */}
          <div className="flex h-[min(90vh,43rem)] flex-col p-6 sm:p-8">
            <div className="-mx-3 -my-1 flex-1 overflow-y-auto px-3 py-1">
              <AnimatePresence mode="wait">
                <motion.div
                  key={step.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduced ? 0 : 0.2 }}
                >
                  <p className={EYEBROW}>{t(`steps.${step.id}.eyebrow`)}</p>
                  <h2 className={`mt-1 font-serif text-ink ${isWelcome ? "text-display" : "text-h2"}`}>
                    {t(`steps.${step.id}.title`)}
                  </h2>
                  <p className={`mt-2 max-w-md ${INTRO}`}>{t(`steps.${step.id}.blurb`)}</p>

                  <div className="mt-6">
                    {step.id === "welcome" ? <WelcomeStep ctrl={ctrl} /> : null}
                    {step.id === "company" ? <CompanyStep ctrl={ctrl} /> : null}
                    {step.id === "team" ? (
                      <div className="max-w-md">
                        <InviteEditor ctrl={ctrl} />
                      </div>
                    ) : null}
                    {step.id === "firstRole" ? <FirstRoleStep ctrl={ctrl} /> : null}
                    {step.id === "handoff" ? <SetupHandoffSummary ctrl={ctrl} /> : null}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Footer controls. Hidden on the hand-off step — its two exit paths
                (start the tour / explore solo) are explicit choice tiles in the
                body, so a third competing primary down here would only blur them. */}
            {!isHandoff ? (
              <div className="mt-6 flex items-center gap-2 border-t border-stone-200 pt-4">
                {ctrl.stepIndex > 0 ? (
                  <button type="button" onClick={ctrl.back} className={`${BTN_GHOST} h-10 px-3`}>
                    <ArrowLeft size={16} aria-hidden /> {t("footer.back")}
                  </button>
                ) : null}
                <div className="flex-1" />
                {isWelcome ? (
                  <button type="button" onClick={ctrl.onClose} className={`${BTN_GHOST} h-10 px-3`}>
                    {t("footer.skipSetup")}
                  </button>
                ) : null}
                {canSkipStep ? (
                  <button type="button" onClick={ctrl.next} className={`${BTN_GHOST} h-10 px-3`}>
                    {t("footer.skipStep")}
                  </button>
                ) : null}
                <button type="button" onClick={ctrl.next} disabled={!ctrl.canAdvance} className={`${BTN_PRIMARY} h-10 px-5`}>
                  {isWelcome ? t("footer.start") : t("footer.continue")} <ArrowRight size={16} aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
