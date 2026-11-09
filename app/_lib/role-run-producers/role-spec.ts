import { createHash } from "node:crypto";
import { getJob } from "../db/jobs.ts";
import { runJdBuild } from "../jd-build-run.ts";
import { validateJdBuildInput } from "../jd-limits.ts";
import { parseRoleSpec } from "../rolespec.ts";
import { DEFAULT_STAGE_RUNNERS, type StageContext, type StageOutcome, type StageRunner } from "../role-run-engine.ts";
import type { RoleSpecPayload } from "../role-run-stages.ts";
import type { RoleRunProducer } from "./index.ts";

// S0 - role_spec, backed by the AI JD builder (idea c6ea9e4a).
//
// REUSE FIRST. A run is per job, and most jobs already carry graded requirements (a
// published JD, an ingested ad, a promoted intake). Those ARE the rubric, and re-deriving
// them with a model would be spend that can only disagree with the standard the role was
// already published under. So the producer generates only when the job has no graded
// requirement at all - and then returns the ledger-safe payload, nothing more.
//
// WHAT IT DOES NOT DO. It does not write the generated spec back onto the job: the run's
// ledger is a record of what the run used, not an edit to the operator's JD. The payload
// says so honestly in `lintFindings` ("rubric_generated_from_description" - the job itself
// still states no graded requirement), and the keyless path's "no_graded_requirements"
// stays when the model produced none either.

/** The slice of runJdBuild this producer needs, injectable so no test spawns a CLI. */
export type JdBuildFn = (params: Record<string, unknown>, progress?: undefined, signal?: AbortSignal) => Promise<Record<string, unknown>>;

export type RoleSpecProducerDeps = {
  build?: JdBuildFn;
  /** The keyless runner used when the job already states its requirements, or when there
   *  is not enough text to design from. Defaults to the engine's own S0. */
  keyless?: StageRunner;
};

const slug = (k: string): string => k.trim().toLowerCase().replace(/\s+/g, "_");

export function roleSpecProducer(deps: RoleSpecProducerDeps = {}): RoleRunProducer {
  const build: JdBuildFn = deps.build ?? ((params, progress, signal) => runJdBuild(params, progress, signal));
  const keyless = deps.keyless ?? DEFAULT_STAGE_RUNNERS.role_spec;

  const run = async (ctx: StageContext): Promise<StageOutcome> => {
    const job = getJob(ctx.run.jobId);
    if (!job) return keyless(ctx); // terminal "job_not_found", exactly as the floor records it
    const stated = (Array.isArray(job.requirements) ? job.requirements : []).some((r) => typeof r?.skill === "string" && r.skill.trim());
    if (stated) return keyless(ctx); // reuse the run's existing JD: its requirements are the rubric

    const need = validateJdBuildInput(job.title, job.description);
    if (!need.ok) return keyless(ctx); // nothing to design from; the floor reports no_graded_requirements

    const built = await build({
      title: need.title,
      company: job.company,
      location: job.location,
      seniority: job.seniority,
      roleFamily: job.roleFamily,
      needText: need.needText,
      // The rubric only: no market research, no interview case, and no jdSlug, so nothing is persisted.
      options: { description: true, marketResearch: false, caseDesign: false },
    });
    const role = parseRoleSpec(built.role);
    const rubricKeys = (role.mustHaves ?? []).filter((k): k is string => typeof k === "string" && k.trim().length > 0).map(slug).slice(0, 40);
    const lintFindings = ["rubric_generated_from_description"];
    if (rubricKeys.length === 0) lintFindings.push("no_graded_requirements");
    if (!job.title?.trim()) lintFindings.push("no_title");
    return {
      status: "complete",
      payload: {
        jobId: ctx.run.jobId,
        roleSpecHash: createHash("sha256").update([ctx.run.jobId, job.title, rubricKeys.join(",")].join("|")).digest("hex").slice(0, 32),
        rubricVersion: "1",
        rubricKeys,
        lintFindings,
      } satisfies RoleSpecPayload,
    };
  };

  return { kind: "role_spec", usesLlm: true, run };
}
