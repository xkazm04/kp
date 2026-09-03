"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { EYEBROW, INTRO } from "@/app/_components/ui/recipes";
import { CompanyStep } from "./SetupCompanyStep";
import { InviteEditor } from "./SetupInviteEditor";
import { SetupPipelineStep } from "./SetupPipelineStep";
import { SetupCompanionStep } from "./SetupCompanionStep";
import { WelcomeStep } from "./SetupWelcomeStep";
import { SetupHandoffSummary } from "./SetupHandoffSummary";
import { SETUP_PROSE } from "./setupProse";
import { SETUP_STEPS, type OnboardingCtrl, type SetupStepId } from "./setupSteps";

/**
 * One step's pane — heading, blurb, body.
 *
 * Its own component, and keyed by step id at the call site, so it REMOUNTS on
 * every step change: that is what lets the heading take focus at the right
 * moment. The wizard crossfades with `AnimatePresence mode="wait"`, so the new
 * pane does not exist until the old one has finished leaving; a focus effect in
 * the parent, watching `stepIndex`, would fire against the outgoing node.
 *
 * Moving focus here is the whole point. The takeover was `aria-modal` with no
 * focus management at all: advancing a step swapped the entire visible content
 * while focus stayed on the Continue button, so a screen-reader user heard
 * nothing change and a keyboard user's next Tab resumed from the footer of a
 * screen that no longer existed. The parent announces the step separately through
 * a persistent live region — a region that remounts with its content usually does
 * not announce at all.
 *
 * On the FIRST open this effect is harmless: child effects run before the
 * ancestor's, so useDialogA11y's open-focus (OnboardingExperience) still wins and
 * the dialog opens on its first focusable control, as every other modal does.
 */
export function SetupWizardStepPane({ ctrl, stepId }: { ctrl: OnboardingCtrl; stepId: SetupStepId }) {
  const t = useTranslations("setup");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const isWelcome = stepId === "welcome";

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div>
      <p className={EYEBROW}>{t(`steps.${stepId}.eyebrow`)}</p>
      <h2
        ref={headingRef}
        tabIndex={-1}
        className={`focus-ring mt-1 rounded-sm font-serif text-ink ${isWelcome ? "text-display" : "text-h2"}`}
      >
        <span className="sr-only">
          {t("aria.stepPosition", { index: SETUP_STEPS.findIndex((s) => s.id === stepId) + 1, total: SETUP_STEPS.length })}{" "}
        </span>
        {t(`steps.${stepId}.title`)}
      </h2>
      <p className={`mt-2 ${SETUP_PROSE} ${INTRO}`}>{t(`steps.${stepId}.blurb`)}</p>

      <div className="mt-6">
        {stepId === "welcome" ? <WelcomeStep /> : null}
        {stepId === "company" ? <CompanyStep ctrl={ctrl} /> : null}
        {stepId === "team" ? <InviteEditor ctrl={ctrl} /> : null}
        {stepId === "pipeline" ? <SetupPipelineStep ctrl={ctrl} /> : null}
        {stepId === "companion" ? <SetupCompanionStep ctrl={ctrl} /> : null}
        {stepId === "handoff" ? <SetupHandoffSummary ctrl={ctrl} /> : null}
      </div>
    </div>
  );
}
