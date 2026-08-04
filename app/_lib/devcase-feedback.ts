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

import { commsTranslator } from "./comms-translator";

export type FeedbackInput = {
  candidateRef: string;
  roleTitle?: string | null;
  strengths: string[];
  concerns: string[];
  gaps: string[];
  /** The candidate's locale, carried on their pipeline entry. */
  locale?: string | null;
};

export type FeedbackBrief = { subject: string; body: string };

const clean = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);

export async function buildFeedbackBrief(input: FeedbackInput): Promise<FeedbackBrief> {
  const t = await commsTranslator(input.locale);
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
  lines.push("");
  lines.push(t("devcaseFeedback.signoff"));

  return { subject, body: lines.join("\n") };
}
