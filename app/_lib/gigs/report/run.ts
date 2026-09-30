import { getGig, setGigReport } from "../../db/gigs";
import { listGigAttemptsForGig } from "../../db/gigs-attempts";
import { listGigOutcomes } from "../../db/gigs-outcomes";
import { listGigPlans } from "../../db/gigs-plans";
import { getGigSource } from "../../db/gigs-sources";
import { runPythonCli, type CliRunner } from "../../jobseeker/python-cli";
import { GIG_REPORT_STAGES, type Gig, type GigReport, type GigReportStage } from "../types";
import { assembleGigReport } from "./assemble";
import { buildGigReportFacts, type GigReportFacts } from "./facts";
import { gigReportPathFor, gigReportsRoot, writeGigReportFile } from "./file";
import { stageRank } from "./model";

// The `gig_report` task's body (late-bound-boot.ts registers it; nothing on the task hub
// imports it): read the gig's records, build the FACTS (facts.ts), hand them to the pinned
// report writer (pipeline/jobfit/gig_report_cli.py, use case `gig_report`, Claude Sonnet 5.5
// at high effort), sanitise and assemble its answer (assemble.ts), write the file atomically
// (file.ts) and record where it is and how current (db/gigs.ts setGigReport).
//
// The rules:
//   - no research brief -> nothing to report (`no_brief`, the gig's report is untouched);
//   - a report already `ready` at the stage the records say, generated after the newest
//     record it reads (facts.factsAt), is `current` and is not rewritten - unless `force`
//     (POST /api/gigs/[id]/report, the operator's "regenerate now");
//   - while it runs the record says `writing` (the previous file stays readable); it ends
//     `ready`, or `failed` with the reason when the file could not be written;
//   - a gig flagged as a honeypot (`suspect`) never reaches a model: its report is kp's own
//     (`gig_suspect`), like every other keyless / failed / unusable answer (deterministic.ts);
//   - when the gig moved to a LATER stage while the report was being written (a plan was
//     accepted during the call), the runner writes once more, so a burst of moves the task's
//     dedupe folded into one run still ends at the stage the records say.
//
// KEYLESS IS A DECISION, NOT A FAULT: the CLI answers `no_provider` (exit 0) and the report is
// written by kp from the facts, complete and honest, `source: "deterministic"`.

/** Kept in lockstep with gig_report_cli.py PROMPT_VERSION (report.test.ts reads both). */
export const GIG_REPORT_PROMPT_VERSION = "gig-report-v1";
/** The pinned writer (gig_report_cli.py PIN; llm-pins.ts mirrors it). */
export const GIG_REPORT_MODEL = "claude-sonnet-5-5";
/** One spawn's hang backstop, over the CLI's own deadline. */
export const GIG_REPORT_SPAWN_TIMEOUT_MS = 8 * 60_000;
/** The CLI's deadline, a minute under the spawn's kill. */
export const GIG_REPORT_CLI_TIMEOUT_S = 420;
/** Passes per run: the write, and one more when the gig moved on meanwhile. */
const MAX_PASSES = 2;

export type GigReportRunDeps = {
  runCli: CliRunner;
  getGig: typeof getGig;
  listGigPlans: typeof listGigPlans;
  listGigAttemptsForGig: typeof listGigAttemptsForGig;
  listGigOutcomes: typeof listGigOutcomes;
  getGigSource: typeof getGigSource;
  setGigReport: typeof setGigReport;
  writeFile: (file: string, html: string) => void;
  reportsRoot: () => string;
  now: () => Date;
  log: (line: string, error?: unknown) => void;
};

export function defaultGigReportRunDeps(): GigReportRunDeps {
  return {
    runCli: runPythonCli,
    getGig,
    listGigPlans,
    listGigAttemptsForGig,
    listGigOutcomes,
    getGigSource,
    setGigReport,
    writeFile: writeGigReportFile,
    reportsRoot: () => gigReportsRoot(),
    now: () => new Date(),
    log: (line, error) => (error === undefined ? console.warn(`[gigs:report] ${line}`) : console.error(`[gigs:report] ${line}`, error)),
  };
}

export type GigReportRunResult = {
  gigId: string;
  /** `written` = a file was written; `current` = the report already reflects the records;
   *  `skipped` = nothing to report (see `reason`); `failed` = the file could not be written. */
  status: "written" | "current" | "skipped" | "failed";
  reason: string | null;
  stage: GigReportStage | null;
  source: "llm" | "deterministic" | null;
  fallbackReason: string | null;
  costUsd: number | null;
  path: string | null;
};

export type GigReportTaskParams = { gigId: string; force: boolean; stage: GigReportStage | null };

/** The task's params, re-validated (a retry replays them from the row). Null without a gig. */
export function parseGigReportTaskParams(params: Record<string, unknown>): GigReportTaskParams | null {
  const gigId = typeof params.gigId === "string" && params.gigId.trim() && params.gigId.length <= 200 ? params.gigId : null;
  if (!gigId) return null;
  const stage = (GIG_REPORT_STAGES as readonly unknown[]).includes(params.stage) ? (params.stage as GigReportStage) : null;
  return { gigId, force: params.force === true, stage };
}

function costOf(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 1e6) / 1e6 : null;
}

function readFacts(workspaceId: string, gig: Gig, deps: GigReportRunDeps): GigReportFacts | null {
  return buildGigReportFacts({
    gig,
    plans: deps.listGigPlans(workspaceId, gig.id),
    attempts: deps.listGigAttemptsForGig(workspaceId, gig.id),
    outcomes: deps.listGigOutcomes(workspaceId, { gigId: gig.id }),
    source: gig.sourceId ? deps.getGigSource(workspaceId, gig.sourceId) : null,
    now: deps.now(),
  });
}

