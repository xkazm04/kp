// Locks the per-IP / per-token throttles on the open-mode money/compute routes
// (backlog #7 + #15). When KP_OPERATOR_PASSWORD is unset the whole API is open
// (proxy.ts), so these routes must self-limit:
//   /api/analyze          — a paid Gemini multimodal call per uncached run
//   /api/github-analysis  — up to ~31 GitHub REST calls + a paid Gemini call
//   /api/extract-text     — a Python subprocess per request; PUBLIC_API_EXACT,
//                           public even on a gated deploy
//   /api/interview/connect — provider-credential minting burns ElevenLabs /
//                           OpenAI credits; throttled per interview TOKEN
//   /api/devcase/session/[id]/chat — a real LLM call per message on a PUBLIC route
//                           (public-routes.ts lists the /api/devcase/session prefix).
//                           Two windows: a per-SESSION burst and a per-apply-TOKEN
//                           daily aggregate. Never per-IP — candidates sitting a timed
//                           assessment legitimately share a NAT.
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

// The default fixed window; a spec may override it (the devcase chat aggregate is daily).
const WINDOW_MS = 10 * 60_000;

type RouteSpec = {
  rel: string;
  /** The limiter key template exactly as it must appear in the route source. */
  key: string;
  limit: number;
  /** Source text of the limit expression when the route passes a named constant
   *  instead of the numeric literal. Pair it with `limitDef` so the constant's
   *  VALUE stays pinned too — otherwise the contract would only pin a name. */
  limitSrc?: string;
  /** The exact defining line for `limitSrc`; must appear before the limiter call. */
  limitDef?: string;
  /** A snippet marking the expensive work the limiter must precede. */
  expensive: string;
  /** Optional snippet that must run BEFORE the limiter (a branch that keeps serving freely). */
  servedBefore?: string;
  /** Window in ms, and the source text it is written as. Defaults to the 10-minute window. */
  windowMs?: number;
  windowSrc?: string;
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
    // The GitHub/Gemini harvest moved into @/app/_lib/github/analysis (F12a) — the
    // library call IS the expensive work the limiter guards.
    expensive: "buildGithubAnalysis(",
    // Cached responses must keep serving without consuming limiter budget.
    servedBefore: "readGithubCache(cacheKey)",
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
    // Self-hosted voice (ELEVENLABS_BASE_URL → loopback/private) mints nothing
    // billable, so the route raises the budget to 120/10min there (04ea66be);
    // the contract pins BOTH values via the defining line, and the behavioral
    // drive below exercises the hosted budget (6) — the one guarding real spend.
    key: "`interview-connect:${token}`",
    limit: 6,
    limitSrc: "connectLimit",
    limitDef: "const connectLimit = isSelfHostedVoice() ? 120 : 6;",
    // The provider connect moved behind the failover helper (round 8) — the
    // helper call IS the expensive work the limiter guards.
    expensive: "connectWithFailover(",
    // Lifecycle guards keep their 404/409 semantics ahead of the throttle.
    servedBefore: 'session0.status === "completed"',
  },
  {
    rel: "./devcase/session/[id]/chat/route.ts",
    // Per-SESSION burst. 30/10min = one message per 20s sustained — roughly 2-3x the
    // fastest honest loop (generate ~3-10s, read the reply, type a follow-up), so a
    // candidate never meets it while a scripted loop is pinned to 3/min.
    key: "`devcase-chat:${id}`",
    limit: 30,
    expensive: "runSessionChat(",
    // The 404/409 lifecycle refusals and the 403 token check keep their semantics
    // ahead of the throttle, so a rejected call never consumes budget.
    servedBefore: 'session.status !== "active"',
  },
  {
    rel: "./intake/[id]/message/route.ts",
    // Per-IP. 30/10min, same budget as /api/analyze: each accepted message is a
    // potentially-paid LLM exchange, and in open mode the operator gate is a
    // no-op so the route must self-limit. A coaching-paced human never meets
    // one message per 20s; a scripted loop is pinned. The 404/409/400 lifecycle
    // refusals run first so a rejected call never consumes budget.
    key: "`intake-message:${clientIpFrom(request.headers)}`",
    limit: 30,
    expensive: "runIntakeExchange(",
    servedBefore: 'intake.status !== "open"',
  },
  {
    rel: "./intake/[id]/voice-connect/route.ts",
    // Per-INTAKE, 6/10min hosted (one start + five reconnects) — credential
    // minting burns OpenAI Realtime credits, the same premise and budget as
    // interview-connect; self-hosted voice mints nothing billable so the
    // budget raises to 120. Both values pinned via the defining line.
    key: "`intake-voice-connect:${id}`",
    limit: 6,
    limitSrc: "voiceConnectLimit",
    limitDef: "const voiceConnectLimit = isSelfHostedVoice() ? 120 : 6;",
    expensive: "adapter.connect(",
    servedBefore: 'intake.status !== "open"',
  },
  {
    rel: "./intake/[id]/voice-turn/route.ts",
    // Per-INTAKE, 60/10min: the FAST voice thread — each accepted utterance is
    // a paid (fast-model) call; one per 10s sustained is ~2x natural spoken
    // pacing while a scripted loop is pinned. Keyed by intake id, not IP
    // (operator retries share the office NAT).
    key: "`intake-voice-turn:${id}`",
    limit: 60,
    expensive: "runIntakeVoiceTurn(",
    servedBefore: 'intake.status !== "open"',
  },
  {
    rel: "./intake/[id]/voice-complete/route.ts",
    // Per-IP, 20/10min: the PERIODIC extraction thread fires every few
    // exchanges of a live call (a long coaching call legitimately reaches
    // double digits) plus the hang-up recovery; a scripted loop stays pinned.
    key: "`intake-voice-complete:${clientIpFrom(request.headers)}`",
    limit: 20,
    expensive: "runIntakeTranscriptExtract(",
    servedBefore: 'intake.status !== "open"',
  },
  {
    rel: "./feedback/route.ts",
    // Per-IP. 10/10min: the dialog submits one message per open; a human never
    // meets this, while unmetered free-text storage on an open-mode deploy is a
    // spam / disk-pressure vector. Validation refuses BEFORE the limiter so a
    // rejected submission never consumes budget.
    key: "`feedback:${clientIpFrom(request.headers)}`",
    limit: 10,
    expensive: "recordFeedback(",
    servedBefore: "parseFeedbackSubmission(body)",
  },
  {
    rel: "./devcase/session/[id]/chat/route.ts",
    // Per-apply-TOKEN daily aggregate. Unlike interview-connect's per-candidate token,
    // a dev-case apply token is per-POSTING and shared by every applicant, so this
    // budget is collective: session-start caps a posting at 50 sessions/day, so 3,000
    // leaves 60 messages per session at full quota — far more than a timeboxed case
    // produces — while cutting the abuse ceiling from ~20,000 model calls/day to 3,000.
    key: "`devcase-chat-token:${session.token}`",
    limit: 3000,
    windowMs: 24 * 60 * 60_000,
    windowSrc: "24 * 60 * 60_000",
    expensive: "runSessionChat(",
    servedBefore: 'session.status !== "active"',
  },
];

