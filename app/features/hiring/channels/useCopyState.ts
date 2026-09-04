"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ONE clipboard state for the three copy controls on this tab (ReceiverTable's row
// button, SetupGuide's endpoint chip, the careers-link button in ChannelsTabWidgets).
//
// All three used to swallow the denial — `.catch(() => undefined)` / an empty catch —
// so a blocked clipboard (an insecure origin, a browser permission prompt the operator
// dismissed, a locked-down corporate profile) looked exactly like a successful copy:
// nothing happened, and the recruiter pasted whatever was ALREADY on the clipboard
// into a forwarding rule or an ad-network callback. Pointing an intake receiver at a
// stale endpoint loses applications silently, which is why this one deserves a visible
// state rather than a shrug.
//
// `copied` clears itself after a beat; `failed` does NOT — it stands until the next
// attempt, because it is an instruction ("select the text and copy it yourself"), not
// a confirmation.
export type CopyState = "idle" | "copied" | "failed";

const COPIED_MS = 1500;

export function useCopyState(): { state: CopyState; copy: (value: string) => void } {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    []
  );
  const copy = useCallback((value: string) => {
    if (timer.current !== null) clearTimeout(timer.current);
    // `navigator.clipboard` is undefined outside a secure context, so the call itself
    // — not just its promise — can throw.
    try {
      const write = navigator.clipboard?.writeText(value);
      if (!write) {
        setState("failed");
        return;
      }
      write
        .then(() => {
          setState("copied");
          timer.current = setTimeout(() => setState("idle"), COPIED_MS);
        })
        .catch(() => setState("failed"));
    } catch {
      // Denied or unavailable — the caller shows the "copy it yourself" state.
      setState("failed");
    }
  }, []);
  return { state, copy };
}
