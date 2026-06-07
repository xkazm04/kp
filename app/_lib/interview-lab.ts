// Gate for the tokenless interview-lab path (idea-6236b597).
//
// A tokenless POST to /api/interview/connect creates a throwaway "test" session
// and mints REAL short-lived provider credentials — an OpenAI Realtime client
// secret or an ElevenLabs signed URL. Credential minting is the most expensive
// operation in the system, and /interview-lab is a publicly routable page that
// exercises exactly this path with no token and no auth: in production an
// attacker could hammer it to mint unlimited credentials and drain the provider
// account (denial-of-wallet). Candidate links and the recruiter simulation are
// NOT affected — both carry a session token.
//
// The lab is a dev/A-B harness, so the default is: enabled outside production,
// disabled in production unless INTERVIEW_LAB_ENABLED=1 explicitly opts in.

/** Whether the tokenless lab path may create sessions and mint credentials. */
export function isInterviewLabEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.INTERVIEW_LAB_ENABLED === "1";
}

/** User-facing API error when the lab path is disabled. Shared by the route and
 *  the lab page so the contract has a single source of truth. */
export const INTERVIEW_LAB_DISABLED_ERROR =
  "The interview lab is disabled in production. Set INTERVIEW_LAB_ENABLED=1 to opt in.";
