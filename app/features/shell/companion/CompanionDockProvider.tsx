"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Defer } from "@/app/_components/ui/Defer";
import { useCompanionRuntime } from "./useCompanionRuntime";
import type { CompanionPrefsState } from "./useCompanionPrefs";
import type { CompanionSpeech } from "./useCompanionSpeech";
import type { CompanionThreadState } from "./useCompanionThread";

/*
 * Candi's dock lives OUTSIDE the keyed tab div (Workspace.tsx) so a conversation
 * survives every tab switch — the operator can ask about the pipeline, walk to
 * Jobs, and keep talking. This provider is what lets surfaces that are nowhere
 * near the dock open it: the command palette's "Ask Candi" item and the
 * ControlDock's layer-1 Ask Candi control both just call openDock(query).
 *
 * ROUND V3 made it hold the conversation as well as the window state. Voice mode
 * splits her across two trees — the strip at the top of the screen, and the
 * input as a layer-2 panel of the footer control dock — and two surfaces that
 * send into the same conversation cannot each own a thread. `useCompanionRuntime`
 * assembles the one thread, the one utterance and the one preference set here,
 * above both consumers; see its header for what that costs and why the
 * alternatives were worse.
 *
 * The dock itself is still code-split (like the sim overlays in
 * WorkspaceSimSurfaces.tsx) and its first commit is still deferred to idle, so
 * an operator who never opens it pays for the seam and none of the surface.
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
  /** THE conversation. One per document, consumed by the dock, the voice strip
   *  and the control dock's `candi` input panel — never created by any of them. */
  thread: CompanionThreadState;
  /** THE utterance. Readable from outside the dock on purpose: voice mode keeps
   *  the strip up while `speakingId` is set, so closing her never cuts audio. */
  speech: CompanionSpeech;
  /** Which shape she wears, and whether replies are read aloud. The control dock
   *  reads `mode` to decide whether Ask Candi is a panel toggle or an action. */
  prefs: CompanionPrefsState;
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

  const { thread, speech, prefs } = useCompanionRuntime({ active: open, seed, consumeSeed, markUnread });

  const value = useMemo<CompanionDockValue>(
    () => ({ open, openDock, closeDock, seed, consumeSeed, unread, markUnread, thread, speech, prefs }),
    [open, openDock, closeDock, seed, consumeSeed, unread, markUnread, thread, speech, prefs]
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
