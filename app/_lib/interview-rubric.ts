// Mirror of the fixed scorecard rubric in pipeline/jobfit/automation.py. The
// SAME competency axes + rating anchors apply to every candidate, so interviews
// are structured and directly comparable.

export const RATING_ANCHORS: Record<number, string> = {
  1: "Well below bar",
  2: "Below bar",
  3: "Meets the bar",
  4: "Above bar",
  5: "Exceptional",
};

export const INTERVIEW_RUBRIC: { competency: string; description: string }[] = [
  { competency: "Technical depth", description: "Depth and correctness in the role's core skills." },
  { competency: "Problem-solving", description: "Reasoning, debugging, and structured thinking under questioning." },
  { competency: "Communication", description: "Clarity, structure, and active listening." },
  { competency: "Experience & fit", description: "Relevance of background and projects to this specific role." },
  { competency: "Motivation", description: "Genuine interest in the role and the team." },
];

export const RUBRIC_ANCHOR_LINE = Object.entries(RATING_ANCHORS)
  .map(([k, v]) => `${k} = ${v}`)
  .join(" · ");
