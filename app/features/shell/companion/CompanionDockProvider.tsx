"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Defer } from "@/app/_components/ui/Defer";

/*
 * Candi's dock lives OUTSIDE the keyed tab div (Workspace.tsx) so a conversation
 * survives every tab switch — the operator can ask about the pipeline, walk to
 * Jobs, and keep talking. This provider is what lets surfaces that are nowhere
 * near the dock open it: the command palette's "Ask Candi" item and the
 * ControlDock's ops-face affordance both just call openDock(query).
 *
 * The dock itself is code-split (like the sim overlays in
 * WorkspaceSimSurfaces.tsx) and its first commit is deferred to idle, so an
 * operator who never opens it pays for a context and nothing else.
 */

const CompanionDock = dynamic(() => import("./CompanionDock").then((m) => ({ default: m.CompanionDock })));

export type CompanionDockValue = {
  open: boolean;
  /** Open the dock, optionally seeding the first message (the palette's query). */
  openDock: (seed?: string) => void;
  closeDock: () => void;
  /** A message the dock should send as soon as its thread is ready, once. */
  seed: string | null;
  consumeSeed: () => void;
  /** A reply landed while the dock was closed and has not been looked at. Lives
   *  here rather than in the dock because both transitions that move it are
   *  EVENTS — a reply arriving, and the operator opening the dock — and keeping
   *  it event-driven is what stops it becoming a setState inside an effect. */
  unread: boolean;
  markUnread: () => void;
};

const CompanionDockContext = createContext<CompanionDockValue | null>(null);

/** Null outside the workspace shell (the deep-link pages render the palette and
 *  the rail without this provider) — callers offer the affordance only when the
 *  dock actually exists, rather than rendering a button that cannot work. */
export function useOptionalCompanionDock(): CompanionDockValue | null {
  return useContext(CompanionDockContext);
}

export function CompanionDockProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState<string | null>(null);
  const [unread, setUnread] = useState(false);

  const openDock = useCallback((next?: string) => {
    setOpen(true);
    // Opening IS looking: the dot clears here, in the event, not in an effect.
    setUnread(false);
    const trimmed = next?.trim();
    if (trimmed) setSeed(trimmed);
  }, []);
  const closeDock = useCallback(() => setOpen(false), []);
  const consumeSeed = useCallback(() => setSeed(null), []);
  const markUnread = useCallback(() => setUnread(true), []);

  const value = useMemo<CompanionDockValue>(
    () => ({ open, openDock, closeDock, seed, consumeSeed, unread, markUnread }),
    [open, openDock, closeDock, seed, consumeSeed, unread, markUnread]
  );

  return (
    <CompanionDockContext.Provider value={value}>
      {children}
      <Defer strategy="idle">
        <CompanionDock />
      </Defer>
    </CompanionDockContext.Provider>
  );
}
