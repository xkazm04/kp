// Auto-feedback brief for non-promoted dev-case candidates (idea-d142462d). At
// the ranked stage the orchestrator emails ONLY promoted candidates; everyone
// below the floor is silently dropped — classic take-home ghosting. The evaluator
// already computed each submission's strengths + concerns + transfer gaps, so a
// short, kind, NON-ADVERSE strengths/growth brief can be assembled for free and
// queued for the recruiter to send. The brief deliberately carries NO rejection
// wording ("unsuccessful", "not selected", …): the adverse decision stays
// human-gated; this only turns the work the candidate already did into useful,
// respectful feedback.
//
// Written in the CANDIDATE's language, not the recruiter's — this letter goes to
// them, so it resolves through the locale-pinned `comms` translator rather than
// useTranslations() (see comms-translator.ts). Until this pass the entire letter
// was hardcoded English with no translator at all, in all four locales.
//
// No longer import-free, so the wording contract is pinned by rendering every
// key against the real catalogs in devcase-feedback.test.ts.

import { resolveCommsLocale } from "./comms-locale";
import { commsTranslator } from "./comms-translator";

export type FeedbackInput = {
  candidateRef: string;
  roleTitle?: string | null;
  strengths: string[];
  concerns: string[];
  gaps: string[];
  /** The candidate's locale, carried on their pipeline entry. */
  locale?: string | null;
  /**
   * The language the BULLETS are actually written in — `narrativeLang`, stamped by the
   * Python evaluator onto the evaluation/transfer artifacts (evaluate.py).
   *
   * The frame of this letter is localized and the bullets are not translated here: they
   * are the evaluator's own sentences, and re-translating a scored finding client-side
   * would put words in the assessment's mouth. So when the two disagree — a bundle
   * scored before the evaluator took a language, or one whose lifecycle carried no
   * locale — the letter SAYS SO with a one-line engine note rather than presenting
   * English findings under a Czech heading as if they had been written for this reader.
   * Absent/unknown is treated as a mismatch only when the reader's locale is not the
   * evaluator's default (en); an all-English letter needs no note.
   */
  narrativeLang?: string | null;
};

export type FeedbackBrief = { subject: string; body: string };

const clean = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);

export async function buildFeedbackBrief(input: FeedbackInput): Promise<FeedbackBrief> {
  const t = await commsTranslator(input.locale);
  // The locale the letter is being WRITTEN in — resolved the same way commsTranslator
  // resolves it, so the comparison below is against the language the reader actually
  // gets rather than against the raw (possibly null) input.
  const letterLocale = resolveCommsLocale(input.locale);
  const bulletLang = (input.narrativeLang ?? "").trim().toLowerCase().split("-")[0];
  // An ABSENT stamp is "no claim", never "English": a bundle scored before the evaluator
  // took a language carries no narrativeLang, and guessing one would let us print a
  // confident note about a language nobody recorded. Only a stamp that disagrees speaks.
  const bulletsAreForeign = bulletLang !== "" && bulletLang !== letterLocale;
  const role = (input.roleTitle ?? "").trim();
  const strengths = clean(input.strengths);
  // Concerns + transfer gaps both become forward-looking "areas to keep growing"
  // — reframed as development, never as a verdict on the person.
  const growth = clean([...input.concerns, ...input.gaps]);

  // Role-titled and untitled variants are separate keys rather than one message
  // with an optional insert: several languages need a different case or word
  // order once the role name appears.
  const subject = role ? t("devcaseFeedback.subjectRole", { role }) : t("devcaseFeedback.subject");

  const lines: string[] = [];
  lines.push(t("devcaseFeedback.greeting", { name: input.candidateRef || t("devcaseFeedback.greetingFallback") }));
  lines.push("");
  lines.push(role ? t("devcaseFeedback.introRole", { role }) : t("devcaseFeedback.intro"));
  if (strengths.length > 0) {
    lines.push("");
    lines.push(t("devcaseFeedback.strengthsHeading"));
    for (const s of strengths) lines.push(`- ${s}`);
  }
  if (growth.length > 0) {
    lines.push("");
    lines.push(t("devcaseFeedback.growthHeading"));
    for (const g of growth) lines.push(`- ${g}`);
  }
  if (strengths.length === 0 && growth.length === 0) {
    lines.push("");
    lines.push(t("devcaseFeedback.noSpecifics"));
  }
  // Named once, at the end, and only when there IS a mismatch and there ARE bullets to
  // qualify — a truthful note about the letter, in the reader's language, instead of a
  // silent language mix. Placed before the signoff so it reads as a footnote, not as
  // part of the assessment.
  if (bulletsAreForeign && (strengths.length > 0 || growth.length > 0)) {
    lines.push("");
    lines.push(t("devcaseFeedback.engineNote", { language: bulletLang.toUpperCase() }));
  }
  lines.push("");
  lines.push(t("devcaseFeedback.signoff"));

  return { subject, body: lines.join("\n") };
}
