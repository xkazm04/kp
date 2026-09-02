"use client";

import { useEffect, useRef, useState } from "react";

// The ONE poll behind both readers of a backgrounded jd_build: the ledger list
// (jdsLedgerLogic) and the detail modal (JdsLedgerDetailModal). Both used to run
// `setInterval(refresh, 3500)` — the literal written twice — with three problems
// the interval shape cannot express:
//
//  * no visibility gate. A workspace left open on another tab kept firing GET
//    /api/jds every 3.5s forever, and with the modal open, GET /api/jds/[slug]
//    alongside it.
//  * no backoff. A build legitimately takes 1–2 minutes, so the fast tick that
//    makes the first flip feel instant is pure waste by minute two.
//  * no end. `analysis_status` is written by a DETACHED handler; if that process
//    dies between the placeholder insert and finishJdAnalysis/failJdAnalysis the
//    row stays "analyzing" forever — and so did the poll, silently, with the UI
//    claiming a build was in progress that nothing was running.
//
// The pure halves live here so `node --test` can drive the schedule without a DOM.

/** First tick — fast, so the common "it just finished" case flips immediately. */
export const POLL_BASE_MS = 3500;
/** Ceiling for the backoff. A build that has run this long is minutes-scale; a
 *  20s worst-case latency on the flip is invisible next to that. */
export const POLL_MAX_MS = 20_000;
/** How long a row may claim "analyzing" before the poll stops and the surface says
 *  so. Comfortably past the 1–2 minute build plus a retry; past it, the honest
 *  reading is "nothing is telling us this is still running". */
export const POLL_MAX_DURATION_MS = 8 * 60 * 1000;

/** Delay before poll #`attempt` (0-based). Doubles from POLL_BASE_MS to the cap:
 *  3.5s, 7s, 14s, 20s, 20s… — the flip stays snappy while a long build settles
 *  into three requests a minute instead of seventeen. */
export function nextPollDelay(attempt: number): number {
  const safe = attempt > 0 ? attempt : 0;
  return Math.min(POLL_MAX_MS, POLL_BASE_MS * 2 ** safe);
}

/** Has this poll session outlived POLL_MAX_DURATION_MS? */
export function pollExhausted(startedAt: number, now: number): boolean {
  return now - startedAt >= POLL_MAX_DURATION_MS;
}

/**
 * Poll `refresh` while `active`, with backoff, a visibility gate and a hard stop.
 *
 * Returns `stalled` — true once the session hit POLL_MAX_DURATION_MS without the
 * caller going inactive. The caller MUST say so on the surface: a stopped poll
 * that looks identical to a running one is exactly the silence this replaces.
 *
 * Returning to the tab resets the backoff and refreshes at once, so a recruiter
 * who comes back to the window sees the current state rather than the state as of
 * whenever the last slow tick landed.
 */
export function useAnalyzingPoll(active: boolean, refresh: () => void): boolean {
  const [stalled, setStalled] = useState(false);
  // The callback identity changes every render on both call sites (a fresh
  // closure over the fetch state); holding it in a ref keeps the effect keyed on
  // `active` alone, so a re-render can never restart the schedule.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!active) return;
    let attempt = 0;
    let stopped = false;
    let timer: number | undefined;
    const startedAt = Date.now();
    // Deferred, not synchronous in the effect body: a fresh poll session must
    // clear a previous session's stalled verdict without a setState during the
    // effect (react-hooks/set-state-in-effect), the same kickoff shape jdsHooks uses.
    const reset = window.setTimeout(() => setStalled(false), 0);

    const schedule = () => {
      timer = window.setTimeout(tick, nextPollDelay(attempt));
    };
    const tick = () => {
      if (stopped) return;
      if (pollExhausted(startedAt, Date.now())) {
        setStalled(true);
        return;
      }
      // A hidden tab keeps its place in the schedule but spends no request; the
      // visibility listener below refreshes the moment it comes back.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        schedule();
        return;
      }
      attempt += 1;
      refreshRef.current();
      schedule();
    };
    schedule();

    const onVisibility = () => {
      if (stopped || document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      attempt = 0;
      tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearTimeout(reset);
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [active]);

  // A poll that is not running cannot be stalled — so the caller never has to
  // reset the flag when its row settles.
  return stalled && active;
}
