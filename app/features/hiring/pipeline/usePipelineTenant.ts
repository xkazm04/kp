"use client";

// board-storage-is-keyed-by-tenant — the WORKSPACE this document belongs to, for the
// board's localStorage-backed memories (saved views, SLA overrides). Kept apart from
// pipelineBoardStorage.ts so that module stays React-free and unit-pinnable.
//
// Client code: there is no currentWorkspace() here and the session cookie that carries
// the workspace is httpOnly, so the one door the browser has is GET /api/workspaces,
// whose payload exposes `current` (the same field the Workspaces console reads through
// useWorkspaceAdmin). Resolved ONCE per document and shared by every board hook; it
// cannot go stale mid-session because switching teams does a full reload
// (WorkspaceTab.switchTo). Same shape as the shell's recents resolver
// (app/features/shell/recents.ts), which closed the identical leak for the Recent list;
// hoisting the two into one shared `useTenantStorage` is the follow-up.

import { useEffect, useState } from "react";
import { LEGACY_SLA_KEY, LEGACY_VIEWS_KEY, migrateLegacyKey, pipelineSlaKey, pipelineViewsKey } from "./pipelineBoardStorage";

let workspaceId: string | null = null;
let resolving: Promise<void> | null = null;
// Same-document signal so every mounted consumer (the views hook, the SLA hook)
// re-reads the moment the tenant lands.
const EVENT = "kp:pipeline-tenant-resolved";

function ensureTenant(): void {
  if (workspaceId || resolving) return;
  if (typeof window === "undefined") return;
  resolving = fetch("/api/workspaces")
    .then((r) => (r.ok ? (r.json() as Promise<{ current?: unknown }>) : null))
    .then((body) => {
      const current = body && typeof body.current === "string" ? body.current : "";
      if (!current) throw new Error("no current workspace in /api/workspaces");
      workspaceId = current;
      // One-time adoption of the pre-tenancy global keys into whichever workspace
      // resolves first — see the LEGACY_* comments in pipelineBoardStorage.ts.
      migrateLegacyKey(localStorage, LEGACY_VIEWS_KEY, pipelineViewsKey(current));
      migrateLegacyKey(localStorage, LEGACY_SLA_KEY, pipelineSlaKey(current));
      window.dispatchEvent(new Event(EVENT));
    })
    .catch(() => {
      // Tenant unknown (an offline blip, or a seat without `read`) = NO saved views and
      // NO overrides this tick, rather than a browser-wide store that survives a team
      // switch. Clearing `resolving` lets the next mount retry, so one failed request
      // does not disable the feature for the whole session.
      resolving = null;
    });
}

/** The current workspace id, or `null` until it resolves. Board storage consumers
 *  hydrate NOTHING while this is null — that is the whole point of the scoping. */
export function usePipelineTenant(): string | null {
  const [id, setId] = useState<string | null>(workspaceId);
  useEffect(() => {
    ensureTenant();
    // A second mount in a document that already resolved gets the id immediately;
    // the first mount gets it from the EVENT below. (One-time mount set, not the
    // cascading-render case the set-state rule targets.)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot adoption of a module-level id resolved before this mount
    if (workspaceId) setId(workspaceId);
    const onResolved = () => setId(workspaceId);
    window.addEventListener(EVENT, onResolved);
    return () => window.removeEventListener(EVENT, onResolved);
  }, []);
  return id;
}