/** One pass: the model (or kp), the file, the record. Never throws. */
async function writePass(workspaceId: string, gig: Gig, facts: GigReportFacts, path: string, deps: GigReportRunDeps, signal: AbortSignal | undefined): Promise<GigReportRunResult> {
  const startedAt = deps.now().toISOString();
  const base: GigReport = gig.report ?? { path, stage: facts.stage, status: "writing", source: "deterministic", model: null, fallbackReason: null, costUsd: null, generatedAt: startedAt };
  try {
    deps.setGigReport(workspaceId, gig.id, { ...base, path, status: "writing" });
  } catch (error) {
    deps.log(`${gig.id}: could not mark the report writing`, error);
  }
  let modelResult: unknown = null;
  let fallbackReason: string | null = null;
  let costUsd: number | null = null;
  if (gig.status === "suspect") {
    fallbackReason = "gig_suspect";
  } else {
    try {
      const out = await deps.runCli({
        module: "gig_report_cli",
        files: { "input.json": { stage: facts.stage, track: facts.track, facts } },
        args: (f) => ["--input-json", f["input.json"], "--timeout-s", String(GIG_REPORT_CLI_TIMEOUT_S)],
        signal,
        llm: true,
        timeoutMs: GIG_REPORT_SPAWN_TIMEOUT_MS,
      });
      costUsd = costOf(out.costUsd);
      if (out.source === "llm" && out.result) modelResult = out.result;
      else fallbackReason = typeof out.fallbackReason === "string" && out.fallbackReason ? out.fallbackReason.slice(0, 120) : "llm_unusable";
    } catch (error) {
      fallbackReason = signal?.aborted ? "aborted" : "engine_error";
      deps.log(`${gig.id}: the report engine failed; kp writes the report itself`, error);
    }
  }
  const generatedAt = deps.now().toISOString();
  const assembled = assembleGigReport({ facts, modelResult, model: GIG_REPORT_MODEL, fallbackReason, costUsd, generatedAt });
  const record: GigReport = {
    path,
    stage: facts.stage,
    status: "ready",
    source: assembled.source,
    model: assembled.source === "llm" ? GIG_REPORT_MODEL : null,
    fallbackReason: assembled.fallbackReason,
    costUsd,
    generatedAt,
  };
  try {
    deps.writeFile(path, assembled.html);
  } catch (error) {
    deps.log(`${gig.id}: could not write the report file`, error);
    // The previous file (if any) is still there; the record says the rewrite failed.
    const failed: GigReport = { ...base, path, status: "failed", fallbackReason: "write_failed", costUsd };
    try {
      deps.setGigReport(workspaceId, gig.id, failed);
    } catch (storeError) {
      deps.log(`${gig.id}: could not record the failed report`, storeError);
    }
    return { gigId: gig.id, status: "failed", reason: "write_failed", stage: facts.stage, source: assembled.source, fallbackReason: "write_failed", costUsd, path };
  }
  try {
    deps.setGigReport(workspaceId, gig.id, record);
  } catch (error) {
    deps.log(`${gig.id}: the report was written but its record was not`, error);
  }
  return { gigId: gig.id, status: "written", reason: null, stage: facts.stage, source: assembled.source, fallbackReason: assembled.fallbackReason, costUsd, path };
}

/** Write (or refresh) one gig's report. See the header for the rules. Never throws. */
export async function runGigReport(
  workspaceId: string,
  gigId: string,
  opts: { force?: boolean; signal?: AbortSignal; deps?: Partial<GigReportRunDeps> } = {}
): Promise<GigReportRunResult> {
  const deps: GigReportRunDeps = { ...defaultGigReportRunDeps(), ...opts.deps };
  const none = (status: GigReportRunResult["status"], reason: string | null, stage: GigReportStage | null = null): GigReportRunResult => ({
    gigId,
    status,
    reason,
    stage,
    source: null,
    fallbackReason: null,
    costUsd: null,
    path: null,
  });
  let result: GigReportRunResult | null = null;
  let spent: number | null = null;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    if (opts.signal?.aborted) return result ?? none("skipped", "aborted");
    let gig: Gig | null;
    let facts: GigReportFacts | null;
    try {
      gig = deps.getGig(workspaceId, gigId);
      facts = gig ? readFacts(workspaceId, gig, deps) : null;
    } catch (error) {
      deps.log(`${gigId}: could not read the gig's records`, error);
      return result ?? none("failed", "store_error");
    }
    if (!gig) return result ?? none("skipped", "not_found");
    if (!facts) return result ?? none("skipped", "no_brief");
    const r = gig.report;
    const current = r !== null && r.status === "ready" && r.stage === facts.stage && r.generatedAt >= facts.factsAt;
    if (pass === 0 && current && !opts.force) return { ...none("current", null, facts.stage), source: r.source, fallbackReason: r.fallbackReason, path: r.path };
    // The second pass runs only when the gig reached a later stage during the first.
    if (pass > 0 && result && result.stage !== null && stageRank(facts.stage) <= stageRank(result.stage)) break;
    const path = gigReportPathFor(deps.reportsRoot(), gig);
    if (!path) return result ?? none("failed", "report_outside_root", facts.stage);
    result = await writePass(workspaceId, gig, facts, path, deps, opts.signal);
    if (result.costUsd !== null) spent = (spent ?? 0) + result.costUsd;
    if (result.status !== "written") break;
  }
  return result ? { ...result, costUsd: spent } : none("skipped", "aborted");
}
