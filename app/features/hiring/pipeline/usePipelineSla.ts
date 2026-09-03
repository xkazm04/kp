"use client";

// Per-stage aging SLA overrides (PIPE4) — the recruiter's per-board tuning of the
// STAGE_SLA_DEFAULTS, plus the editor's open/closed flag. Split out of
// usePipelineTabState so the tab hook is composition, not six concerns in one body.
//
// board-storage-is-keyed-by-tenant — the overrides are stored PER WORKSPACE
// (pipelineBoardStorage.ts). They used to sit under one bare `kp.pipelineStageSla`
// for the whole browser, so after a team switch team A's stage ids and cadences
// governed team B's aging chips — on a board whose columns may not even carry those
// stage ids. Nothing hydrates until the tenant resolves.

import { useEffect, useState } from "react";
import { clampSlaDays } from "./pipelineSla";
import { readStoredSla, writeStoredSla } from "./pipelineBoardStorage";
import { usePipelineTenant } from "./usePipelineTenant";

export function usePipelineSla() {
  const workspaceId = usePipelineTenant();
  const [slaOverrides, setSlaOverrides] = useState<Record<string, number>>({});
  const [editingSla, setEditingSla] = useState(false);
  useEffect(() => {
    // Client-only localStorage — a mount effect is the SSR-safe way to read it, and a
    // one-time set isn't a cascading-render concern. Re-runs when the tenant resolves
    // (null → id), which is the tick this board is allowed to hydrate at all. Values
    // are clamped on the way IN by readStoredSla: one stored by an older build (which
    // accepted anything positive) must not keep silencing a column's aging chip.
    if (!workspaceId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlaOverrides(readStoredSla(localStorage, workspaceId));
  }, [workspaceId]);
  const setStageSla = (stage: string, days: number | null) => {
    const next = { ...slaOverrides };
    // Re-clamped at the STORE, not only at the field: this is what persists, and a
    // second caller (or a hydrated value from an older build that stored 5000) must
    // not be able to write a cadence the aging chip will never fire on.
    const clamped = days == null ? null : clampSlaDays(String(days));
    if (clamped) next[stage] = clamped;
    else delete next[stage]; // cleared → back to the default
    setSlaOverrides(next);
    // An unresolved tenant writes NOTHING (the override still applies in memory this
    // session) — a cadence we cannot attribute to a team must not be persisted.
    writeStoredSla(localStorage, workspaceId, next);
  };
  return { slaOverrides, setStageSla, editingSla, setEditingSla };
}

export type PipelineSlaState = ReturnType<typeof usePipelineSla>;
