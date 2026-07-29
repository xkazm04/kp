// The "Define need" workspace's need-analysis → design → approve pipeline, split
// out of DevTab.tsx.
import { useMemo, useState } from "react";
import { useTaskResult, type Task } from "@/app/features/shell/tasks/TasksProvider";
import type { Design, Result } from "./DevTypes";

export function useDevTabNeedAnalysis(args: {
  tasks: Task[];
  startTask: (kind: string, params?: Record<string, unknown>) => Promise<Task | null>;
  buildNeed: () => Record<string, unknown>;
  runAction: (label: string, fetcher: () => Promise<Response>, onOk?: (body: unknown) => void) => Promise<boolean>;
  loadCases: () => void;
}) {
  const { tasks, startTask, buildNeed, runAction, loadCases } = args;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [designId, setDesignId] = useState<string | null>(null);
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
  const { full: viewedFull } = useTaskResult(viewed?.id ?? null);
  const awaitingResult = viewed?.status === "succeeded" && !viewedFull;
  const running = (viewed ? viewed.status === "running" || viewed.status === "queued" : false) || awaitingResult;
  const result = viewed?.status === "succeeded" ? ((viewedFull?.result as Result | undefined) ?? null) : null;
  const analysis = result?.analysis ?? {};
  // Multi-repo: `snapshots` is canonical; lift a legacy single `snapshot` into a
  // one-item list so bundles saved before multi-repo render identically.
  const snapshots = result?.snapshots ?? (result?.snapshot ? [result.snapshot] : []);
  const viewedNeed = (viewedFull?.params as { need?: Record<string, unknown> } | undefined)?.need;

  const { full: designFull, status: designStatus } = useTaskResult(designId);
  const designing = designStatus === "running" || designStatus === "queued" || (designStatus === "succeeded" && !designFull);
  const design = designStatus === "succeeded" ? ((designFull?.result as Design | undefined) ?? null) : null;

  const selectNeed = (id: string) => {
    setSelectedId(id);
    setDesignId(null);
    setApprovedId(null);
  };

  const submit = async () => {
    const t = await startTask("need_analysis", { need: buildNeed() });
    if (t) selectNeed(t.id);
  };

  const startDesign = async () => {
    if (!viewedNeed || !result) return;
    setApprovedId(null);
    const t = await startTask("design_artifacts", { need: viewedNeed, analysis: result.analysis });
    if (t) setDesignId(t.id);
  };

  const approve = async () => {
    if (!design?.role || !design?.case) return;
    setApproving(true);
    try {
      // Route through the shared runAction error surface like every other write on
      // this tab (dev-case-authoring-publishing #2). approve() previously did a bare
      // fetch that only acted `if (r.ok)`, so a probe-gate block (enforceProbeGate
      // returns a structured error + code + verdict) spun and then did nothing — no
      // banner, no explanation, a dead button. Now the server's message lands in the
      // actionError banner.
      await runAction(
        "Approve",
        () =>
          fetch("/api/devcase", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ need: viewedNeed, analysis: result?.analysis, role: design.role, case: design.case }),
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
