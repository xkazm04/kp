"use client";

// Per-stage aging cadences (PIPE4), now TEAM data (challenge-r03 pipeline-board-ui/A).
//
// The cadence a column ages against lives on the workspace's board axis (`slaDays`,
// read by the board, the sidebar badge and the automation pass through the one aging
// clock in aging-policy.ts). This hook no longer owns the value; it owns:
//
//   - the WRITE: PATCH /api/pipeline/stage-sla for one column, then the caller's board
//     reload, which brings the new axis back as the truth;
//   - an OPTIMISTIC map (`slaOverrides`) holding a just-saved number between the save
//     and that reload, so the chip does not flicker back; dropped once the reload lands
//     or the save fails;
//   - the ONE-TIME MIGRATION of a browser's leftover per-browser cadences (written by
//     builds before this one under `kp.pipelineStageSla:<ws>`). They are read once per
//     tenant and OFFERED to the team; never imported silently, because one browser's
//     taste is not team policy until someone with `pipeline:write` says so. Cleared
//     after a successful adoption or an explicit discard.
//
// A seat without `pipeline:write` is refused by the route (FORBIDDEN_CAPABILITY) and the
// editor says so; before, anyone could tune their own browser.

import { useState } from "react";
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";
import type { LocalSlaOffer } from "@/app/_lib/stage-sla";
import { clearStoredSla, readStoredSla } from "./pipelineBoardStorage";
import { usePipelineTenant } from "./usePipelineTenant";

/** One column's write. Resolves to null on success, else the failure payload (the
 *  editor resolves its CODE, never the server's English). */
async function patchStageSla(stage: string, days: number | null): Promise<ApiErrorPayload | null> {
  try {
    const res = await fetch("/api/pipeline/stage-sla", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stage, days }),
    });
    if (res.ok) return null;
    return ((await res.json().catch(() => null)) as ApiErrorPayload | null) ?? {};
  } catch {
    return {}; // offline / aborted: no code, the editor shows its own localized fallback
  }
}

export function usePipelineSla() {
  const workspaceId = usePipelineTenant();
  const [slaOverrides, setSlaOverrides] = useState<Record<string, number>>({});
  const [editingSla, setEditingSla] = useState(false);
  const [slaSaveError, setSlaSaveError] = useState<ApiErrorPayload | null>(null);
  const [localSla, setLocalSla] = useState<Record<string, number>>({});
  // The leftover per-browser map is read once per TENANT, in the 'adjust state when a
  // prop changes' shape (React docs): the tenant only resolves on the client, so the
  // server render never touches localStorage. readStoredSla clamps on the way in.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  if (workspaceId && hydratedFor !== workspaceId) {
    setHydratedFor(workspaceId);
    setLocalSla(readStoredSla(localStorage, workspaceId));
  }

  const dropOptimistic = (stage: string) =>
    setSlaOverrides((cur) => {
      if (!(stage in cur)) return cur;
      const next = { ...cur };
      delete next[stage];
      return next;
    });

  /** Save one column's cadence for the TEAM (`null` = back to the role default), then
   *  run `reload` so the board reads the new axis. */
  const saveStageSla = async (stage: string, days: number | null, reload: () => Promise<unknown>): Promise<boolean> => {
    setSlaSaveError(null);
    if (days != null) setSlaOverrides((cur) => ({ ...cur, [stage]: days }));
    else dropOptimistic(stage);
    const failure = await patchStageSla(stage, days);
    if (failure) {
      dropOptimistic(stage);
      setSlaSaveError(failure);
      return false;
    }
    await reload();
    dropOptimistic(stage);
    return true;
  };

  /** Apply the offered leftovers to the team, one column at a time; the local copy is
   *  cleared only when every one of them landed (a partial failure keeps the offer). */
  const adoptLocalSla = async (offers: readonly LocalSlaOffer[], reload: () => Promise<unknown>): Promise<void> => {
    setSlaSaveError(null);
    for (const { stage, days } of offers) {
      const failure = await patchStageSla(stage, days);
      if (failure) {
        setSlaSaveError(failure);
        await reload();
        return;
      }
    }
    clearStoredSla(localStorage, workspaceId);
    setLocalSla({});
    await reload();
  };

  /** Throw the leftovers away without touching the team's cadences. */
  const discardLocalSla = () => {
    clearStoredSla(localStorage, workspaceId);
    setLocalSla({});
  };

  return {
    slaOverrides,
    saveStageSla,
    editingSla,
    setEditingSla,
    slaSaveError,
    localSla,
    adoptLocalSla,
    discardLocalSla,
  };
}

export type PipelineSlaState = ReturnType<typeof usePipelineSla>;
