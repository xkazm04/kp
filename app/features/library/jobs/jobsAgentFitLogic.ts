// State + data-loading for the Agent fit tab (JobsAgentFitTab.tsx), following
// the jobsCampaignTabLogic split so the view files stay under the 200-line cap.
// Owns: the bridge/spec/catalog/roster reads, the backgrounded transform task
// (POST agent-fit → taskId → useTaskResult, the JD-build polling pattern), the
// editable spec form, the dispatch call, and the per-agent status refresh.
"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useJsonFetch } from "@/app/_lib/useJsonFetch";
import { useErrorMessage } from "@/app/_lib/use-error-message";
import { useTaskResult, useTasks } from "@/app/features/shell/tasks/TasksProvider";
import type { BridgeConfigPublic } from "@/app/_lib/agent-hire/bridge-store";
import type { AgentFitSpecRecord } from "@/app/_lib/db/agents";
import type { AgentRosterEntry } from "@/app/features/agents-workforce/agentsWorkforceLogic";
import { buildOverrides, specFormFromRecord, toggleConnector, type SpecForm } from "./jobsAgentFitModel";

export type ConnectorCatalogView = { connectors: { name: string; description: string }[]; source: string };

export function useAgentFitLogic(jobId: string) {
  const t = useTranslations("agentFit");
  // The bridge routes answer with `{ error, code }`; resolve the machine `code`
  // through the `errors` catalog, never the English `error` — see
  // app/_lib/use-error-message.ts.
  const errMsg = useErrorMessage();

  const { data: bridgeData } = useJsonFetch<{ bridge: BridgeConfigPublic }>("/api/agents/bridge", t("loadFailed"));
  const bridge = bridgeData?.bridge ?? null;

  const specUrl = `/api/jobs/${encodeURIComponent(jobId)}/agent-fit`;
  const {
    data: specData,
    error: specError,
    reload: reloadSpec,
  } = useJsonFetch<{ spec: AgentFitSpecRecord | null }>(specUrl, t("loadFailed"));
  const record = specData?.spec ?? null;
  const specLoading = !specData && !specError;

  const { data: catalogData } = useJsonFetch<ConnectorCatalogView>("/api/agents/catalog", t("loadFailed"));
  const catalog = catalogData?.connectors ?? [];

  // This job's most recent hired agent (live or terminal) — drives the status
  // timeline and the dispatch idempotency hint. The roster is small; filtering
  // client-side avoids a bespoke per-job route.
  const {
    data: agentsData,
    reload: reloadAgents,
  } = useJsonFetch<{ agents: AgentRosterEntry[] }>("/api/agents", t("loadFailed"));
  const agent =
    agentsData?.agents
      .filter((a) => a.jobId === jobId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;

  // ---- The backgrounded transform (task kind agent_fit) ----------------------
  // refreshTasks nudges the shared poll right after the route starts the task,
  // so the 6s idle cadence doesn't delay the first "running" paint.
  const { refresh: refreshTasks } = useTasks();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const { active: taskActive, status: taskStatus, error: taskError, progressMsg } = useTaskResult(taskId);
  // Reload the stored spec ONCE per finished task (the result persists server-side
  // as the job's latest agent_fit_specs row — the GET is the source of truth).
  const handledTask = useRef<string | null>(null);
  useEffect(() => {
    if (taskId && taskStatus === "succeeded" && handledTask.current !== taskId) {
      handledTask.current = taskId;
      reloadSpec();
    }
  }, [taskId, taskStatus, reloadSpec]);

  const run = async () => {
    if (taskActive) return;
    setStartError(null);
    try {
      const r = await fetch(specUrl, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { taskId?: string; error?: string; code?: string } | null;
      if (!r.ok || !p?.taskId) throw new Error(errMsg(p, t("runFailed")));
      setTaskId(p.taskId);
      void refreshTasks();
    } catch (e) {
      setStartError(e instanceof Error && e.message ? e.message : t("runFailed"));
    }
  };

  // ---- Editable spec form ----------------------------------------------------
  // Prefilled from the stored record, adjusted DURING render when a new record
  // arrives (the derived-from-props pattern the set-state-in-effect rule points
  // at) — a re-run replaces the form with the fresh spec's values.
  const [form, setForm] = useState<SpecForm | null>(null);
  const [formFor, setFormFor] = useState<string | null>(null);
  if (record && formFor !== record.id) {
    setFormFor(record.id);
    setForm(specFormFromRecord(record));
  }
  const patchForm = (patch: Partial<SpecForm>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const toggleFormConnector = (name: string) =>
    setForm((f) => (f ? { ...f, connectors: toggleConnector(f.connectors, name) } : f));

  // ---- Dispatch --------------------------------------------------------------
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const dispatch = async () => {
    if (dispatching || !form) return;
    setDispatching(true);
    setDispatchError(null);
    try {
      const r = await fetch("/api/agents/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, overrides: buildOverrides(form) }),
      });
      const p = (await r.json().catch(() => null)) as { error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(p, t("dispatchFailed")));
      reloadAgents();
    } catch (e) {
      setDispatchError(e instanceof Error && e.message ? e.message : t("dispatchFailed"));
      // A failed dispatch still mints a `failed` row server-side — show it.
      reloadAgents();
    } finally {
      setDispatching(false);
    }
  };

  // ---- Status refresh (pull fallback) ---------------------------------------
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const refresh = async () => {
    if (refreshing || !agent) return;
    setRefreshing(true);
    setRefreshNote(null);
    try {
      const r = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/refresh`, { method: "POST" });
      const p = (await r.json().catch(() => null)) as { refreshed?: boolean; reason?: string; error?: string; code?: string } | null;
      if (!r.ok) throw new Error(errMsg(p, t("refreshFailed")));
      // A 200 that refused to refresh carries a machine code beside its English reason
      // (wave 20); resolve the code, never paint the prose.
      if (p?.refreshed === false && (p.code || p.reason)) setRefreshNote(errMsg(p, t("refreshFailed")));
      reloadAgents();
    } catch (e) {
      setRefreshNote(e instanceof Error && e.message ? e.message : t("refreshFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  return {
    t,
    bridge,
    record,
    specLoading,
    specError,
    reloadSpec,
    catalog,
    catalogSource: catalogData?.source ?? null,
    agent,
    // Running from the click until the poll reports a terminal state — the
    // just-started window (taskStatus still null) must not flash the CTA back.
    running: taskId != null && (taskStatus === null || taskActive),
    taskError,
    progressMsg,
    startError,
    run,
    form,
    patchForm,
    toggleFormConnector,
    dispatch,
    dispatching,
    dispatchError,
    refresh,
    refreshing,
    refreshNote,
  };
}

export type AgentFitLogic = ReturnType<typeof useAgentFitLogic>;
