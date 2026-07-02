// Locks the per-IP / per-token throttles on the open-mode money/compute routes
// (backlog #7 + #15). When KP_OPERATOR_PASSWORD is unset the whole API is open
// (proxy.ts), so these routes must self-limit:
//   /api/analyze          — a paid Gemini multimodal call per uncached run
//   /api/github-analysis  — up to ~31 GitHub REST calls + a paid Gemini call
//   /api/extract-text     — a Python subprocess per request; PUBLIC_API_EXACT,
//                           public even on a gated deploy
//   /api/interview/connect — provider-credential minting burns ElevenLabs /
//                           OpenAI credits; throttled per interview TOKEN
//
// Route modules import via the "@/..." alias, which Node's test runner does not
// resolve — so, mirroring upload-size-contract.test.ts, each route gets
//   (a) a source-level guard: the shared limiter gates the expensive work, with
//       the pinned key/limit and the shared 429 refusal envelope
//       ({ error: RATE_LIMITED_ERROR }, status 429 — the demo/offer/schedule
//       convention), placed after any branch that must keep serving freely; and
//   (b) a behavioral drive of the REAL in-process limiter with the route's
//       exact config: every hit up to the limit passes, the next hit inside the
//       window is refused (the 429 branch), and a fresh window admits again.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rateLimit } from "../_lib/rate-limit.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

// All four routes share the 10-minute fixed window.
const WINDOW_MS = 10 * 60_000;

type RouteSpec = {
  rel: string;
  /** The limiter key template exactly as it must appear in the route source. */
  key: string;
  limit: number;
  /** A snippet marking the expensive work the limiter must precede. */
  expensive: string;
  /** Optional snippet that must run BEFORE the limiter (a branch that keeps serving freely). */
  servedBefore?: string;
};

const ROUTES: RouteSpec[] = [
  {
    rel: "./analyze/route.ts",
    // Per-IP. 30/10min: the UI submits ONE request per run (multi-CV variants
    // ride together inside it), so a single operator never hits this.
    key: "`analyze:${clientIpFrom(request.headers)}`",
    limit: 30,
    expensive: "startTask(",
  },
  {
    rel: "./github-analysis/route.ts",
    // Per-IP. 10/10min uncached runs; GitHub's anonymous 60/hr cap binds first.
    key: "`github-analysis:${clientIpFrom(request.headers)}`",
    limit: 10,
    expensive: "githubFetch<GithubUser>",
    // Cached responses must keep serving without consuming limiter budget.
    servedBefore: "githubCache.get(cacheKey)",
  },
  {
    rel: "./extract-text/route.ts",
    // Per-IP. 20/10min: one extract per JD/CV file in every real flow.
    key: "`extract-text:${clientIpFrom(request.headers)}`",
    limit: 20,
    expensive: "spawnPython(",
  },
  {
    rel: "./interview/connect/route.ts",
    // Per-TOKEN (the link is the credential; IP rotation must not reset it).
    // 6/10min = one start + five legitimate reconnects after dropped calls.
    key: "`interview-connect:${token}`",
    limit: 6,
    expensive: "adapter.connect(",
    // Lifecycle guards keep their 404/409 semantics ahead of the throttle.
    servedBefore: 'session0.status === "completed"',
  },
];

for (const spec of ROUTES) {
  test(`${spec.rel} gates the expensive work behind the shared limiter (${spec.limit}/10min)`, () => {
    const src = read(spec.rel);
    assert.match(src, /from "@\/app\/_lib\/rate-limit"/, "must reuse the one shared limiter");

    const call = `rateLimit(${spec.key}, { limit: ${spec.limit}, windowMs: 10 * 60_000 })`;
    const at = src.indexOf(call);
    assert.ok(at >= 0, `expected the pinned limiter call:\n  ${call}`);

    // The refusal must follow the shared 429 convention used by every existing
    // limiter consumer: the shared message, status 429, nothing bespoke.
    const refusal = src.slice(at, at + 400);
    assert.match(refusal, /RATE_LIMITED_ERROR/, "the refusal must use the shared message");
    assert.match(refusal, /status:\s*429/, "the refusal must be a 429");

    // The limiter must run BEFORE the expensive work it guards…
    const expensiveAt = src.indexOf(spec.expensive);
    assert.ok(expensiveAt > at, `the limiter must precede ${spec.expensive}`);

    // …and AFTER any branch that must keep serving freely (cache hits, the
    // lifecycle refusals) so those paths never consume or mask the budget.
    if (spec.servedBefore) {
      const beforeAt = src.indexOf(spec.servedBefore);
      assert.ok(
        beforeAt >= 0 && beforeAt < at,
        `${spec.servedBefore} must come before the limiter call`,
      );
    }
  });

  test(`${spec.rel}: hit ${spec.limit + 1} inside one window is refused → 429`, () => {
    // Drive the real in-process limiter with the route's pinned config. `nowMs`
    // is injectable, so the window arithmetic is deterministic; the key is
    // test-unique so specs can't starve each other (keys are independent).
    const t0 = 10_000_000;
    const key = `${spec.rel}:contract`;
    for (let i = 0; i < spec.limit; i++) {
      assert.equal(
        rateLimit(key, { limit: spec.limit, windowMs: WINDOW_MS }, t0 + i),
        true,
        `hit ${i + 1} must pass — a legitimate burst under the limit is never blocked`,
      );
    }
    assert.equal(
      rateLimit(key, { limit: spec.limit, windowMs: WINDOW_MS }, t0 + spec.limit),
      false,
      "the next hit inside the window must be refused — the route returns 429",
    );
    // A fresh window admits again: a throttled caller recovers without a restart.
    assert.equal(
      rateLimit(key, { limit: spec.limit, windowMs: WINDOW_MS }, t0 + WINDOW_MS + 1),
      true,
      "a fresh window must admit again",
    );
  });
}

// The connect throttle exists to protect credential minting per TOKEN — assert
// it is not quietly re-keyed to the caller's IP (which an abuser rotates) and
// that tokenless lab sessions (no key to charge) are left to their own gate.
test("./interview/connect/route.ts throttles by token, not by caller IP", () => {
  const src = read("./interview/connect/route.ts");
  const at = src.indexOf("rateLimit(`interview-connect:");
  assert.ok(at >= 0, "expected the per-token limiter call");
  const call = src.slice(at, src.indexOf(")", at) + 1);
  assert.doesNotMatch(call, /clientIpFrom/, "the connect throttle must be keyed by token only");
  assert.ok(
    src.includes("if (token && !rateLimit(`interview-connect:"),
    "tokenless lab sessions carry no token to charge — they stay on their own dev-only gate",
  );
});
