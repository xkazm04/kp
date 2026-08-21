import { createHash } from "node:crypto";

// Human-approval gate for the screening auto-reject wave (EU AI Act / GDPR Art. 22:
// no SOLELY-automated significant decision). The token is a stable signature of the
// EXACT set the wave would reject under a given policy, AT A GIVEN MOMENT. The
// dry-run preview returns it; a commit must echo it; the server recomputes it from
// the LIVE cohort and refuses the commit unless it matches and is still fresh. So a
// recruiter can only commit a reject set they actually reviewed, a cohort that
// drifted since the preview forces a fresh review rather than rubber-stamping a
// stale, now-different set — and a review made weeks ago can no longer stand in for
// a review made now.
//
// Pure + dependency-free (node:crypto only) so it unit-tests without dragging in the
// DB that screen-wave.ts imports, and so the client never needs it — the modal reads
// the token from the dry-run response, it never recomputes it.

/** How long an approval stays committable. Minutes, not hours: "a human reviewed
 *  this set" is the whole Art. 22 defence, and a review is of a MOMENT — of that
 *  cohort, those scores, that recruiter's attention. 15 minutes is long enough to
 *  read a long preview list, be interrupted, and still commit the set that was on
 *  screen; short enough that nothing meaningful (an interview, new evidence, a
 *  handover) can land inside the window unnoticed. A commit past it is not refused
 *  forever — it costs one re-preview, which is exactly the review being asserted. */
export const SCREEN_WAVE_APPROVAL_MAX_AGE_MS = 15 * 60 * 1000;

/** Stable, order-independent signature of the reject set under a policy, for one job,
 *  as of `issuedAt`. Shape: `<issuedAtEpochMs>.<hash>` — the issue time travels in
 *  cleartext so the server can age-check a token the client echoes back, and is ALSO
 *  inside the hash so it cannot be back-dated without invalidating the signature. */
export function screenWaveApprovalToken(
  jobId: string,
  policyVersion: string,
  rejectIds: string[],
  issuedAt: number = Date.now()
): string {
  const canonical = [...rejectIds]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const issued = Math.trunc(issuedAt);
  const hash = createHash("sha256").update(`${jobId}|${policyVersion}|${issued}|${canonical}`).digest("hex").slice(0, 32);
  return `${issued}.${hash}`;
}

/** The issue time carried by a token, or null when it isn't one of ours. */
export function screenWaveApprovalIssuedAt(token: string): number | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const issued = Number(token.slice(0, dot));
  return Number.isSafeInteger(issued) && issued > 0 ? issued : null;
}

export type ScreenWaveApprovalCheck = { ok: true } | { ok: false; reason: "malformed" | "mismatch" | "expired" };

/** The commit gate: the echoed token must be well-formed, must still sign the LIVE
 *  reject set under the LIVE policy (re-derived with the token's own issue time), and
 *  must not be older than SCREEN_WAVE_APPROVAL_MAX_AGE_MS. A token issued in the
 *  future is treated as malformed rather than fresh — clock skew must not extend the
 *  window. Callers map every failure to the same 409 (re-preview and re-approve). */
export function verifyScreenWaveApprovalToken(
  token: string,
  jobId: string,
  policyVersion: string,
  rejectIds: string[],
  now: number = Date.now()
): ScreenWaveApprovalCheck {
  const issuedAt = screenWaveApprovalIssuedAt(token);
  if (issuedAt === null) return { ok: false, reason: "malformed" };
  if (token !== screenWaveApprovalToken(jobId, policyVersion, rejectIds, issuedAt)) return { ok: false, reason: "mismatch" };
  const age = now - issuedAt;
  if (age < 0) return { ok: false, reason: "malformed" };
  if (age > SCREEN_WAVE_APPROVAL_MAX_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Thrown when a commit lacks human approval, its token no longer matches the live
 *  set, or the approval has gone stale. The route maps it to 409 so the client
 *  re-previews and re-approves. */
export class ScreenWaveApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScreenWaveApprovalError";
  }
}
