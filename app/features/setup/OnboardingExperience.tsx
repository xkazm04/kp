"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { setOrgLanguage, setOrgName } from "@/app/_lib/org-actions";
import { toast } from "@/app/_components/toast-store";
import { OnboardingWizard } from "./OnboardingWizard";
import { INITIAL_SETUP, SETUP_STEPS, type OnboardingCtrl, type SetupInvite, type SetupState } from "./steps";

// bug-ui-scan-2026-07-09 (organizations-members-invites #4): the wizard's invite
// roles are now the REAL membership slugs (auth/roles) end-to-end, so the invite
// POST sends inv.role verbatim — the hand-maintained label→slug ROLE_SLUG map (and
// its `?? "recruiter"` silent-downgrade fallback) is gone.

// First-run onboarding host. Owns the setup state + step index and hands one
// controller to the Spotlight Wizard. Rendered as a fixed overlay over the
// workspace. Escape / X / Skip discard the draft (onClose); "Enter KP" PERSISTS it
// (finish) — org name, language, invites, and the first role all land server-side.
export function OnboardingExperience({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(0);
  const [state, setState] = useState<SetupState>(INITIAL_SETUP);
  const finishing = useRef(false);

  const goTo = useCallback((i: number) => setStepIndex(Math.max(0, Math.min(SETUP_STEPS.length - 1, i))), []);
  const next = useCallback(() => setStepIndex((s) => Math.min(SETUP_STEPS.length - 1, s + 1)), []);
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
    try {
      const name = state.orgName.trim();
      if (name) await setOrgName(name);
      await setOrgLanguage(state.language);

      await Promise.allSettled(
        state.invites.map((inv) =>
          fetch("/api/org/invites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: inv.email, role: inv.role }),
          })
        )
      );

      // First role — only when we have both a title AND body (the JD save requires
      // both); an incomplete draft is skipped and can be finished in the Library.
      const title = state.job.title.trim();
      const body = state.job.body.trim();
      if (title && body) {
        await fetch("/api/jds", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body }),
        }).catch(() => {});
      }
      toast.success("Your workspace is set up");
    } catch {
      toast.error("Some setup steps couldn't be saved — you can finish them in Settings");
    } finally {
      router.refresh();
      onClose();
    }
  }, [state, onClose, router]);

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
    finish,
    canAdvance,
    isLast: stepIndex === SETUP_STEPS.length - 1,
  };

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Set up your workspace">
      <OnboardingWizard ctrl={ctrl} />
    </div>
  );
}
