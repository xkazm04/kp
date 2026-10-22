"use client";

// CX S45 - the work-sample half of the role decision view for the Docket's role level:
// GET /api/decisions/role-view?job=<jobId>, folded to entry id -> work sample. Read-only.
// A role with no job id (a title-only group) has nothing to read and stays "none".
import { useEffect, useState } from "react";
import type { RoleDecisionView, RoleViewWorkSample } from "@/app/_lib/role-decision-view";

export type RoleWorkSamples =
  | { status: "none" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; byEntry: ReadonlyMap<string, RoleViewWorkSample> };

export function useRoleWorkSamples(jobId: string | null, rev: string): RoleWorkSamples {
  const key = jobId ? `${jobId}|${rev}` : null;
  const [state, setState] = useState<{ for: string | null; value: RoleWorkSamples }>({ for: null, value: { status: "none" } });

  useEffect(() => {
    if (!key || !jobId) return;
    const controller = new AbortController();
    fetch(`/api/decisions/role-view?job=${encodeURIComponent(jobId)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`role-view ${res.status}`);
        const body = (await res.json()) as RoleDecisionView;
        const byEntry = new Map((Array.isArray(body?.candidates) ? body.candidates : []).map((c) => [c.entryId, c.workSample] as const));
        if (!controller.signal.aborted) setState({ for: key, value: { status: "ready", byEntry } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ for: key, value: { status: "failed" } });
      });
    return () => controller.abort();
  }, [key, jobId]);

  if (!key) return { status: "none" };
  return state.for === key ? state.value : { status: "loading" };
}
