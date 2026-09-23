"use client";

// board-storage-is-keyed-by-tenant — the WORKSPACE this document belongs to, for the
// board's localStorage-backed memories (saved views, SLA overrides). Kept apart from
// pipelineBoardStorage.ts so that module stays React-free and unit-pinnable.
//
// The tenant comes from the shell's one door (app/features/shell/shellPrincipal.ts):
// seeded from '/' in the workspace shell, else one GET /api/workspaces shared with
// the Recent list and the palette's preview memo. This hook keeps only the board's
// own semantics — the one-time legacy-key adoption and the same-document signal. It
// cannot go stale mid-session because switching teams does a full reload
// (WorkspaceTab.switchTo).

import { useEffect, useState } from "react";
import { resolveShellWorkspace, shellWorkspaceId } from "@/app/features/shell/shellPrincipal";
import { LEGACY_SLA_KEY, LEGACY_VIEWS_KEY, migrateLegacyKey, pipelineSlaKey, pipelineViewsKey } from "./pipelineBoardStorage";

let workspaceId: string | null = null;
let resolving = false;
// Same-document signal so every mounted consumer (the views hook, the SLA hook)
// re-reads the moment the tenant lands.
const EVENT = "kp:pipeline-tenant-resolved";

function adoptTenant(current: string): void {
  if (workspaceId === current) return;
  workspaceId = current;
  // One-time adoption of the pre-tenancy global keys into whichever workspace
  // resolves first — see the LEGACY_* comments in pipelineBoardStorage.ts.
  migrateLegacyKey(localStorage, LEGACY_VIEWS_KEY, pipelineViewsKey(current));
  migrateLegacyKey(localStorage, LEGACY_SLA_KEY, pipelineSlaKey(current));
  window.dispatchEvent(new Event(EVENT));
}

function ensureTenant(): void {
  if (workspaceId || resolving) return;
  if (typeof window === "undefined") return;
  // Seeded by the shell: adopt now, no request.
  const seeded = shellWorkspaceId();
  if (seeded) {
    adoptTenant(seeded);
    return;
  }
  resolving = true;
  void resolveShellWorkspace().then((id) => {
    resolving = false;
    // Tenant unknown (an offline blip, or a seat without `read`) = NO saved views and
    // NO overrides this tick, rather than a browser-wide store that survives a team
    // switch. The shared resolver clears its slot on failure, so the next mount
    // retries — one failed request does not disable the feature for the session.
    if (id) adoptTenant(id);
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
