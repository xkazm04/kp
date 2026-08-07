import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublicPath, underPath } from "./public-routes.ts";

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
  ]) {
    assert.equal(isPublicPath(p), true, `${p} must be public`);
  }
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

test("public JD share links reach the page, but the JD API stays gated", () => {
  // `/jds/<slug>` is a server component with an Apply CTA and OG unfurl metadata; it was
  // absent from the allow-list, so every shared JD link 302'd to /login in production.
  assert.equal(isPublicPath("/jds/senior-engineer"), true);
  // Its recruiter controls call these, and are only rendered for an operator.
  assert.equal(isPublicPath("/api/jds"), false);
  assert.equal(isPublicPath("/api/jds/senior-engineer"), false);
  assert.equal(isPublicPath("/api/jds/senior-engineer/revisions"), false);
});

test("recruiter surfaces stay gated", () => {
  for (const p of [
    "/",
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
