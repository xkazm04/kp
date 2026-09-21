"use client";

import { useEffect, useRef } from "react";

// Re-entry channel for the first-run wizard.
//
// The wizard is mounted by `shell/Workspace.tsx` (`onboardingOpen`, seeded from
// the server-side '/' gate). The Getting-started checklist that asks to reopen it
// lives several tabs deep inside `WorkspaceTabPanel`, so the two have no prop path
// between them — and the alternatives are worse:
//
//   * `router.push("/?onboarding=1")` reuses the existing force-open contract but
//     costs a server round-trip, would NOT reopen anything (Workspace seeds
//     `onboardingOpen` from `useState`, which a re-render with a new prop never
//     re-runs), and leaves a param in the URL that reopens the wizard on every
//     later reload of that page.
//   * A React context threaded from Workspace would add a provider to the shell
//     for one boolean that only ever travels upward.
//
// So this is the same shape the shell already uses for cross-tree signals
// (`shell/live-refresh.ts`): a named window event, one publisher, one subscriber.
// Deliberately NOT on the live-refresh bus — that one means "server data changed,
// re-read it", and every subscribed view would re-fetch for a signal about the UI.
const EVENT = "kp:reopen-onboarding";

/** Ask the shell to reopen the first-run wizard in LIVE mode (it persists and
 *  stamps, exactly as it does on a real first run). No-op on the server. */
export function requestOnboardingReopen(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

/** Subscribe to the request above. Always calls the latest handler, so the
 *  listener is attached once for the life of the shell. */
export function useOnboardingReopen(handler: () => void): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => {
    const onRequest = () => ref.current();
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, []);
}
