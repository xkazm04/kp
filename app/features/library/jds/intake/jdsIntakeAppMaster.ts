"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { AppMasterCompose } from "@/app/_lib/db/intakes";
import type { RepoDossier } from "@/app/_lib/schemas.generated";
import { readRepoScanResponse, type IntakeSession, type RepoScanView, type ScanState } from "./jdsIntakeLogic";

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
//  3. **Dispatch** the composed spec to Personas as an agent hire (P4). The
//     bridge's pairing state is read once per App-master session so the control
//     can say WHY it is unavailable instead of failing on click — the same
//     honesty the Agent-fit tab's `notConnected` banner shows.

/** GET /api/repo-scan/[id] — P2's contract, read-only from here. The type and its
 *  (wrapper-aware) reader live in jdsIntakeLogic.ts so a node:test can pin them
 *  without dragging TasksProvider's React/next-intl chain in; re-exported here
 *  because this is the module that consumes them. */
export type { RepoScanView };

/** What the dispatch control is currently able to claim. `sent` means Personas
 *  ACCEPTED the request (it still needs a human approval there) — never "hired". */
export type DispatchState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent"; hiredAgentId: string | null }
  // The failure carries the server's machine CODE, never its English `error`
  // string — the card resolves it through the `errors` catalog in the reader's
  // language (app/_lib/use-error-message.ts).
  | { status: "error"; code: string | null };

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
        // The route wraps the row (`{ scan }`); reading it flat left `status`
        // undefined and stalled the whole App-master flow — see
        // readRepoScanResponse.
        const scan = readRepoScanResponse(await res.json());
        if (!scan) throw new Error("unrecognized /api/repo-scan payload");
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

  // ---- P4: dispatch the composed spec to Personas ---------------------------

  // null = not read yet (the control stays neutral rather than claiming
  // "unpaired" before anything asked).
  const [paired, setPaired] = useState<boolean | null>(null);
  const [dispatchState, setDispatchState] = useState<DispatchState>({ status: "idle" });
  const isAppMaster = active?.shape === "app_master";

  // ---- Per-session state does not outlive its session --------------------------
  //
  // `scanState`, `composeError` and `dispatchState` each answer a question about ONE
  // session ("is that session's scan still running", "was that session dispatched"),
  // but the hook outlives the session: JdsIntakePanel is mounted once by
  // JdsSavedLedger and swaps `active` underneath it, with no `key` to force a
  // remount. Without this reset a session switch carried the previous session's
  // answers onto the new screen:
  //   - `scanState` (set to e.g. "running" and left there when the watch effect
  //     early-returns for a session with no scanId) kept rendering "reading the
  //     codebase…" as JdsIntakePanel's `statusNote` under an unrelated session's
  //     opener;
  //   - `dispatchState: "sent"` kept the App-master card claiming "sent to Personas"
  //     and kept the Dispatch button DISABLED for a session that was never
  //     dispatched, with a full page reload the only way out.
  //
  // Render-phase adjustment rather than an effect, the same shape jobsTabDeepLink.ts
  // uses for its once-per-param guard: an effect would let one frame render with the
  // previous session's claims. `paired` is deliberately NOT reset — the Personas
  // bridge is workspace-level, not per-session, and re-reading it on every switch is
  // a wasted round trip.
  const [stateForIntake, setStateForIntake] = useState<string | null>(intakeId);
  if (stateForIntake !== intakeId) {
    setStateForIntake(intakeId);
    setScanState(null);
    setComposeError(null);
    setDispatchState({ status: "idle" });
  }

  useEffect(() => {
    if (!isAppMaster || paired !== null) return;
    let cancelled = false;
    const read = async () => {
      try {
        const res = await fetch("/api/agents/bridge");
        const body = res.ok ? ((await res.json()) as { bridge?: { paired?: boolean } }) : null;
        if (!cancelled) setPaired(body?.bridge?.paired === true);
      } catch {
        // Unreachable reads as unpaired: dispatch would fail anyway, and saying
        // so up front beats a click that 502s.
        if (!cancelled) setPaired(false);
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [isAppMaster, paired]);

  const dispatchAppMaster = useCallback(async () => {
    if (!intakeId || dispatchState.status === "sending") return;
    setDispatchState({ status: "sending" });
    try {
      const res = await fetch("/api/agents/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intakeId }),
      });
      const body = (await res.json().catch(() => null)) as { hiredAgentId?: string; code?: string } | null;
      if (!res.ok) {
        // The route distinguishes the failures that mean something to a
        // requestor (unpaired bridge, human population, stale spec) by CODE; the
        // card resolves it, so the reason survives translation.
        setDispatchState({ status: "error", code: body?.code ?? null });
        return;
      }
      setDispatchState({ status: "sent", hiredAgentId: body?.hiredAgentId ?? null });
    } catch {
      setDispatchState({ status: "error", code: null });
    }
  }, [intakeId, dispatchState.status]);

  return { scanState, composeAppMaster, composing, composeError, paired, dispatchState, dispatchAppMaster };
}
