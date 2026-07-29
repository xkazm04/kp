// Pure types for OnboardingTab and its section components, split out so the
// tab file stays under the 200-line cap.

import type { OnboardingTask, QuestionnaireField } from "@/app/_lib/onboarding";

export type HiredCandidate = { entryId: string; candidateLabel: string | null; jobTitle: string | null; runId: string | null };
export type RunSummary = {
  id: string;
  candidateLabel: string | null;
  jobTitle: string | null;
  status: string;
  progress: { done: number; total: number; pct: number; complete: boolean };
  intakeSubmitted: boolean;
};
export type Template = { id: string; name: string; tasks: OnboardingTask[]; questionnaire: QuestionnaireField[] };
