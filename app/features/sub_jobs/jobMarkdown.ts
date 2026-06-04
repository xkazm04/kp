import { FAMILY_LABEL, splitRequirements, type Job } from "./JobsTypes";

const fmtSalary = (band?: number[]) =>
  band && band.length >= 2 ? `${band[0].toLocaleString("cs-CZ")} – ${band[1].toLocaleString("cs-CZ")} CZK / month` : null;

// Compose a job record into a clean, publish-ready Markdown document — the
// representative format a recruiter could paste to a job board.
export function jobToMarkdown(job: Job): string {
  const lines: string[] = [];
  lines.push(`# ${job.title}`);

  const metaBits = [
    job.company,
    job.location,
    job.workMode ? job.workMode[0].toUpperCase() + job.workMode.slice(1) : null,
    job.seniority ? `${job.seniority[0].toUpperCase()}${job.seniority.slice(1)} level` : null,
    job.employmentType ?? null,
  ].filter(Boolean);
  if (metaBits.length) lines.push(`**${metaBits.join(" · ")}**`);

  const salary = fmtSalary(job.salaryBand);
  if (salary) lines.push(`**Salary:** ${salary}`);

  if (job.description) {
    lines.push("");
    lines.push("## About the role");
    lines.push(job.description);
  }

  const { mustHaves: musts, niceToHaves: nices } = splitRequirements(job.requirements);
  if (musts.length) {
    lines.push("");
    lines.push("## What you'll bring");
    musts.forEach((s) => lines.push(`- ${s}`));
  }
  if (nices.length) {
    lines.push("");
    lines.push("## Nice to have");
    nices.forEach((s) => lines.push(`- ${s}`));
  }

  const details: string[] = [];
  if (job.minYearsExperience != null) details.push(`- **Experience:** ${job.minYearsExperience}+ years`);
  if (job.minEducation) details.push(`- **Education:** ${job.minEducation}`);
  if (job.languages?.length) details.push(`- **Languages:** ${job.languages.join(", ")}`);
  if (job.roleFamily) details.push(`- **Field:** ${FAMILY_LABEL[job.roleFamily] ?? job.roleFamily}`);
  if (details.length) {
    lines.push("");
    lines.push("## Details");
    lines.push(...details);
  }

  const ep = job.entryProfile;
  if (ep?.isEntryEligible) {
    lines.push("");
    lines.push("## Early-career welcome");
    lines.push(ep.rationale || "This role is open to early-career candidates — relevant projects and potential count.");
    if (ep.trainableGaps?.length) lines.push(`- **Trainable on the job:** ${ep.trainableGaps.join(", ")}`);
  }

  return lines.join("\n");
}
