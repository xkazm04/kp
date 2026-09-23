// The JOB-LEVEL interview kit (spark interview-kit-template).
//
// WHAT IT IS. One kit per job: the competencies this role is hired on, what is asked
// about each, how long each gets, which questions may never be skipped, and a short FAQ
// the interviewer may answer the candidate from. It is the SPINE of every interview for
// that job — the per-candidate plan adds probes from the CV on top of it, and a
// recruiter's per-candidate edits ride over that as an overlay.
//
// WHY IT IS VERSIONED. A regeneration must never silently clobber an operator's edit
// (the reasoning `agent_fit_specs` already carries, db/core.ts), and a candidate's link
// is PINNED to the version it was minted with, so candidates in one round face the same
// questions and their ratings stay comparable. A kit row is therefore append-only: an
// edit publishes a NEW version.
//
// WHAT IT MUST NEVER HOLD. Anything about a candidate. The GDPR erasure scrub is
// entirely entry-keyed (db/pipeline.ts scrubEntryLinkedPii), so a job-keyed row is
// unreachable from it — a pasted candidate name or a CV-derived probe stored here would
// be undeletable by design. Per-candidate material belongs in `interview_preps`, which
// the scrub does blank. A test pins the shape; this comment is why it exists.

/** How much of the decision a competency carries. Deliberately three coarse steps, not
 *  a percentage: weights ORDER the scorecard and mark emphasis, and no total is computed
 *  from them (registry: presenting-a-score-to-a-recruiter — a number the product shows
 *  is a number it has to defend). */
export const KIT_WEIGHTS = [1, 2, 3] as const;
export type KitWeight = (typeof KIT_WEIGHTS)[number];

/** Caps, enforced at the write boundary. A kit is read aloud inside a booked call: a
 *  kit that cannot fit its own interview is an authoring error, not a runtime one.
 *  The four collection caps are GENERATED from pipeline/jobfit/automation.py (the kit
 *  generator stops short of them) — see codegen.py CONTRACT_CONSTANTS. */
export {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_FAQ,
} from "./contract-constants.generated.ts";
export const KIT_MAX_TEXT_CHARS = 600;
export const KIT_MAX_FAQ_ANSWER_CHARS = 1200;

export type KitQuestion = {
  /** Stable within the kit version, so an overlay and the evidence record can name it. */
  id: string;
  text: string;
  /** A must-ask is asked even when the clock has run out — the director asks the
   *  candidate to agree to the overrun rather than taking it silently. */
  mustAsk: boolean;
  /** Optional narrowing follow-up the interviewer may use when the answer is thin. */
  followUp?: string;
};

export type KitCompetency = {
  id: string;
  /** What the recruiter calls this competency. Candidate-facing: it becomes an agenda
   *  block title, so it carries no assessment annotation. */
  title: string;
  weight: KitWeight;
  /** Planned minutes. The agenda fits the kit to whatever length the candidate was
   *  actually booked for, so this is a ratio as much as a duration. */
  budgetMin: number;
  questions: KitQuestion[];
};

/** A question the interviewer may answer FROM, instead of forwarding it to the
 *  recruiter. Answers are role facts, never a promise about the candidate's chances. */
export type KitFaqEntry = { id: string; question: string; answer: string };

export type InterviewKit = {
  version: 1;
  competencies: KitCompetency[];
  faq: KitFaqEntry[];
  /** Free note from the author to the interviewer — tone, context, what to avoid. Never
   *  read aloud. */
  note?: string;
};

/** A stored kit version. `version` counts up per job; `status` is how a draft becomes
 *  the one new links are minted from. */
export type StoredInterviewKit = {
  id: string;
  workspaceId: string;
  jobId: string;
  version: number;
  status: "draft" | "published";
  kit: InterviewKit;
  /** Where this version came from: the generator, or a human editing the one before it. */
  source: "generated" | "edited";
  createdAt: string;
};

// ---- the per-candidate overlay ---------------------------------------------------------

/** A recruiter's edits to ONE candidate's plan, stored as a human-owned key on the
 *  candidate's prep payload so a regeneration reapplies rather than discards them
 *  (interview-prep-run.ts mergeRegeneratedPrep preserves every non-generator key).
 *
 *  It is an overlay, not a rewrite: each entry names what it does to a question the
 *  generator or the kit produced, so the underlying plan can change beneath it and the
 *  intent still applies. */
export type KitOverlay = {
  version: 1;
  /** Questions the recruiter removed for this candidate, by question id. */
  dropped: string[];
  /** Questions whose text the recruiter rewrote, by question id. */
  edited: { id: string; text: string }[];
  /** Questions the recruiter added for this candidate, with the competency they belong
   *  to (or null for a block of their own at the end). */
  added: { id: string; competencyId: string | null; text: string; mustAsk: boolean }[];
};

export const EMPTY_KIT_OVERLAY: KitOverlay = { version: 1, dropped: [], edited: [], added: [] };
