// Pure types for the onboarding run detail view, split out of
// OnboardingRunDetailView.tsx so that file stays under the 200-line cap.

import type { OnboardingTask, OnboardingTaskState, QuestionnaireField } from "@/app/_lib/onboarding";

export type Signature = { id: string; document: string; status: string; signer: string | null; signedAt: string | null };
export type RunDetail = {
  run: { id: string; candidateLabel: string | null; jobTitle: string | null; status: string };
  tasks: OnboardingTask[];
  questionnaire: QuestionnaireField[];
  states: OnboardingTaskState[];
  intake: Record<string, string> | null;
  signatures: Signature[];
  progress: { done: number; total: number; pct: number; complete: boolean };
};
