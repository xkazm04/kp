import { splitRequirements, type Job } from "./JobsTypes";

const fmtSalary = (band?: number[]) =>
  band && band.length >= 2 ? `${band[0].toLocaleString("cs-CZ")} – ${band[1].toLocaleString("cs-CZ")} CZK / month` : null;

// JOB3 (i18n) — the heading/label table the publish-ready posting renders from.
// jobToMarkdown is the product's external output (the copy-to-job-board
// artifact), so a recruiter posting to a Czech board must be able to copy a
// Czech-scaffolded document even when the app runs in English. The strings live
// HERE (a tiny self-contained bilingual table) rather than in the message
// catalog so the Posting-tab language toggle can swap them without bundling the
// whole catalog into the client OR depending on the active app locale.
export type JobMarkdownStrings = {
  level: (seniority: string) => string;
  salary: string;
  aboutRole: string;
  whatBring: string;
  niceToHave: string;
  details: string;
  experienceLabel: string;
  experienceValue: (years: number) => string;
  education: string;
  languages: string;
  field: string;
  earlyWelcome: string;
  earlyDefault: string;
  trainable: string;
  familyLabel: Record<string, string>;
};

export const POSTING_LOCALES = ["en", "cs"] as const;
export type PostingLocale = (typeof POSTING_LOCALES)[number];

export const JOB_MARKDOWN_STRINGS: Record<PostingLocale, JobMarkdownStrings> = {
  en: {
    level: (s) => `${s[0].toUpperCase()}${s.slice(1)} level`,
    salary: "Salary:",
    aboutRole: "About the role",
    whatBring: "What you'll bring",
    niceToHave: "Nice to have",
    details: "Details",
    experienceLabel: "Experience:",
    experienceValue: (y) => `${y}+ years`,
    education: "Education:",
    languages: "Languages:",
    field: "Field:",
    earlyWelcome: "Early-career welcome",
    earlyDefault: "This role is open to early-career candidates — relevant projects and potential count.",
    trainable: "Trainable on the job:",
    familyLabel: { software_engineering: "Software", data_ai: "Data / AI", product_project: "Product / Project" },
  },
  cs: {
    level: (s) => `úroveň ${s}`,
    salary: "Mzda:",
    aboutRole: "O pozici",
    whatBring: "Co byste měli mít",
    niceToHave: "Výhodou",
    details: "Detaily",
    experienceLabel: "Praxe:",
    experienceValue: (y) => `${y}+ let`,
    education: "Vzdělání:",
    languages: "Jazyky:",
    field: "Obor:",
    earlyWelcome: "Vítáme začínající talenty",
    earlyDefault: "Tato pozice je otevřená i začínajícím kandidátům — záleží na relevantních projektech a potenciálu.",
    trainable: "Lze se doučit při práci:",
    familyLabel: { software_engineering: "Software", data_ai: "Data / AI", product_project: "Produkt / Projekt" },
  },
};

// Compose a job record into a clean, publish-ready Markdown document — the
// representative format a recruiter could paste to a job board. Pure: the
// heading/label table is passed in (JOB_MARKDOWN_STRINGS[locale]) so the same
// function renders either language. Recruiter-authored body text (description,
// requirement skills, the early-career rationale) is left verbatim — only the
// scaffolding localizes.
export function jobToMarkdown(job: Job, s: JobMarkdownStrings = JOB_MARKDOWN_STRINGS.en): string {
  const lines: string[] = [];
  lines.push(`# ${job.title}`);

  const metaBits = [
    job.company,
    job.location,
    job.workMode ? job.workMode[0].toUpperCase() + job.workMode.slice(1) : null,
    job.seniority ? s.level(job.seniority) : null,
    job.employmentType ?? null,
  ].filter(Boolean);
  if (metaBits.length) lines.push(`**${metaBits.join(" · ")}**`);

  const salary = fmtSalary(job.salaryBand);
  if (salary) lines.push(`**${s.salary}** ${salary}`);

  if (job.description) {
    lines.push("");
    lines.push(`## ${s.aboutRole}`);
    lines.push(job.description);
  }

  const { mustHaves: musts, niceToHaves: nices } = splitRequirements(job.requirements);
  if (musts.length) {
    lines.push("");
    lines.push(`## ${s.whatBring}`);
    musts.forEach((skill) => lines.push(`- ${skill}`));
  }
  if (nices.length) {
    lines.push("");
    lines.push(`## ${s.niceToHave}`);
    nices.forEach((skill) => lines.push(`- ${skill}`));
  }

  const details: string[] = [];
  if (job.minYearsExperience != null) details.push(`- **${s.experienceLabel}** ${s.experienceValue(job.minYearsExperience)}`);
  if (job.minEducation) details.push(`- **${s.education}** ${job.minEducation}`);
  if (job.languages?.length) details.push(`- **${s.languages}** ${job.languages.join(", ")}`);
  if (job.roleFamily) details.push(`- **${s.field}** ${s.familyLabel[job.roleFamily] ?? job.roleFamily}`);
  if (details.length) {
    lines.push("");
    lines.push(`## ${s.details}`);
    lines.push(...details);
  }

  const ep = job.entryProfile;
  if (ep?.isEntryEligible) {
    lines.push("");
    lines.push(`## ${s.earlyWelcome}`);
    lines.push(ep.rationale || s.earlyDefault);
    if (ep.trainableGaps?.length) lines.push(`- **${s.trainable}** ${ep.trainableGaps.join(", ")}`);
  }

  return lines.join("\n");
}
