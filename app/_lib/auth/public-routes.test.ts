import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, PUBLIC_PAGES, underPath } from "./public-routes.ts";

// The auth gate is fail-closed: these tests pin WHICH paths escape it. Two Criticals in
// the 2026-07-09 bug+ui scan were both this one bug class — a public entry matched by raw
// string prefix, swallowing a sibling or child route that must stay gated.

test("underPath matches whole segments, never a longer sibling", () => {
  assert.equal(underPath("/market", "/market"), true);
  assert.equal(underPath("/market/cz", "/market"), true);
  assert.equal(underPath("/marketing", "/market"), false); // the bug class
  assert.equal(underPath("/api/devcase/session", "/api/devcase/session"), true);
  assert.equal(underPath("/api/devcase/sessionX", "/api/devcase/session"), false);
});

test("underPath with a trailing slash matches strict descendants only", () => {
  assert.equal(underPath("/apply/42", "/apply/"), true);
  assert.equal(underPath("/apply", "/apply/"), false);
});

test("candidate surfaces stay public", () => {
  for (const p of [
    "/login",
    "/apply/job-123",
    "/offer/tok",
    "/status/tok",
    "/skill/tok",
    "/interview/tok",
    "/invite/tok",
    "/devcase/apply/tok",
    "/api/apply/job-123",
    "/api/offer/tok",
    "/api/skill-profile/tok/verify",
    "/api/invite/tok",
    "/api/auth/login",
    "/api/health",
    "/api/billing/webhook",
    "/api/interview/connect",
    "/api/devcase/inbound",
    "/api/comms/callback",
  ]) {
    assert.equal(isPublicPath(p), true, `${p} must be public`);
  }
});

test("CRITICAL: the relay delivery callback is reachable, the rest of /api/comms is not", () => {
  // callback-unblocked — the relay POSTs receipts from a server, with no session cookie.
  // Absent from the allow-list, the operator gate 401'd it BEFORE the route's own
  // shared-secret auth ran, so `bounced` receipts never arrived and the whole bounce
  // subsystem (Bounced badge, supersession, BouncedResend) was inert in production.
  assert.equal(isPublicPath("/api/comms/callback"), true);
  // Exact entry, matched by segment: no sibling or child rides along with it.
  assert.equal(isPublicPath("/api/comms/callbackX"), false);
  assert.equal(isPublicPath("/api/comms/callback/anything"), false);
  // The recruiter surfaces of the same subtree stay gated.
  assert.equal(isPublicPath("/api/comms"), false);
  assert.equal(isPublicPath("/api/comms/out_123/resend"), false);
});

test("CRITICAL: the recruiter webhook console is NOT public", () => {
  // `PUBLIC_API_PREFIXES` used to contain the whole `/api/channels/` subtree, so an
  // anonymous caller could GET/POST/DELETE the real tenant's webhook console.
  assert.equal(isPublicPath("/api/channels/webhooks"), false);
  assert.equal(isPublicPath("/api/channels/webhooks/tok"), false);
  // ...while the token-authed inbound intake receiver stays public.
  assert.equal(isPublicPath("/api/channels/inbound/tok"), true);
});

test("CRITICAL: bulk scheduling-invite minting is NOT public", () => {
  // The old rule was `startsWith("/api/schedule/") && p !== "/api/schedule/invite"`, an
  // exact-string exclusion. The child route `/api/schedule/invite/bulk` slipped past it and
  // let an unauthenticated caller mint 100 scheduling tokens + email candidates per call.
  assert.equal(isPublicPath("/api/schedule/invite"), false);
  assert.equal(isPublicPath("/api/schedule/invite/bulk"), false);
  // Any future child of the recruiter invite subtree is gated by default.
  assert.equal(isPublicPath("/api/schedule/invite/anything/deeper"), false);
  // The recruiter scheduler-settings route is gated; only a candidate token is public.
  assert.equal(isPublicPath("/api/schedule"), false);
  assert.equal(isPublicPath("/api/schedule/some-token"), true);
});

test("CRITICAL: the GDPR erasure self-service surface is reachable", () => {
  // comms-dispatch.ts appends a "manage your data" footer to every candidate comm
  // pointing at an absolute `<base>/data/<erasureToken>`; the page then calls
  // GET/POST /api/data/<token>. Neither was allow-listed, so in password mode the
  // link 302'd to /login and the API 401'd — the Art. 17 right-to-erasure path was
  // dead for the only people who can use it (candidates hold no session).
  assert.equal(isPublicPath("/data/er-abc123"), true);
  assert.equal(isPublicPath("/api/data/er-abc123"), true);
  // Trailing-slash entries: strict descendants only, never the bare base or a sibling.
  assert.equal(isPublicPath("/data"), false);
  assert.equal(isPublicPath("/api/data"), false);
  assert.equal(isPublicPath("/database"), false);
  assert.equal(isPublicPath("/api/data-export"), false);
});

