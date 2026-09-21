"use client";

/**
 * "Has this principal finished first-run setup?" — as one boolean, for whichever
 * surface offers the way back into the wizard.
 *
 * This is what remains of the Getting-started checklist's `finishSetup` row after
 * the checklist itself was deleted (a board that showed two competing to-do lists
 * at once). The ROW is gone; the DOOR it opened must not be, because a first run
 * that was left early is otherwise unrecoverable: the '/' gate never re-fires for
 * a stamped principal (KP_FORCE_ONBOARDING=1 excepted) and Settings → "Preview
 * onboarding" persists nothing by design.
 *
 * The answer is a STORED FLAG rather than a workspace fact — see
 * `GettingStarted.setupFinished` for why nothing derivable can answer it — and it
 * already rides in on the derived payload (`GET /api/me/getting-started`, computed
 * in `app/_lib/getting-started.ts`). Only that one field is read here: a second
 * endpoint for one boolean would be a route, an auth posture and an API-reference
 * row to maintain for a value this one already sends.
 *
 * Answers `false` until the read lands, so an operator who DID finish never sees a
 * "pick up where you left off" affordance blink onto their board. The wizard calls
 * `notifyDataChanged()` the moment its "completed" stamp lands
 * (`OnboardingExperience.tsx`), so finishing clears this within milliseconds — and
 * that is the only event that can change it, so there is no poll.
 */

import { useEffect, useState } from "react";
import type { GettingStarted } from "@/app/_lib/getting-started";
import { useLiveRefresh } from "@/app/features/shell/live-refresh";

/** `null` when the answer is not knowable right now (offline, 401, a bad body) —
 *  never a guess, because guessing "unfinished" puts a resume prompt in front of
 *  an operator who has nothing to resume. */
function readSetupFinished(): Promise<boolean | null> {
  return fetch("/api/me/getting-started")
    .then((r) => (r.ok ? (r.json() as Promise<GettingStarted>) : null))
    .then((d) => (d && typeof d.setupFinished === "boolean" ? d.setupFinished : null))
    .catch(() => null);
}

/** True when this principal's first-run wizard was started but never finished. */
export function useSetupUnfinished(): boolean {
  const [unfinished, setUnfinished] = useState(false);

  useEffect(() => {
    let alive = true;
    void readSetupFinished().then((finished) => {
      if (alive && finished !== null) setUnfinished(!finished);
    });
    return () => {
      alive = false;
    };
  }, []);

  // The wizard's "completed" stamp announces itself on the live-refresh bus, so a
  // finish closes the affordance without a reload.
  useLiveRefresh(() => {
    void readSetupFinished().then((finished) => {
      if (finished !== null) setUnfinished(!finished);
    });
  });

  return unfinished;
}
