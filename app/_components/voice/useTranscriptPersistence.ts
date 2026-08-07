// Durable persistence of the interview transcript — the ONLY record of the call.
// Extracted from VoiceInterview.tsx: the POST-with-retries, the M6 manual retry,
// and the online/visibilitychange listeners that re-drive it.
//
// The session capability ids and the live turn buffer stay owned by the component
// (finalize, start() and the unmount beacon all mutate them), so they arrive here
// as ref boxes rather than being re-homed — the alternative would have split one
// piece of state across two owners.

import { useCallback, useEffect, useState } from "react";
import type { VoiceTurn } from "@/app/_lib/voice/types";

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
  // M6: the transcript POST failed after retries — surface a manual Retry (the body is stashed in
  // sessionStorage) instead of asking the candidate to babysit a tab with no action to take.
  const [saveFailed, setSaveFailed] = useState(false);

  // Durable persist of the transcript — the ONLY record of the interview. Stash it
  // locally first (so a total POST failure doesn't vanish it), then POST with a
  // few retries; 4xx (consent/token/already-completed) won't improve on retry, so
  // stop. keepalive lets it survive a closing tab. Returns whether it was saved.
  const persistTranscript = useCallback(
    async (tok: string, sid: string, transcript: VoiceTurn[], status: "completed" | "failed"): Promise<boolean> => {
      const body = JSON.stringify({ token: tok, sessionId: sid, transcript, status });
      const stashKey = `kp.iv.${sid}`;
      try {
        sessionStorage.setItem(stashKey, body);
      } catch {
        /* ignore */
      }
      for (let attempt = 0; attempt < 3; attempt += 1) {
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
            return true;
          }
          if (res.status >= 400 && res.status < 500) break;
        } catch {
          /* network error — retry */
        }
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      return false;
    },
    []
  );

  // M6: re-POST the (still in-memory + sessionStorage-stashed) transcript on demand or when the
  // tab regains connectivity/visibility, so a transient network failure doesn't lose the record.
  const retrySave = useCallback(async () => {
    const sid = sessionIdRef.current;
    const tok = sessionTokenRef.current ?? token ?? null;
    if (!sid || !tok) return;
    const saved = await persistTranscript(tok, sid, turnsRef.current, endedAs ?? "failed");
    if (saved) setSaveFailed(false);
  }, [persistTranscript, token, endedAs, sessionIdRef, sessionTokenRef, turnsRef]);

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

  return { saveFailed, setSaveFailed, persistTranscript, retrySave };
}
