// perfect: offer-countdown-stays-honest (2026-09-01). The countdown a candidate
// sees is computed where the expiry is enforced (hoursRemaining, server-side) —
// but it used to be computed ONCE at first load and never again, so a tab left
// open overnight said "12 hours left" over an offer the server had already
// lapsed; the accept click was then refused with 410. The page now revalidates
// on an interval and on focus, stops at terminal, and never lets a failed refresh
// replace a rendered offer.
//
// Source-contract test (the repo pattern for client wiring the node runner can't
// mount — OfferClient is JSX), plus the throttle arithmetic replayed through the
// REAL limiter at the route's pinned bound, exactly as status-rate-limit.test.ts
// does for the status page: adding a poll to a throttled public route is only
// safe if normal use can never meet the bound.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "../_lib/rate-limit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const clientSrc = readFileSync(path.join(HERE, "[token]", "OfferClient.tsx"), "utf8");
const routeSrc = readFileSync(path.join(HERE, "..", "api", "offer", "[token]", "route.ts"), "utf8");

function num(src: string, re: RegExp, what: string): number {
  const m = src.match(re);
  assert.ok(m, `${what} must stay a literal the test can read`);
  return Number(m[1].replace(/_/g, ""));
}

test("the offer page revalidates on an interval and on focus, and stops once the offer is terminal", () => {
  assert.match(clientSrc, /const POLL_MS = [\d_]+;/, "the poll interval is a readable literal");
  assert.match(clientSrc, /addEventListener\("visibilitychange", revalidate\)/, "revalidates when the tab becomes visible");
  assert.match(clientSrc, /window\.addEventListener\("focus", revalidate\)/, "revalidates when the window regains focus");
  assert.match(clientSrc, /if \(!token \|\| terminal\) return;/, "a terminal offer stops polling");
  assert.match(clientSrc, /const terminal = result !== null \|\| notFound;/, "terminal covers accepted/declined/expired AND a revoked link");
});

test("a failed refresh never replaces a rendered offer — only the initial load owns loadError", () => {
  const at = clientSrc.indexOf("const refresh = useCallback(");
  assert.ok(at > 0, "refresh must exist");
  const body = clientSrc.slice(at, clientSrc.indexOf("}, [token]);", at));
  assert.doesNotMatch(body, /setLoadError/, "refresh must never raise the whole-card load error");
  assert.match(body, /r\.status === 404/, "a 404 (revoked link) is a definite state change and may replace the view");
  assert.match(body, /setOffer\(p\.offer as OfferView\)/, "a good answer refreshes the server-computed countdown");
});

test("the post-POST reconcile rides the same silent refresh", () => {
  assert.doesNotMatch(clientSrc, /reconcile\(/, "one re-read path, not two — no call to a separate reconcile");
  const respondAt = clientSrc.indexOf("const respond = async");
  const respondBody = clientSrc.slice(respondAt, clientSrc.indexOf("\n  };\n", respondAt));
  assert.equal((respondBody.match(/void refresh\(\);/g) ?? []).length, 2, "both POST failure branches (non-OK and thrown) re-read the authoritative status");
});

test("normal revalidation never reaches the offer-view throttle — with an order of magnitude to spare", () => {
  const limit = num(routeSrc, /const OFFER_VIEW_RATE_LIMIT = \{ limit: ([\d_]+), windowMs: [\d_]+ \}/, "OFFER_VIEW_RATE_LIMIT.limit");
  const windowMs = num(routeSrc, /const OFFER_VIEW_RATE_LIMIT = \{ limit: [\d_]+, windowMs: ([\d_]+) \}/, "OFFER_VIEW_RATE_LIMIT.windowMs");
  const pollMs = num(clientSrc, /const POLL_MS = ([\d_]+);/, "POLL_MS");
  const perWindow = windowMs / pollMs;
  assert.ok(perWindow < limit / 10, `polling (${perWindow}/window) must sit an order of magnitude under the ${limit} cap`);

  // Replay a full window of the real traffic shape: every poll, plus a focus
  // revalidation AND a manual reload between each one (3x the honest rate).
  const key = "offer-view:local:tok-normal";
  const t0 = 7_000_000;
  for (let i = 0; i < Math.max(1, Math.floor(perWindow)); i++) {
    for (let k = 0; k < 3; k++) {
      assert.equal(rateLimit(key, { limit, windowMs }, t0 + i * pollMs + k), true, "a revalidating candidate must never be throttled");
    }
  }
});
