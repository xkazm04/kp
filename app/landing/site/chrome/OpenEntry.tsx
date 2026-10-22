"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { enterWorkspace } from "@/app/_lib/auth/session-nav";
import { claimAutoEntry, readEntryMarker, returnVisitDecision } from "@/app/_lib/auth/open-entry";

/*
 * cx T2: on a local open-mode install the landing's sign-in calls to action read
 * "open your workspace", and a browser that has entered before skips the landing.
 * `openEntry` is resolved on the server (app/page.tsx) and handed down once through
 * this context so the many CTAs need no new prop. Default false: every other
 * surface (password mode, hosted, public link, About without the provider) is unchanged.
 */
const OpenEntryContext = createContext(false);

export const useOpenEntry = () => useContext(OpenEntryContext);

export function OpenEntryProvider({ openEntry, children }: { openEntry: boolean; children: ReactNode }) {
  useEffect(() => {
    if (returnVisitDecision({ openEntry, marker: readEntryMarker() }) !== "enter") return;
    if (!claimAutoEntry()) return;
    void enterWorkspace();
  }, [openEntry]);
  return <OpenEntryContext.Provider value={openEntry}>{children}</OpenEntryContext.Provider>;
}
