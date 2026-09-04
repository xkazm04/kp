import { namespaceTranslator } from "./catalog-translator";
import { isLocale, DEFAULT_LOCALE } from "@/i18n/locales";
import type { RosStrings } from "./run-of-show";
import type { StudentPrepStrings } from "./student-interview";

// F5 — the catalog loader for the interview-prep pack's deterministic scaffolding.
//
// WHY IT IS ITS OWN MODULE: run-of-show.ts and student-interview.ts are pure
// builders that take their copy as a parameter (the shape rule in
// docs/architecture/localization.md), and student-interview.ts is client-bundled.
// Keeping the loader out of both means neither drags a catalog import into a
// client chunk, and the timing contract stays unit-testable in isolation.
//
// DOCUMENT-READER, not UI-user: `runInterviewPrep` builds the pack inside a
// DETACHED background task that cannot read the request cookie — the recruiter's
// locale rides in on the task params and is STAMPED on the stored payload
// (`lang`), so the pack is re-read later in the language it was written in. That
// is a property of the artifact, which is exactly what the locale-pinned
// translator is for.

/** Narrow whatever the task params carried to a supported locale. Mirrors the
 *  prior `lang === "cs" ? "cs" : "en"` gate, except the other two locales now
 *  resolve to themselves instead of silently becoming English. */
function prepLocale(lang: string | null | undefined) {
  return isLocale(lang) ? lang : DEFAULT_LOCALE;
}

/** The BAU run-of-show scaffolding in `lang`. */
export async function rosStrings(lang: string | null | undefined): Promise<RosStrings> {
  const t = await namespaceTranslator(prepLocale(lang), "scheduleTab.prep.plan");
  return {
    // Raw number into the ICU message — a pre-formatted string would make
    // intl-messageformat render the literal word NaN in any locale that pluralizes.
    topicFallback: (n) => t("topicFallback", { n }),
    introTopic: t("introTopic"),
    introGoal: t("introGoal"),
    defaultGoal: t("defaultGoal"),
    openTopic: t("openTopic"),
    openGoal: t("openGoal"),
    wrapTopic: t("wrapTopic"),
    wrapGoal: t("wrapGoal"),
    signalDepth: t("signalDepth"),
    signalMustHaves: t("signalMustHaves"),
    signalQuestions: t("signalQuestions"),
    forCandidate: t("forCandidate"),
    focusFallback: t("focusFallback"),
    scenario: (durationMin, who, focus) => t("scenario", { durationMin, who, focus }),
  };
}

/** The six-phase early-career plan's scaffolding in `lang`. `forCandidate` is
 *  shared with the BAU plan — one word, one catalog entry, so the two plans can
 *  never disagree on it. */
export async function studentPrepStrings(lang: string | null | undefined): Promise<StudentPrepStrings> {
  const locale = prepLocale(lang);
  const t = await namespaceTranslator(locale, "scheduleTab.prep.studentPlan");
  const plan = await namespaceTranslator(locale, "scheduleTab.prep.plan");
  return {
    listenFor: t("listenFor"),
    signalHint: t("signalHint"),
    signalQuotes: t("signalQuotes"),
    signalHypotheses: t("signalHypotheses"),
    forCandidate: plan("forCandidate"),
    focusFallback: t("focusFallback"),
    scenario: (durationMin, who, focus) => t("scenario", { durationMin, who, focus }),
  };
}

/** The DEBRIEF/BRIEF scaffolding that is written for the CANDIDATE rather than
 *  for the recruiter holding the browser: the submission-debrief agenda that is
 *  persisted on `interview_sessions.run_of_show_json` and rendered on the
 *  candidate portal, and the topic the recruiter-added questions are injected
 *  under in the candidate-safe voice brief.
 *
 *  Same document-reader rule as the prep pack above — the reader is the applicant,
 *  so the language is the ENTRY's locale (`pipeline_entries.locale`, the language
 *  they chose at apply), never the request's. These were hard-coded English
 *  literals until wave 37: a German applicant's portal listed a four-item agenda
 *  in English while every other word on the page was German. */
export type InterviewBriefStrings = {
  /** The four-phase submission-debrief agenda, in order. */
  debriefRunOfShow: string[];
  /** Topic heading for the recruiter's imported interview-kit questions. */
  recruiterAddedQuestions: string;
};

export async function interviewBriefStrings(lang: string | null | undefined): Promise<InterviewBriefStrings> {
  const t = await namespaceTranslator(prepLocale(lang), "interview.brief");
  return {
    debriefRunOfShow: [t("debriefApproach"), t("debriefDecisions"), t("debriefCounterfactuals"), t("debriefQuestions")],
    recruiterAddedQuestions: t("recruiterAddedQuestions"),
  };
}
