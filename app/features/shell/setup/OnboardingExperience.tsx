"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "@/app/_components/toast-store";
import { useDialogA11y } from "@/app/_components/useDialogA11y";
import { notifyDataChanged } from "@/app/features/shell/live-refresh";
import type { AxisDraft } from "@/app/features/shared/pipelineAxisDraft";
import { OnboardingWizard } from "./SetupOnboardingWizard";
import {
  INITIAL_SETUP,
  reachedCeiling as ceilingOf,
  relevantSteps,
  stepSatisfied,
  type OnboardingCtrl,
  type SetupInvite,
  type SetupState,
} from "./setupSteps";
import { finishRemainder, persistOnboardingSetup } from "./setupOnboardingFinish";
import {
  finishNext,
  finishReceipt,
  mergeFinishRuns,
  type SetupFinishReceipt,
  type SetupFinishRun,
} from "./setupFinishOutcome";
import { mergeSetupDraft, restoredStepIndex, type SetupDraft } from "./setupDraft";
import { useSetupDraft } from "./useSetupDraft";
import type { SetupSeat } from "./setupSeat";
import { useSetupPipelineAxis } from "./useSetupPipelineAxis";
import { useSetupCompanionBrain } from "./useSetupCompanionBrain";

// First-run onboarding host. Owns the setup state + step index and hands one
// controller to the wizard. Rendered as a fixed overlay over the workspace. Two
// modes:
//   "live"    — the real first run (mounted by Workspace when the '/' gate says
//               so). Finish PERSISTS everything — org name, language, brand,
//               invites, and the board's columns when the Pipeline step changed
//               them (POST /api/pipeline/stage-migration) — and stamps the
//               principal "completed"; Escape / X ASK FIRST (setup.leave.*) and
//               stamp "skipped" only on confirm — either way the '/' gate never
//               re-fires (KP_FORCE_ONBOARDING=1 excepted), so the way back is the
//               resume affordance the empty Pipeline board offers an operator whose
//               setup is unfinished (shell/setup/useSetupUnfinished.ts answers
//               WHETHER to offer it; setup/onboardingReopen.ts reopens this same
//               host in live mode when it is taken).
//               Answers are mirrored into a per-user sessionStorage draft, so a
//               reload mid-setup resumes instead of starting over (setupDraft.ts).
//   "preview" — the Settings → Organization walkthrough. NOTHING persists — no
//               org writes, no invites, no axis write, no stamp, no draft (fixes
//               the ambiguity-ui finding that "Preview" wrote for real). The axis
//               is still READ, so the walkthrough shows this workspace's real board.
//
// THE INTENT FORK. Every index here is a position in `relevantSteps(state)` — the
// declared sequence for THIS run (setupSteps.ts). A seeker's run is Welcome →
// Hand-off, and its finish() persists only the language and routes to /me.
export function OnboardingExperience({ mode = "preview", onClose }: { mode?: "live" | "preview"; onClose: () => void }) {
  const router = useRouter();
  const t = useTranslations("setup");
  const [stepIndex, setStepIndex] = useState(0);
  const [draftRestored, setDraftRestored] = useState(false);
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

  // The steps THIS run walks. The intent is answered on step 0, so the sequence can
  // only shrink while the operator stands on Welcome — but the clamp below holds
  // regardless, so an index can never point past the sequence it indexes.
  const steps = useMemo(() => relevantSteps(state), [state]);
  const lastIndex = steps.length - 1;
  const safeIndex = Math.min(stepIndex, lastIndex);

  // Highest step legitimately reached (Continue / Skip both route through the
  // movers below, so the high-water mark is exactly "reached through the gates").
  const [maxVisited, setMaxVisited] = useState(0);

  const canAdvance = stepSatisfied(steps[safeIndex].id, state);
  // …and the ceiling that mark buys, which the current step can REVOKE — see
  // reachedCeiling in setupSteps.ts for why the raw high-water mark is unsafe.
  const reachedCeiling = ceilingOf(Math.min(maxVisited, lastIndex), safeIndex, canAdvance);

  // Rail navigation is GATED like the Continue button: freely back to anything
  // already reached, forward only one step and only when the current step's
  // required inputs are satisfied — so the stepper can't bypass a key input the
  // footer enforces. (Skip for now still works: it goes through next(), which
  // raises the high-water mark legitimately.)
  const goTo = useCallback(
    (i: number) => {
      const target = Math.max(0, Math.min(lastIndex, i));
      const allowed =
        target <= Math.max(reachedCeiling, safeIndex) || (target === safeIndex + 1 && stepSatisfied(steps[safeIndex].id, state));
      if (!allowed) return;
      setStepIndex(target);
      setMaxVisited((m) => Math.max(m, target));
    },
    [safeIndex, lastIndex, reachedCeiling, state, steps]
  );
  const next = useCallback(() => {
    const target = Math.min(lastIndex, safeIndex + 1);
    setStepIndex(target);
    setMaxVisited((m) => Math.max(m, target));
  }, [safeIndex, lastIndex]);
  const back = useCallback(() => setStepIndex((s) => Math.max(0, Math.min(s, lastIndex) - 1)), [lastIndex]);
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
  // WHO is answering (setupSeat.ts). It lands on the same response as the draft's
  // scope and just BEFORE the restore, so the ref lets the restore clamp to the run
  // this seat walks without waiting a render for `state.seat`.
  const seatRef = useRef<SetupSeat>(null);
  const onSeat = useCallback(
    (seat: SetupSeat) => {
      seatRef.current = seat;
      update({ seat });
    },
    [update]
  );
  const restore = useCallback(
    (draft: SetupDraft) => {
      setState((s) => mergeSetupDraft(s, draft, initial));
      setDraftRestored(true);
      // The restored position is a position in the sequence the restored INTENT and
      // this SEAT imply — a seeker's draft claiming step 4 clamps to its two-step run.
      const at = restoredStepIndex(draft, relevantSteps({ ...initial, intent: draft.intent, seat: seatRef.current }).length);
      setStepIndex((s) => (s === 0 ? at.stepIndex : s));
      setMaxVisited((m) => Math.max(m, at.maxVisited));
      pendingAxis.current = draft.axisDraft;
    },
    [initial]
  );
  const { clear: clearDraft } = useSetupDraft({
    enabled: mode === "live",
    state,
    base: initial,
    stepIndex: safeIndex,
    maxVisited,
    restore,
    onSeat,
  });
  useEffect(() => {
    if (!pendingAxis.current || !state.pipeline) return;
    const draft = pendingAxis.current;
    pendingAxis.current = null;
    setPipelineDraft(draft);
  }, [state.pipeline, setPipelineDraft]);

  // Stamp the first-run outcome so the '/' gate stops showing the wizard. Fire-
  // and-forget: a lost stamp only means the wizard offers itself once more. The
  // promise is still returned so a caller that has something to do AFTER the stamp
  // lands (finish, below, tells the open views to re-read) can wait for it.
  const stamp = useCallback(
    (status: "completed" | "skipped"): Promise<void> => {
      if (mode !== "live") return Promise.resolve();
      return fetch("/api/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
        .then(() => {})
        .catch(() => {});
    },
    [mode]
  );

  // Skip / Escape / X: in live mode this is an explicit "not now" — record it, and
  // drop the draft. A dismissal is an answer, not an interruption: resuming a
  // setup the operator walked away from would re-open a decision they closed.
  const dismiss = useCallback(() => {
    // No notifyDataChanged here: a skip changes nothing any open view reads — the
    // board's resume affordance was already showing and stays showing.
    void stamp("skipped");
    clearDraft();
    onClose();
  }, [stamp, clearDraft, onClose]);

  // …but it is a REVERSIBLE answer now, and the operator is told so before it is
  // recorded. Escape is the reflex on any modal, and pressing it here used to close
  // the '/' gate for good: the wizard never re-fired, Settings → "Preview
  // onboarding" persists nothing, and company name, brand, invites, board columns
  // and Candi's memory had to be rebuilt one screen at a time. So in live mode the
  // close control and Escape ask once (`setup.leave.*`), and the empty Pipeline
  // board's resume affordance is the way back in afterwards either way.
  //
  // Preview keeps closing immediately — a walkthrough that writes nothing has
  // nothing to confirm, and a confirmation there would only teach the operator to
  // dismiss the one that matters.
  const [leaving, setLeaving] = useState(false);
  const requestClose = useCallback(() => {
    if (mode !== "live") {
      dismiss();
      return;
    }
    setLeaving(true);
  }, [mode, dismiss]);
  const cancelLeave = useCallback(() => setLeaving(false), []);

  // The board's real columns, read once on mount (both modes — a walkthrough that
  // showed a made-up board would be teaching the wrong thing).
  useSetupPipelineAxis(update);

  // What this machine already holds for Candi, read once on mount (both modes
  // — the probe CREATES NOTHING, so the walkthrough can show the real state
  // without the walkthrough having caused it).
  useSetupCompanionBrain(update);

  // Close the run for good: the one place the draft is cleared and the principal
  // stamped "completed". Reached straight from finish() when there is nothing to
  // act on, and from the receipt's Done otherwise — never from a `finally` that
  // runs whatever the outcome, which is how a partial finish used to throw away
  // every answer AND the board's resume door under a transient toast.
  const afterFinish = useRef<(() => void) | null>(null);
  // Mirrors "afterFinish holds something" for render (the Done label); refs are
  // not read during render.
  const [deferredTour, setDeferredTour] = useState(false);
  const settle = useCallback(() => {
    clearDraft();
    // Tell the open views once the stamp has actually landed — the board's resume
    // affordance reads it (`useSetupUnfinished`) through its own fetch, so without
    // this it would keep offering "pick up where you left off".
    void stamp("completed").then(notifyDataChanged);
    if (state.intent === "seek") router.push("/me");
    else router.refresh();
    onClose();
    // What the operator chose to do next (the tour tile's sim.start) runs only
    // now, after the writes and the receipt, never beside them in the same tick.
    const after = afterFinish.current;
    afterFinish.current = null;
    after?.();
  }, [state.intent, stamp, clearDraft, onClose, router]);

  // The receipt (SetupFinishReceipt.tsx) and the run it was built from — the run is
  // what a Retry narrows (finishRemainder) and folds back into (mergeFinishRuns).
  const [receipt, setReceipt] = useState<SetupFinishReceipt | null>(null);
  const lastRun = useRef<SetupFinishRun | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryingRef = useRef(false);

  // Show the receipt this run owes, or close as the wizard always has. The origin
  // is the runtime one; the link goes through copyInviteUrl, so a configured
  // public base URL still wins. A run that owes nothing toasts the one claim it can
  // make truthfully: every write landed.
  const land = useCallback(
    (run: SetupFinishRun) => {
      lastRun.current = run;
      const next = finishReceipt(run, window.location.origin);
      if (finishNext(run.outcome, next) === "close" || next === null) {
        setReceipt(null);
        toast.success(t("toast.saved"));
        settle();
        return;
      }
      setReceipt(next);
    },
    [settle, t]
  );

  // Persist everything the wizard collected.
  //
  // Each write is best-effort (one refused invite must not sink the org name) and
  // each one reports: the org settings are refusable (a recruiter without
  // org:manage gets ORG_SETTINGS_FORBIDDEN and nothing is written), the invite
  // route refuses per address and answers a landed invite with its accept link,
  // and the axis write can 409. When that leaves nothing to act on the wizard
  // closes on "Your workspace is set up", exactly as before; otherwise it stays
  // open on a receipt — the links to share, and each part that did not land by
  // part and machine code in the reader's language — and settles on its Done.
  //
  // A SEEKER's finish writes only the parts of the steps they walked (the language)
  // and lands on /me — their workspace — instead of refreshing the recruiter's.
  const finish = useCallback(
    async (after?: () => void) => {
      if (finishing.current) return;
      finishing.current = true;
      if (mode !== "live") {
        // Preview walkthrough: nothing is saved, and no toast pretends otherwise.
        onClose();
        after?.();
        return;
      }
      afterFinish.current = after ?? null;
      setDeferredTour(after !== undefined);
      let run: SetupFinishRun;
      try {
        run = await persistOnboardingSetup(state);
      } catch {
        // A thrown write (a server action whose request never came back) leaves no
        // per-part record to build a receipt from: say so, and close as before.
        toast.error(t("toast.partial"));
        settle();
        return;
      }
      land(run);
    },
    [state, mode, onClose, settle, land, t]
  );

  // The receipt's Retry: ONLY the failed parts a retry can fix, ONLY the refused
  // addresses among the invites — a landed invite already holds a live link, and
  // re-posting it would mint a second one for the same person.
  const retryFinish = useCallback(async () => {
    const run = lastRun.current;
    if (!run || retryingRef.current) return;
    const remainder = finishRemainder(state, run);
    if (!remainder) return;
    retryingRef.current = true;
    setRetrying(true);
    try {
      const again = await persistOnboardingSetup(remainder.state, remainder.parts);
      land(mergeFinishRuns(run, again, remainder.parts));
    } catch {
      toast.error(t("toast.partial"));
    } finally {
      retryingRef.current = false;
      setRetrying(false);
    }
  }, [state, land, t]);

  const closeReceipt = useCallback(() => {
    if (retryingRef.current) return;
    setReceipt(null);
    settle();
  }, [settle]);

  // WCAG dialog behavior — focus in on open, Tab trapped inside, Escape dismisses,
  // page scroll locked — from the shared implementation every other modal uses, so
  // this takeover joins the same stack instead of running its own bare keydown
  // listener beside an `aria-modal` it never actually enforced.
  //
  // The wizard card registers its OWN useDialogA11y on top of this one, so in
  // practice Escape reaches that one (the hook gates on top-of-stack). This handler
  // is kept in step with it anyway — Escape must never bypass the confirmation just
  // because the stack shifted.
  useDialogA11y(dialogRef, leaving ? cancelLeave : receipt ? closeReceipt : requestClose);

  const ctrl: OnboardingCtrl = {
    mode,
    steps,
    stepIndex: safeIndex,
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
    onClose: requestClose,
    leaving,
    confirmLeave: dismiss,
    cancelLeave,
    finish,
    receipt,
    retrying,
    retryFinish,
    closeReceipt,
    receiptStartsTour: deferredTour,
    canAdvance,
    isLast: safeIndex === lastIndex,
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
      <OnboardingWizard ctrl={ctrl} draftRestored={draftRestored} />
    </div>
  );
}
