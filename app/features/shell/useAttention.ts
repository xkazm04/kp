"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveRefresh } from "./live-refresh";
import { attentionPollDelayMs, shouldPollNow } from "./attentionPoll";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import type { AttentionKey } from "./tabs";

// SHELL2 — the interactive shell's live attention counts. Loads on mount,
// re-loads on the live-refresh bus (any mutating fetch in this document), and
// polls while the tab is visible — the automation heartbeat mutates entries
// server-side with no client signal, so without the poll the badges would lie
// within minutes on an idle-but-open studio. Failures degrade to the last known
// counts (or none): a badge is a hint, never worth an error surface.
//
// The poll BACKS OFF on failure (attentionPoll.ts — the tasks dock's curve) and
// resumes the instant the tab is looked at again. It used to re-arm at a flat 60s
// whether or not the last read reached the server: one request a minute for ever,
// from every open tab, against a server that had stopped answering.
export type AttentionCounts = Record<AttentionKey, number>;

export function useAttention(): AttentionCounts | null {
  const [counts, setCounts] = useState<AttentionCounts | null>(null);
  // Consecutive failed reads. A ref, not state: the schedule reads it, nothing
  // renders it, and a re-render per failed badge poll is exactly the cost this
  // hook exists to avoid.
  const failures = useRef(0);

  // Sharing is OPT-IN (features/shared/sharedGet.ts). The mount read may ride a
  // sibling's in-flight request — in dev that is React StrictMode's second effect
  // pass, which fired this exact GET twice on every tab open. The live-refresh and
  // poll paths below deliberately go to the network: both exist to observe a change.
  const load = useCallback((opts?: { shared?: boolean }): Promise<void> => {
    return sharedGetJson<AttentionCounts & { error?: string }>("/api/attention", { refresh: !opts?.shared })
      .then((body) => {
        if (body && !body.error) {
          failures.current = 0;
          setCounts(body);
        } else {
          // A 200 carrying `error` is a read that did not happen — count it, or the
          // backoff would never engage against a store that is answering politely
          // and uselessly.
          failures.current += 1;
        }
      })
      .catch(() => {
        failures.current += 1;
        /* keep the previous counts — see above */
      });
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const arm = () => {
      if (stopped) return;
      timer = setTimeout(tick, attentionPollDelayMs(failures.current));
    };
    const tick = () => {
      if (!shouldPollNow(document.hidden)) {
        // Hidden: skip the request but keep the loop alive, and do NOT count a skip
        // as a failure — a backgrounded tab is not an unreachable server.
        arm();
        return;
      }
      void load().then(arm);
    };
    // Coming back to the tab is the moment a stale badge is most visibly wrong: read
    // NOW rather than waiting out whatever the backoff had armed, and drop the
    // failure count so a return from a closed laptop starts from the fast schedule.
    const onVisible = () => {
      if (document.hidden) return;
      failures.current = 0;
      clearTimeout(timer);
      void load().then(arm);
    };
    void load({ shared: true }).then(arm);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);
  useLiveRefresh(load);

  return counts;
}
