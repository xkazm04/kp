"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { AppMasterCompose } from "@/app/_lib/db/intakes";
import type { RepoDossier } from "@/app/_lib/schemas.generated";
import type { IntakeSession, ScanState } from "./jdsIntakeLogic";

// App master (docs/features/app-master/README.md): the client half of the third
// intake shape. Two jobs, both split out of jdsIntakeLogic so that file stays
// readable:
//
//  1. **Watch the repo scan** the session was started from, and post its
//     dossier to the intake the moment it lands. There is NO new poller here —
//     the shared TasksProvider list is the clock. That list is referentially
//     stable across no-op polls (TasksProvider gates `setTasks` on a rendered
//     signature), so this effect re-runs exactly when a task's state moves,
//     which is precisely when a scan can have progressed. On a reload the
//     session still knows its `scanId`, so the same effect resumes the watch
//     without needing the taskId the start call returned.
//  2. **Compose** the AppMasterSpec + population-fit verdict on demand.

/** GET /api/repo-scan/[id] — P2's contract, read-only from here. */
export type RepoScanView = {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
  source: "llm" | "heuristic" | null;
  dossier: RepoDossier | null;
  error?: string | null;
};

export function useAppMasterLogic(
  active: IntakeSession | null,
  /** The identity-checked session updater from useIntakeLogic. */
  applySession: (intakeId: string, patch: Partial<IntakeSession>) => void
) {
  const { tasks } = useTasks();
  const [scanState, setScanState] = useState<ScanState>(null);
  const [composing, setComposing] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // The scan whose dossier was already posted — a second POST would re-merge
  // the same facets and re-spend on the population fit for no new information.
  const posted = useRef<string | null>(null);

  const intakeId = active?.id ?? null;
  const scanId = active?.scanId ?? null;
  const hasDossier = Boolean(active?.dossier);

  useEffect(() => {
    if (!scanId || !intakeId || hasDossier) return;
    let cancelled = false;
    const run = async () => {
      if (inFlight.current || posted.current === scanId) return;
      inFlight.current = true;
      try {
        const res = await fetch(`/api/repo-scan/${encodeURIComponent(scanId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const scan = (await res.json()) as RepoScanView;
        if (cancelled) return;
        setScanState(scan.status);
        if (scan.status !== "complete" || !scan.dossier) return;
        posted.current = scanId;
        const post = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/dossier`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scanId, dossier: scan.dossier }),
        });
        if (!post.ok) {
          // Refused (429/409/offline): let the next tick try again rather than
          // silently leaving a finished scan unattached to its session.
          posted.current = null;
          throw new Error(`HTTP ${post.status}`);
        }
        const payload = (await post.json()) as {
          brief: IntakeSession["brief"];
          shape: IntakeSession["shape"];
          dossier: RepoDossier;
        };
        if (cancelled) return;
        applySession(intakeId, { brief: payload.brief, shape: payload.shape, dossier: payload.dossier });
        setScanState(null);
      } catch {
        // The queue or the scan route did not answer. `tasks` is stale rather
        // than empty, so say "unreachable" instead of rendering silence as done.
        if (!cancelled) setScanState("unreachable");
      } finally {
        inFlight.current = false;
      }
    };
    // Deferred a tick (the jdsHooks.ts pattern) — no synchronous setState in an effect.
    const timer = window.setTimeout(() => void run(), 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [tasks, scanId, intakeId, hasDossier, applySession]);

  const composeAppMaster = useCallback(async () => {
    if (!intakeId || composing) return;
    setComposing(true);
    setComposeError(null);
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/compose-app-master`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as AppMasterCompose & { brief: IntakeSession["brief"] };
      // applySession is identity-checked, like every other late response here.
      applySession(intakeId, {
        brief: data.brief,
        appMaster: { spec: data.spec, fit: data.fit, composedAt: data.composedAt },
      });
    } catch {
      setComposeError("compose");
    } finally {
      setComposing(false);
    }
  }, [intakeId, composing, applySession]);

  return { scanState, composeAppMaster, composing, composeError };
}
