// Durable persistence of the interview transcript — the ONLY record of the call.
// Extracted from VoiceInterview.tsx: the POST-with-retries, the M6 manual retry,
// and the online/visibilitychange listeners that re-drive it.
//
// The session capability ids and the live turn buffer stay owned by the component
// (finalize, start() and the unmount beacon all mutate them), so they arrive here
// as ref boxes rather than being re-homed — the alternative would have split one
// piece of state across two owners.

import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceTurn } from "@/app/_lib/voice/types";
import { createTimerRegistry } from "./timer-registry";
import { isPermanentRefusal, saveStateOf, type SaveState } from "./reconnect-plan";

// Re-exported so the tri-state reads as this hook's own vocabulary at call sites.
export { saveStateOf, type SaveState };

/** sessionStorage key prefix for a transcript body the server has not accepted
 *  yet. Shared by the writer (persistTranscript) and the replay pass below. */
const STASH_PREFIX = "kp.iv.";

/** How many times the transcript POST is retried before the manual-retry banner
 *  takes over. */
const PERSIST_ATTEMPTS = 3;
/** Linear backoff step between those attempts (500ms, 1s, 1.5s). */
const PERSIST_BACKOFF_STEP_MS = 500;

export type TranscriptPersistenceArgs = {
  /** The link token from props — the fallback when /connect hasn't returned one. */
  token?: string;
  sessionIdRef: { current: string | null };
  /** /complete demands the session token as the completion capability (idea-5248c3e9). */
  sessionTokenRef: { current: string | null };
  turnsRef: { current: VoiceTurn[] };
  /** The verdict finalize settled on, so a manual retry re-POSTs the same status. */
  endedAs: "completed" | "failed" | null;
};

