"use client";

import { useCallback, useEffect, useState } from "react";
import { useLiveRefresh } from "./live-refresh";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import type { AttentionKey } from "./tabs";

// SHELL2 — the interactive shell's live attention counts. Loads on mount,
// re-loads on the live-refresh bus (any mutating fetch in this document), and
// polls every 60s while the tab is visible — the automation heartbeat mutates
// entries server-side with no client signal, so without the poll the badges
// would lie within minutes on an idle-but-open studio. Failures degrade to the
// last known counts (or none): a badge is a hint, never worth an error surface.
export type AttentionCounts = Record<AttentionKey, number>;

const POLL_MS = 60_000;

export function useAttention(): AttentionCounts | null {
  const [counts, setCounts] = useState<AttentionCounts | null>(null);

  // Sharing is OPT-IN (features/shared/sharedGet.ts). The mount read may ride a
  // sibling's in-flight request — in dev that is React StrictMode's second effect
  // pass, which fired this exact GET twice on every tab open. The live-refresh and
  // poll paths below deliberately go to the network: both exist to observe a change.
  const load = useCallback((opts?: { shared?: boolean }) => {
    sharedGetJson<AttentionCounts & { error?: string }>("/api/attention", { refresh: !opts?.shared })
      .then((body) => {
        if (body && !body.error) setCounts(body);
      })
      .catch(() => {
        /* keep the previous counts — see above */
      });
  }, []);

  useEffect(() => {
    load({ shared: true });
    const id = setInterval(() => {
      if (!document.hidden) load();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [load]);
  useLiveRefresh(load);

  return counts;
}
