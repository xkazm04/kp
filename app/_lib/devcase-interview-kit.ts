// Interview kit from the winning submission (idea-8d4f38b9). The evaluator already
// mints candidate-specific follow-up questions for every submission — each
// anchored to ONE observed decision from their work, with interviewer-internal
// "listen for" / "red flag" notes (evaluate.mint_followups). But they were buried
// inside one submission's expanded EvalPanel. This assembles the TOP candidate's
// questions into a copy/exportable interview-ready kit at the case level, so a
// recruiter prepping the round doesn't have to hunt for them.
//
// Pure + import-free so the Markdown contract is unit-testable.

type KitQuestion = { question?: string; decision?: string; listenFor?: string; redFlag?: string };

export type InterviewKitInput = {
  caseTitle: string;
  candidateRef: string;
  transferScore: number | null;
  questions: KitQuestion[];
};

/** Render the kit as Markdown (copy/download). Questions with no text are
 *  dropped; the listen-for / red-flag notes are labeled INTERNAL because they
 *  must never be read out to the candidate. */
export function interviewKitMarkdown(input: InterviewKitInput): string {
  const { caseTitle, candidateRef, transferScore, questions } = input;
  const usable = questions.filter((q) => (q.question ?? "").trim());
  const lines: string[] = [];
  lines.push(`# Interview kit — ${caseTitle || "Dev case"}`);
  const fit = transferScore != null ? ` · transfer fit ${transferScore}` : "";
  lines.push(`Candidate: ${candidateRef || "—"}${fit}`);
  lines.push("");
  lines.push(
    "Each question verifies the candidate owns a real decision from their submission. " +
      "The _listen for_ / _red flag_ notes are interviewer-internal — never read them aloud."
  );
  lines.push("");
  if (usable.length === 0) {
    lines.push("_No follow-up questions were minted for this submission yet — evaluate it first._");
    return lines.join("\n");
  }
  usable.forEach((q, i) => {
    lines.push(`## ${i + 1}. ${(q.question ?? "").trim()}`);
    if (q.decision?.trim()) lines.push(`- Decision under test: ${q.decision.trim()}`);
    if (q.listenFor?.trim()) lines.push(`- Listen for: ${q.listenFor.trim()}`);
    if (q.redFlag?.trim()) lines.push(`- Red flag: ${q.redFlag.trim()}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}