export function useTranscriptPersistence({
  token,
  sessionIdRef,
  sessionTokenRef,
  turnsRef,
  endedAs,
}: TranscriptPersistenceArgs) {
  // Every delayed callback this hook schedules, in the registry unmount empties.
  const timersRef = useRef(createTimerRegistry());
  useEffect(() => {
    // A remount (dev StrictMode: mount → cleanup → mount) must not inherit the
    // registry the first cleanup made inert — the save backoff would stop waiting.
    if (timersRef.current.cleared) timersRef.current = createTimerRegistry();
    const timers = timersRef.current;
    return () => timers.clearAll();
  }, []);

  // The last save's answer and whether one is in flight. ONE record, read through
  // saveStateOf (reconnect-plan.ts) by every surface that cares: the Retry banner
  // (M6: a manual Retry instead of "keep this tab open"), the reconnect plan (a
  // redial never goes out while the session can still be in_progress server-side)
  // and Start's precondition. It used to be two booleans the shell set by hand, and
  // start() cleared the failure flag before dialling — which disarmed the
  // online/visibility re-drive below and walked the candidate into /connect's
  // INTERVIEW_ALREADY_LIVE for their own unsaved session.
  //
  // `discardedTurns` is how many turns the SERVER said it discarded (409
  // INTERVIEW_ALREADY_COMPLETED): another window's call for this link finished
  // first. `refusedStatus` is the HTTP status of any 4xx answer — every permanent
  // one (400 / 403 / 404 / 409 / 413) is a refusal a retry can never turn around,
  // with or without discardedTurns, so it gets an explanation, not a Retry button.
  const [lastSave, setLastSave] = useState<{
    saved: boolean;
    discardedTurns: number;
    refusedStatus: number | null;
  } | null>(null);
  const [inFlight, setInFlight] = useState(false);
  // The same fact for callbacks: a re-drive (online, visibilitychange, the reconnect
  // plan, Start's precondition) while a POST is already out must not send a second.
  const inFlightRef = useRef(false);
  const saveState: SaveState | null =
    inFlight || lastSave
      ? saveStateOf({
          saved: lastSave?.saved ?? false,
          discardedTurns: lastSave?.discardedTurns ?? 0,
          inFlight,
          refusedStatus: lastSave?.refusedStatus ?? null,
        })
      : null;
  const discardedTurns = lastSave?.discardedTurns ?? 0;

  /** Forget the previous attempt's save. start() calls it only once the
   *  precondition has settled that save, never before. */
  const resetSave = useCallback(() => {
    inFlightRef.current = false;
    setLastSave(null);
    setInFlight(false);
  }, []);

  // Durable persist of the transcript — the ONLY record of the interview. Stash it
  // locally first (so a total POST failure doesn't vanish it), then POST with a
  // few retries; 4xx (consent/token/already-completed) won't improve on retry, so
  // stop. keepalive lets it survive a closing tab. Returns whether it was saved.
  const persistTranscript = useCallback(
    async (
      tok: string,
      sid: string,
      transcript: VoiceTurn[],
      status: "completed" | "failed"
    ): Promise<{ saved: boolean; discardedTurns: number }> => {
      inFlightRef.current = true;
      setInFlight(true);
      const settle = (saved: boolean, discarded: number, refusedStatus: number | null) => {
        inFlightRef.current = false;
        setLastSave({ saved, discardedTurns: discarded, refusedStatus });
        setInFlight(false);
        return { saved, discardedTurns: discarded };
      };
      const body = JSON.stringify({ token: tok, sessionId: sid, transcript, status });
      const stashKey = `${STASH_PREFIX}${sid}`;
      try {
        sessionStorage.setItem(stashKey, body);
      } catch {
        /* ignore */
      }
      for (let attempt = 0; attempt < PERSIST_ATTEMPTS; attempt += 1) {
        try {
          const res = await fetch("/api/interview/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive: true,
          });
          if (res.ok) {
            try {
              sessionStorage.removeItem(stashKey);
            } catch {
              /* ignore */
            }
            return settle(true, 0, null);
          }
          // 429 is the ONE 4xx that WILL improve on retry (/complete's per-token+IP
          // throttle): treat it as transient so the backoff below still runs and the
          // stash survives, unlike consent/token/already-completed which never will.
          if (isPermanentRefusal(res.status)) {
            // A 409 may carry `discardedTurns`: this body lost to another window's
            // call for the same link and its turns are NOT in the saved record.
            // Read it so the shell can say that, rather than showing a Retry that
            // would be refused identically forever.
            let discarded = 0;
            if (res.status === 409) {
              try {
                const body = (await res.json()) as { discardedTurns?: unknown };
                if (typeof body.discardedTurns === "number" && body.discardedTurns > 0) {
                  discarded = body.discardedTurns;
                }
              } catch {
                /* a refusal we cannot read is still a refusal (refusedStatus says so) */
              }
            }
            // The stash exists so a transient failure can be replayed. This one can
            // never succeed, and leaving it would re-POST a discarded transcript on
            // every future mount.
            try {
              sessionStorage.removeItem(stashKey);
            } catch {
              /* ignore */
            }
            return settle(false, discarded, res.status);
          }
        } catch {
          /* network error — retry */
        }
        // Through the call's timer registry, not a bare setTimeout: this await
        // sits between the tab's last two frames on a close, and an unmount used
        // to leave it pending — the retry loop kept running against a torn-down
        // component, and the promise never settled. The registry cancels the
        // timer AND resolves the sleeper (timer-registry.ts).
        await timersRef.current.sleep(PERSIST_BACKOFF_STEP_MS * (attempt + 1));
        // A cleared registry resolves its sleepers IMMEDIATELY rather than
        // hanging them, so "we were torn down" and "the backoff elapsed" arrive
        // the same way — check which it was before spending another attempt.
        // The body is already stashed in sessionStorage and replayed on the next
        // mount, so stopping here loses nothing.
        if (timersRef.current.cleared) break;
      }
      return settle(false, 0, null);
    },
    []
  );

  // M6: re-POST the (still in-memory + sessionStorage-stashed) transcript on demand or when the
  // tab regains connectivity/visibility, so a transient network failure doesn't lose the record.
  // Answers whether the record is now saved, so Start's precondition can await it.
  const retrySave = useCallback(async (): Promise<boolean> => {
    const sid = sessionIdRef.current;
    const tok = sessionTokenRef.current ?? token ?? null;
    if (!sid || !tok || inFlightRef.current) return false;
    const { saved } = await persistTranscript(tok, sid, turnsRef.current, endedAs ?? "failed");
    return saved;
  }, [persistTranscript, token, endedAs, sessionIdRef, sessionTokenRef, turnsRef]);

  // The stash was WRITE-ONLY: nothing in the app ever read `kp.iv.*` back, so the
  // saveFailed banner's "please keep this tab open" was the whole recovery — a
  // reload (the natural reaction to that banner) dropped the only record of a
  // one-shot, billed interview even though its exact POST body was sitting in
  // sessionStorage. Replay every stashed body once on mount, silently: this runs
  // before any session of this component's own exists, so it can't race an
  // in-flight save, and the server stays the authority — a 2xx clears the stash,
  // and so does a 4xx (already completed / bad token / consent), because those can
  // never succeed on a later try and would otherwise be re-POSTed on every mount.
  // A network failure leaves the stash for the next mount.
  useEffect(() => {
    let cancelled = false;
    const keys: string[] = [];
    try {
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const k = sessionStorage.key(i);
        if (k?.startsWith(STASH_PREFIX)) keys.push(k);
      }
    } catch {
      return; // storage blocked (private mode) — nothing to replay
    }
    if (keys.length === 0) return;
    void (async () => {
      for (const k of keys) {
        if (cancelled) return;
        let body: string | null = null;
        try {
          body = sessionStorage.getItem(k);
        } catch {
          return;
        }
        if (!body) continue;
        try {
          // No `keepalive` here (unlike persistTranscript, which needs it to
          // survive a closing tab): this is an ordinary in-page request, and
          // keepalive caps the body at 64KB — the exact size a long transcript
          // might have failed on in the first place.
          const res = await fetch("/api/interview/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
          });
          // Same carve-out as persistTranscript: a throttled (429) replay must KEEP
          // the stash - dropping it here would discard the candidate's transcript for
          // a refusal that is explicitly temporary.
          if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
            try {
              sessionStorage.removeItem(k);
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* offline — keep the stash and try again on the next mount */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const saveFailed = saveState === "failed";
  useEffect(() => {
    if (!saveFailed) return;
    const onRetry = () => {
      if (navigator.onLine) void retrySave();
    };
    window.addEventListener("online", onRetry);
    document.addEventListener("visibilitychange", onRetry);
    return () => {
      window.removeEventListener("online", onRetry);
      document.removeEventListener("visibilitychange", onRetry);
    };
  }, [saveFailed, retrySave]);

  return { saveState, discardedTurns, resetSave, persistTranscript, retrySave };
}
