import { writeFile } from "node:fs/promises";
import path from "node:path";
import { canWriteJobLifecycle, getJob } from "./db/jobs";
import { promotedBriefForJob } from "./db/intakes";
import { interviewKitAppendVersion } from "./db/interview-kits";
import { DEFAULT_WORKSPACE_ID, getWorkspaceDefaultLocale } from "./db/workspaces";
import { briefDealbreakerEvidence, briefOutcomeEvidence } from "./intake-brief";
import { buildLlmConfigEnv } from "./llm-config";
import { normalizeInterviewKit, type KitAdjustment, type KitRejection } from "./interview-kit-validate";
import { cleanupWorkdir, createWorkdir, parsePythonJson, parseStderrError, PipelineError, spawnPython } from "./python-runner";
import type { RoleBrief } from "./rolespec";
import type { StoredInterviewKit } from "./interview-kit-types";
import type { Locale } from "@/i18n/locales";

// Generate the FIRST version of a job's interview kit (spark interview-kit-template,
// WP-A). The `runAgentFit` envelope, one verb: write the job + its promoted RoleBrief
// into a temp workdir, spawn `automation_cli interview-kit`, coerce the envelope,
// normalize it through the same trust boundary a recruiter's own edit goes through, and
// append it as a DRAFT version. Runs as the `interview_kit` background task (tasks.ts),
// started by POST /api/jobs/[id]/interview-kit.
//
// A GENERATED VERSION IS NEVER AUTO-PUBLISHED. Publishing is what decides which kit new
// candidate links mint from — i.e. what real people are about to be asked — and the whole
// point of the versioned table is that a machine's draft cannot become the live kit
// without a human saying so. The draft lands beside whatever is already published; the
// live interview keeps running the published version until someone publishes this one.
//
// KEYLESS IS A SUPPORTED PATH, not a failure mode: `automation.interview_kit`'s
// `deterministic()` builds a kit from the role's own stated requirements when no provider
// is configured, and `source` on the result says which of the two served.

export type InterviewKitPayload = {
  competencies: unknown;
  faq?: unknown;
  note?: unknown;
  promptVersion?: string;
};

export type InterviewKitRunResult = {
  /** The saved DRAFT version. */
  record: StoredInterviewKit;
  /** `llm` when the model's own kit survived coercion, `deterministic` when the keyless
   *  template served. The stored row's `source` is a different axis — it says
   *  generated-vs-edited, not which engine generated it. */
  source: string;
  /** Repairs the normalizer made on the way in (a cap trimmed, an id minted). Empty on
   *  the normal path; surfaced so a caller can say what changed rather than implying the
   *  model wrote exactly this. */
  adjusted: KitAdjustment[];
  promptVersion: string | null;
};

/** Raised when the generator's output cannot be stored as a kit. Distinct from a spawn
 *  failure so the caller can say "the model answered, and its answer was unusable" —
 *  which is a different operator action (re-run / author by hand) from "the engine is
 *  down". */
export class InterviewKitGenerationError extends Error {
  readonly reason: KitRejection;
  constructor(reason: KitRejection) {
    super(`the generated interview kit was not usable: ${reason}`);
    this.name = "InterviewKitGenerationError";
    this.reason = reason;
  }
}

type CliEnvelope = { result: InterviewKitPayload; source: string };

/** Shape-check the CLI envelope. Exported pure so the parse contract is unit-testable
 *  without spawning Python (the `toAgentFitEnvelope` precedent). Throws on a malformed
 *  envelope — the task surfaces that as a failed run, never a half-saved kit. */
export function toInterviewKitEnvelope(payload: unknown): CliEnvelope {
  const p = payload as CliEnvelope | null;
  const r = p?.result;
  if (!r || typeof r !== "object" || !Array.isArray((r as InterviewKitPayload).competencies)) {
    throw new Error("automation_cli interview-kit returned an unexpected envelope (missing result.competencies).");
  }
  return { result: r, source: typeof p.source === "string" ? p.source : "deterministic" };
}

/** The CLI's argv, built where it can be read without spawning anything. `--brief-json`
 *  is omitted rather than pointed at an empty file when the role never went through an
 *  intake: "no brief" and "an empty brief" must not look the same to the prompt. */
export function interviewKitArgs(jobPath: string, briefPath: string | null, lang: Locale): string[] {
  return [
    "-m",
    "pipeline.jobfit.automation_cli",
    "interview-kit",
    "--job-json",
    jobPath,
    ...(briefPath ? ["--brief-json", briefPath] : []),
    "--lang",
    lang,
  ];
}

