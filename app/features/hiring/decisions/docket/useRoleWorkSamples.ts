"use client";

// CX S45/S46 - the role decision view for the Docket's role level:
// GET /api/decisions/role-view?job=<jobId>, read ONCE per level and shared by the decide rows'
// work-sample cell (workSamplesOf) and the "Everyone on this role" overview (CX S46). Read-only.
// A role with no job id (a title-only group) has nothing to read and stays "none".
import { useEffect, useState } from "react";
import type { RoleDecisionView, RoleViewCandidate, RoleViewWorkSample } from "@/app/_lib/role-decision-view";

export type RoleWorkSamples =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; byEntry: ReadonlyMap<string, RoleViewWorkSample> };

export type RoleViewRead =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; candidates: readonly RoleViewCandidate[] };

export function useRoleDecisionView(jobId: string | null, rev: string): RoleViewRead {
  const key = jobId ? `${jobId}|${rev}` : null;
  const [state, setState] = useState<{ for: string | null; value: RoleViewRead }>({ for: null, value: { status: "none" } });

  useEffect(() => {
    if (!key || !jobId) return;
    const controller = new AbortController();
    fetch(`/api/decisions/role-view?job=${encodeURIComponent(jobId)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`role-view ${res.status}`);
        const body = (await res.json()) as RoleDecisionView;
        const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
        if (!controller.signal.aborted) setState({ for: key, value: { status: "ready", candidates } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ for: key, value: { status: "failed" } });
      });
    return () => controller.abort();
  }, [key, jobId]);

  if (!key) return { status: "none" };
  // Keep the last good read on screen while a re-read (a stage moved) is in flight.
  // Only the same role's read: another role's people never stand in for this one's.
  if (state.for !== key) return state.value.status === "ready" && state.for?.startsWith(`${jobId}|`) ? state.value : { status: "loading" };
  return state.value;
}

/** The work-sample half, folded to entry id -> work sample (the decide rows' cell). */
export function workSamplesOf(read: RoleViewRead): RoleWorkSamples {
  if (read.status !== "ready") return read;
  return { status: "ready", byEntry: new Map(read.candidates.map((c) => [c.entryId, c.workSample] as const)) };
}
