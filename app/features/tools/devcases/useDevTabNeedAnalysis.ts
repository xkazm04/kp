// The "Define need" workspace's need-analysis → design → approve pipeline, split
// out of DevTab.tsx.
import { useMemo, useState } from "react";
import { useTaskResult, type Task } from "@/app/features/shell/tasks/TasksProvider";
import type { DevAction } from "./useDevTabActions";
import type { Design, Result } from "./DevTypes";

export function useDevTabNeedAnalysis(args: {
  tasks: Task[];
  startTask: (kind: string, params?: Record<string, unknown>) => Promise<Task | null>;
  buildNeed: () => Record<string, unknown>;
  runAction: (action: DevAction, fetcher: () => Promise<Response>, onOk?: (body: unknown) => void) => Promise<boolean>;
  loadCases: () => void;
}) {
  const { tasks, startTask, buildNeed, runAction, loadCases } = args;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
  // LINEAGE STAMP. `viewed` is a DERIVED pointer into a workspace-wide task poll, not a
  // held value: it falls back to needTasks[0] whenever the selected task isn't in the
  // polled list (it is capped at LIMIT 60 / a 7-day window) and whenever selectedId is
  // still null, so a newer need_analysis started in a second tab or by a teammate lands
  // at index 0 and silently re-points it. approve() re-read viewedNeed/result at CLICK
  // time, so with a design card open across such a flip it persisted a case whose
  // role+case came from need A while its stored need+analysis came from need B — the
  // case's own record of why it exists, wrong, and unfalsifiable after the fact. Pin the
  // pair at the moment the design is started, which is also exactly what the design task
  // was given, so the saved case can only ever carry the need it was designed from.
  const [designFrom, setDesignFrom] = useState<{ need: Record<string, unknown>; analysis: Result["analysis"] } | null>(
    null
  );
  const [approving, setApproving] = useState(false);
  const [approvedId, setApprovedId] = useState<string | null>(null);

  const needTasks = useMemo(() => tasks.filter((t) => t.kind === "need_analysis"), [tasks]);
  const viewed = useMemo(
    () => needTasks.find((t) => t.id === selectedId) ?? needTasks[0] ?? null,
    [needTasks, selectedId]
  );
  // result/params live in the full task record, which the poll omits — fetch the
  // viewed need-analysis task's full record on demand. `awaitingResult` holds the
  // "analyzing" state through the brief fetch after the task succeeds, so the panel
  // never flashes its "did not complete" error between finish and result arrival.
  // OO-L2-12: useTaskResult gives up after RESULT_FETCH_MAX_ATTEMPTS failed full-record
  // fetches and raises `resultUnavailable`, whose contract is explicit — "Consumers MUST
  // resolve their busy state and surface an error instead of spinning forever". This
  // consumer ignored it, so a need analysis that SUCCEEDED but whose GET /api/tasks/[id]
  // kept failing (500 / offline / unparseable blob) held `awaitingResult` true for the
  // life of the view: the pane spun "Pulling the codebase + reflecting…" with no error
  // and no way out. Dropping the busy state hands the view its error branch instead.
  const { full: viewedFull, resultUnavailable: resultLost } = useTaskResult(viewed?.id ?? null);
  const awaitingResult = viewed?.status === "succeeded" && !viewedFull && !resultLost;
  const running = (viewed ? viewed.status === "running" || viewed.status === "queued" : false) || awaitingResult;
  const result = viewed?.status === "succeeded" ? ((viewedFull?.result as Result | undefined) ?? null) : null;
  const analysis = result?.analysis ?? {};
  // Multi-repo: `snapshots` is canonical; lift a legacy single `snapshot` into a
  // one-item list so bundles saved before multi-repo render identically.
  const snapshots = result?.snapshots ?? (result?.snapshot ? [result.snapshot] : []);
  const viewedNeed = (viewedFull?.params as { need?: Record<string, unknown> } | undefined)?.need;

  // Same give-up contract on the design watch: without it a succeeded design_artifacts
  // task whose full record never loads left "Designing the role + assignment…" spinning
  // permanently, hiding the "Design role & assignment" button that would restart it.
  const { full: designFull, status: designStatus, resultUnavailable: designLost } = useTaskResult(designId);
  const designing =
    designStatus === "running" || designStatus === "queued" || (designStatus === "succeeded" && !designFull && !designLost);
  const design = designStatus === "succeeded" ? ((designFull?.result as Design | undefined) ?? null) : null;

  const selectNeed = (id: string) => {
    setSelectedId(id);
    setDesignId(null);
    setDesignFrom(null);
    setApprovedId(null);
  };

  const submit = async () => {
    const t = await startTask("need_analysis", { need: buildNeed() });
    if (t) selectNeed(t.id);
  };

  const startDesign = async () => {
    if (!viewedNeed || !result) return;
    setApprovedId(null);
    const pinned = { need: viewedNeed, analysis: result.analysis };
    const t = await startTask("design_artifacts", pinned);
    if (t) {
      setDesignId(t.id);
      setDesignFrom(pinned);
    }
  };

  const approve = async () => {
    // designFrom is set with designId and cleared with it, so this can only be null for
    // a design that was never started from this hook — but it is the lineage the write
    // is stamped with, so it gates the write rather than silently defaulting.
    if (!design?.role || !design?.case || !designFrom) return;
    setApproving(true);
    try {
      // Route through the shared runAction error surface like every other write on
      // this tab (dev-case-authoring-publishing #2). approve() previously did a bare
      // fetch that only acted `if (r.ok)`, so a probe-gate block (enforceProbeGate
      // returns a structured error + code + verdict) spun and then did nothing — no
      // banner, no explanation, a dead button. Now the server's message lands in the
      // actionError banner.
      await runAction(
        "approve",
        () =>
          fetch("/api/devcase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              need: designFrom.need,
              analysis: designFrom.analysis,
              role: design.role,
              case: design.case,
            }),
          }),
        (body) => {
          setApprovedId((body as { id?: string } | null)?.id ?? null);
          loadCases();
        }
      );
    } finally {
      setApproving(false);
    }
  };

  return {
    selectedId, selectNeed,
    needTasks, viewed,
    running, result, analysis, snapshots,
    design, designing,
    submit, startDesign, approve, approving, approvedId,
  };
}
