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
  /** Source text when the route passes a whole named OPTIONS OBJECT rather than an
   *  inline `{ limit, windowMs }` literal (e.g. `rateLimit(key, APPLY_RATE_LIMIT)`).
   *  Pair it with `optsDef` so the constant's VALUES stay pinned too — otherwise the
   *  contract would pin only a name, which a later edit could redefine freely. */
  optsSrc?: string;
  /** The exact defining line for `optsSrc`; must precede the limiter call and must
   *  itself spell out the pinned limit and window. */
  optsDef?: string;
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
    // ADDED with the route (voice-tts package, 2026-08-23). Operator-gated, but
    // open mode makes that a no-op: a cloud call costs money and a local call
    // spawns a sidecar per request. 60/10min per IP — the compare panel is one
    // click per utterance.
    rel: "./tts/route.ts",
    key: "`tts:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "TTS_RATE_LIMIT",
    optsDef: "const TTS_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    expensive: "getTts().speak(",
  },
  {
    rel: "./analyze/route.ts",
    // Per-IP. 30/10min: the UI submits ONE request per run (multi-CV variants
    // ride together inside it), so a single operator never hits this.
    key: "`analyze:${clientIpFrom(request.headers)}`",
    limit: 30,
    expensive: "startTask(",
  },
  {
    // ADDED scan-sweep 2026-08-22. This route reaches the SAME startTask that
    // ./analyze throttles and ./jds/generate operator-gates — it had neither, so an
    // anonymous /api/demo session could spend unbounded LLM credit through it.
    // 120/10min is deliberately generous: a 50-card bulk accept in the Decisions
    // queue is a legitimate 50-request burst.
    rel: "./tasks/route.ts",
    key: "`tasks-start:${clientIpFrom(request.headers)}`",
    limit: 120,
    expensive: "startTask(",
  },
  {
    // ADDED scan-sweep 2026-08-22. Every accepted retry re-spends; the limiter sits
    // after the ownership/status refusals so a rejected click costs no budget.
    rel: "./tasks/[id]/retry/route.ts",
    key: "`tasks-retry:${clientIpFrom(request.headers)}`",
    limit: 20,
    // The CALL SITE, not the bare `startTask(` this file uses elsewhere: that
    // substring also appears in this route's header comment, which precedes the
    // limiter, so the generic marker would fail on prose rather than on ordering.
    expensive: "startTask(task.kind",
    servedBefore: "RETRYABLE.has(task.status)",
  },
  // The four PUBLIC apply surfaces. Every one is unauthenticated, spawns the
  // deterministic profile_cli and writes a pipeline entry, and every one has
  // carried a limiter since it shipped — but none was PINNED until the
  // scan-sweep of 2026-08-24 noticed the gap. That is the failure mode this file
  // exists for: an unpinned limiter can be re-keyed, widened or moved below the
  // expensive work by a later edit with nothing to catch it. Each passes a named
  // constant, so limitSrc+limitDef keep the VALUE pinned and not just the name.
  {
    rel: "./apply/[id]/route.ts",
    key: "`apply:${id}:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "APPLY_RATE_LIMIT",
    optsDef: "const APPLY_RATE_LIMIT = { limit: 20, windowMs: 60_000 };",
    expensive: "buildApplicantProfile(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    rel: "./apply/[id]/quick/route.ts",
    key: "`apply-quick:${id}:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "QUICK_APPLY_RATE_LIMIT",
    optsDef: "const QUICK_APPLY_RATE_LIMIT = { limit: 30, windowMs: 60_000 };",
    expensive: "intakeLead(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    rel: "./apply/[id]/followup/route.ts",
    key: "`apply-followup:${id}:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "FOLLOWUP_RATE_LIMIT",
    optsDef: "const FOLLOWUP_RATE_LIMIT = { limit: 10, windowMs: 60_000 };",
    expensive: "renormalizeApplicantProfile(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    rel: "./apply/[id]/session/route.ts",
    key: "`apply-session:${id}:${clientIpFrom(request.headers)}`",
    limit: 12,
    optsSrc: "SESSION_RATE_LIMIT",
    optsDef: "const SESSION_RATE_LIMIT = { limit: 12, windowMs: 60_000 };",
    expensive: "startApplySession(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    // ADDED scan-sweep 2026-08-24. The SYNCHRONOUS twin of ./tasks/route.ts kind
    // "reasoning" — same runReasoning, same LLM spend, but reachable directly and
    // unlimited until now. 60/10min is below the batch path's 120 because a matrix
    // session legitimately opens many cells.
    rel: "./match/reasoning/route.ts",
    key: "`match-reasoning:${clientIpFrom(request.headers)}`",
    limit: 60,
    expensive: "runReasoning(",
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
    // ADDED with the route (operator companion WP2). Per-IP. 30/10min: every
    // accepted message spawns companion_cli AND makes a paid `assistant` call.
    // Operator-gated, but open mode makes that a no-op for the whole API.
    rel: "./companion/[id]/message/route.ts",
    key: "`companion-message:${clientIpFrom(request.headers)}`",
    limit: 30,
    expensive: "runCompanionTurn(",
    // The 404 (unknown / other-tenant thread) and the 400 (empty message) keep
    // their semantics ahead of the throttle, so a rejected call never consumes budget.
    servedBefore: "if (!thread) return NextResponse.json",
  },
  {
    // ADDED with the route (operator companion WP3). Per-IP. 60/10min: accepting
    // a proposal DISPATCHES — a screening call, a JD build, an outreach letter, a
    // digest — so an unlimited accept endpoint is an unlimited spend endpoint.
    // Operator-gated, but open mode makes that a no-op for the whole API. The
    // budget sits far above a human reading cards and clicking Accept.
    rel: "./companion/proposals/[id]/resolve/route.ts",
    key: "`companion-resolve:${clientIpFrom(request.headers)}`",
    limit: 60,
    // The CALL SITE. `claimProposal(` also appears in this route's import, which
    // precedes the limiter, so the generic marker would fail on ordering rather
    // than on a real regression.
    expensive: "spec.execute(revalidated.params, {",
    // The 404 (unknown / other-tenant proposal), the 400 (a decision that is
    // neither accept nor decline) and the 409 (already answered) all keep their
    // semantics ahead of the throttle, so a rejected call never consumes budget —
    // and a second dock racing the first is the ordinary case here, not abuse.
    servedBefore: 'if (proposal.status !== "open")',
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
    limitDef: "const connectLimit = isSelfHostedProvider(provider) ? 120 : 6;",
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
    // KP_BENCH_MODE=1 (server env, local app-master bench only — see
    // scripts/app-master-bench) raises the budget to 600 so a scripted sweep
    // is not throttled at human pace. The contract pins BOTH budgets and the
    // env gate: the human default must stay 30, and the raise must remain
    // server-env-gated, never reachable from a request.
    limitSrc: "benchMode ? 600 : 30",
    limitDef: 'const benchMode = process.env.KP_BENCH_MODE === "1";',
    expensive: "runIntakeExchange(",
    servedBefore: 'intake.status !== "open"',
  },
  {
    // ADDED scan-sweep 2026-08-24, with the limiter itself. In open mode
    // (requireOperator is a documented no-op there) the whole intake spend chain
    // was unlimited: POST /api/intake spawns intake_cli per request, and promote
    // starts a full paid jd_build. Both budgets sit far above human pace — a
    // session is a ten-minute conversation; a promote produces a JD to read.
    rel: "./intake/route.ts",
    key: "`intake-create:${clientIpFrom(request.headers)}`",
    limit: 30,
    // The CALL SITE, not a bare `runIntakeOpening(`: that substring also appears in
    // this route's IMPORT and in the comment above the limiter, both of which
    // precede it — so the generic marker would fail on prose, not on ordering.
    // `lang,` (with the comma) since the App-master shape added a second
    // argument: `runIntakeOpening(lang, scanId ? "app_master" : undefined)`.
    expensive: "runIntakeOpening(lang,",
  },
  {
    rel: "./intake/[id]/promote/route.ts",
    key: "`intake-promote:${clientIpFrom(request.headers)}`",
    limit: 20,
    // The limiter sits AFTER the cheap 404/409/400 refusals, so a request that was
    // never going to promote costs no budget.
    // Same reason: `insertAnalyzingJd(` appears in this route's own comment above
    // the limiter. Pin the call's opening brace instead.
    expensive: "insertAnalyzingJd({",
    servedBefore: "briefReadyToPromote(intake.brief)",
  },
  {
    rel: "./intake/[id]/voice-connect/route.ts",
    // Per-INTAKE, 6/10min FLAT (one start + five reconnects) — credential minting
    // burns OpenAI Realtime credits, the same premise and budget as
    // interview-connect. The self-hosted raise to 120 that used to sit here was
    // removed from the route (scan-sweep 2026-08-24): this handler mints
    // getVoiceAdapter("openai") credentials and ONLY those, so a locally
    // configured ElevenLabs is unreachable from it and the "nothing billable is
    // minted" premise was false — the raise let one open intake id mint 120 PAID
    // ephemeral credentials per 10 minutes. Value pinned via the defining line.
    key: "`intake-voice-connect:${id}`",
    limit: 6,
    limitSrc: "voiceConnectLimit",
    limitDef: "const voiceConnectLimit = 6;",
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
    // App master (P2). Per-IP. Every accepted scan is a `git clone` plus a Python
    // subprocess plus, when a provider is configured, an in-repo Claude Code
    // session — by far the largest unit of work any single POST here buys. The
    // operator gate above it stops a stranger; this stops a loop. 10/10min is the
    // same budget as ./github-analysis, which guards a much cheaper harvest.
    rel: "./repo-scan/route.ts",
    key: "`repo-scan:${clientIpFrom(request.headers)}`",
    limit: 10,
    // The CALL SITE, not a bare `startRepoScan(`: that substring also appears in
    // this route's import and header comment, both of which precede the limiter, so
    // the generic marker would fail on prose rather than on ordering.
    expensive: "startRepoScan(\n",
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

    const opts = spec.optsSrc ?? `{ limit: ${spec.limitSrc ?? spec.limit}, windowMs: ${windowSrc} }`;
    const call = `rateLimit(${spec.key}, ${opts})`;
    const at = src.indexOf(call);
    assert.ok(at >= 0, `expected the pinned limiter call:\n  ${call}`);

    // When the limit is a named constant, its defining line (with the pinned
    // VALUES) must exist and precede the call — the budget stays contract-locked.
    if (spec.limitDef) {
      const defAt = src.indexOf(spec.limitDef);
      assert.ok(defAt >= 0, `expected the pinned limit definition:\n  ${spec.limitDef}`);
      assert.ok(defAt < at, "the limit definition must precede the limiter call");
    }

    // Same contract for a named options OBJECT: it must exist, precede the call,
    // and literally carry the pinned limit and window — so re-pointing the constant
    // at a laxer budget is a red test rather than a silent widening.
    if (spec.optsDef) {
      const optsAt = src.indexOf(spec.optsDef);
      assert.ok(optsAt >= 0, `expected the pinned limiter options:
  ${spec.optsDef}`);
      assert.ok(optsAt < at, "the limiter options must precede the limiter call");
      assert.ok(
        spec.optsDef.includes(`limit: ${spec.limit}`) && spec.optsDef.includes(`windowMs: ${windowSrc}`),
        "the pinned options line must spell out the limit and window this spec claims",
      );
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
