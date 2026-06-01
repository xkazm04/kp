import { insertJob, jobContentHash, normalizeJob } from "@/app/_lib/job-ingest";
import { normalizeSalaryBand } from "@/app/_lib/salary-band";

type RoleSpec = {
  title?: string;
  seniority?: string;
  roleFamily?: string;
  mustHaves?: string[];
  niceToHaves?: string[];
  responsibilities?: string[];
  languages?: string[];
};

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

  const { job } = await normalizeJob(record, `jd-${input.slug}`);
  // Clamp/swap a backwards or non-positive band rather than dropping it, so the
  // matchable Job's band never silently disagrees with the published JD.
  const band = normalizeSalaryBand(input.salary?.suggestedMinimum, input.salary?.suggestedMaximum);
  if (band) job.salaryBand = band;

  // Authored JDs start as a DRAFT — publishing sources them into the pipeline.
  insertJob(job, jobContentHash(`${input.title}\n${input.markdown}`), "draft");
  return true;
}
