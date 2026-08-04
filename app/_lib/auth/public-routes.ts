// The public-surface allow-list for the fail-closed auth gate in `proxy.ts`.
//
// Kept in its own pure, dependency-free module (no node:crypto, no next/*) so it is
// edge-safe for the proxy AND directly unit-testable — `proxy.ts` lives at the repo
// root, outside the `app/**/*.test.ts` runner glob, which is why this predicate went
// untested long enough to grow two auth bypasses.
//
// FAIL-CLOSED: every path is gated EXCEPT what is listed here. A forgotten recruiter
// route stays gated (safe). A forgotten public route sends a candidate to /login
// (visible, fixable) — never a PII leak.

export const PUBLIC_PAGES = [
  "/login",
  "/about",
  "/market",
  "/landing",
  "/apply/",
  "/offer/",
  "/schedule/",
  "/interview/",
  "/status/",
  "/skill/",
  "/devcase/apply/",
  "/invite/",
  // Public, shareable JD detail page (Apply CTA + OG unfurl). It is a SERVER component
  // that reads the DB directly and gates its recruiter controls on isOperator(), so the
  // page is public while `/api/jds/*` stays gated.
  "/jds/",
];

export const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/apply/",
  "/api/offer/",
  "/api/status/",
  "/api/skill-profile/",
  "/api/devcase/session",
  // Inbound ad/email intake (token-authed) only. `/api/channels/webhooks*` is the
  // RECRUITER console and must stay gated — the old entry was the whole `/api/channels/`
  // subtree, which served that console to anonymous callers.
  "/api/channels/inbound",
  "/api/invite/",
  // Agent-bridge inbound report (token-authed): a hired Personas agent POSTs
  // cost/activity/lifecycle here — a MACHINE with a report token, never a browser
  // with a session cookie, so the proxy gate would 401 it before the route's own
  // token auth ran (the documented public-routes trap). Trailing slash = strict
  // descendants only: the rest of /api/agents (roster, pair, dispatch, refresh)
  // is the RECRUITER console and stays gated.
  "/api/agents/report/",
];

export const PUBLIC_API_EXACT: ReadonlySet<string> = new Set([
  "/api/health",
  "/api/demo", // public entry: mints an isolated "demo"-workspace session for the guided sim
  "/api/extract-text",
  "/api/billing/webhook", // Polar posts here; the rest of /api/billing is recruiter
  "/api/devcase/inbound", // candidate apply webhook; the rest of /api/devcase is recruiter
  "/api/interview/connect", // candidate voice runtime; create/by-entry/compare/revoke are recruiter
  "/api/interview/complete",
  // The relay's asynchronous delivery-receipt callback (bounce/complaint/drop), same
  // rationale as /api/billing/webhook and /api/devcase/inbound: a MACHINE posts here,
  // never a browser with a session cookie, so the operator gate would 401 it before its
  // own auth ran — leaving the whole bounce subsystem inert in any password-protected
  // deployment. It is NOT unauthenticated: the route is 503 unless COMMS_CALLBACK_SECRET
  // is set, then requires a constant-time `x-comms-secret` match, a ±5-minute
  // `x-comms-timestamp`, and a nonce replay guard. The rest of /api/comms (the recruiter
  // read + resend) stays gated.
  "/api/comms/callback",
]);

// Candidate schedule links are `/api/schedule/<token>` — exactly ONE segment below the
// base. `/api/schedule` (recruiter scheduler settings) and the whole
// `/api/schedule/invite` subtree (recruiter token minting, incl. `/bulk`) stay gated.
const SCHEDULE_TOKEN = /^\/api\/schedule\/[^/]+$/;

/** Match an allow-list entry against a path by PATH SEGMENT, never by raw string prefix.
 *
 *  An entry ending in `/` matches strict descendants only (`/apply/` ⇒ `/apply/42`).
 *  An entry without one matches itself or a descendant (`/market` ⇒ `/market`, `/market/cz`).
 *  Neither ever matches a longer sibling: `/marketing` is NOT under `/market`, and
 *  `/api/devcase/sessionX` is NOT under `/api/devcase/session`.
 *
 *  This fixes a class of bug, not one route. The old matcher used `p.startsWith(entry)`
 *  plus a single hand-written `p !== "/api/schedule/invite"` exclusion — so
 *  `/api/schedule/invite/bulk`, a CHILD of the excluded route added later, was served as a
 *  public candidate endpoint. Segment matching makes a newly-added child inherit its
 *  parent's gating instead of silently escaping it. */
export function underPath(p: string, entry: string): boolean {
  if (entry.endsWith("/")) return p.startsWith(entry);
  return p === entry || p.startsWith(entry + "/");
}

/** True when `pathname` is public-by-design and the auth gate must let it through. */
export function isPublicPath(p: string): boolean {
  if (PUBLIC_API_EXACT.has(p)) return true;
  if (PUBLIC_API_PREFIXES.some((x) => underPath(p, x))) return true;
  if (SCHEDULE_TOKEN.test(p) && !underPath(p, "/api/schedule/invite")) return true;
  if (PUBLIC_PAGES.some((x) => underPath(p, x))) return true;
  return false;
}
