"use client";

// The shell's two facts about WHO is looking: which workspace (tenant) this document
// belongs to, and what the caller may do there. One door for both.
//
// SEEDED FROM '/'. The server render of the root page already resolves the session,
// so app/page.tsx resolves currentWorkspace() + callerCapabilities() too and passes
// them to <Workspace principal>. Workspace hands the value down twice, on purpose:
//   • as React CONTEXT (ShellPrincipalContext), which the server render AND the first
//     client render both read — useCapabilities' server snapshot is the seed, so a
//     viewer's first paint already shows the locks the server knows, with no
//     hydration mismatch;
//   • into this MODULE (primeShellPrincipal, from a useState initializer), so the
//     non-React stores (recents, the palette preview memo, the board's storage) can
//     read the tenant synchronously without a request.
//
// NEVER PRIMED ON THE SERVER. Module scope on the server is shared by every request
// in the process; a primed value there would hand request A's tenant to request B.
// primeShellPrincipal is a no-op without `window`, and the server render reads the
// seed only through context.
//
// THE FALLBACK. Surfaces mounted without the shell (the /jds/[slug] and
// /history/[slug] deep-link pages mount the palette and record recents) are never
// seeded, so they keep the old doors — ONE deduped GET /api/workspaces for the
// tenant (the httpOnly session cookie is not readable here) and ONE GET
// /api/me/capabilities — each retried after a failure, never cached as "unknown".
// Unknown capabilities stay `null`, which locks nothing (navCapabilities.ts: the
// shell fails open; the server gates are the enforcement).
//
// Team switching does a full reload (WorkspaceTab.switchTo), so neither fact can go
// stale inside a document.

import { createContext } from "react";
import { sharedGetJson } from "@/app/features/shared/sharedGet";
import { isCapability, type Capability } from "@/app/_lib/auth/roles";

export type ShellPrincipal = { workspaceId: string; capabilities: Capability[] };

/** The seed as the render tree sees it — the server render included. `null` outside
 *  the workspace shell (and when '/' could not resolve it: fail open). */
export const ShellPrincipalContext = createContext<ShellPrincipal | null>(null);

/** Fired on `window` when the capability set lands through the fallback fetch. */
export const CAPABILITIES_EVENT = "kp:capabilities-resolved";

let workspaceId: string | null = null;
let workspaceInflight: Promise<string | null> | null = null;
let capabilities: Capability[] | null = null;
let capabilitiesInflight = false;

const hasWindow = (): boolean => typeof window !== "undefined";

/** Seed both facts for this document. Idempotent; a no-op on the server. */
export function primeShellPrincipal(p: ShellPrincipal | null | undefined): void {
  if (!p || !hasWindow()) return;
  if (p.workspaceId) workspaceId = p.workspaceId;
  // Kept by identity: the context carries the same array, so the client snapshot
  // and the server snapshot compare equal during hydration.
  if (Array.isArray(p.capabilities)) capabilities = p.capabilities;
}

/** The tenant if already known (seeded or fetched), else null. Synchronous. */
export function shellWorkspaceId(): string | null {
  return workspaceId;
}

type Fetcher = () => Promise<unknown>;

const fetchWorkspaces: Fetcher = () => sharedGetJson("/api/workspaces");

/** The tenant: the seed when there is one, else ONE shared GET /api/workspaces for
 *  every concurrent caller. A failure (or a body with no `current`) resolves null and
 *  clears the slot, so the next caller retries. */
export function resolveShellWorkspace(fetcher: Fetcher = fetchWorkspaces): Promise<string | null> {
  if (workspaceId) return Promise.resolve(workspaceId);
  workspaceInflight ??= fetcher()
    .then((body) => {
      const current = body && typeof (body as { current?: unknown }).current === "string" ? (body as { current: string }).current : "";
      if (!current) throw new Error("no current workspace in /api/workspaces");
      workspaceId = current;
      return current;
    })
    .catch(() => {
      workspaceInflight = null;
      return null;
    });
  return workspaceInflight;
}

const fetchCapabilities: Fetcher = () => sharedGetJson("/api/me/capabilities");

/** Start the fallback capabilities read unless the set is known or already in
 *  flight. A seeded document never issues it. */
export function ensureShellCapabilities(fetcher: Fetcher = fetchCapabilities): void {
  if (capabilities || capabilitiesInflight) return;
  capabilitiesInflight = true;
  void fetcher()
    .then((body) => {
      const raw = (body as { capabilities?: unknown } | null)?.capabilities;
      capabilities = Array.isArray(raw) ? raw.filter(isCapability) : [];
      if (hasWindow()) window.dispatchEvent(new Event(CAPABILITIES_EVENT));
    })
    .catch(() => {
      // Unknown stays unknown, and the next mount retries. Never an empty set: an
      // empty set is a REAL answer ("you may do nothing here") and would lock the
      // whole settings group over a dropped request.
      capabilitiesInflight = false;
    });
}

/** useSyncExternalStore's client snapshot: the module value (seeded or fetched),
 *  else the context seed, else null. Stable identity once known. */
export function capabilitiesSnapshot(seed: ShellPrincipal | null | undefined): Capability[] | null {
  return capabilities ?? seed?.capabilities ?? null;
}

/** …and its server snapshot: the seed the server render was given, or null. Never
 *  module state — see the header on why the server is never primed. */
export function capabilitiesServerSnapshot(seed: ShellPrincipal | null | undefined): Capability[] | null {
  return seed?.capabilities ?? null;
}

/** Test hook: forget both facts and any in-flight read. */
export function resetShellPrincipalForTests(): void {
  workspaceId = null;
  workspaceInflight = null;
  capabilities = null;
  capabilitiesInflight = false;
}
