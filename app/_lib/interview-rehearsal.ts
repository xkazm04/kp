// REHEARSING a job's interview kit (spark interview-kit-template, WP-D).
//
// A recruiter can hear the real interviewer run a kit — its agenda, both briefs, the
// director and its tools — before any candidate meets it. The operator's call: rehearse
// the job TEMPLATE, with no candidate attached. So a rehearsal is a `mode: "test"`
// interview session with NO pipeline entry, PINNED to one kit version (draft or
// published — rehearsing an unpublished draft is the point), in the recruiter's own
// workspace. It is minted by POST /api/jobs/[id]/interview-kit/rehearse, directed by
// /api/interview/connect (interview-agenda.ts buildKitOnlyInterviewKit +
// interview-run.ts buildRehearsalBriefs), and run by the ordinary public portal
// /interview/[token].
//
// Two predicates carry the policy, and every door that has to decide reads them rather
// than re-deriving it from `mode` and `entryId` inline:
//
//   isCandidateInterview — the ONLY kind of session whose outcome may touch a candidate:
//     a scorecard, the scorecard_review approval, a sealed ai_scorecard decision, a
//     /status link. Both halves are required: a candidate-mode session with no entry is
//     a recruiter's /simulate demo, and a test-mode session that somehow carries an
//     entry is still a rehearsal or a lab call — the recruiter's own voice, which must
//     never be scored against a real person. (The audio-recording OFFER is narrower
//     still and older: /connect stamps recording consent only for candidate MODE, and
//     the portal now offers it under the same rule, so a rehearsal never sees it.)
//
//   isKitRehearsal — a test-mode session pinned to a kit: /connect builds the kit-only
//     agenda, both directed briefs and the director tools for it. A test session with no
//     kit is the tokenless lab call and keeps its behaviour byte for byte.
//
// BILLING (the decision, stated once): a rehearsal is metered exactly like /simulate.
// It spends real provider minutes, so the rehearse door reserves the worst case at mint
// (meterGate over maxBillableInterviewMin — skipped for a self-hosted provider, which
// spends no allowance), and /complete debits the workspace's interview minutes on a
// completed call and writes the llm_usage cost row. That row is attributed to the
// SESSION id only — the session has no entry and llm_usage has no entry column — so the
// spend is visible in the usage panel and attributable to no candidate.
//
// A LEAF on purpose (type-only imports): the public portal page reads these predicates,
// and it must not compile the interview-brief graph to ask a yes/no question.

import type { InterviewSession } from "./db/interviews";

/** A session whose outcome may be written against a candidate. See the header. A type
 *  guard, so a caller that passes it holds a non-null `entryId` without re-checking. */
export function isCandidateInterview<T extends Pick<InterviewSession, "mode" | "entryId">>(
  session: T
): session is T & { mode: "candidate"; entryId: string } {
  return session.mode === "candidate" && typeof session.entryId === "string" && session.entryId !== "";
}

/** A recruiter's rehearsal of a job kit: test mode, pinned to a kit version. */
export function isKitRehearsal(session: Pick<InterviewSession, "mode" | "kitId">): boolean {
  return session.mode === "test" && typeof session.kitId === "string" && session.kitId !== "";
}
