import { createHash } from "node:crypto";

// Human-approval gate for the screening auto-reject wave (EU AI Act / GDPR Art. 22:
// no SOLELY-automated significant decision). The token is a stable signature of the
// EXACT set the wave would reject under a given policy. The dry-run preview returns
// it; a commit must echo it; the server recomputes it from the LIVE cohort and
// refuses the commit unless it matches. So a recruiter can only commit a reject set
// they actually reviewed, and a cohort that drifted since the preview forces a fresh
// review rather than rubber-stamping a stale, now-different set.
//
// Pure + dependency-free (node:crypto only) so it unit-tests without dragging in the
// DB that screen-wave.ts imports, and so the client never needs it — the modal reads
// the token from the dry-run response, it never recomputes it.

/** Stable, order-independent signature of the reject set under a policy, for one job. */
export function screenWaveApprovalToken(jobId: string, policyVersion: string, rejectIds: string[]): string {
  const canonical = [...rejectIds]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .sort()
    .join(",");
  return createHash("sha256").update(`${jobId}|${policyVersion}|${canonical}`).digest("hex").slice(0, 32);
}

/** Thrown when a commit lacks human approval or its token no longer matches the live
 *  set. The route maps it to 409 so the client re-previews and re-approves. */
export class ScreenWaveApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenWaveApprovalError";
  }
}
