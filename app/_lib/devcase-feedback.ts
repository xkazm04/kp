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
// Pure + import-free so the wording contract is unit-testable.

export type FeedbackInput = {
  candidateRef: string;
  roleTitle?: string | null;
  strengths: string[];
  concerns: string[];
  gaps: string[];
};

export type FeedbackBrief = { subject: string; body: string };

const clean = (xs: string[]) => xs.map((s) => s.trim()).filter(Boolean);

export function buildFeedbackBrief(input: FeedbackInput): FeedbackBrief {
  const role = (input.roleTitle ?? "").trim();
  const strengths = clean(input.strengths);
  // Concerns + transfer gaps both become forward-looking "areas to keep growing"
  // — reframed as development, never as a verdict on the person.
  const growth = clean([...input.concerns, ...input.gaps]);

  const subject = role ? `Your ${role} exercise — a few notes` : "Your take-home exercise — a few notes";

  const lines: string[] = [];
  lines.push(`Hi ${input.candidateRef || "there"},`);
  lines.push("");
  lines.push(
    role
      ? `Thank you for taking the time on the ${role} exercise. Here's some honest, friendly feedback on your work.`
      : "Thank you for taking the time on the exercise. Here's some honest, friendly feedback on your work."
  );
  if (strengths.length > 0) {
    lines.push("");
    lines.push("What stood out:");
    for (const s of strengths) lines.push(`- ${s}`);
  }
  if (growth.length > 0) {
    lines.push("");
    lines.push("Areas to keep growing:");
    for (const g of growth) lines.push(`- ${g}`);
  }
  if (strengths.length === 0 && growth.length === 0) {
    lines.push("");
    lines.push("We appreciated your effort on the exercise and wish you the very best in your search.");
  }
  lines.push("");
  lines.push("Thanks again for your time and interest.");

  return { subject, body: lines.join("\n") };
}