test("public JD share links reach the page, but the JD API stays gated", () => {
  // `/jds/<slug>` is a server component with an Apply CTA and OG unfurl metadata; it was
  // absent from the allow-list, so every shared JD link 302'd to /login in production.
  assert.equal(isPublicPath("/jds/senior-engineer"), true);
  // Its recruiter controls call these, and are only rendered for an operator.
  assert.equal(isPublicPath("/api/jds"), false);
  assert.equal(isPublicPath("/api/jds/senior-engineer"), false);
  assert.equal(isPublicPath("/api/jds/senior-engineer/revisions"), false);
});

test("signup page + register API pass the proxy gate (feature-gated in-route)", () => {
  // The proxy must let an anonymous visitor reach them; KP_SIGNUP_ENABLED (checked
  // by the page/route themselves) decides whether they answer or 404.
  assert.equal(isPublicPath("/signup"), true);
  assert.equal(isPublicPath("/api/auth/register"), true); // under the /api/auth/ prefix
  // Never a longer sibling.
  assert.equal(isPublicPath("/signup-bonus"), false);
});

test("recruiter surfaces stay gated", () => {
  // "/" was in this list until 2026-09-03 and is now deliberately public — see the
  // front-door test below. The workspace it can render is a CLIENT shell whose every
  // data call ("/api/*" here) is still gated, so what an anonymous visitor can reach
  // through the root is the landing, and nothing else.
  for (const p of [
    "/pipeline",
    "/api/pipeline",
    "/api/jobs",
    "/api/analytics/calibration",
    "/api/org/members",
    "/api/ats/config",
    "/api/billing/checkout",
    "/api/decisions/records",
    "/api/devcase/publish",
    "/api/interview/create",
  ]) {
    assert.equal(isPublicPath(p), false, `${p} must be gated`);
  }
});

test("the site's own front door is public — and cannot be widened into a wildcard", () => {
  // The gate used to redirect "/" to /login in password mode while app/page.tsx
  // still carried an anonymous-landing branch: a marketing link, an OG unfurl or a
  // crawler hitting the root met a login form, and the landing branch was dead code.
  assert.equal(isPublicPath("/"), true);
  // …EXACTLY, though. "/" is in PUBLIC_PAGES_EXACT and must never migrate into
  // PUBLIC_PAGES, where `underPath` (trailing-slash entry ⇒ prefix match) would make
  // it match every path in the app and switch the fail-closed gate off entirely.
  assert.equal(PUBLIC_PAGES.includes("/"), false, "'/' in PUBLIC_PAGES would make the WHOLE app public");
  for (const gated of ["/settings", "/api/jds", "/api/org/members", "/analytics"]) {
    assert.equal(isPublicPath(gated), false, `${gated} must stay gated with '/' public`);
  }
});

test("every marketing + legal page an anonymous visitor is promised survives the gate", () => {
  // robots.ts allows these and the public footer links them; a missing fixture here is
  // how one of them would quietly regress into a /login redirect for the whole internet.
  for (const p of ["/about", "/market", "/landing", "/privacy", "/terms", "/trust"]) {
    assert.equal(isPublicPath(p), true, `${p} must be public`);
  }
  // Segment matching, not prefix: a longer sibling never rides along.
  assert.equal(isPublicPath("/marketing"), false);
  assert.equal(isPublicPath("/trustees"), false);
  assert.equal(isPublicPath("/privacy-internal"), false);
});

test("the machine-authed and candidate API entries stay reachable, their siblings gated", () => {
  // Each of these is authed by something OTHER than a session cookie (a token, a shared
  // secret, or nothing but a rate limiter), so the operator gate would 401 it before its
  // own auth ran — the documented trap this allow-list exists to avoid.
  for (const p of [
    "/api/demo", // mints the isolated demo-workspace session for the guided sim
    "/api/extract-text", // anonymous CV drop on the public apply form
    "/api/channels/inbound", // token-authed ad/email intake
    "/api/agents/report/agt_1", // a hired agent POSTs cost/activity with a report token
    "/api/devcase/session", // candidate work-sample runtime
    "/api/interview/complete", // candidate voice runtime end-of-call callback
  ]) {
    assert.equal(isPublicPath(p), true, `${p} must be public`);
  }
  // The recruiter consoles that share those subtrees must NOT come with them.
  assert.equal(isPublicPath("/api/channels/webhooks"), false);
  assert.equal(isPublicPath("/api/agents/roster"), false);
  assert.equal(isPublicPath("/api/agents/report"), false, "the prefix is strict-descendants");
  assert.equal(isPublicPath("/api/devcase/list"), false);
  assert.equal(isPublicPath("/api/interview/create"), false);
  assert.equal(isPublicPath("/api/demo/reset"), false, "an exact entry never grows children");
});
