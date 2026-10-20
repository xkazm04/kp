import type { CatalogTranslator } from "./catalog-translator";
import { competencyKey } from "./interview-rubric";
import type { LetterOutcome } from "./interview-letter-policy";

// The KEYLESS interview feedback letter (spark interview-feedback-letter, WP-alpha): the
// deterministic draft a recruiter receives when no model is configured, or when the model's
// letter was discarded (pipeline/jobfit/automation.py `letter_problem`).
//
// EVERY WORD IS CATALOG COPY. The sentences come from `interviewLetter.template.*` in the
// candidate's language, and the competency names from `rubric.competency.<key>.label` —
// the same localized labels the recruiter's scorecard shows. A name the rubric catalog
// does not know is DROPPED, never printed: the names arrive from the drafting CLI, and this
// is the last gate that guarantees nothing a candidate said, and no rating, can reach the
// letter through the keyless path. The one interpolated value that is not catalog copy is
// the role's title — the company's own words about its opening.
//
// Honest by construction, per the registry (rejection-with-dignity): a list the record left
// empty renders nothing — no generic advice fills the slot — and a record with no areas at
// all says so in one plain sentence instead of guessing.
//
// It reads as a template and says so by being plain: `source: "template"` rides on the
// stored draft, so the recruiter reviewing it is told nobody wrote it for this person.

export type LetterTemplateInput = {
  outcome: LetterOutcome;
  /** The role's title, or null when the entry carries none. */
  jobTitle: string | null;
  /** Canonical rubric competency names (automation.letter_evidence), strongest first. */
  wentWell: readonly string[];
  /** Canonical rubric competency names, weakest first. */
  toWorkOn: readonly string[];
};

/** A canonical competency name → its localized rubric label, or null when the catalog does
 *  not know it. `rubric` is a translator for the `rubric.competency` namespace. */
export function letterAreaLabel(name: unknown, rubric: CatalogTranslator): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  const key = `${competencyKey(name)}.label`;
  return rubric.has(key) ? rubric(key) : null;
}

function labels(names: readonly string[], rubric: CatalogTranslator): string[] {
  const out: string[] = [];
  for (const name of names) {
    const label = letterAreaLabel(name, rubric);
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/**
 * Assemble the letter. `t` is a translator for `interviewLetter.template`, `rubric` one for
 * `rubric.competency`, both pinned to the LETTER's language (namespaceTranslator), never the
 * request's.
 *
 * Layout: greeting · thanks + frame · what went well · what to work on (or the one
 * no-specifics line) · close · sign-off. The OUTCOME changes only the frame and the close;
 * the areas are the same record either way.
 */
export function buildInterviewLetterTemplate(input: LetterTemplateInput, t: CatalogTranslator, rubric: CatalogTranslator): string {
  const hired = input.outcome === "hired";
  const role = typeof input.jobTitle === "string" ? input.jobTitle.trim() : "";
  const wentWell = labels(input.wentWell, rubric);
  const toWorkOn = labels(input.toWorkOn, rubric).filter((label) => !wentWell.includes(label));

  const paragraphs: string[] = [
    t("greeting"),
    `${role ? t("thanksRole", { role }) : t("thanks")} ${hired ? t("frameHired") : t("frameNotSelected")}`,
  ];
  if (wentWell.length > 0) paragraphs.push([t("wentWellIntro"), ...wentWell.map((area) => t("bullet", { area }))].join("\n"));
  if (toWorkOn.length > 0) paragraphs.push([t("toWorkOnIntro"), ...toWorkOn.map((area) => t("bullet", { area }))].join("\n"));
  if (wentWell.length === 0 && toWorkOn.length === 0) paragraphs.push(t("noSpecifics"));
  paragraphs.push(hired ? t("closeHired") : t("closeNotSelected"), t("signoff"));
  return paragraphs.join("\n\n");
}
