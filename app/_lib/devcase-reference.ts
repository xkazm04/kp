import { createHash } from "node:crypto";

// The handle a CANDIDATE is given for the work they just submitted.
//
// Both public intake doors used to echo the raw `dev_submissions.id` and both
// candidate surfaces printed it on screen ("Submission reference: sub_x7…").
// That is an internal store key on a public wire, which this repo already has a
// rule about (candidate token routes carry a projection, never the row) — and it
// was, for a while, worse than untidy: `POST /api/devcase/skill-profile` took
// that id as its ONLY argument and carried no operator gate, so on a
// default-workspace deploy the candidate could mint their own signed credential
// from the number the thank-you screen had just handed them.
//
// The gate is the real fix; this is the other half. A reference is a one-way,
// deterministic short hash of the id: stable (the candidate can quote the same
// string in a follow-up email), opaque (it is not the id, and nothing in the
// product accepts it as one), and derivable by us — the same id always produces
// the same reference, so a recruiter-side lookup can be built on it without
// storing a second column.
//
// It is deliberately NOT a secret and NOT a capability: 10 hex characters is a
// human-quotable handle, not a bearer token, and no route authorizes on it.

/** The candidate-facing reference for a submission id. `ref-` + 10 hex chars,
 *  the same shape (and the same reasoning) as the session watermark. */
export function submissionReference(submissionId: string): string {
  return `ref-${createHash("sha256").update(`kp-devcase-ref|${submissionId}`, "utf8").digest("hex").slice(0, 10)}`;
}
