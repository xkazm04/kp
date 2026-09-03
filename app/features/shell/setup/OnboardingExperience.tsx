"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import type { AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import { OnboardingWizard } from "./SetupOnboardingWizard";
import {
  INITIAL_SETUP,
  SETUP_STEPS,
  reachedCeiling as ceilingOf,
  stepSatisfied,
  type OnboardingCtrl,
  type SetupInvite,
  type SetupState,
} from "./setupSteps";
import { persistOnboardingSetup } from "./setupOnboardingFinish";
import { describeSetupFailures, type SetupFinishPart } from "./setupFinishOutcome";
import { mergeSetupDraft, restoredStepIndex, type SetupDraft } from "./setupDraft";
import { useSetupDraft } from "./useSetupDraft";
import { useSetupPipelineAxis } from "./useSetupPipelineAxis";
import { useSetupCompanionBrain } from "./useSetupCompanionBrain";

// First-run onboarding host. Owns the setup state + step index and hands one
// controller to the wizard. Rendered as a fixed overlay over the workspace. Two
// modes:
//   "live"    — the real first run (mounted by Workspace when the '/' gate says
//               so). Finish PERSISTS everything — org name, language, brand,
//               invites, and the board's columns when the Pipeline step changed
//               them (POST /api/pipeline/stage-migration) — and stamps the
//               principal "completed"; Escape / X / Skip stamp "skipped" — either
//               way the '/' gate never re-fires (KP_FORCE_ONBOARDING=1 excepted).
//               Answers are mirrored into a per-user sessionStorage draft, so a
//               reload mid-setup resumes instead of starting over (setupDraft.ts).
//   "preview" — the Settings → Organization walkthrough. NOTHING persists — no
//               org writes, no invites, no axis write, no stamp, no draft (fixes
//               the ambiguity-ui finding that "Preview" wrote for real). The axis
//               is still READ, so the walkthrough shows this workspace's real board.
export function OnboardingExperience({ mode = "preview", onClose }: { mode?: "live" | "preview"; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("setup");
  const resolveError = useErrorMessage();
  const [stepIndex, setStepIndex] = useState(0);
  // Seed the language draft from the locale the app is ACTUALLY running in
  // (cookie, else Accept-Language, else en) rather than the hardcoded "en" in
  // INITIAL_SETUP — otherwise a browser that already resolved to Czech opens the
  // wizard with "English" selected under Czech copy, and finishing would quietly
  // switch the workspace back to English.
  const appLocale = useLocale();
  const initial = useMemo<SetupState>(() => ({ ...INITIAL_SETUP, language: appLocale }), [appLocale]);
  const [state, setState] = useState<SetupState>(initial);
  const finishing = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Highest step legitimately reached (Continue / Skip both route through the
  // movers below, so the high-water mark is exactly "reached through the gates").
  const [maxVisited, setMaxVisited] = useState(0);

  const canAdvance = stepSatisfied(SETUP_STEPS[stepIndex].id, state);
  // …and the ceiling that mark buys, which the current step can REVOKE — see
  // reachedCeiling in setupSteps.ts for why the raw high-water mark is unsafe.
  const reachedCeiling = ceilingOf(maxVisited, stepIndex, canAdvance);

  // Rail navigation is GATED like the Continue button: freely back to anything
  // already reached, forward only one step and only when the current step's
  // required inputs are satisfied — so the stepper can't bypass a key input the
  // footer enforces. (Skip for now still works: it goes through next(), which
  // raises the high-water mark legitimately.)
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(SETUP_STEPS.length - 1, i));
      const allowed =
        target <= Math.max(reachedCeiling, stepIndex) ||
        (target === stepIndex + 1 && stepSatisfied(SETUP_STEPS[stepIndex].id, state));
      if (!allowed) return;
      setStepIndex(target);
      setMaxVisited((m) => Math.max(m, target));
    },
    [stepIndex, reachedCeiling, state]
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
  // Board-draft writes keep `stored` and `counts` intact — those are the loaded
  // truth the dirty check and the removal guard are judged against, and a step
  // must never be able to move the baseline it is compared to.
  const setPipelineDraft = useCallback(
    (draft: AxisDraft) => setState((s) => (s.pipeline ? { ...s, pipeline: { ...s.pipeline, draft } } : s)),
    []
  );

  // A restored axis draft has to WAIT for the server's baseline: `pipeline` is
  // null until the read lands, and setPipelineDraft is a deliberate no-op before
  // then (the dirty check has nothing to compare against yet).
  const pendingAxis = useRef<AxisDraft | null>(null);
  const restore = useCallback(
    (draft: SetupDraft) => {
      setState((s) => mergeSetupDraft(s, draft, initial));
      const at = restoredStepIndex(draft, SETUP_STEPS.length);
      setStepIndex((s) => (s === 0 ? at.stepIndex : s));
      setMaxVisited((m) => Math.max(m, at.maxVisited));
      pendingAxis.current = draft.axisDraft;
    },
    [initial]
  );
  const { clear: clearDraft } = useSetupDraft({ enabled: mode === "live", state, stepIndex, maxVisited, restore });
  useEffect(() => {
    if (!pendingAxis.current || !state.pipeline) return;
    const draft = pendingAxis.current;
    pendingAxis.current = null;
    setPipelineDraft(draft);
  }, [state.pipeline, setPipelineDraft]);

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

  // Skip / Escape / X: in live mode this is an explicit "not now" — record it, and
  // drop the draft. A dismissal is an answer, not an interruption: resuming a
  // setup the operator walked away from would re-open a decision they closed.
  const dismiss = useCallback(() => {
    stamp("skipped");
    clearDraft();
    onClose();
  }, [stamp, clearDraft, onClose]);

  // The board's real columns, read once on mount (both modes — a walkthrough that
  // showed a made-up board would be teaching the wrong thing).
  useSetupPipelineAxis(update);

  // What this machine already holds for Candi, read once on mount (both modes
  // — the probe CREATES NOTHING, so the walkthrough can show the real state
  // without the walkthrough having caused it).
  useSetupCompanionBrain(update);

  // Persist everything the wizard collected, then close.
  //
  // Each write is best-effort (one refused invite must not sink the org name) but
  // the CLOSING CLAIM is one truthful fold of all of them: the org settings are
  // refusable (a recruiter without org:manage gets ORG_SETTINGS_FORBIDDEN and
  // nothing is written), the invite route refuses per address, and the axis write
  // can 409. Anything that did not land is named — by part and by the server's
  // machine code, resolved in the reader's language — instead of collapsing into a
  // green "Your workspace is set up".
  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    if (mode !== "live") {
      // Preview walkthrough: nothing is saved, and no toast pretends otherwise.
      onClose();
      return;
    }
    try {
      const outcome = await persistOnboardingSetup(state);
      if (outcome.ok) toast.success(t("toast.saved"));
      else {
        const lines = describeSetupFailures(
          outcome.failures,
          (part: SetupFinishPart) => t(`finish.part.${part}`),
          (code) => resolveError({ code }, t("finish.reasonUnknown")),
          (p) => t("finish.line", p),
          (p) => t("finish.lineWithAddresses", p)
        );
        toast.error([t("toast.partialLead"), ...lines].join(" "));
      }
    } catch {
      toast.error(t("toast.partial"));
    } finally {
      clearDraft();
      stamp("completed");
      router.refresh();
      onClose();
    }
  }, [state, mode, stamp, clearDraft, onClose, router, t, resolveError]);

  // WCAG dialog behavior — focus in on open, Tab trapped inside, Escape dismisses,
  // page scroll locked — from the shared implementation every other modal uses, so
  // this takeover joins the same stack instead of running its own bare keydown
  // listener beside an `aria-modal` it never actually enforced.
  useDialogA11y(dialogRef, dismiss);

  const ctrl: OnboardingCtrl = {
    mode,
    stepIndex,
    // The REACHABLE ceiling, not the raw high-water mark — see above. The rail
    // draws its disabled state from the same number goTo enforces, so a step the
    // stepper offers is always a step a click can actually open.
    maxVisited: reachedCeiling,
    goTo,
    next,
    back,
    state,
    update,
    addInvite,
    removeInvite,
    setPipelineDraft,
    onClose: dismiss,
    finish,
    canAdvance,
    isLast: stepIndex === SETUP_STEPS.length - 1,
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[var(--z-onboarding)]"
      role="dialog"
      aria-modal="true"
      aria-label={t("aria.dialog")}
    >
      <OnboardingWizard ctrl={ctrl} />
    </div>
  );
}
