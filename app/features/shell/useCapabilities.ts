"use client";

// The shell's ONE read of "what may this caller do here", shared by every consumer
// (the nav rail, the mobile drawer, the command palette, the About tab, the Models
// quality overview).
//
// SEEDED. '/' resolves the caller's capabilities server-side and hands them down
// (shellPrincipal.ts): through ShellPrincipalContext, which is this hook's server
// snapshot, AND into the module, which is its client snapshot — the same array, so
// the first render on both sides already shows the locks the server knows, with no
// hydration mismatch and no GET. A surface mounted without the shell (the deep-link
// pages' palette) has no seed and falls back to ONE GET /api/me/capabilities — see
// the route for why it is a dedicated read rather than /api/org/members'
// callerCapabilities.
//
// FAILS OPEN. An unresolved set (unseeded and still in flight, or the request
// failed) is `null`, and navCapabilities.ts locks nothing for null: a shell that hid
// an owner's Billing tab because one GET blipped would be a worse failure than the
// one this closes. The server gates are the enforcement; this is only the shell
// being honest about which doors it already knows are shut.

import { useContext, useSyncExternalStore } from "react";
import type { Capability } from "@/app/_lib/auth/roles";
import {
  CAPABILITIES_EVENT,
  capabilitiesServerSnapshot,
  capabilitiesSnapshot,
  ensureShellCapabilities,
  ShellPrincipalContext,
  type ShellPrincipal,
} from "./shellPrincipal";

function subscribe(onChange: () => void): () => void {
  ensureShellCapabilities();
  window.addEventListener(CAPABILITIES_EVENT, onChange);
  return () => window.removeEventListener(CAPABILITIES_EVENT, onChange);
}

/** The caller's effective capabilities, or null while unknown.
 *  `principal` is for the component that PROVIDES the context (Workspace), which
 *  cannot read its own provider; everyone else reads the context. */
export function useCapabilities(principal?: ShellPrincipal | null): Capability[] | null {
  const fromContext = useContext(ShellPrincipalContext);
  const seed = principal ?? fromContext;
  return useSyncExternalStore(
    subscribe,
    () => capabilitiesSnapshot(seed),
    () => capabilitiesServerSnapshot(seed)
  );
}
