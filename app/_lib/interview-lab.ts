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

// The refusal sentence that used to live here as INTERVIEW_LAB_DISABLED_ERROR is
// gone. /connect answers jsonRefusal("INTERVIEW_LAB_DISABLED", 403) and the lab
// page renders its own copy from the catalog, so an English constant here was a
// third source of truth that neither of them read. This module is the GATE; the
// wording is the catalog's. interview-lab.test.ts pins the gate's two answers.
