// A company JD format template (Phase 1, minimal). Applies a branded, structured
// format to a role so the published JD reads like a real posting. A fuller
// "manage templates" feature (CRUD of multiple company formats) is a follow-up.
//
// i18n: this module owns no copy. Every heading and prose line arrives through
// `copy`, which the caller reads from the `simulation.jd.*` catalog — the guided
// demo is the public "Try the live demo" surface, so a Czech/German/French
// prospect must not land in an English job posting. The money line goes through
// the shared presentation seam (formatSalaryRange) rather than a local
// toLocaleString + hardcoded "CZK" + hand-rolled en dash, so the demo JD renders
// its band with the same grouping, dash and currency as every other salary in
// the app.
import { formatSalaryRange } from "@/app/_lib/format";

/** The localized text of a rendered JD: section headings + the three prose lines
 *  the template contributes itself (the role's own bullets come from the caller). */
export type CompanyTemplateCopy = {
  aboutHeading: string;
  roleHeading: string;
  lookingForHeading: string;
  niceToHaveHeading: string;
  weOfferHeading: string;
  howToApplyHeading: string;
  /** Default "about us" paragraph, already interpolated with the company name. */
  aboutBody: string;
  weOfferBody: string;
  howToApplyBody: string;
  /** Salary cadence appended to the band, e.g. "mo" -> "… CZK / mo". */
  period: string;
  /** The active UI locale, so the band's digit grouping matches the rest of the
   *  rendered JD (see the number-locale contract in app/_lib/format.ts). */
  locale: string;
};

export function applyCompanyTemplate(opts: {
  title: string;
  company: string;
  seniority?: string;
  about?: string;
  responsibilities: string[];
  mustHaves: string[];
  niceToHaves: string[];
  salaryBand?: [number, number];
  /** Omit to inherit the app currency (APP_CURRENCY) — the app does not do FX. */
  currency?: string;
  copy: CompanyTemplateCopy;
}): string {
  const { copy } = opts;
  const band = opts.salaryBand
    ? formatSalaryRange(opts.salaryBand[0], opts.salaryBand[1], {
        currency: opts.currency,
        period: copy.period,
        locale: copy.locale,
      })
    : null;
  return [
    `# ${opts.title}`,
    `**${opts.company}**${opts.seniority ? ` · ${opts.seniority}` : ""}${band ? ` · ${band}` : ""}`,
    "",
    `## ${copy.aboutHeading}`,
    opts.about ?? copy.aboutBody,
    "",
    `## ${copy.roleHeading}`,
    ...opts.responsibilities.map((r) => `- ${r}`),
    "",
    `## ${copy.lookingForHeading}`,
    ...opts.mustHaves.map((s) => `- ${s}`),
    "",
    `## ${copy.niceToHaveHeading}`,
    ...opts.niceToHaves.map((s) => `- ${s}`),
    "",
    `## ${copy.weOfferHeading}`,
    `- ${copy.weOfferBody}`,
    "",
    `## ${copy.howToApplyHeading}`,
    `- ${copy.howToApplyBody}`,
  ].join("\n");
}
