// The candidate bundle as STATE, not as a one-shot fetch: a parser for the wire, a
// sequenced reducer with stale-while-revalidate, and the one declared answer to "does
// this in-modal write change the story?". Pure — useCandidateBundle runs it, and
// candidateBundle.test.ts pins it. Type-only imports: nothing here pulls a store.

import type {
  CandidateComm,
  CandidateConsentView,
  CandidateDecision,
  CandidateTimelineItem,
  RematchLink,
} from "@/app/_lib/candidate-timeline";
import type { InterviewTelemetry } from "@/app/_lib/interview-telemetry";
import type { ScorecardEntities, ScorecardRating } from "@/app/_lib/interview-scorecard";
import type { HumanScorecardView } from "@/app/_lib/human-scorecard-set";
import type { ScorecardCoverage } from "@/app/_lib/interview-transcript";
import type { PipelineEvent } from "@/app/features/shared/pipelineTypes";

export type InterviewOutcome = {
  recommendation?: string;
  summary?: string;
  ratings?: ScorecardRating[];
  hasTranscript?: boolean;
  /** Conversation signals + scoring-coverage caveat, projected server-side. Absent ⇒ no chrome. */
  telemetry?: InterviewTelemetry;
  coverage?: ScorecardCoverage;
  /** Structured read-back outcome (confirmed / corrected / unconfirmed technologies). */
  entities?: ScorecardEntities;
};

/** GET /api/pipeline/[id]/timeline, every section present and typed. */
export type CandidateBundleData = {
  events: PipelineEvent[];
  items: CandidateTimelineItem[];
  /** The sealed decision trail the route computes on every open (newest first). */
  decisions: CandidateDecision[];
  comms: CandidateComm[];
  interview: InterviewOutcome | null;
  /** Every interviewer's scorecard (one per interviewer + round, newest first). An
   *  empty artifact — no ratings and no summary — is dropped as noise. */
  humanScorecards: HumanScorecardView[];
  consent: CandidateConsentView | null;
  rematchLinks: Record<number, RematchLink>;
  notes: string | null;
  staleSince: string | null;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const arrayOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const stringOr = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** A non-object body is a failed load (null); inside an object every section defaults. */
export function parseCandidateBundle(json: unknown): CandidateBundleData | null {
  if (!isObject(json)) return null;
  const consent =
    isObject(json.consent) && isObject(json.consent.consent) && Array.isArray(json.consent.events)
      ? (json.consent as CandidateConsentView)
      : null;
  return {
    events: arrayOf<PipelineEvent>(json.events),
    items: arrayOf<CandidateTimelineItem>(json.items),
    decisions: arrayOf<CandidateDecision>(json.decisions),
    comms: arrayOf<CandidateComm>(json.comms),
    interview: isObject(json.interview) ? (json.interview as InterviewOutcome) : null,
    humanScorecards: arrayOf<unknown>(json.humanScorecards)
      .filter(isObject)
      .map((v) => v as HumanScorecardView)
      .filter((v) => (Array.isArray(v.ratings) && v.ratings.length > 0) || Boolean(v.summary)),
    consent,
    rematchLinks: isObject(json.rematchLinks) ? (json.rematchLinks as Record<number, RematchLink>) : {},
    notes: stringOr(json.notes),
    staleSince: stringOr(json.staleSince),
  };
}

/**
 * loading    first pull in flight, nothing to show
 * ready      the story as the server last told it
 * refreshing a re-pull in flight; the last-good story stays painted
 * stale      a re-pull failed; the last-good story stays painted
 * failed     the first pull failed; there is nothing to show
 */
export type BundleStatus = "loading" | "ready" | "refreshing" | "stale" | "failed";
export type BundleState = { status: BundleStatus; data: CandidateBundleData | null; seq: number };
export type BundleAction =
  | { type: "invalidate" }
  | { type: "retry" }
  | { type: "reset" }
  | { type: "settle"; seq: number; data: CandidateBundleData }
  | { type: "fail"; seq: number };

export const initialBundleState = (): BundleState => ({ status: "loading", data: null, seq: 1 });

/** Every pull carries the seq it was issued under; a settle or fail for any other seq
 *  is an older response and is dropped, so it can never overwrite a newer one. */
export function bundleReducer(state: BundleState, action: BundleAction): BundleState {
  switch (action.type) {
    case "invalidate":
    case "retry":
      return { status: state.data ? "refreshing" : "loading", data: state.data, seq: state.seq + 1 };
    case "reset":
      return { status: "loading", data: null, seq: state.seq + 1 };
    case "settle":
      return action.seq === state.seq ? { status: "ready", data: action.data, seq: state.seq } : state;
    case "fail":
      if (action.seq !== state.seq) return state;
      return { status: state.data ? "stale" : "failed", data: state.data, seq: state.seq };
  }
}

/** The consent panel's "could not load": only when there is no snapshot at all. A
 *  failed re-pull keeps the good snapshot rather than replacing it with a failure. */
export const consentFailed = (state: BundleState): boolean => state.status === "failed";

/** What the modal itself just did. */
export type InModalEffect =
  | { kind: "task"; applied: string }
  | { kind: "link"; flow: "schedule" | "voice"; minted: boolean }
  | { kind: "resend" };

// Task outcomes that wrote nothing the story reads (automation-run.ts): a screen on a
// non-screening column, a rematch with nowhere to go or already done, an outreach
// already sent.
const QUIET_OUTCOMES = new Set(["advisory", "no_alternative", "already_rematched", "already_sent"]);
// Outcomes that MOVED the stage: the hook re-pulls on the entry's stage already, so
// invalidating here too would be a second fetch for the same change.
const STAGE_OUTCOMES = new Set(["advanced", "auto_ratified"]);

/** Does this in-modal write change the candidate's story? Anything not declared quiet
 *  re-pulls: a new outcome that forgets to declare itself costs one GET, never a
 *  modal that silently shows yesterday. */
export function invalidatesBundle(effect: InModalEffect): boolean {
  switch (effect.kind) {
    case "task":
      return !QUIET_OUTCOMES.has(effect.applied) && !STAGE_OUTCOMES.has(effect.applied);
    case "link":
      // A mint writes the invite/session row the timeline reads and dispatches its
      // letter; a refused mint wrote nothing.
      return effect.minted;
    case "resend":
      // The resend route writes a new letter and stamps the candidate's history.
      return true;
  }
}
