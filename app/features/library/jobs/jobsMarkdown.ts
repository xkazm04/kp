import { APP_CURRENCY } from "@/app/_lib/format";
import { LOCALES, type Locale } from "@/i18n/locales";
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
// Czech-scaffolded document even when the app runs in English.
//
// DOCUMENT-READER side, and the repo's worked example of it: the language of a
// posting is a property of the POSTING (the tab's toggle), not of the app locale.
//
// F5 — the strings used to be a self-contained `Record<"en" | "cs", …>` table
// right here, so the toggle offered only two of the four languages and a de/fr
// recruiter was hard-coded back to English (jobsPostingModalLogic said so in a
// comment). They now come from `jobs.posting.doc.*` + the shared `enums.*` labels,
// resolved through a translator PINNED to the posting language —
// `buildJobMarkdownStrings` below, fed on the client by a lazily-imported catalog
// so the modal still doesn't bundle four catalogs up front.
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
  /** Display label for a role-family / seniority / work-mode slug, falling back to
   *  the raw slug. Backed by the shared `enums.*` catalog rather than a private
   *  3-entry map — the old table named only software/data/product, so a posting for
   *  any of the other THIRTEEN families printed the raw slug ("healthcare_clinical")
   *  onto a job board, and the work mode was hardcoded English ("Hybrid") even in
   *  the Czech posting. */
  enumLabel: (group: "family" | "seniority" | "workMode", slug: string) => string;
};

/** Postings can be copied in any language the app ships. */
export const POSTING_LOCALES = LOCALES;
export type PostingLocale = Locale;

// The BCP-47 tag each posting language groups its money figures with. A named
// constant, not copy: a translator must never be able to change how digits group.
// Not routed through format.ts's formatSalaryRange on purpose — see fmtSalary.
const NUMBER_LOCALE: Record<PostingLocale, string> = {
  en: "en-US",
  cs: "cs-CZ",
  de: "de-DE",
  fr: "fr-FR",
};

/** Minimal translator shape both call sites satisfy: the client's
 *  `useTranslations()` (root namespace, wrapped) and the locale-pinned
 *  `namespaceTranslator(locale)` from catalog-translator.ts. */
export type PostingLookup = {
  (key: string, values?: Record<string, string | number>): string;
  has: (key: string) => boolean;
};

/** Build the posting's strings table for `locale` from a translator pinned to it.
 *  `t` takes ROOT-level keys because the table spans two namespaces — the
 *  posting's own copy (`jobs.posting.doc.*`) and the shared enum labels
 *  (`enums.*`), which must read the same in a posting as they do in the app. */
export function buildJobMarkdownStrings(locale: PostingLocale, t: PostingLookup): JobMarkdownStrings {
  const doc = (key: string, values?: Record<string, string | number>) => t(`jobs.posting.doc.${key}`, values);
  const enumLabel: JobMarkdownStrings["enumLabel"] = (group, slug) => {
    const s = slug.trim();
    if (!s) return "";
    // A slug outside the taxonomy degrades to the slug itself (the prior behaviour
    // for an unmapped family), never to a raw "enums.family.foo" key path.
    const key = `enums.${group}.${s}`;
    return t.has(key) ? t(key) : s;
  };
  return {
    level: (s) => doc("level", { seniority: enumLabel("seniority", s) }),
    salary: doc("salary"),
    salaryEstimate: doc("salaryEstimate"),
    numberLocale: NUMBER_LOCALE[locale],
    // The currency comes from the app-wide APP_CURRENCY contract; the message only
    // decides how that unit READS. Czech spends its own glyph instead — the native
    // form in the market's home language, the same rule the Salary column header
    // already follows (messages/cs.json "Mzda (Kč/měs)") — so its message ignores
    // the placeholder on purpose.
    salaryUnit: doc("salaryUnit", { currency: APP_CURRENCY }),
    aboutRole: doc("aboutRole"),
    whatBring: doc("whatBring"),
    niceToHave: doc("niceToHave"),
    details: doc("details"),
    experienceLabel: doc("experienceLabel"),
    // Raw number into the ICU message: a pre-formatted string makes
    // intl-messageformat render the literal word NaN wherever the message pluralizes.
    experienceValue: (y) => doc("experienceValue", { years: y }),
    education: doc("education"),
    languages: doc("languages"),
    field: doc("field"),
    earlyWelcome: doc("earlyWelcome"),
    earlyDefault: doc("earlyDefault"),
    trainable: doc("trainable"),
    enumLabel,
  };
}

// Compose a job record into a clean, publish-ready Markdown document — the
// representative format a recruiter could paste to a job board. Pure: the
// heading/label table is passed in (buildJobMarkdownStrings for the posting's
// language) so the same function renders any of the four. Recruiter-authored body
// text (description, requirement skills, the early-career rationale) is left
// verbatim — only the scaffolding localizes.
export function jobToMarkdown(job: Job, s: JobMarkdownStrings): string {
  const lines: string[] = [];
  lines.push(`# ${job.title}`);

  const metaBits = [
    job.company,
    job.location,
    job.workMode ? s.enumLabel("workMode", job.workMode) : null,
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
  if (job.roleFamily) details.push(`- **${s.field}** ${s.enumLabel("family", job.roleFamily)}`);
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
