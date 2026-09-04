import { writeFile } from "node:fs/promises";
import path from "node:path";
import { saveAgentFitSpec, type AgentFitSpecRecord } from "../db/agents";
import { getJob } from "../db/jobs";
import { DEFAULT_WORKSPACE_ID, getWorkspaceDefaultLocale } from "../db/workspaces";
import type { Locale } from "@/i18n/locales";
import { buildLlmConfigEnv } from "../llm-config";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "../python-runner";
import { fetchConnectorCatalog } from "./bridge-client";

// Job → AgentFitSpec transform runner (WP1). The runDevcaseCli envelope, one
// verb: write the job + connector catalog into a temp workdir, spawn
// `python -m pipeline.jobfit.agentfit_cli`, parse the uniform provenance
// envelope, persist the artifact (agent_fit_specs — the saveCampaignPack
// durable-per-job pattern), and always clean the workdir up. Runs as the
// `agent_fit` background task kind (tasks.ts) started by
// POST /api/jobs/[id]/agent-fit.

export type AgentFitPayload = {
  fit: { verdict: string; coverage: { item: string; coverage: string; rationale: string }[]; coverageRatio: number };
  spec: { name: string; mission: string; systemPromptDraft: string; connectors: string[]; maxTurns: number | null };
  budget: { suggestedMonthlyUsd: number | null; rule: string; salaryBandRef: string };
  metrics: { key: string; label: string; target: number; unit: string; direction: string }[];
  promptVersion?: string;
};

export type AgentFitResult = {
  record: AgentFitSpecRecord;
  result: AgentFitPayload;
  source: string;
  perStepSources: Record<string, string>;
  fallbackReason: Record<string, string>;
  /** Where the connector catalog came from: the live Personas app or the built-in list. */
  catalogSource: "personas" | "builtin";
};

type CliEnvelope = {
  result: AgentFitPayload;
  source: string;
  perStepSources?: Record<string, string>;
  fallbackReason?: Record<string, string>;
};

/** Shape-check + normalize the CLI envelope (exported pure so the parse contract
 *  is unit-testable without spawning Python). Throws on a malformed envelope —
 *  the task runner surfaces that as a failed run, never a half-persisted spec. */
export function toAgentFitEnvelope(payload: unknown): CliEnvelope {
  const p = payload as CliEnvelope | null;
  const r = p?.result;
  if (!r || typeof r !== "object" || !r.fit || !r.spec || !r.budget || !Array.isArray(r.metrics)) {
    throw new Error("agentfit_cli returned an unexpected envelope (missing fit/spec/budget/metrics).");
  }
  if (!Array.isArray(r.spec.connectors)) {
    throw new Error("agentfit_cli returned an unexpected envelope (spec.connectors is not a list).");
  }
  return {
    result: r,
    source: typeof p.source === "string" ? p.source : "deterministic",
    perStepSources: p.perStepSources ?? {},
    fallbackReason: p.fallbackReason ?? {},
  };
}

/** The CLI's argv, built where it can be read without spawning anything.
 *
 *  `--lang` is the reason this is a function: `agentfit_cli` has accepted it
 *  since it shipped (`parser.add_argument("--lang", ... default="en")`) and this
 *  runner never passed it, so every agent spec — the mission, the system-prompt
 *  draft, the coverage rationales — was drafted in English no matter what the
 *  workspace speaks. Threaded the way every other runner here does it
 *  (`intake-run.ts`, `campaign-run.ts`, `devcase-run.ts`). */
export function agentFitArgs(jobPath: string, catalogPath: string, lang: Locale): string[] {
  return ["-m", "pipeline.jobfit.agentfit_cli", "--job-json", jobPath, "--catalog-json", catalogPath, "--lang", lang];
}

export async function runAgentFit(
  jobId: string,
  signal?: AbortSignal,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // Resolved from the workspace rather than required, so the background task
  // runner (tasks.ts, kind "agent_fit") keeps its three-argument call and still
  // stops producing English specs for a Czech tenant.
  lang: Locale = getWorkspaceDefaultLocale(workspaceId)
): Promise<AgentFitResult> {
  const job = getJob(jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);
  // The catalog degrades to the built-in list when Personas is unpaired/down —
  // the transform itself must never depend on the bridge being alive.
  const catalog = await fetchConnectorCatalog();

  const workdir = await createWorkdir();
  try {
    const jobPath = path.join(workdir, "job.json");
    const catalogPath = path.join(workdir, "catalog.json");
    await writeFile(jobPath, JSON.stringify(job), "utf-8");
    await writeFile(catalogPath, JSON.stringify(catalog.connectors), "utf-8");
    // KP_LLM_CONFIG so the agent_fit use case resolves BYOM keys / model routing.
    const { result } = spawnPython(agentFitArgs(jobPath, catalogPath, lang), { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const envelope = toAgentFitEnvelope(parsePythonJson<unknown>(stdout, stderr));

    const record = saveAgentFitSpec(
      {
        jobId,
        fit: envelope.result.fit,
        spec: envelope.result.spec,
        budget: envelope.result.budget,
        metrics: envelope.result.metrics,
        source: envelope.source,
      },
      workspaceId
    );
    return {
      record,
      result: envelope.result,
      source: envelope.source,
      perStepSources: envelope.perStepSources ?? {},
      fallbackReason: envelope.fallbackReason ?? {},
      catalogSource: catalog.source,
    };
  } finally {
    await cleanupWorkdir(workdir);
  }
}
