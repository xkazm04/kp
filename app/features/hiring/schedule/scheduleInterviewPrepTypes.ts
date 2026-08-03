// Types + normalization for the interview-prep artifact (Schedule's prep modal).
// Split out of ScheduleInterviewPrepModal.tsx so the modal file stays under the
// 200-line cap; owns the Prep/ImportedQuestion shapes and normImported.

import type { Scorecard } from "@/app/_lib/interview-scorecard";
import type { RubricCoverage } from "@/app/_lib/interview-rubric";
import type { RunOfShow } from "@/app/_lib/run-of-show";
import type { InterviewPrepProgress } from "@/app/_lib/interview-prep";

// The persisted prep artifact payload: the generated run-of-show (single-sourced
// from RunOfShow — scenario/durationMin/focusAreas/chronology/signals) plus the
// human-input seams. `userProgress` (PREP2) rides inside the payload as the
// interviewer's ticked items + notes; it is exactly InterviewPrepProgress minus
// the top-level `interviewer` (which saveInterviewPrepProgress splits out), so it
// is single-sourced from the server type rather than re-declared and left to drift.
export type Prep = RunOfShow & {
  source?: string;
  // Generator-owned provenance of the pack's scorecard rubric: whether the
  // role-family industry axes made it in, and if not why (interview-prep-run.ts).
  // Optional — packs generated before this stamp existed simply omit it, and the
  // modal discloses from the entry's LIVE role family anyway.
  rubricCoverage?: RubricCoverage;
  userProgress?: Omit<InterviewPrepProgress, "interviewer">;
  humanScorecard?: Scorecard;
  interviewer?: string;
  // Questions imported from the candidate's analysis report (Direction 2). A
  // dedicated key preserved across Regenerate. An element is either a legacy plain
  // string OR a { question, blockRef? } entry (Direction 3): a `blockRef` names the
  // chronology block topic the question has been WOVEN into, so it renders inside
  // that block + counts in the completion meter rather than sitting read-only below.
  // ONE key, so the voice brief that reads importedQuestions composes with it.
  importedQuestions?: ImportedQuestion[];
};

// Direction 3 — an imported question, normalized to the entry shape the modal
// renders. A woven question carries the topic of the block it belongs to.
export type ImportedEntry = { question: string; blockRef?: string };
export type ImportedQuestion = string | ImportedEntry;

/** Normalize a stored importedQuestions element (legacy string or {question,
 *  blockRef?}) to an entry, tolerating junk. Mirrors the server's
 *  normalizeImportedEntry so the modal and the API agree on the one shape. */
export function normImported(raw: ImportedQuestion): ImportedEntry | null {
  if (typeof raw === "string") {
    const q = raw.trim();
    return q ? { question: q } : null;
  }
  if (raw && typeof raw === "object") {
    const q = typeof raw.question === "string" ? raw.question.trim() : "";
    if (!q) return null;
    const blockRef = typeof raw.blockRef === "string" && raw.blockRef.trim() ? raw.blockRef.trim() : undefined;
    return blockRef ? { question: q, blockRef } : { question: q };
  }
  return null;
}