for (const spec of ROUTES) {
  const windowMs = spec.windowMs ?? WINDOW_MS;
  const windowSrc = spec.windowSrc ?? "10 * 60_000";
  test(`${spec.rel} gates the expensive work behind the shared limiter (${spec.key} — ${spec.limit}/${windowSrc})`, () => {
    const src = read(spec.rel);
    assert.match(src, /from "@\/app\/_lib\/rate-limit"/, "must reuse the one shared limiter");

    const call = `rateLimit(${spec.key}, { limit: ${spec.limitSrc ?? spec.limit}, windowMs: ${windowSrc} })`;
    const at = src.indexOf(call);
    assert.ok(at >= 0, `expected the pinned limiter call:\n  ${call}`);

    // When the limit is a named constant, its defining line (with the pinned
    // VALUES) must exist and precede the call — the budget stays contract-locked.
    if (spec.limitDef) {
      const defAt = src.indexOf(spec.limitDef);
      assert.ok(defAt >= 0, `expected the pinned limit definition:\n  ${spec.limitDef}`);
      assert.ok(defAt < at, "the limit definition must precede the limiter call");
    }

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

  test(`${spec.rel} (${spec.key}): hit ${spec.limit + 1} inside one window is refused → 429`, () => {
    // Drive the real in-process limiter with the route's pinned config. `nowMs`
    // is injectable, so the window arithmetic is deterministic; the key is
    // test-unique so specs can't starve each other (keys are independent).
    const t0 = 10_000_000;
    const key = `${spec.rel}:${spec.key}:contract`;
    for (let i = 0; i < spec.limit; i++) {
      assert.equal(
        rateLimit(key, { limit: spec.limit, windowMs }, t0 + i),
        true,
        `hit ${i + 1} must pass — a legitimate burst under the limit is never blocked`,
      );
    }
    assert.equal(
      rateLimit(key, { limit: spec.limit, windowMs }, t0 + spec.limit),
      false,
      "the next hit inside the window must be refused — the route returns 429",
    );
    // A fresh window admits again: a throttled caller recovers without a restart.
    assert.equal(
      rateLimit(key, { limit: spec.limit, windowMs }, t0 + windowMs + 1),
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

// Same rule for the dev-case chat aggregate: the apply link is the credential, and an
// abuser rotates IPs while honest candidates on one office/campus NAT share one.
test("./devcase/session/[id]/chat/route.ts throttles by session + apply token, never by caller IP", () => {
  const src = read("./devcase/session/[id]/chat/route.ts");
  assert.doesNotMatch(src, /clientIpFrom/, "the devcase chat throttle must never be keyed by caller IP");
  assert.ok(
    src.includes("if (session.token && !rateLimit(`devcase-chat-token:"),
    "tokenless sessions (fixtures/seeds, never reachable from the product) carry no link to charge",
  );
});

// The other half of the same defect: a session id is a BEARER capability unless the
// owning apply token is re-checked. Pin the check on all three mutating sub-routes —
// event append + file overwrite (the flush), the model spend (chat), and finalize.
for (const rel of [
  "./devcase/session/[id]/route.ts",
  "./devcase/session/[id]/chat/route.ts",
  "./devcase/session/[id]/submit/route.ts",
]) {
  test(`${rel} re-checks the owning apply token — a session id alone is not authority`, () => {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_lib\/devcase-session-auth"/, "must reuse the shared token check");
    const at = src.indexOf("sessionTokenMatches(session.token, body.token)");
    assert.ok(at >= 0, "expected the apply-token re-check against the session's own token");
    const refusal = src.slice(at, at + 240);
    // One call now pins both facts: the shared refusal code (which the candidate
    // page localizes) and the status.
    assert.match(
      refusal,
      /jsonRefusal\("SESSION_TOKEN_REQUIRED",\s*403\)/,
      "the refusal must use the shared code at 403"
    );
    // 403, never 404/409: those two tell LiveWorkSurface the session is dead and to
    // re-mint, which would spin the per-token/day session quota on an unauthorized call.

  });
}
