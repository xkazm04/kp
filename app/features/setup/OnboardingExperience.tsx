"use client";

import { useCallback, useEffect, useState } from "react";
import { OnboardingWizard } from "./OnboardingWizard";
import { INITIAL_SETUP, SETUP_STEPS, type OnboardingCtrl, type SetupInvite, type SetupState } from "./steps";

// First-run onboarding host. Owns the setup state + step index and hands one
// controller to the Spotlight Wizard. Rendered as a fixed overlay over the
// workspace (the onboarding sits ON TOP of the real app). Escape closes.
export function OnboardingExperience({ onClose }: { onClose: () => void }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<SetupState>(INITIAL_SETUP);

  const goTo = useCallback((i: number) => setStepIndex(Math.max(0, Math.min(SETUP_STEPS.length - 1, i))), []);
  const next = useCallback(() => setStepIndex((s) => Math.min(SETUP_STEPS.length - 1, s + 1)), []);
  const back = useCallback(() => setStepIndex((s) => Math.max(0, s - 1)), []);
  const update = useCallback((patch: Partial<SetupState>) => setState((s) => ({ ...s, ...patch })), []);
  const addInvite = useCallback((invite: SetupInvite) => setState((s) => ({ ...s, invites: [...s.invites, invite] })), []);
  const removeInvite = useCallback(
    (index: number) => setState((s) => ({ ...s, invites: s.invites.filter((_, i) => i !== index) })),
    []
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stepId = SETUP_STEPS[stepIndex].id;
  const canAdvance =
    stepId === "organization"
      ? state.orgName.trim().length > 0
      : stepId === "jobDescription"
        ? (state.job.mode === "write" ? state.job.title.trim().length > 0 : state.job.body.trim().length > 0)
        : true;

  const ctrl: OnboardingCtrl = {
    stepIndex,
    goTo,
    next,
    back,
    state,
    update,
    addInvite,
    removeInvite,
    onClose,
    canAdvance,
    isLast: stepIndex === SETUP_STEPS.length - 1,
  };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Set up your workspace">
      <OnboardingWizard ctrl={ctrl} />
    </div>
  );
}
