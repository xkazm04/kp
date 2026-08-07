// bug-ui-scan-2026-07-09 (skill-matrix-coverage #2): the public skill-profile verify
// oracle must throttle per client IP so its token space can't be walked to enumerate
// credentials / harvest summaries. This mirrors app/api/rate-limit-contract.test.ts:
//   (a) a SOURCE-level guard — the shared limiter gates the verify work with the pinned
//       key/limit and the shared 429 refusal envelope ({ error: RATE_LIMITED_ERROR },
//       status 429); and
//   (b) a BEHAVIORAL drive of the real in-process limiter with the route's exact config.
// Route modules import via "@/…" (which node's test runner won't resolve), so the guard
// reads the route as text; the behavioral half drives the real limiter directly.
//
// Runner: node --test with type stripping. `npm run test:unit`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rateLimit } from "../../../../_lib/rate-limit.ts";

const routeSrc = readFileSync(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");

const LIMIT = 30;
const WINDOW_MS = 10 * 60_000;
const KEY = "`skill-verify:${clientIpFrom(request.headers)}`";

test("verify route gates behind the ONE shared per-IP limiter (30/10min)", () => {
  assert.match(routeSrc, /from "@\/app\/_lib\/rate-limit"/, "must reuse the shared limiter");

  const call = `rateLimit(${KEY}, { limit: ${LIMIT}, windowMs: 10 * 60_000 })`;
  const at = routeSrc.indexOf(call);
  assert.ok(at >= 0, `expected the pinned per-IP limiter call:\n  ${call}`);

  // Shared refusal convention: the shared message + a 429, nothing bespoke.
  const refusal = routeSrc.slice(at, at + 400);
  assert.match(refusal, /RATE_LIMITED_ERROR/, "the refusal must use the shared message");
  assert.match(refusal, /status:\s*429/, "the refusal must be a 429");

  // The throttle must PRECEDE the oracle work (the verify + summary dump) so a walker
  // can't spend the summary before being rate-limited.
  const workAt = routeSrc.indexOf("verifySkillProfileToken(token)");
  assert.ok(workAt > at, "the limiter must run before verifySkillProfileToken(token)");
});

test("verify route keys the throttle by client IP, not by token", () => {
  // Per-TOKEN keying would be useless here: enumeration presents a DIFFERENT token each
  // hit, so every guess would land in its own fresh bucket. It must be per-IP.
  const at = routeSrc.indexOf("rateLimit(`skill-verify:");
  assert.ok(at >= 0, "expected the per-IP limiter call");
  const call = routeSrc.slice(at, routeSrc.indexOf(")", at) + 1);
  assert.match(call, /clientIpFrom\(request\.headers\)/, "the throttle must be keyed by caller IP");
});

test(`hit ${LIMIT + 1} inside one window is refused → 429`, () => {
  // Drive the REAL limiter with the route's pinned config; nowMs injected for determinism.
  const t0 = 20_000_000;
  const key = "skill-verify:contract";
  for (let i = 0; i < LIMIT; i++) {
    assert.equal(
      rateLimit(key, { limit: LIMIT, windowMs: WINDOW_MS }, t0 + i),
      true,
      `hit ${i + 1} must pass — a legitimate burst under the limit is never blocked`,
    );
  }
  assert.equal(
    rateLimit(key, { limit: LIMIT, windowMs: WINDOW_MS }, t0 + LIMIT),
    false,
    "the next hit inside the window must be refused — the route returns 429",
  );
  assert.equal(
    rateLimit(key, { limit: LIMIT, windowMs: WINDOW_MS }, t0 + WINDOW_MS + 1),
    true,
    "a fresh window must admit again — a throttled caller recovers without a restart",
  );
});
