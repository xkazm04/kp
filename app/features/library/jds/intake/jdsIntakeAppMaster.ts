"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { AppMasterCompose } from "@/app/_lib/db/intakes";
import type { RepoDossier } from "@/app/_lib/schemas.generated";
import { readRepoScanResponse, scanStateFor, type IntakeSession, type RepoScanView, type ScanState } from "./jdsIntakeLogic";

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
  const { tasks, fetchTask, cancelTask } = useTasks();
  const [scanState, setScanState] = useState<ScanState>(null);
  const [composing, setComposing] = useState(false);
  // The server's machine CODE, never its English `error` string — the card
  // resolves it through the `errors` catalog in the reader's language, exactly
  // as the dispatch control below already does. A single placeholder string used
  // to collapse a throttle, "the scan has not landed" and "answer the dialog
  // first" into one line that told the requestor nothing about what to do next.
  const [composeError, setComposeError] = useState<{ code: string | null } | null>(null);
  const inFlight = useRef(false);
  // The in-flight compose, so it can be cancelled (see composeAppMaster).
  const composeAbort = useRef<AbortController | null>(null);
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
        // The row's own honest reading of itself: which failure, or which agent
        // fallback is hiding behind a "complete". Not `scan.status`, which
        // collapsed both to one word.
        setScanState(scanStateFor(scan));
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
          // 409 = INTAKE_BRIEF_MOVED: a dialog turn landed while the merge was
          // being computed, so the server re-read rather than overwrote. That is
          // the system working, not a fault — retry on the next tick WITHOUT
          // claiming the scan is unreachable, which is what the catch below would
          // otherwise render under an intake that is perfectly reachable.
          if (post.status === 409) return;
          throw new Error(`HTTP ${post.status}`);
        }
        const payload = (await post.json()) as {
          brief: IntakeSession["brief"];
          shape: IntakeSession["shape"];
          dossier: RepoDossier;
        };
        if (cancelled) return;
        applySession(intakeId, { brief: payload.brief, shape: payload.shape, dossier: payload.dossier });
        // A clean completion has nothing left to say; a completion that fell back
        // keeps saying so, because the dossier is thinner than the card looks and
        // this is the moment the requestor can still fix the agent and re-scan.
        setScanState(scanStateFor(scan));
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

  // ---- Cancelling the scan --------------------------------------------------
  //
  // The engine already threads the abort signal end to end (runRepoScan → the git
  // clone and the Python child both take it), and DELETE /api/tasks/[id] is the door
  // to it — but no surface ever knocked, so a four-minute scan of the wrong
  // repository could only be waited out.
  //
  // Finding WHICH task is this scan's is the one awkward part: the polled task list
  // projects `params` out (they can be multi-MB), so the scanId is not on it. The
  // active `repo_scan` rows are few — at most the two runner slots plus a queue — so
  // the full record is fetched for those and matched by params.scanId. Resolved once
  // per session and cached; a wrong guess here would cancel somebody else's scan.
  const [scanTaskId, setScanTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!scanId || scanTaskId || hasDossier) return;
    const candidates = tasks.filter((t) => t.kind === "repo_scan" && (t.status === "queued" || t.status === "running"));
    if (candidates.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const candidate of candidates) {
        const full = await fetchTask(candidate.id);
        if (cancelled) return;
        if ((full?.params as { scanId?: unknown } | null)?.scanId === scanId) {
          setScanTaskId(candidate.id);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tasks, scanId, scanTaskId, hasDossier, fetchTask]);

  /** `null` when there is nothing to cancel — the control is then not rendered at
   *  all, rather than rendered dead. A queued scan cancels as truly as a running
   *  one: the `repo_scan` handler's `onCancelQueued` hook moves the row to
   *  `failed`/`cancelled` so it cannot sit at `queued` forever. */
  const cancellable =
    scanTaskId !== null &&
    (scanState === "queued" || scanState === "running") &&
    !hasDossier;
  const cancelScan = useCallback(() => {
    if (!scanTaskId) return;
    void cancelTask(scanTaskId);
  }, [scanTaskId, cancelTask]);

  const composeAppMaster = useCallback(async () => {
    if (!intakeId || composing) return;
    // The compose spawn can run for minutes. Holding its controller is what makes
    // the Cancel below a real cancel rather than a UI lie: aborting the fetch
    // aborts `request.signal` server-side, which the route threads into the
    // Python spawn.
    const controller = new AbortController();
    composeAbort.current = controller;
    setComposing(true);
    setComposeError(null);
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(intakeId)}/compose-app-master`, {
        method: "POST",
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { code?: string } | null;
        setComposeError({ code: body?.code ?? null });
        return;
      }
      const data = (await res.json()) as AppMasterCompose & { brief: IntakeSession["brief"] };
      // applySession is identity-checked, like every other late response here.
      applySession(intakeId, {
        brief: data.brief,
        appMaster: { spec: data.spec, fit: data.fit, composedAt: data.composedAt },
      });
    } catch (err) {
      // A cancel is not a failure and must not be reported as one; the button
      // simply returns to idle.
      if ((err as { name?: string } | null)?.name !== "AbortError") setComposeError({ code: null });
    } finally {
      if (composeAbort.current === controller) composeAbort.current = null;
      setComposing(false);
    }
  }, [intakeId, composing, applySession]);

  /** Abort an in-flight compose. Safe to call when nothing is running. */
  const cancelCompose = useCallback(() => {
    composeAbort.current?.abort();
    composeAbort.current = null;
  }, []);

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
    // …and the task this session's scan resolved to. Cancelling the PREVIOUS
    // session's scan from the new session's button is exactly the class of bug the
    // reset block exists to prevent.
    setScanTaskId(null);
  }

  // A compose belongs to the session it was started from, so a session switch
  // aborts it — the spawn behind it can run for minutes, and nobody is waiting
  // for it any more. In an EFFECT's cleanup, not in the render-phase reset
  // above: touching a ref during render is exactly what react-hooks/refs
  // forbids, and the reset block runs during render.
  useEffect(() => {
    return () => {
      composeAbort.current?.abort();
      composeAbort.current = null;
    };
  }, [intakeId]);

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

  return {
    scanState,
    /** Cancel this session's scan, or `null` when there is nothing to cancel. */
    cancelScan: cancellable ? cancelScan : null,
    composeAppMaster,
    cancelCompose,
    composing,
    composeError,
    paired,
    dispatchState,
    dispatchAppMaster,
  };
}
