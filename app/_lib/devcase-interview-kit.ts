// Interview kit from the winning submission (idea-8d4f38b9). The evaluator already
// mints candidate-specific follow-up questions for every submission — each
// anchored to ONE observed decision from their work, with interviewer-internal
// "listen for" / "red flag" notes (evaluate.mint_followups). But they were buried
// inside one submission's expanded EvalPanel. This assembles the TOP candidate's
// questions into a copy/exportable interview-ready kit at the case level, so a
// recruiter prepping the round doesn't have to hunt for them.
//
// Pure + import-free so the Markdown contract is unit-testable.
//
// WHOSE LANGUAGE (F15, docs/architecture/localization.md "Two readers"): the panel.
// The kit is assembled in the recruiter's browser from what is already on their
// screen and handed to interviewers inside the same tenant — colleagues, not an
// external audience, and there is no stored artifact carrying a language field. So
// the reader is the UI user and the scaffolding follows `useTranslations()`.
// The safety line matters most here: "never read them aloud" is an INSTRUCTION to
// the interviewer, and an instruction nobody can read is not a safeguard.
//
// The question / decision / listen-for / red-flag TEXT stays verbatim — it is
// model-minted free text about one submission, in whatever language it was minted.
// Only the scaffolding localizes, exactly as jobToMarkdown leaves the recruiter's
// own posting body alone.

type KitQuestion = { question?: string; decision?: string; listenFor?: string; redFlag?: string };

export type InterviewKitInput = {
  caseTitle: string;
  candidateRef: string;
  transferScore: number | null;
  questions: KitQuestion[];
};

/** The kit's headings and labels, resolved for the reader. Passed in so the
 *  builder stays pure and import-free (the shape rule). */
export type InterviewKitStrings = {
  /** "Interview kit: {case}" */
  heading: (caseTitle: string) => string;
  /** Stands in for an unnamed case. */
  caseFallback: string;
  /** "Candidate: {ref}{fit}" */
  candidateLine: (candidateRef: string, fit: string) => string;
  /** " · transfer fit {score}" — empty when the submission has no transfer score. */
  fitSuffix: (score: number) => string;
  intro: string;
  none: string;
  decision: string;
  listenFor: string;
  redFlag: string;
};

/** Minimal translator shape both call sites satisfy: the panel's
 *  `useTranslations("devcase.interviewKit")` and a locale-pinned
 *  `namespaceTranslator(locale, "devcase.interviewKit")` in a test. */
export type InterviewKitLookup = (key: string, values?: Record<string, string | number>) => string;

/** Resolve the kit's scaffolding from a translator scoped to
 *  `devcase.interviewKit`. Kept beside the builder (it takes a translator, not a
 *  catalog) so the panel stays a one-liner and no catalog import reaches this module. */
export function buildInterviewKitStrings(t: InterviewKitLookup): InterviewKitStrings {
  return {
    heading: (caseTitle) => t("doc.heading", { case: caseTitle }),
    caseFallback: t("doc.caseFallback"),
    candidateLine: (candidateRef, fit) => t("doc.candidateLine", { ref: candidateRef, fit }),
    // The separator is punctuation, not copy — the catalog owns only the words, so a
    // translator can't accidentally change the line's shape.
    fitSuffix: (score) => ` · ${t("doc.fit", { score })}`,
    intro: t("doc.intro"),
    none: t("doc.none"),
    decision: t("doc.decision"),
    listenFor: t("doc.listenFor"),
    redFlag: t("doc.redFlag"),
  };
}

/** Render the kit as Markdown (copy/download). Questions with no text are
 *  dropped; the listen-for / red-flag notes are labeled INTERNAL because they
 *  must never be read out to the candidate. */
export function interviewKitMarkdown(input: InterviewKitInput, s: InterviewKitStrings): string {
  const { caseTitle, candidateRef, transferScore, questions } = input;
  const usable = questions.filter((q) => (q.question ?? "").trim());
  const lines: string[] = [];
  lines.push(`# ${s.heading(caseTitle || s.caseFallback)}`);
  const fit = transferScore != null ? s.fitSuffix(transferScore) : "";
  lines.push(s.candidateLine(candidateRef || "—", fit));
  lines.push("");
  lines.push(s.intro);
  lines.push("");
  if (usable.length === 0) {
    lines.push(`_${s.none}_`);
    return lines.join("\n");
  }
  usable.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${(q.question ?? "").trim()}`);
    if (q.decision?.trim()) lines.push(`- ${s.decision} ${q.decision.trim()}`);
    if (q.listenFor?.trim()) lines.push(`- ${s.listenFor} ${q.listenFor.trim()}`);
    if (q.redFlag?.trim()) lines.push(`- ${s.redFlag} ${q.redFlag.trim()}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
