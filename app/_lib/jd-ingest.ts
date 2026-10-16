import { insertJob, jobContentHash, normalizeJob } from "@/app/_lib/job-ingest";
import { normalizeSalaryBand, withGroundedBand } from "@/app/_lib/salary-band";
import { jdJobId } from "@/app/_lib/jd-limits";
import { DEFAULT_WORKSPACE_ID } from "@/app/_lib/db/workspaces";
import { parseRoleSpec } from "@/app/_lib/rolespec";

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
}, workspaceId: string = DEFAULT_WORKSPACE_ID): Promise<boolean> {
  // Trust-boundary parse (client-sent on POST /api/jds/save): a malformed role
  // degrades to {} instead of crashing the `.map` calls below via a blind cast.
  const role = parseRoleSpec(input.role);
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

  const { job: parsed } = await normalizeJob(record, jdJobId(input.slug));
  // The matchable band is FIXED to the AI/market analysis's salary, on purpose:
  // it carries that analysis's provenance, confidence, and cited sources, so a
  // hand-typed override (e.g. a number edited into the JD markdown) is NOT honored
  // here — that would let an arbitrary figure masquerade as web-grounded research.
  // The Ledger detail's salary card is read-only and says so (LibrarySavedJdsLedger's
  // SalaryCard); editing the salary line in the markdown changes the published wording only.
  // Clamp/swap a backwards or non-positive band rather than dropping it, so the
  // matchable Job's band never silently disagrees with the analysis it came from.
  // `withGroundedBand` is the ONE place that rule is written — the edit-time
  // re-sync in PATCH /api/jds/[slug] applies the same helper, so the band the
  // first ingest pinned survives every later wording edit.
  const band = normalizeSalaryBand(input.salary?.suggestedMinimum, input.salary?.suggestedMaximum);
  const job = withGroundedBand(parsed, band);

  // Authored JDs start as a DRAFT — "Source into Pipeline" takes them live and
  // sources them into the pipeline.
  insertJob(job, jobContentHash(`${input.title}\n${input.markdown}`), "draft", workspaceId);
  return true;
}
