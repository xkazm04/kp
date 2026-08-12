"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { OnboardingWizard } from "./SetupOnboardingWizard";
import { INITIAL_SETUP, SETUP_STEPS, stepSatisfied, type OnboardingCtrl, type SetupInvite, type SetupState } from "./setupSteps";
import { persistOnboardingSetup } from "./setupOnboardingFinish";

// First-run onboarding host. Owns the setup state + step index and hands one
// controller to the wizard. Rendered as a fixed overlay over the workspace. Two
// modes:
//   "live"    — the real first run (mounted by Workspace when the '/' gate says
//               so). Finish PERSISTS everything — org name, language, brand,
//               invites — starts the first role's REAL backgrounded AI build
//               (POST /api/jds/generate: description + market salary + case
//               design, landing in the Library ledger), and stamps the principal
//               "completed"; Escape / X / Skip stamp "skipped" — either way the
//               '/' gate never re-fires (KP_FORCE_ONBOARDING=1 excepted).
//   "preview" — the Settings → Organization walkthrough. NOTHING persists — no
//               org writes, no invites, no build, no stamp (fixes the
//               ambiguity-ui finding that "Preview" wrote for real).
export function OnboardingExperience({ mode = "preview", onClose }: { mode?: "live" | "preview"; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("setup");
  const [stepIndex, setStepIndex] = useState(0);
  // Seed the language draft from the locale the app is ACTUALLY running in
  // (cookie, else Accept-Language, else en) rather than the hardcoded "en" in
  // INITIAL_SETUP — otherwise a browser that already resolved to Czech opens the
  // wizard with "English" selected under Czech copy, and finishing would quietly
  // switch the workspace back to English.
  const appLocale = useLocale();
  const [state, setState] = useState<SetupState>(() => ({ ...INITIAL_SETUP, language: appLocale }));
  const finishing = useRef(false);

  // Stamp the first-run outcome so the '/' gate stops showing the wizard. Fire-
  // and-forget: a lost stamp only means the wizard offers itself once more.
  const stamp = useCallback(
    (status: "completed" | "skipped") => {
      if (mode !== "live") return;
      void fetch("/api/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }).catch(() => {});
    },
    [mode]
  );

  // Skip / Escape / X: in live mode this is an explicit "not now" — record it.
  const dismiss = useCallback(() => {
    stamp("skipped");
    onClose();
  }, [stamp, onClose]);

  // Highest step legitimately reached (Continue / Skip both route through the
  // movers below, so the high-water mark is exactly "reached through the gates").
  const [maxVisited, setMaxVisited] = useState(0);

  // Rail navigation is GATED like the Continue button: freely back to anything
  // already reached, forward only one step and only when the current step's
  // required inputs are satisfied — so the stepper can't bypass a key input the
  // footer enforces. (Skip for now still works: it goes through next(), which
  // raises the high-water mark legitimately.)
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(SETUP_STEPS.length - 1, i));
      const allowed =
        target <= Math.max(maxVisited, stepIndex) ||
        (target === stepIndex + 1 && stepSatisfied(SETUP_STEPS[stepIndex].id, state));
      if (!allowed) return;
      setStepIndex(target);
      setMaxVisited((m) => Math.max(m, target));
    },
    [stepIndex, maxVisited, state]
  );
  const next = useCallback(() => {
    const target = Math.min(SETUP_STEPS.length - 1, stepIndex + 1);
    setStepIndex(target);
    setMaxVisited((m) => Math.max(m, target));
  }, [stepIndex]);
  const back = useCallback(() => setStepIndex((s) => Math.max(0, s - 1)), []);
  const update = useCallback((patch: Partial<SetupState>) => setState((s) => ({ ...s, ...patch })), []);
  const addInvite = useCallback((invite: SetupInvite) => setState((s) => ({ ...s, invites: [...s.invites, invite] })), []);
  const removeInvite = useCallback(
    (index: number) => setState((s) => ({ ...s, invites: s.invites.filter((_, i) => i !== index) })),
    []
  );

  // Persist everything the wizard collected, then close. Each step is best-effort
  // (one failing invite must not sink the rest), so a partial network hiccup still
  // lands what it can and the user isn't trapped.
  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    if (mode !== "live") {
      // Preview walkthrough: nothing is saved, and no toast pretends otherwise.
      onClose();
      return;
    }
    try {
      await persistOnboardingSetup(state, t);
    } catch {
      toast.error(t("toast.partial"));
    } finally {
      stamp("completed");
      router.refresh();
      onClose();
    }
  }, [state, mode, stamp, onClose, router, t]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismiss]);

  const stepId = SETUP_STEPS[stepIndex].id;
  const canAdvance = stepSatisfied(stepId, state);

  const ctrl: OnboardingCtrl = {
    mode,
    stepIndex,
    maxVisited,
    goTo,
    next,
    back,
    state,
    update,
    addInvite,
    removeInvite,
    onClose: dismiss,
    finish,
    canAdvance,
    isLast: stepIndex === SETUP_STEPS.length - 1,
  };

  return (
    <div className="fixed inset-0 z-[var(--z-onboarding)]" role="dialog" aria-modal="true" aria-label={t("aria.dialog")}>
      <OnboardingWizard ctrl={ctrl} />
    </div>
  );
}
