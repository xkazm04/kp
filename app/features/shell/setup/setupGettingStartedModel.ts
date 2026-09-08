"use client";

/**
 * Shared state + step taxonomy for the Getting-started surface.
 *
 * Extracted so the baseline card and the prototype variants read from ONE
 * source of truth: the server-derived GettingStarted payload
 * (GET /api/me/getting-started, computed in app/_lib/getting-started.ts).
 * No variant may invent a step, a completion flag, or a progress number — the
 * honesty contract of this surface is that every mark reflects a real workspace
 * fact, so all derivation lives here and nowhere in a component.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GettingStarted } from "@/app/_lib/getting-started";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";
import { requestOnboardingReopen } from "./onboardingReopen";

/** Per-browser dismissal preference (the repo's convention for user-scoped UI state). */
export const DISMISS_KEY = "kp-getting-started-dismissed";

/** Set by the wizard hand-off card when the operator clicks through to the checklist. */
export const CHECKLIST_HIGHLIGHT_KEY = "kp-checklist-highlight";

/**
 * The four core steps — the ones a workspace genuinely cannot hire without —
 * behind the one step that is about the SETUP rather than about the work.
 * Inviting teammates used to ride along as an optional extra mark; it was the one
 * step that never gated anything, so it no longer competes for attention here.
 * The server still reports `team` in the payload for surfaces that care.
 *
 * `finishSetup` is different from every other row in two ways, both deliberate:
 *
 *  - It does not route to a tab. It REOPENS the first-run wizard in live mode
 *    (`opens: "wizard"` → `requestOnboardingReopen()` below), because the wizard
 *    is where its four subjects — company, team, board, Candi — are asked as one
 *    conversation. Before this row existed, an operator who pressed Escape on
 *    their first load had no way back to it at all: the '/' gate never re-fires
 *    for a stamped principal, and Settings → "Preview onboarding" persists
 *    nothing by design.
 *  - It is FIRST, so an operator who left setup early meets "pick up where you
 *    left off" as the promoted next move instead of finding it after four other
 *    chores. An operator who finished the wizard has it ticked on arrival, and
 *    the briefing moves on to the first real piece of work exactly as before.
 */
export const STEPS = [
  { key: "finishSetup", opens: "wizard" },
  { key: "company", opens: "tab", tab: "organization" },
  // The authoring tab, not the ledger: this step is "write your first role", and
  // the ledger it used to point at is where a role LANDS.
  { key: "firstRole", opens: "tab", tab: "intake" },
  { key: "case", opens: "tab", tab: "assignments" },
  { key: "channels", opens: "tab", tab: "channels" },
] as const;

export type Step = (typeof STEPS)[number];
export type StepKey = Step["key"];

export function stepDone(key: StepKey, d: GettingStarted): boolean {
  switch (key) {
    // The only step whose answer is a stored stamp rather than a workspace fact —
    // see GettingStarted.setupFinished for why nothing else can answer it. A skip
    // is NOT done: it is precisely the state this row offers a way out of, and a
    // skip that was later finished reads "completed" (both stamp writers keep
    // completed winning over a later skip).
    case "finishSetup":
      return d.setupFinished;
    case "company":
      return d.company;
    case "firstRole":
      return d.firstRole === "ready";
    case "case":
      return d.caseDesigned;
    case "channels":
      return d.channels === "verified";
  }
}

/** The row's live sub-state ("building now…"), when one applies. */
export type StepNote = "analyzing" | "failed" | "listening";

export function stepNote(key: StepKey, d: GettingStarted): StepNote | null {
  if (key === "firstRole" && d.firstRole === "analyzing") return "analyzing";
  if (key === "firstRole" && d.firstRole === "failed") return "failed";
  if (key === "channels" && d.channels === "listening") return "listening";
  return null;
}

/** How many of the steps are genuinely complete. */
export function doneCount(d: GettingStarted): number {
  return STEPS.filter((s) => stepDone(s.key, d)).length;
}

/** Nothing left on this checklist — the condition under which the card retires
 *  itself. NOT `GettingStarted.allDone`, which is the server's narrower "the
 *  workspace can hire" fold over the four core steps: retiring on that would take
 *  the way back into the wizard off the board the moment the operator finished the
 *  work by hand, which is the exact trap `finishSetup` exists to undo. */
export function allStepsDone(d: GettingStarted): boolean {
  return doneCount(d) === STEPS.length;
}

/** The first step that isn't done yet — the honest "do this next". */
export function nextStep(d: GettingStarted): Step | null {
  return STEPS.find((s) => !stepDone(s.key, d)) ?? null;
}

/**
 * Fetches the derived checklist and owns the dismissal preference. Polls gently
 * while on screen so a finished JD build or an arriving test application flips a
 * row without a manual reload.
 */
export function useGettingStarted() {
  const [data, setData] = useState<GettingStarted | null>(null);
  // Lazy init: SSR says hidden (data is null there anyway, so markup agrees);
  // the client reads the stored preference before the first data render.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/me/getting-started")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => alive && d && setData(d as GettingStarted))
        .catch(() => {});
    load();
    const id = window.setInterval(load, 20_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // Re-poll immediately when a mutation elsewhere (e.g. the simulate-CV card)
  // signals that server data changed — so the checklist flips to "verified"
  // within milliseconds rather than waiting up to 20 s for the next tick.
  useLiveRefresh(() => {
    fetch("/api/me/getting-started")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setData(d as GettingStarted))
      .catch(() => {});
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* per-browser preference only */
    }
  }, []);

  const undismiss = useCallback(() => {
    setDismissed(false);
    try {
      window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      /* per-browser preference only */
    }
  }, []);

  return { data, dismissed, dismiss, undismiss };
}

/** Open a step where it actually lives: its real tab, or — for `finishSetup` — the
 *  first-run wizard, reopened in live mode over whatever tab the operator is on. */
export function useOpenStep() {
  const router = useRouter();
  return useCallback(
    (step: Step) => {
      if (step.opens === "wizard") {
        requestOnboardingReopen();
        return;
      }
      router.push(`/?tab=${step.tab}`);
    },
    [router]
  );
}

/** Props every Getting-started variant receives from the switcher. */
export type GettingStartedViewProps = {
  data: GettingStarted;
  dismiss: () => void;
};
