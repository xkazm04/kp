import { APP_CURRENCY } from "@/app/_lib/format";
import { splitRequirements, type Job } from "./JobsTypes";

// The band's unit and its digit grouping are POSTING-language scaffolding, exactly
// like every heading below — they belong in the strings table, not in a literal.
// They used to be hardcoded (`toLocaleString("cs-CZ")` + "CZK / month") so the
// English posting emitted Czech digit grouping and the CZECH posting told a Czech
// job board "CZK / month". The currency itself comes from the app-wide APP_CURRENCY
// contract (see the Job.salaryBand doc + format.ts) so a single deployment constant
// still governs it; the table only decides how that unit READS in each language —
// the same rule Python states in market_config.currency_unit ("Kč/měsíc" for a Czech
// reader, the ISO code for everyone else).
//
// Not routed through format.ts's formatSalaryRange on purpose: that helper pins ONE
// grouping locale for the in-app typographic rhythm, while this is an external
// artifact whose language is the posting toggle's, not the app's.
const fmtSalary = (band: number[] | undefined, s: JobMarkdownStrings) =>
  band && band.length >= 2
    ? `${band[0].toLocaleString(s.numberLocale)} – ${band[1].toLocaleString(s.numberLocale)} ${s.salaryUnit}`
    : null;

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
  salaryEstimate: string;
  /** BCP-47 tag the posting's money figures are digit-grouped with. */
  numberLocale: string;
  /** The salary band's unit suffix — currency + pay period — in this language. */
  salaryUnit: string;
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
    salaryEstimate: "Salary (market estimate):",
    numberLocale: "en-US",
    salaryUnit: `${APP_CURRENCY} / month`,
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
    salaryEstimate: "Mzda (tržní odhad):",
    numberLocale: "cs-CZ",
    // The native glyph in the market's home language — the same rule the Salary
    // column header already follows (messages/cs.json "Mzda (Kč/měs)").
    salaryUnit: "Kč / měsíc",
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

  // A band normalize_job anchored from the taxonomy because the ad stated no pay
  // ("salary_band" in defaultedFields) is a market ESTIMATE — labeled as such, so
  // the published posting never presents it as the employer's stated salary.
  const salary = fmtSalary(job.salaryBand, s);
  if (salary) lines.push(`**${job.defaultedFields?.includes("salary_band") ? s.salaryEstimate : s.salary}** ${salary}`);

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
