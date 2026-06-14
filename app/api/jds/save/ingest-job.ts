import { insertJob, jobContentHash, normalizeJob } from "@/app/_lib/job-ingest";
import { normalizeSalaryBand } from "@/app/_lib/salary-band";
import { jdJobId } from "@/app/_lib/jd-limits";
import type { RoleSpec } from "@/app/_lib/jd-build-run";

// Turn a generated JD's role into a structured, matchable Job: build a record
// from the RoleSpec, normalize it deterministically (salary band, requirements,
// entry profile), override the band with the grounded salary, and upsert it.
export async function ingestStructuredJob(input: {
  slug: string;
  title: string;
  markdown: string;
  role: Record<string, unknown>;
  salary?: { suggestedMinimum?: number; suggestedMaximum?: number };
  company?: string;
}): Promise<boolean> {
  const role = input.role as RoleSpec;
  const record: Record<string, unknown> = {
    title: input.title,
    seniority: role.seniority ?? "medior",
    role_family: role.roleFamily ?? "software_engineering",
    company: input.company || undefined,
    languages: role.languages ?? [],
    description: (role.responsibilities ?? []).join("; "),
    requirements: [
      ...(role.mustHaves ?? []).map((s) => ({ skill: s, kind: "must_have" })),
      ...(role.niceToHaves ?? []).map((s) => ({ skill: s, kind: "nice_to_have" })),
    ],
    source: "authored_jd",
  };

  const { job } = await normalizeJob(record, jdJobId(input.slug));
  // The matchable band is FIXED to the AI/market analysis's salary, on purpose:
  // it carries that analysis's provenance, confidence, and cited sources, so a
  // hand-typed override (e.g. a number edited into the JD markdown) is NOT honored
  // here — that would let an arbitrary figure masquerade as web-grounded research.
  // The builder's salary card is read-only and says so (JdBuilderResult.tsx);
  // editing the salary line in the markdown changes the published wording only.
  // Clamp/swap a backwards or non-positive band rather than dropping it, so the
  // matchable Job's band never silently disagrees with the analysis it came from.
  const band = normalizeSalaryBand(input.salary?.suggestedMinimum, input.salary?.suggestedMaximum);
  if (band) job.salaryBand = band;

  // Authored JDs start as a DRAFT — "Source into Pipeline" takes them live and
  // sources them into the pipeline.
  insertJob(job, jobContentHash(`${input.title}\n${input.markdown}`), "draft");
  return true;
}
