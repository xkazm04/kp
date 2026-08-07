// Pins the candidate-link origin contract (idea-e6c66bcd + bug-ui-scan-2026-07-09 #3):
// both client and server resolve outward-facing links through publicBaseUrl with one
// explicit precedence — APP_BASE_URL, then the NEXT_PUBLIC_ mirror, then a VALIDATED
// runtime origin — and the result is ALWAYS an absolute, deployment-owned http(s)
// origin: never the "" that became a dead relative "/offer/<token>" in a mail client,
// and never a spoofable request Host header poisoning a candidate-delivered link.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publicBaseUrl } from "./public-base-url.ts";

const ORIGINAL_APP = process.env.APP_BASE_URL;
const ORIGINAL_PUBLIC = process.env.NEXT_PUBLIC_APP_BASE_URL;
const ORIGINAL_SITE = process.env.NEXT_PUBLIC_SITE_URL;

function setEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  setEnv("APP_BASE_URL", ORIGINAL_APP);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", ORIGINAL_PUBLIC);
  setEnv("NEXT_PUBLIC_SITE_URL", ORIGINAL_SITE);
});

// ── Precedence: an explicit deploy override always wins ──────────────────────

test("APP_BASE_URL wins over the runtime origin (the deploy-time footgun fix)", () => {
  setEnv("APP_BASE_URL", "https://public.example.com");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  // The recruiter is on localhost but candidates must get the public host.
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://public.example.com");
});

test("uses the NEXT_PUBLIC_ mirror when the server-only var is unset", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "https://mirror.example.com");
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://mirror.example.com");
});

test("APP_BASE_URL takes precedence over the NEXT_PUBLIC_ mirror server-side", () => {
  setEnv("APP_BASE_URL", "https://server.example.com");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "https://mirror.example.com");
  assert.equal(publicBaseUrl("http://localhost:3000"), "https://server.example.com");
});

test("strips a trailing slash so appending a path never doubles up", () => {
  setEnv("APP_BASE_URL", "https://public.example.com/");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  assert.equal(publicBaseUrl("http://localhost:3000") + "/offer/abc", "https://public.example.com/offer/abc");
});

// ── #3 (a): an override / runtime origin must be an ABSOLUTE http(s) URL ──────

test("a non-absolute APP_BASE_URL override is ignored, not emitted as a broken base", () => {
  // NON-VACUITY: the pre-fix helper did `configured || runtimeOrigin` and would
  // have returned the junk "not-a-url" verbatim. The fix validates it, ignores it,
  // and falls through to the (trusted) localhost runtime origin.
  setEnv("APP_BASE_URL", "not-a-url");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl("http://localhost:3000"), "http://localhost:3000");
});

test("a blank/whitespace override falls through to the trusted runtime origin", () => {
  setEnv("APP_BASE_URL", "   ");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", "");
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  // localhost is a trusted dev host, so the runtime origin is honored as-is.
  assert.equal(publicBaseUrl("http://localhost:3000"), "http://localhost:3000");
});

// ── #3 (a): origin-less / SSR callers never get a relative "" ─────────────────

test("an origin-less caller falls back to the canonical site origin (never a relative link)", () => {
  // NON-VACUITY: pre-fix, publicBaseUrl() with nothing configured returned "" — the
  // exact host-less "/offer/<token>" the reminder sweeps emailed. It now resolves to
  // the deployment-owned NEXT_PUBLIC_SITE_URL.
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl(), "https://app.example.com");
  // The reminder sweeps build `${publicBaseUrl()}/offer/<token>` — now absolute.
  assert.equal(`${publicBaseUrl()}/offer/abc`, "https://app.example.com/offer/abc");
});

test("a blank SSR-before-hydration origin resolves to the site origin, not \"\"", () => {
  // NON-VACUITY: pre-fix returned "" for publicBaseUrl("") and publicBaseUrl(undefined).
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl(""), "https://app.example.com");
  assert.equal(publicBaseUrl(undefined), "https://app.example.com");
});

test("with nothing configured at all it still returns the documented default origin (never \"\")", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", undefined);
  // site-url.ts's documented default. The contract that matters: absolute, non-empty.
  const base = publicBaseUrl();
  assert.notEqual(base, "");
  assert.match(base, /^https?:\/\//);
});

// ── #3 (b): a spoofable request Host can never poison a candidate link ────────

test("a poisoned request Host that isn't the configured site host is DROPPED", () => {
  // NON-VACUITY: pre-fix, with no override the helper returned the runtime origin
  // verbatim — so `new URL(request.url).origin` reflecting an attacker Host produced
  // a candidate-delivered link on the attacker's domain. The fix drops a runtime
  // origin whose host is neither localhost nor the configured site host, falling
  // back to the trusted canonical origin.
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl("https://evil.attacker.example"), "https://app.example.com");
});

test("a request Host that MATCHES the configured site host is trusted", () => {
  setEnv("APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl("https://app.example.com"), "https://app.example.com");
});

test("a configured override still beats a poisoned Host outright", () => {
  setEnv("APP_BASE_URL", "https://public.example.com");
  setEnv("NEXT_PUBLIC_APP_BASE_URL", undefined);
  setEnv("NEXT_PUBLIC_SITE_URL", "https://app.example.com");
  assert.equal(publicBaseUrl("https://evil.attacker.example"), "https://public.example.com");
});