/** The slice of a promoted RoleBrief the kit is authored from: the requestor's own words
 *  about what the role must ACHIEVE, which is what a competency is supposed to name.
 *  Deliberately not the whole brief — the per-requirement rationale/provenance/confidence
 *  fields are intake bookkeeping, and the facets carry free prose that has no business
 *  steering what a candidate is asked. */
export function kitBriefProjection(brief: RoleBrief | null): Record<string, unknown> | null {
  if (!brief) return null;
  const projection = {
    summary: typeof brief.summary === "string" ? brief.summary : "",
    responsibilities: (brief.responsibilities ?? []).filter((r): r is string => typeof r === "string" && !!r.trim()),
    successCriteria: (brief.successCriteria ?? []).filter((s): s is string => typeof s === "string" && !!s.trim()),
    // Both read through the intake-brief projections rather than off the brief's raw
    // fields, so the kit sees the same dealbreakers and 90-day outcomes the JD build and
    // the devcase chain do — from BOTH homes (requirements and facets).
    dealbreakers: briefDealbreakerEvidence(brief),
    outcomes: briefOutcomeEvidence(brief),
  };
  const empty =
    !projection.summary &&
    projection.responsibilities.length === 0 &&
    projection.successCriteria.length === 0 &&
    projection.dealbreakers.length === 0 &&
    projection.outcomes.length === 0;
  return empty ? null : projection;
}

export async function runInterviewKit(
  jobId: string,
  signal?: AbortSignal,
  workspaceId: string = DEFAULT_WORKSPACE_ID,
  // Resolved from the workspace rather than required, so the background task runner
  // (tasks.ts, kind "interview_kit") keeps its three-argument call and a Czech tenant
  // does not get an English kit read aloud to Czech candidates.
  lang: Locale = getWorkspaceDefaultLocale(workspaceId)
): Promise<InterviewKitRunResult> {
  const job = getJob(jobId);
  // OWNERSHIP, asserted here and not only at the route. This runner is also reachable
  // through POST /api/tasks, which starts any known kind with CLIENT-SUPPLIED params — so
  // the route's own gate is not the only door, and `getJob` is an unscoped by-id read.
  // Without this, a team could name another team's private role, spend its own model
  // call on it, and read that role's requirements and stated facts back out of the task
  // result as a kit. Same predicate the route uses, and the same "unknown" answer for a
  // role this team cannot see (the evaluate_submission / lifecycle doctrine in tasks.ts).
  if (!job || !canWriteJobLifecycle(jobId, workspaceId)) throw new Error(`job not found: ${jobId}`);
  // Scoped to the SAME team the kit is filed under: `promotedBriefForJob` is a
  // workspace-filtered read, so a shared corpus role simply has no brief here rather
  // than picking up another tenant's intake conversation.
  const brief = kitBriefProjection(promotedBriefForJob(jobId, workspaceId));

  const workdir = await createWorkdir();
  try {
    const jobPath = path.join(workdir, "job.json");
    const briefPath = brief ? path.join(workdir, "brief.json") : null;
    await writeFile(jobPath, JSON.stringify(job), "utf-8");
    if (briefPath) await writeFile(briefPath, JSON.stringify(brief), "utf-8");
    // KP_LLM_CONFIG so the `automation` use case resolves the admin's BYOM key / routing.
    const { result } = spawnPython(interviewKitArgs(jobPath, briefPath, lang), { signal, env: buildLlmConfigEnv() });
    const { stdout, stderr, exitCode } = await result;
    if (exitCode !== 0) throw new PipelineError(parseStderrError(stderr, exitCode));
    const envelope = toInterviewKitEnvelope(parsePythonJson<unknown>(stdout, stderr));

    // The generator's output crosses the SAME boundary a browser's PUT does. Python's
    // coercer already caps and defaults everything, so a refusal here means the envelope
    // was structurally empty — worth failing the run for rather than storing.
    const normalized = normalizeInterviewKit(envelope.result);
    if (!normalized.ok) throw new InterviewKitGenerationError(normalized.reason);

    const record = interviewKitAppendVersion(
      { jobId, kit: normalized.kit, source: "generated", status: "draft" },
      workspaceId
    );
    return {
      record,
      source: envelope.source,
      adjusted: normalized.adjusted,
      promptVersion: typeof envelope.result.promptVersion === "string" ? envelope.result.promptVersion : null,
    };
  } finally {
    await cleanupWorkdir(workdir);
  }
}
