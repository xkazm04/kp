"use client";

// The shell's ONE read of "what may this caller do here", resolved once per
// document and shared by every consumer (the nav rail, the mobile drawer, the
// command palette). GET /api/me/capabilities — see the route for why it is a
// dedicated read rather than /api/org/members' callerCapabilities.
//
// FAILS OPEN. An unresolved set (still in flight, or the request failed) is `null`,
// and navCapabilities.ts locks nothing for null: a shell that hid an owner's
// Billing tab because one GET blipped would be a worse failure than the one this
// closes. The server gates are the enforcement; this is only the shell being honest
// about which doors it already knows are shut.

import { useSyncExternalStore } from "react";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { isCapability, type Capability } from "@/app/_lib/auth/roles";

// Module-scope, not context: the answer cannot change without a full reload
// (switching teams hard-navigates — WorkspaceTab.switchTo), and every mount in the
// document wants the same value. Same shape as recents.ts's tenant resolve, and
// read through useSyncExternalStore so a consumer that mounts AFTER the fetch
// landed sees the answer on its first render — no set-state-in-effect, no flash of
// an unlocked nav for a viewer.
let resolved: Capability[] | null = null;
let inflight = false;
const EVENT = "kp:capabilities-resolved";

function ensureCapabilities(): void {
  if (resolved || inflight) return;
  inflight = true;
  void sharedGetJson<{ capabilities?: unknown }>("/api/me/capabilities")
    .then((body) => {
      resolved = Array.isArray(body?.capabilities) ? body.capabilities.filter(isCapability) : [];
      window.dispatchEvent(new Event(EVENT));
    })
    .catch(() => {
      // Unknown stays unknown, and the next mount retries. Never an empty set: an
      // empty set is a REAL answer ("you may do nothing here") and would lock the
      // whole settings group over a dropped request.
      inflight = false;
    });
}

function subscribe(onChange: () => void): () => void {
  ensureCapabilities();
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

// Stable identity once resolved (the same array object), which is what lets
// useSyncExternalStore compare snapshots without re-rendering every tick.
const snapshot = (): Capability[] | null => resolved;
// The server render knows nothing about the caller's browser session state here;
// null = unknown = nothing locked, which is also the correct SSR output.
const serverSnapshot = (): Capability[] | null => null;

/** The caller's effective capabilities, or null while unknown. */
export function useCapabilities(): Capability[] | null {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
