// /api/status/[token] was the last PUBLIC token route with no throttle, while
// its offer / schedule siblings all have one. Adding one to a route
// the candidate's own page POLLS is only safe if the bound cannot be reached by
// normal use — a candidate who gets "Too many requests" while watching their
// application would read it as the app breaking.
//
// So this pins BOTH halves against the route's real, single-sourced numbers: the
// wiring (source-contract — importing the route would pull in `next/server`,
// which the unit runner can't resolve) and the arithmetic, replayed through the
// actual limiter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rateLimit } from "../../_lib/rate-limit.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(path.join(HERE, "[token]", "route.ts"), "utf8");
const clientSrc = readFileSync(path.join(HERE, "..", "..", "status", "[token]", "StatusClient.tsx"), "utf8");

/** The route's OWN bound, read from source so this test can never drift from it. */
function statusRateLimit(): { limit: number; windowMs: number } {
  const m = routeSrc.match(/const STATUS_RATE_LIMIT = \{ limit: ([\d_]+), windowMs: ([\d_]+) \}/);
  assert.ok(m, "STATUS_RATE_LIMIT must stay a literal the test can read");
  return { limit: Number(m[1].replace(/_/g, "")), windowMs: Number(m[2].replace(/_/g, "")) };
}

test("the status route throttles before it reads the store, keyed by token AND client", () => {
  assert.match(
    routeSrc,
    /rateLimit\(`status:\$\{clientIpFrom\(request\.headers\)\}:\$\{token\}`, STATUS_RATE_LIMIT\)/,
    "sibling-pattern key: per token AND client, so the untrusted-proxy shared client key still gives each candidate their own bucket"
  );
  assert.match(
    routeSrc,
    /jsonRefusal\("TOO_MANY_REQUESTS", 429\)/,
    "over the limit answers the ONE registered refusal, so the status page can say so in the candidate's language"
  );
  const limitAt = routeSrc.indexOf("rateLimit(");
  const readAt = routeSrc.indexOf("getEntryIdByStatusToken(");
  assert.ok(limitAt > 0 && limitAt < readAt, "a flood must be rejected before the store reads");
});

test("normal polling never reaches the limit — with an order of magnitude to spare", () => {
  const { limit, windowMs } = statusRateLimit();
  // The client's real poll interval, read from its source for the same reason.
  const pollMs = Number((clientSrc.match(/const POLL_MS = ([\d_]+)/)?.[1] ?? "").replace(/_/g, ""));
  assert.ok(pollMs > 0, "StatusClient must keep POLL_MS a readable literal");

  const perWindow = windowMs / pollMs;
  assert.ok(perWindow < limit / 10, `polling (${perWindow}/window) must sit an order of magnitude under the ${limit} cap`);

  // Replay a full window of the real traffic shape: every poll, plus a focus
  // revalidation AND a manual Refresh between each one (3x the honest rate).
  const key = "status:local:tok-normal";
  const t0 = 5_000_000;
  for (let i = 0; i < Math.floor(perWindow); i++) {
    for (let k = 0; k < 3; k++) {
      assert.equal(rateLimit(key, { limit, windowMs }, t0 + i * pollMs + k), true, "a polling candidate must never be throttled");
    }
  }
});

test("a burst well past human speed IS refused, and recovers next window", () => {
  const { limit, windowMs } = statusRateLimit();
  const key = "status:local:tok-burst";
  const t0 = 9_000_000;
  for (let i = 0; i < limit; i++) assert.equal(rateLimit(key, { limit, windowMs }, t0 + i), true);
  assert.equal(rateLimit(key, { limit, windowMs }, t0 + limit), false, "past the cap the scraper is refused");
  // Containment, not a ban: the candidate's next window works again.
  assert.equal(rateLimit(key, { limit, windowMs }, t0 + windowMs + 1), true);
});

test("one candidate's burst cannot throttle another's status page", () => {
  const { limit, windowMs } = statusRateLimit();
  const t0 = 11_000_000;
  for (let i = 0; i <= limit; i++) rateLimit("status:local:tok-noisy", { limit, windowMs }, t0 + i);
  assert.equal(rateLimit("status:local:tok-quiet", { limit, windowMs }, t0 + limit), true, "buckets are per token");
});
