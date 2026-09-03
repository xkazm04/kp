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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { rateLimit } from "../_lib/rate-limit.ts";

const apiDir = path.dirname(fileURLToPath(import.meta.url));

/** Every route module under app/api — for the tree-walking rules at the bottom of
 *  this file (the named specs above cover one file each). */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      out.push(p);
    }
  }
  return out;
}

function read(rel: string): string {
  // Line endings normalised: a checkout with core.autocrlf=true carries CRLF, and
  // a marker that ends in a newline (the repo-scan call site, chosen so the
  // import line does not match) then never matches - the test went red on
  // Windows for an ordering the route had right all along. The contract is
  // about ORDER in the source, never about the byte that ends a line.
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
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
  /** Routes that answer the throttle through the REFUSAL CHOKEPOINT
   *  (`jsonRefusal("TOO_MANY_REQUESTS", 429)`) rather than hand-rolling the
   *  envelope. The shared message still reaches the client — REFUSAL_ERRORS'
   *  TOO_MANY_REQUESTS IS `RATE_LIMITED_ERROR`, pinned by its own test below —
   *  and the response additionally carries the machine code, so a throttled dock
   *  can say WHICH refusal happened in the reader's language instead of painting
   *  the server's English string (api-contracts.md 1.1). */
  refusalCode?: "TOO_MANY_REQUESTS";
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
    // Moved onto the chokepoint: the dock renders errors.TOO_MANY_REQUESTS in
    // the reader's language instead of the server's English string.
    refusalCode: "TOO_MANY_REQUESTS",
    // The limiter precedes the CACHE LOOKUP too, not just the engine: a hit is
    // cheap but not free, and a throttle that only counted misses would let a
    // burst walk the whole window for nothing.
    expensive: "speakCached(",
  },
  {
    // ADDED with the route (voice-stt package). The TIGHTEST of the three voice
    // routes on purpose: one call here is billed per audio HOUR on the cloud
    // path (AssemblyAI) and occupies a CPU for minutes on the local one
    // (whisper.cpp), where /api/tts's unit is a sentence. 20/10min per IP.
    rel: "./stt/route.ts",
    key: "`stt:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "STT_RATE_LIMIT",
    optsDef: "const STT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "getStt().transcribe(",
  },
  {
    rel: "./analyze/route.ts",
    // Per-IP. 30/10min: the UI submits ONE request per run (multi-CV variants
    // ride together inside it), so a single operator never hits this.
    key: "`analyze:${clientIpFrom(request.headers)}`",
    limit: 30,
    // Moved onto the chokepoint with the analyze-refusal conversion: the form
    // renders errors.TOO_MANY_REQUESTS in the reader's language (and "try again
    // in N seconds" when a fronting proxy sent a Retry-After) instead of the
    // server's English string.
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "startTask(",
  },
  {
    // ADDED scan-sweep 2026-08-22. This route reaches the SAME startTask that
    // ./analyze throttles and ./jds/generate operator-gates — it had neither, so an
    // anonymous /api/demo session could spend unbounded LLM credit through it.
    // 120/10min is deliberately generous: a 50-card bulk accept in the Decisions
    // queue is a legitimate 50-request burst.
    rel: "./tasks/route.ts",
    key: "`tasks-start:${ip}`",
    limit: 120,
    optsSrc: "TASKS_START_RATE_LIMIT",
    optsDef: "const TASKS_START_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "startTask(",
  },
  {
    // ADDED scan-sweep 2026-08-22. Every accepted retry re-spends; the limiter sits
    // after the ownership/status refusals so a rejected click costs no budget.
    rel: "./tasks/[id]/retry/route.ts",
    key: "`tasks-retry:${ip}`",
    limit: 20,
    optsSrc: "TASKS_RETRY_RATE_LIMIT",
    optsDef: "const TASKS_RETRY_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
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
    // ADDED 2026-09-01 (perfect: open-doors-throttled). The Art. 17 erasure door:
    // its POST is an IRREVERSIBLE anonymizeEntry and was the one public token door
    // with no limiter. Both verbs keyed per token AND client, like status; the
    // limiter precedes the token lookup so a flood never reaches the store.
    rel: "./data/[token]/route.ts",
    key: "`data-view:${clientIpFrom(request.headers)}:${token}`",
    limit: 60,
    optsSrc: "DATA_VIEW_RATE_LIMIT",
    optsDef: "const DATA_VIEW_RATE_LIMIT = { limit: 60, windowMs: 60_000 };",
    expensive: "findEntryByErasureToken(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    rel: "./data/[token]/route.ts",
    key: "`data-erase:${clientIpFrom(request.headers)}:${token}`",
    limit: 10,
    optsSrc: "DATA_ERASE_RATE_LIMIT",
    optsDef: "const DATA_ERASE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };",
    expensive: "anonymizeEntry(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    // ADDED 2026-09-01 (perfect: open-doors-throttled). The invited-member door:
    // GET discloses the invitee's email + org name to any token holder, POST creates
    // a user, a membership and a session cookie. Its sibling /api/auth/register is
    // throttled; this path into the same tenant was not.
    rel: "./invite/[token]/route.ts",
    key: "`invite-view:${clientIpFrom(request.headers)}:${token}`",
    limit: 10,
    optsSrc: "INVITE_RATE_LIMIT",
    optsDef: "const INVITE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };",
    expensive: "getRedeemableInvite(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    rel: "./invite/[token]/route.ts",
    key: "`invite-redeem:${clientIpFrom(request.headers)}:${token}`",
    limit: 10,
    optsSrc: "INVITE_RATE_LIMIT",
    optsDef: "const INVITE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };",
    expensive: "acceptInvite(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    // ADDED 2026-09-01 (perfect: open-doors-throttled). The offer GET runs
    // expireOfferIfDue — a write — on every hit and only the POST was throttled.
    // 60/min: the page revalidates every 60s plus on focus, an order of magnitude under.
    rel: "./offer/[token]/route.ts",
    key: "`offer-view:${clientIpFrom(request.headers)}:${token}`",
    limit: 60,
    optsSrc: "OFFER_VIEW_RATE_LIMIT",
    optsDef: "const OFFER_VIEW_RATE_LIMIT = { limit: 60, windowMs: 60_000 };",
    expensive: "offerView(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    // ADDED 2026-09-02 (perfect: token-doors-get-an-axe-pass). The offer POST has
    // been throttled since idea-3e49abaf, but it was the ONE public token verb the
    // contract never pinned — so the budget on the most consequential candidate
    // action in the product (accept hires and fires the ATS handoff; decline closes
    // the entry, irreversibly) was a line of code nothing defended. Keyed per
    // client AND token like its GET sibling; 10/min is generous for a decision a
    // candidate makes once.
    rel: "./offer/[token]/route.ts",
    key: "`offer:${clientIpFrom(request.headers)}:${token}`",
    limit: 10,
    expensive: "respondToOffer(",
    windowMs: 60_000,
    windowSrc: "60_000",
  },
  {
    // ADDED /perfect 2026-09-03 (match-route-answers-like-its-siblings). The
    // candidate-focus ranking. No model spend, but every accepted call spawns
    // match_cli AND first writes the ENTIRE live job corpus to a temp file — a
    // process and an unbounded disk write per request, which is exactly the
    // ./extract-text rationale one directory over. Its own reasoning sibling below
    // was limited for the same reason a week earlier; this door was simply missed.
    // 60/10min per IP: the focus panel fires ONE request per run, so a recruiter
    // re-ranking all afternoon never meets it and a scripted loop meets it at once.
    rel: "./match/route.ts",
    key: "`match:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "MATCH_RATE_LIMIT",
    optsDef: "const MATCH_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The FIRST thing that touches the disk. The limiter must precede createWorkdir,
    // not merely spawnPython: a throttled call must leave no temp dir behind either.
    expensive: "await createWorkdir()",
    // The body parse keeps its place ahead of the budget — it costs nothing, and a
    // malformed request must be refused honestly rather than counted as traffic.
    servedBefore: "await request.json()",
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
    // Moved onto the refusal chokepoint (/perfect 2026-09-03, matrix-ui-2): the grid's
    // popover resolves the code, so a throttled recruiter reads "you're going too fast"
    // in their own language instead of the generic engine-failure sentence.
    refusalCode: "TOO_MANY_REQUESTS",
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
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "runCompanionTurn(",
    // The 404 (unknown / other-tenant thread) and the 400 (empty message) keep
    // their semantics ahead of the throttle, so a rejected call never consumes budget.
    servedBefore: 'if (!thread) return jsonRefusal("COMPANION_THREAD_NOT_FOUND", 404)',
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
    refusalCode: "TOO_MANY_REQUESTS",
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
    // ADDED with the route (operator companion WP4). Per-IP. 20/10min: recording
    // consent spawns companion_cli, and the `birth` arm WRITES into the
    // operator's home directory. It is answered ONCE at first run, so the budget
    // sits far above any honest use and only a scripted loop can meet it.
    rel: "./companion/brain/route.ts",
    key: "`companion-brain:${clientIpFrom(request.headers)}`",
    limit: 20,
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE. Both helper names also appear in the import block above the
    // limiter, so a bare name would fail on ordering rather than on a regression.
    expensive: "? await birthCompanionBrain()",
    // The 400 (an action that is neither connect nor birth) keeps its semantics
    // ahead of the throttle, so a malformed call never starts a process.
    servedBefore: 'action !== "connect" && action !== "birth"',
  },
  {
    // ADDED 2026-09-02 with the limiter itself (companion-route-hygiene). The GET
    // in the SAME file was the one companion handler that spawned a Python child
    // with no throttle at all: `companion_cli --probe` creates nothing and calls
    // no model, but it is still a process per request, and in open mode the
    // operator gate above it is a no-op for the whole API — so a polling tab could
    // keep the box spawning. 60/10min (one probe per 10s sustained) is far above a
    // wizard that asks the question a handful of times at first run, and three
    // times the POST's budget because nothing here writes to the operator's home
    // directory.
    rel: "./companion/brain/route.ts",
    key: "`companion-brain-probe:${clientIpFrom(request.headers)}`",
    limit: 60,
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE inside GET. A bare `probeCompanionBrain(` also appears in the
    // import block and in the POST, so the generic marker would pass on the wrong
    // occurrence rather than pin this handler.
    expensive: "companionBrainStatus(await probeCompanionBrain(), ws)",
  },
  {
    // ADDED /perfect 2026-09-03 (profile-editor-keeps-hand-edits) WITH the limiter.
    // The synchronous AI profile-draft door spawns a PAID model child per call and had
    // neither an operator gate nor a throttle, while the background twin it delegates to
    // (POST /api/tasks, kind "profile_draft") carries both. In open mode — or through the
    // anonymous session /api/demo mints — that made drafting an unbounded spend endpoint.
    // 20/10min per IP: the panel is one click per pasted CV blurb.
    rel: "./profile/draft/route.ts",
    key: "`profile-draft:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "DRAFT_RATE_LIMIT",
    optsDef: "const DRAFT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "runProfileDraft(",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-03 (model-keys-need-the-org-key), WITH the limiters.
  // The Models tab has TWO Test buttons and neither door was throttled: each click
  // spawns a Python child that makes a REAL, billable completion through the pinned
  // provider or the stored key. Both are operator-gated, and open mode makes that
  // gate a documented no-op for the ENTIRE API - the same rationale that already
  // put budgets on /api/profile/draft and the two interview mint doors.
  {
    rel: "./llm/test/route.ts",
    key: "`llm-canary:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "CANARY_RATE_LIMIT",
    optsDef: "const CANARY_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "spawnPython(",
    // The unknown-useCase 400 keeps its place ahead of the budget: a malformed call
    // spends nothing and must not be counted as traffic.
    servedBefore: "isLlmUseCase(body.useCase)",
  },
  {
    rel: "./llm/keys/test/route.ts",
    // TIGHTER than the routing canary on purpose: this panel holds one row per stored
    // credential (a handful), not one per use case.
    key: "`llm-key-probe:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "KEY_PROBE_RATE_LIMIT",
    optsDef: "const KEY_PROBE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "spawnPython(",
    // The LAST refusal ahead of the budget - unknown provider, model-required and
    // "no stored key for that provider and scope" all answer before it, so a call
    // that spawns nothing consumes nothing.
    servedBefore: "buildProviderKeyProbeEnv(provider, scope)",
  },
  // The two AGENT-BRIDGE doors. Both spawn real outbound work — a persona request
  // POSTed to Personas, a pairing key exchange — behind `requireOperator()`, which
  // open mode (no KP_OPERATOR_PASSWORD) makes a documented no-op for the whole API.
  // Neither had a limiter until the 2026-09-03 sweep.
  {
    rel: "./agents/dispatch/route.ts",
    // Per-IP. The limiter sits inside `mintAndDispatch`, which is entered only after
    // EVERY cheap refusal of both origins (job/intake missing, not composed, spec
    // stale, human population, invalid budget) and after the one-live-agent
    // idempotency reuse — so a rejected or idempotent call spends no budget. That
    // ordering is structural, not textual, which is why no `servedBefore` is pinned.
    key: "`agent-dispatch:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "DISPATCH_RATE_LIMIT",
    optsDef: "const DISPATCH_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The mint is the first irreversible act: a row, a CSPRNG report token, then the
    // outbound POST.
    expensive: "createHiredAgent(",
  },
  {
    rel: "./agents/pair/route.ts",
    // Phase 1. Ahead of the baseUrl WRITE as well as the outbound call — a throttled
    // start must not re-point the deployment at someone else's Personas either.
    key: "`agent-pair:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "PAIR_START_RATE_LIMIT",
    optsDef: "const PAIR_START_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "startPairing()",
  },
  {
    rel: "./agents/pair/route.ts",
    // Phase 2, and DELIBERATELY the laxer of the pair: the panel polls claim for up
    // to the 300s TTL along a 2s→15s backoff (~30 requests per pairing), so a budget
    // sized like start's would refuse a legitimate wait. After the shape refusal, so
    // a bodyless poll costs nothing.
    key: "`agent-pair-claim:${clientIpFrom(request.headers)}`",
    limit: 120,
    optsSrc: "PAIR_CLAIM_RATE_LIMIT",
    optsDef: "const PAIR_CLAIM_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "claimPairing(nonce)",
    servedBefore: "if (!nonce)",
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
    // Moved onto the refusal chokepoint with the rest of this route's refusals: a
    // candidate portal opened from a Czech invite renders errors.TOO_MANY_REQUESTS
    // in Czech instead of the server's English sentence.
    refusalCode: "TOO_MANY_REQUESTS",
    // The provider connect moved behind the failover helper (round 8) — the
    // helper call IS the expensive work the limiter guards.
    expensive: "connectWithFailover(",
    // Lifecycle guards keep their 404/409 semantics ahead of the throttle.
    servedBefore: 'session0.status === "completed"',
  },
  {
    // ADDED /perfect wave 18b, with the limiter itself. /complete was the LAST
    // public token door in the interview family with no throttle, and it is not a
    // read: the non-terminal path writes the transcript, debits interview minutes,
    // and (entry-linked) runs an LLM scorecard that seals a decision record.
    // Keyed on token AND IP - the token alone lets one flaky candidate exhaust
    // their own budget, the IP alone throttles a whole NAT of candidates together.
    // 10/10min; every duplicate POST after the first is answered by the free
    // already-completed branch that precedes the limiter.
    rel: "./interview/complete/route.ts",
    key: "`interview-complete:${token}:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "COMPLETE_RATE_LIMIT",
    optsDef: "const COMPLETE_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The transcript write - the first thing that costs anything - and the gate
    // for the debit + scorecard that follow it.
    expensive: "completeInterviewSession(",
    // The idempotent retry reply must keep answering for free, forever.
    servedBefore: "alreadyCompleted: true",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-02 (api-voice-interview), with the limiters themselves.
  // /connect - the credential mint - had carried a per-token throttle since it
  // shipped, but the two doors that MINT a session had none at all: /create runs a
  // model-backed grounding and emails the candidate on every accepted call, and
  // /simulate mints a billable voice session (and on a self-hosted install skips
  // meterGate, so nothing else bounds it). Both are operator-gated, and open mode
  // makes that gate a documented no-op for the ENTIRE API, so each must self-limit -
  // the law this file already states for the JD library's four spend doors.
  {
    rel: "./interview/create/route.ts",
    key: "`interview-create:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "CREATE_RATE_LIMIT",
    optsDef: "const CREATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The grounding is the LLM-backed half; the limiter must also precede
    // resolveEntryForSubmission, which PROMOTES a candidate onto the board.
    expensive: "await buildGroundedInterview(entryId, workspace)",
    // The cheap refusals keep serving freely ahead of the budget: the billing 402
    // and the "you named no candidate" 400 spend nothing and must not be masked.
    servedBefore: 'const quota = meterGate("interview_minutes"',
  },
  {
    rel: "./interview/simulate/route.ts",
    key: "`interview-simulate:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "SIMULATE_RATE_LIMIT",
    optsDef: "const SIMULATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The session row IS the billable artifact here.
    expensive: "createInterviewSession({",
    // The meter refusal runs first, so a 402'd sim consumes no budget.
    servedBefore: 'const quota = meterGate("interview_minutes"',
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
    // The limiter sits AFTER the cheap 404/409/400 refusals, so a request that was
    // never going to promote costs no budget.
    // Promote now goes through the shared jd_build seam (app/_lib/jd-build-start.ts),
    // so the expensive call to pin is `startJdBuild({` — with its opening brace, the
    // same reason as before: the bare name also appears in the import line above.
    expensive: "startJdBuild({",
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
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
    // Moved onto the refusal chokepoint with the rest of this surface: the
    // panel renders errors.TOO_MANY_REQUESTS in the reader's language instead of
    // the server's English string (api-contracts.md §1.1).
    refusalCode: "TOO_MANY_REQUESTS",
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
    // Moved onto the refusal chokepoint with the feedback-code conversion: the dialog
    // renders errors.TOO_MANY_REQUESTS instead of falling through to its generic
    // "couldn't send, try again" and sending the recruiter straight back at the wall.
    refusalCode: "TOO_MANY_REQUESTS",
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
  {
    // ADDED /perfect 2026-09-02 (api-devcase-1), with the limiter itself. The FLUSH is
    // the chat route's unthrottled twin on the same public prefix: it appends observed-
    // process rows and OVERWRITES the session's file tree, admitting 50 x 256 KB =
    // 12.8 MB per call, and carried no bound at all. Per-SESSION burst, 200/10min:
    // LiveWorkSurface flushes on an 8s interval (75 per 10 minutes) plus a submit flush
    // and the odd retry, so 200 is ~2.6x the client's own cadence and a candidate never
    // meets it, while a scripted loop is pinned to 20/min.
    rel: "./devcase/session/[id]/route.ts",
    key: "`devcase-flush:${id}`",
    limit: 200,
    // The first WRITE the limiter guards (the bare name also appears in the import).
    expensive: "appendDevSessionEvents(id, events)",
    // The 404/409 lifecycle refusals and the 403 token check keep their semantics ahead
    // of the throttle, so a rejected flush never consumes budget.
    servedBefore: 'session.status !== "active"',
  },
  {
    // The flush's per-apply-TOKEN daily aggregate — same collective budget shape as the
    // chat sibling (a dev-case token is per-POSTING, shared by every applicant).
    // Session-start caps a posting at 50 sessions/day, so 60,000 leaves 1,200 flushes per
    // session: about 2.7 hours of continuous 8s flushing each, longer than any timeboxed
    // case runs. The count is not the whole bound — 60,000 x 12.8 MB is ~768 GB of body
    // per link per day — so the route additionally charges a stated BYTE budget through
    // `chargeFlushBytes` (session-limits.ts), pinned by devcase-flush-guards.test.ts.
    rel: "./devcase/session/[id]/route.ts",
    key: "`devcase-flush-token:${session.token}`",
    limit: 60000,
    // The source writes the digit-separated form; the contract pins that text and the
    // behavioral drive below uses the value.
    limitSrc: "60_000",
    windowMs: 24 * 60 * 60_000,
    windowSrc: "24 * 60 * 60_000",
    expensive: "appendDevSessionEvents(id, events)",
    servedBefore: 'session.status !== "active"',
  },
  {
    // ADDED /explorer 2026-09-01, with the limiter itself. The heaviest compute
    // surface in the jobs area and the only spend route in it that carried NO
    // limiter: one POST fans out a `recruiter_cli` child PER published role
    // (worker-pool + per-role-timeout + roles-per-sweep bounded, but still N
    // subprocesses, hence maxDuration 180). Session-gated, and in open mode that
    // gate is a no-op for the whole API — so a tab holding Refresh could keep the
    // box saturated with ranking children. 10/10min per IP: a sweep legitimately
    // runs for minutes, so ten is far above human Refresh pace.
    //
    // POST only. The GET feed and the PATCH dismiss are a read and a single-row
    // write, and the feed polls the GET.
    rel: "./rediscovery/alerts/route.ts",
    key: "`rediscovery-sweep:${clientIpFrom(request.headers)}`",
    limit: 10,
    // The CALL, not a bare `sweepRediscoveryAlerts(`: that substring also appears in
    // this route's import and in the comment above the limiter, both before it.
    expensive: "await sweepRediscoveryAlerts({",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-02 (api-jobs), with the limiters themselves. Seven jobs
  // routes spawned a child or spent on a model and NONE carried a limiter — the whole
  // area was absent from this contract. Every one is session-gated, and open mode
  // (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the entire API,
  // so each must self-limit. Two budget families: the per-request spawns a reader
  // triggers by navigating (candidates, winnability, rediscover) get 30/10min; the
  // deliberate, once-per-role acts (ingest, campaign, publish, outreach) get budgets a
  // legitimate operator never meets and a scripted loop always does.
  {
    rel: "./jobs/ingest/route.ts",
    key: "`jobs-ingest:${clientIpFrom(request.headers)}`",
    limit: 20,
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE with its first argument: a bare `ingestJobAd(` also appears in the
    // import above the limiter, so the generic marker would pass on the wrong occurrence.
    expensive: "ingestJobAd(adText,",
    // The too-short-ad 400 and the foreign-jobId 404 keep their semantics ahead of the
    // throttle, so a rejected paste never consumes budget.
    servedBefore: "canWriteJobLifecycle(explicitJobId, ws)",
  },
  {
    rel: "./jobs/[id]/campaign/route.ts",
    key: "`jobs-campaign:${clientIpFrom(request.headers)}`",
    limit: 20,
    refusalCode: "TOO_MANY_REQUESTS",
    // POST only. GET reads the stored pack and spends nothing.
    expensive: "await runCampaign(",
    servedBefore: "if (!visibleJob(id, ws))",
  },
  {
    rel: "./jobs/[id]/candidates/route.ts",
    key: "`jobs-candidates:${clientIpFrom(request.headers)}`",
    limit: 30,
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "rankPoolForJob<",
    // The empty-pool short-circuit answers before the limiter: it spawns nothing, so it
    // must neither consume nor mask the budget.
    servedBefore: "entries.length === 0",
  },
  {
    rel: "./jobs/[id]/winnability/route.ts",
    key: "`jobs-winnability:${clientIpFrom(request.headers)}`",
    limit: 30,
    refusalCode: "TOO_MANY_REQUESTS",
    // The module the child runs — the limiter must precede the workdir AND the spawn.
    expensive: "pipeline.jobfit.winnability_cli",
    servedBefore: "entries.length === 0",
  },
  {
    rel: "./jobs/[id]/rediscover/route.ts",
    key: "`jobs-rediscover:${clientIpFrom(request.headers)}`",
    limit: 30,
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL, not a bare `rediscoverForJob(`: that substring also appears in the
    // import and in the header comment, both before the limiter.
    expensive: "await rediscoverForJob(job, {",
    servedBefore: "jobVisibleToWorkspace(id, ws)",
  },
  {
    rel: "./jobs/[id]/publish/route.ts",
    key: "`jobs-publish:${clientIpFrom(request.headers)}`",
    limit: 20,
    refusalCode: "TOO_MANY_REQUESTS",
    // The go-live's FIRST spawning step; the rediscovery alert fan-out follows it. The
    // limiter also precedes the billing transaction, so a throttled call cannot debit.
    expensive: "await runSourceForRole(role, {",
    // The 404 and the ownership gate keep their semantics ahead of the throttle.
    servedBefore: "canWriteJobLifecycle(id, ws)",
  },
  {
    rel: "./jobs/[id]/candidates/outreach/route.ts",
    key: "`jobs-outreach:${clientIpFrom(request.headers)}`",
    limit: 60,
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE with its arguments: `runAutomationTask(` also appears in the import.
    expensive: 'runAutomationTask(entry.id, "outreach"',
    // The GDPR suppression 409 (and the 404/400 above it) run first, so a reach-out that
    // was never going to send costs no budget — and the limiter precedes the first WRITE
    // (createPipelineEntry) as well as the draft.
    servedBefore: "candidateOutreachSuppression(body.candidateId)",
  },
  {
    // ADDED /perfect 2026-09-03 (jobs-workspace-2), with the limiter itself. The
    // eighth jobs spend door and the one the 2026-09-02 sweep missed: POST here
    // accepts a BACKGROUNDED `agent_fit` task, i.e. one LLM call over the role's own
    // text, and carried no throttle at all. Operator-gated, and open mode makes that
    // gate a documented no-op for the whole API.
    rel: "./jobs/[id]/agent-fit/route.ts",
    key: "`jobs-agent-fit:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "AGENT_FIT_RATE_LIMIT",
    optsDef: "const AGENT_FIT_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE with its first argument: a bare `startTask(` also appears in this
    // file's header comment, which precedes the limiter.
    expensive: 'startTask("agent_fit"',
    // The visibility 404 (unknown / other-tenant role) keeps its semantics ahead of
    // the throttle, so a rejected call never consumes budget.
    servedBefore: "jobVisibleToWorkspace(id, ws)",
  },
  {
    // ADDED /perfect (schedule-door-speaks-the-candidates-language), with the limiter
    // itself. The candidate's own READ was the last public token read in the product with
    // no throttle — and it is not a cheap one: every hit runs proposeFreeSlots, which
    // queries the interviewer's connected Google calendar for free/busy. A holder of one
    // link (or anyone who scraped one out of a forwarded email) could drive unbounded
    // third-party calendar traffic, and the same call is what the POST's own "stuck"
    // decision re-runs. 60/min per client AND token, the same budget and key shape as
    // /api/status/[token]: the picker fetches on load and re-fetches after a booking, a
    // 409 and an RSVP cancel, so honest use sits an order of magnitude under it, while
    // the per-token half keeps one scraped link from throttling a different candidate
    // behind the same NAT.
    rel: "./schedule/[token]/route.ts",
    key: "`sched-read:${clientIpFrom(request.headers)}:${token}`",
    limit: 60,
    windowMs: 60_000,
    windowSrc: "60_000",
    optsSrc: "SCHEDULE_READ_RATE_LIMIT",
    optsDef: "const SCHEDULE_READ_RATE_LIMIT = { limit: 60, windowMs: 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The free/busy fan-out the limiter exists to bound. The GET's call is the first in
    // the file, so this also pins that the throttle precedes it rather than the POST's.
    expensive: "await proposeFreeSlots(",
  },
  {
    // ADDED /perfect 2026-09-03 (pipeline-board-3), with the limiter itself. The
    // scheduler dock's "Run now" door: `{"tick": true}` forces a FULL policy pass —
    // the same Python-spawning sweep over every active entry that /api/automation/run
    // and the board's `run policy` command already throttle — and it was the third
    // entry point to that sweep, guarded by nothing but a client-side single-flight
    // ref. Operator-gated, and open mode makes that gate a documented no-op for the
    // whole API. 10/10min per IP: a pass runs for minutes, so ten is far above any
    // human "Run now" pace. The GET and the cheap config writes (toggle, interval,
    // reminders pause) stay unthrottled — they spawn nothing.
    rel: "./automation/schedule/route.ts",
    key: "`schedule-tick:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "SCHEDULE_TICK_RATE_LIMIT",
    optsDef: "const SCHEDULE_TICK_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE with its arguments: a bare `tickScheduler(` also appears in the
    // import above the limiter, so the generic marker would pass on the wrong one.
    expensive: "tickScheduler({ force: true",
    // The malformed-interval 400 keeps its semantics ahead of the throttle, so a
    // broken body neither consumes budget nor is masked by a 429.
    servedBefore: 'jsonRefusal("SCHEDULE_INTERVAL_INVALID", 400)',
  },
  {
    // ADDED /perfect 2026-09-02 (api-pipeline), with the limiter itself. `run policy`
    // typed into the board's command bar reaches the SAME sweep POST
    // /api/automation/run drives — a Python-spawning pass over every active entry
    // that dispatches candidate outreach — and it was the one entry point to it with
    // no throttle at all. Operator-gated, but open mode makes that gate a no-op for
    // the whole API, so the limiter is the real bound. 6/10min per IP: a sweep runs
    // for minutes, so six is far above any human pace, and the per-candidate commands
    // on the same route (reject_below / advance_top) are deliberately NOT throttled —
    // they are bounded by the previewed cohort and spawn nothing.
    rel: "./pipeline/command/route.ts",
    key: "`pipeline-command-policy:${clientIpFrom(request.headers)}`",
    limit: 6,
    optsSrc: "RUN_POLICY_RATE_LIMIT",
    optsDef: "const RUN_POLICY_RATE_LIMIT = { limit: 6, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL, not a bare `runAutomationPass(`: that substring also appears in this
    // route's import and in the comments above the limiter, both before it.
    expensive: "result = await runAutomationPass();",
    // The operator gate keeps serving (refusing) freely ahead of the budget: a
    // non-operator must never be able to spend another caller's window.
    servedBefore: "const denied = await requireOperator();",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-02 (api-jd-library), with the limiters themselves. The
  // JD library's four spend doors carried NONE. Every one is operator-gated, and open
  // mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the
  // ENTIRE API, so each must self-limit. METERING the paid build (a per-workspace
  // quota) is a separate BILLING decision and deliberately not what these are.
  {
    // The 1-2 minute paid build's front door. 20/10min per IP: a Generate produces a
    // JD the requestor then reads, so twenty in ten minutes is far above honest pace.
    rel: "./jds/generate/route.ts",
    key: "`jd-generate:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "GENERATE_RATE_LIMIT",
    optsDef: "const GENERATE_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL SITE with its opening brace: the bare name also appears in the import
    // and in the comment above the limiter, both of which precede it.
    expensive: "startJdBuild({",
    // The bad-JSON 400, the empty-checklist 400, the too-thin-need 400 and the
    // vanished-template 400 keep their semantics ahead of the throttle, so a request
    // that was never going to build costs no budget.
    servedBefore: "const valid = validateJdBuildInput(title, needText);",
  },
  {
    // The SAME build, replayed by one click. Same budget as generate for the same
    // reason — a retry carries generate's full spend with none of its typing effort.
    rel: "./jds/[slug]/retry-analysis/route.ts",
    key: "`jd-retry:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "RETRY_RATE_LIMIT",
    optsDef: "const RETRY_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "restartJdBuild(slug,",
    // The 404, the not-failed 409 and the nothing-to-replay 400 run first.
    servedBefore: 'jd.analysis_status !== "failed"',
  },
  {
    // One Claude ad-parse of the whole JD body per accepted call — the JD-library
    // door to the parse ./jobs/ingest already throttles at the same 20/10min.
    rel: "./jds/[slug]/ingest-job/route.ts",
    key: "`jd-ingest-job:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "INGEST_JOB_RATE_LIMIT",
    optsDef: "const INGEST_JOB_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL with its first argument: a bare `ingestJobAd(` also appears in the
    // import above the limiter.
    expensive: "ingestJobAd(jd.body,",
    // The already-ingested short-circuit parses nothing, so it must neither consume
    // nor be masked by the budget.
    servedBefore: "if (getJob(jobId)) {",
  },
  {
    // The loosest of the four on purpose: a save is the CHEAPEST door (a
    // deterministic `jobs_cli normalize` child, no model call) and the builder
    // legitimately re-POSTs to retry the best-effort ingest, so 30/10min must clear
    // a retry burst.
    rel: "./jds/save/route.ts",
    key: "`jds-save:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "SAVE_RATE_LIMIT",
    optsDef: "const SAVE_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The CALL with its first argument: the bare name also appears in the import.
    expensive: "ingestStructuredJob({ slug,",
    // The invalid-title/body 400 runs first, so a rejected save costs no budget —
    // and the limiter precedes the saveJd write as well as the spawn.
    servedBefore: "validateJdFields(body.title, body.body)",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-02 (org-workspace-settings), with the limiters themselves.
  // The ORGANIZATION's two consequential doors carried none. Neither spends on a model,
  // which is why an LLM-shaped scan kept missing them - what they spend is the company's
  // own safety: one mints capability links into the tenant, the other serializes every
  // candidate's PII into a single response. Both are capability-gated, and in open mode
  // (KP_OPERATOR_PASSWORD unset) that gate is a documented no-op for the ENTIRE API, so
  // each must self-limit.
  {
    // Every accepted call writes an invite row AND returns a live accept link that
    // seats its holder in the org. 30/10min per IP is far above a human typing
    // addresses into a form; a scripted loop is pinned at 3/min.
    rel: "./org/invites/route.ts",
    key: "`org-invite:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "INVITE_MINT_RATE_LIMIT",
    optsDef: "const INVITE_MINT_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The mint itself. The bare name also appears in the import above the limiter,
    // so the marker carries its opening argument.
    expensive: "inviteMember({ orgId,",
    // All three cheap refusals (bad address, role above the ceiling, already a
    // member) keep their semantics ahead of the throttle, so an invite that was
    // never going to be minted spends none of the window.
    servedBefore: 'existing.orgId === orgId && existing.status === "active"',
  },
  {
    // FULL PII for the whole organization - every candidate, contact and transcript -
    // in one response, built by walking every org-scoped table into memory. An
    // authorized administrator taking a backup does it occasionally and deliberately;
    // 10/10min leaves that untouched and stops a loop. The limiter sits AFTER both
    // gates so an unauthenticated or under-privileged probe can never spend an
    // administrator's window.
    rel: "./workspace/export/route.ts",
    key: "`org-export:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "EXPORT_RATE_LIMIT",
    optsDef: "const EXPORT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "dumpOrg(orgId)",
    servedBefore: 'await requireOrgCapability("org:manage")',
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-02 (pipeline-composer), with the limiters themselves. The
  // hiring pipeline's two write doors carried NONE. Both are operator-gated, and open
  // mode (KP_OPERATOR_PASSWORD unset) makes that gate a documented no-op for the ENTIRE
  // API, so each must self-limit.
  {
    // The AUTO-REJECT gate's own write. Cheap per call, which is exactly why it was
    // unthrottled - but an unbounded loop here flaps the rules that decide who the
    // screening wave rejects, and every flap is a real policy change with a real audit
    // trail. 60/10min per IP leaves any human editing session untouched.
    rel: "./decisions/config/route.ts",
    key: "`decision-config:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "CONFIG_RATE_LIMIT",
    optsDef: "const CONFIG_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "setDecisionConfig(result.phase,",
    // The body checks, the schema validation and the stale-version refusal all keep
    // their semantics ahead of the throttle: a request that was never going to be
    // written spends none of the window.
    servedBefore: 'jsonRefusal("DECISION_CONFIG_INVALID", 400',
  },
  {
    // This route MOVES CANDIDATES between board columns and rewrites the axis. 20/10min
    // per IP is far above any real editing session. The limiter sits after EVERY cheap
    // refusal - invalid axis, invalid mapping, stale axis, and the server's own
    // occupancy recount - so a refused reshape costs no budget.
    rel: "./pipeline/stage-migration/route.ts",
    key: "`stage-migration:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "MIGRATION_RATE_LIMIT",
    optsDef: "const MIGRATION_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "migratePipelineStages(migrations, ws)",
    servedBefore: 'jsonRefusal("PIPELINE_MIGRATION_REQUIRED", 409',
  },
  {
    // ADDED /perfect 2026-09-03 (devcase-workspace-3), with the limiter itself. The
    // dead-letter RECOVERY door: the one place in the assignments loop where a click
    // spends real email on demand, and it carried no throttle at all. Its only guards
    // were an in-process in-flight Set and a dedup that a REFLESS message skipped
    // entirely - so a refless dead letter could be re-dispatched once per click,
    // without bound. Operator-gated, and open mode (KP_OPERATOR_PASSWORD unset) makes
    // that gate a documented no-op for the ENTIRE API, so the limiter is the real
    // bound. 60/10min per IP sits far above a recruiter working a dead-letter list by
    // hand (one click per message, each read first) and pins a scripted loop at 6/min.
    rel: "./comms/[id]/resend/route.ts",
    key: "`comms-resend:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "RESEND_RATE_LIMIT",
    optsDef: "const RESEND_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The relay call, with its opening brace: the bare name also appears in the import
    // above the limiter, so the generic marker would pass on the wrong occurrence.
    expensive: "await sendComm({",
    // Every cheap refusal - the in-flight 409, the unknown-id 404, the missing-fields
    // 422 - keeps its semantics ahead of the throttle, so a click that was never going
    // to send costs no budget.
    servedBefore: "getOutboxEntry(id, ws)",
  },
  {
    // ADDED /perfect 2026-09-03 (channels-1), with the limiter itself. The one
    // SECRET-WRITE door on the Channels tab: an accepted call replaces the endpoint
    // every candidate-facing message (PII) is POSTed to and can store a new HMAC
    // signing secret. Operator-gated, and open mode (KP_OPERATOR_PASSWORD unset) makes
    // that gate a documented no-op for the ENTIRE API - so the limiter is the real
    // bound, and without it the door was also an unmetered oracle for probing the SSRF
    // guard (assertPublicHttpsEndpoint) one candidate host at a time. 30/10min is far
    // above an operator editing a form.
    rel: "./comms/relay/route.ts",
    key: "`comms-relay:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "RELAY_RATE_LIMIT",
    optsDef: "const RELAY_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "setRelayConfig(body)",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-03 (integrations-settings), with the limiters themselves. The
  // two doors on the Integrations tab that REACH THE NETWORK carried none. Both are
  // operator-gated, and open mode (KP_OPERATOR_PASSWORD unset) makes that gate a
  // documented no-op for the ENTIRE API - so in each case the limiter is the real bound.
  {
    // Every accepted call POSTs a signed ping to an OPERATOR-SET URL. The SSRF guard
    // vets the address; nothing vetted the RATE, so a loop turned kp into an amplifier
    // pointed at that host and every answer was a reachability oracle for it. 20/10min
    // is far above a human clicking "Send test" while wiring an integration up.
    rel: "./ats/test/route.ts",
    key: "`ats-test:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "TEST_PING_RATE_LIMIT",
    optsDef: "const TEST_PING_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: 'deliver("ping"',
  },
  {
    // The OAuth start: each hit mints a 32-byte state, SETS A COOKIE and redirects a
    // browser into Google's consent screen - cookie churn on kp plus unattributed
    // traffic at Google from this deployment's address. The limiter sits before the
    // state mint, so a throttled caller never gets a stale state cookie either.
    rel: "./calendar/google/start/route.ts",
    key: "`gcal-oauth-start:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "OAUTH_START_RATE_LIMIT",
    optsDef: "const OAUTH_START_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "randomBytes(32)",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-03 (analytics-writes-check-authority), with the limiters
  // themselves. Three expensive analytics READS carried none. They spend CPU and the
  // shared SQLite connection rather than provider credit, which is exactly why they
  // were overlooked - and one of them hangs off a download link, which a browser, a
  // prefetcher or a shared bookmark can pull with no click at all.
  {
    // GET, and a DOWNLOAD (?format=md): one hit assembles the whole analytics
    // aggregate, walks the entire open-role corpus, reads every membership on the team
    // and summarises the NPS corpus. 30/10min per IP - the pack is a page you read,
    // then send.
    rel: "./analytics/metric-pack/route.ts",
    key: "`metric-pack:${clientIpFrom(request.headers)}`",
    limit: 30,
    optsSrc: "METRIC_PACK_RATE_LIMIT",
    optsDef: "const METRIC_PACK_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "pipelineAnalytics(windowDays, undefined, ws)",
  },
  {
    // The decision log. Its `?q=` path abandons SQL paging and refines IN THE HANDLER -
    // up to MAX_SUBJECT_SCAN rows, diacritic-folded and Intl-collated per request.
    // 120/10min per IP: the log pages 20 at a time on scroll, so a recruiter working a
    // long trail legitimately chains pages.
    rel: "./analytics/decisions/route.ts",
    key: "`decision-log:${clientIpFrom(request.headers)}`",
    limit: 120,
    optsSrc: "DECISION_LOG_RATE_LIMIT",
    optsDef: "const DECISION_LOG_RATE_LIMIT = { limit: 120, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "countPipelineEvents(filter.kinds, ws)",
    // A contradictory kind x attribution pair selects nothing and keeps serving freely
    // ahead of the throttle, so a request that reads no trail costs no budget.
    servedBefore: "filter.matchesNothing",
  },
  {
    // The threshold strip. Deliberately NOT role-gated (its written justification
    // stands: policy-level seals only, no candidate PII) - which is precisely why it
    // needs a budget: two 200-record chain reads plus a full calibration scan and an
    // effect computation, per hit, from any valid session. 60/10min per IP; the panel
    // fetches once per family switch.
    rel: "./analytics/calibration/threshold-history/route.ts",
    key: "`threshold-history:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "HISTORY_RATE_LIMIT",
    optsDef: "const HISTORY_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "listDecisionRecords({ candidateRef: policyRef, workspaceId: ws })",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-03 (decisions-ui-1), with the limiter itself.
  {
    // The screening auto-reject WAVE - the one door in the Decisions tab that queues
    // real adverse-action email, moves a whole cohort to rejected and seals a record
    // per candidate. Its dry-run preview runs the same cohort ranking, so both halves
    // share one budget. Its sibling write doors (pipeline/batch, decisions/config)
    // were limited; this one, the heaviest, was not. 60/10min per IP: the preview is
    // debounced at 350ms, so a recruiter working the sliders stays far under it.
    rel: "./decisions/screen-wave/route.ts",
    key: "`screen-wave:${clientIpFrom(request.headers)}`",
    limit: 60,
    optsSrc: "WAVE_RATE_LIMIT",
    optsDef: "const WAVE_RATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "await runScreenWave(",
    // The missing-jobId 400 and the override schema 400 keep their semantics ahead of
    // the throttle, so a request that could never run a wave costs no budget.
    servedBefore: "validateScreeningOverride(body.override)",
  },
  // ------------------------------------------------------------------
  // ADDED /perfect 2026-09-03 (billing-ui), with the limiters themselves. The two
  // BILLING doors had no throttle at all — the only doors in the app that reach a
  // MERCHANT OF RECORD. Both were guarded by `requireOperator()` alone, and open mode
  // (KP_OPERATOR_PASSWORD unset) makes every operator gate a documented no-op for the
  // ENTIRE API, so an unauthenticated caller could loop live Polar checkout sessions
  // and customer-portal mints. The capability gate that now precedes each limiter
  // (org:manage) is the authorization half; this is the abuse-containment half, and
  // neither substitutes for the other.
  {
    rel: "./billing/checkout/route.ts",
    key: "`billing-checkout:${clientIpFrom(request.headers)}`",
    limit: 10,
    optsSrc: "CHECKOUT_RATE_LIMIT",
    optsDef: "const CHECKOUT_RATE_LIMIT = { limit: 10, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The provider hop. A bare `createCheckout(` would also match nothing else here,
    // but the awaited call site is what must follow the limiter.
    expensive: "await gateway.createCheckout(req,",
    // EVERY cheap refusal keeps its semantics ahead of the throttle — a body that was
    // never going to buy anything must not consume the window, and a throttled caller
    // must not be told "slow down" when the real answer is "you are not an owner".
    servedBefore: 'jsonRefusal("BILLING_ALREADY_SUBSCRIBED", 403)',
  },
  {
    rel: "./billing/portal/route.ts",
    key: "`billing-portal:${clientIpFrom(request.headers)}`",
    limit: 20,
    optsSrc: "PORTAL_RATE_LIMIT",
    optsDef: "const PORTAL_RATE_LIMIT = { limit: 20, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    expensive: "await gateway.createPortalSession(customerId)",
    // The "no customer yet" 404 is the calm pre-first-purchase state; it mints nothing.
    servedBefore: 'jsonRefusal("BILLING_NO_CUSTOMER", 404)',
  },
  {
    // ADDED /perfect wave 17 (api-workspace). Not a money or subprocess door — a
    // COMPUTE one, and the heaviest read per byte of input in the app: five
    // `LIKE '%q%'` scans, all with a leading wildcard, so every one is a full table
    // walk (analytics.ts searchEntities). It had no limiter, and in open mode it takes
    // an unauthenticated path.
    //
    // 3000/10min looks absurd next to its neighbours and the reason is pinned here so
    // nobody "tightens" it: with KP_TRUSTED_PROXY unset, clientIpFrom returns
    // SHARED_CLIENT_KEY for everyone, so `search:local` is ONE bucket for the whole
    // deployment — and unlike an apply or login door, tripping it denies the command
    // palette to every colleague at once. The ceiling has to sit where people cannot
    // reach it and a script still can.
    rel: "./search/route.ts",
    key: "`search:${clientIpFrom(request.headers)}`",
    limit: 3000,
    optsSrc: "SEARCH_RATE_LIMIT",
    optsDef: "const SEARCH_RATE_LIMIT = { limit: 3000, windowMs: 10 * 60_000 };",
    refusalCode: "TOO_MANY_REQUESTS",
    // The call site, not the bare name: `searchEntities(` also appears in the import
    // line, which necessarily precedes the limiter.
    expensive: "searchEntities(q,",
    // A sub-minimum query runs no SQL and the palette sends one on every deletion
    // keystroke — it must never spend the window.
    servedBefore: "if (q.length < MIN_QUERY_LENGTH)",
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
    // limiter consumer: the shared message, status 429, nothing bespoke. Routes on
    // the refusal chokepoint say the same thing through `jsonRefusal` — same
    // message (pinned below), plus the code the client localizes.
    const refusal = src.slice(at, at + 400);
    if (spec.refusalCode) {
      assert.ok(
        refusal.includes(`jsonRefusal("${spec.refusalCode}", 429)`),
        `the refusal must go through the chokepoint: jsonRefusal("${spec.refusalCode}", 429)`,
      );
    } else {
      assert.match(refusal, /RATE_LIMITED_ERROR/, "the refusal must use the shared message");
      assert.match(refusal, /status:\s*429/, "the refusal must be a 429");
    }

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

// A coded refusal may not quietly become a DIFFERENT refusal. Every route above
// that answers the throttle with `jsonRefusal("TOO_MANY_REQUESTS", 429)` is
// claiming the shared message — so the registry entry must literally BE
// RATE_LIMITED_ERROR, not a second string that drifts from it. (Read as source
// rather than imported: api-response.ts pulls in next/server, which the unit
// runner does not resolve.)
test('REFUSAL_ERRORS.TOO_MANY_REQUESTS is RATE_LIMITED_ERROR itself, not a copy of it', () => {
  const src = readFileSync(fileURLToPath(new URL("../_lib/api-response.ts", import.meta.url)), "utf8");
  assert.match(
    src,
    /^ {2}TOO_MANY_REQUESTS: RATE_LIMITED_ERROR,$/m,
    "the throttle refusal must reuse the limiter's own message constant",
  );
  assert.match(
    src,
    /import \{ RATE_LIMITED_ERROR \} from "\.\/rate-limit";/,
    "…and import it, so the two can never say different things",
  );
});

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

// ── the task doors' per-KIND budget (/perfect wave 17, background-tasks) ────
//
// POST /api/tasks is ONE door in front of every kind in HANDLERS and carried ONE
// bucket, 120/10min per IP, calibrated for the cheapest thing that comes through
// it (the Decisions queue's one-POST-per-accepted-review burst). The same 120
// admitted 120 repo clones, 120 board-wide screen sweeps and 120 cohort
// evaluations. The class table is app/_lib/task-budget.ts; these tests pin that
// BOTH doors consult it, that the numbers stay where this direction put them, and
// that the workspace half exists — the IP half alone is the wrong unit when a team
// shares a NAT (and with no trusted proxy configured `clientIpFrom` collapses the
// whole deployment into one bucket anyway).
for (const rel of ["./tasks/route.ts", "./tasks/[id]/retry/route.ts"]) {
  test(`${rel} applies the per-kind budget class on top of the IP bucket`, () => {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_lib\/task-budget"/, "must reuse the shared budget table");
    const clsAt = src.indexOf("rateLimit(`tasks-start:${cls}:${ip}`, budget.ip)");
    const wsAt = src.indexOf("rateLimit(`tasks-start-ws:${cls}:${ws}`, budget.workspace)");
    assert.ok(clsAt > 0, "expected the per-class IP bucket");
    assert.ok(wsAt > clsAt, "expected the per-class WORKSPACE bucket after it");
    // Both refuse with the code the dock localizes — never the shared throttle
    // message, whose remedy ("slow down") is not this one's ("wait, this weight of
    // run is spent").
    for (const at of [clsAt, wsAt]) {
      assert.ok(
        src.slice(at, at + 200).includes('jsonRefusal("TASK_BUDGET_EXHAUSTED", 429'),
        "the per-kind refusal must carry its own code",
      );
    }
    // …and the whole budget precedes the enqueue.
    const spend = src.indexOf(rel.includes("retry") ? "startTask(task.kind" : "const task = startTask(");
    assert.ok(spend > wsAt, "the budget must precede the enqueue, or a refused start still costs a slot");
    // The retry door reuses the START keys deliberately: replaying must not be a
    // way to double a workspace's allowance.
    assert.ok(src.includes("tasks-start-ws:"), "the two doors must share one workspace allowance");
  });
}

test("the task budget classes keep the numbers this contract claims", () => {
  const src = read("../_lib/task-budget.ts");
  for (const line of [
    "cheap: { ip: { limit: 120, windowMs: TEN_MIN }, workspace: null },",
    "metered: { ip: { limit: 30, windowMs: TEN_MIN }, workspace: { limit: 90, windowMs: HOUR } },",
    "agent: { ip: { limit: 6, windowMs: TEN_MIN }, workspace: { limit: 15, windowMs: HOUR } },",
  ]) {
    assert.ok(src.includes(line), `expected the pinned budget line:
  ${line}`);
  }
  assert.ok(src.includes("const TEN_MIN = 10 * 60_000;") && src.includes("const HOUR = 60 * 60_000;"), "…with the pinned windows");
});

// Drive the REAL limiter with each class's config, the same way the per-route
// specs above do: every hit up to the limit passes, the next is refused, a fresh
// window admits again.
for (const [cls, limit, windowMs] of [
  ["cheap", 120, 600_000],
  ["metered", 30, 600_000],
  ["agent", 6, 600_000],
  ["metered-ws", 90, 3_600_000],
  ["agent-ws", 15, 3_600_000],
] as const) {
  test(`the ${cls} task budget refuses the hit past its limit (${limit}/${windowMs}ms)`, () => {
    const t0 = 20_000_000;
    const key = `task-budget:${cls}:contract`;
    for (let i = 0; i < limit; i++) assert.equal(rateLimit(key, { limit, windowMs }, t0 + i), true, `hit ${i + 1} must pass`);
    assert.equal(rateLimit(key, { limit, windowMs }, t0 + limit), false, "the next hit inside the window must be refused");
    assert.equal(rateLimit(key, { limit, windowMs }, t0 + windowMs + 1), true, "a fresh window must admit again");
  });
}

// ── the DIRECT enqueues: the three dev-case doors (/perfect wave 18b) ───────
//
// These three call the runner themselves rather than posting to /api/tasks, so
// until this direction they enqueued `lifecycle` — the AGENT class, a whole
// dev-case orchestration — with no limiter at all and were carried on the
// UNTHROTTLED_ENQUEUE ratchet below. They now go through the SAME helper and the
// SAME keys as the dock, so a direct enqueue and a dock enqueue share ONE
// allowance; that is the property these specs pin, not merely "a limiter exists".
for (const rel of [
  "./devcase/control/route.ts",
  "./devcase/lifecycle/route.ts",
  "./devcase/lifecycle/[id]/approve/route.ts",
]) {
  test(`${rel} spends the agent-class task budget before it enqueues a lifecycle`, () => {
    const src = read(rel);
    assert.match(src, /from "@\/app\/_lib\/task-budget"/, "must reuse the shared budget table, never a local number");
    const budgetAt = src.indexOf('enforceTaskBudget("lifecycle"');
    assert.ok(budgetAt > 0, "expected the shared per-kind budget call for the lifecycle kind");
    // …against the caller's client key and the tenant, not a constant.
    assert.match(src.slice(budgetAt, budgetAt + 160), /clientIpFrom\(request\.headers\)|enforceTaskBudget\("lifecycle", ip,/);
    const spend = src.search(/\bstartTask\(\s*"lifecycle"/);
    assert.ok(spend > budgetAt, "the budget must precede the enqueue, or a refused start still costs a run");
    // The refusal carries the code the dev tab localizes (errors.TASK_BUDGET_EXHAUSTED
    // in all four catalogs) — never a raw message, never the generic throttle copy.
    assert.match(src, /jsonRefusal\("TASK_BUDGET_EXHAUSTED", 429/, "the refusal must carry the shared code at 429");
  });
}

test("the direct enqueues share the task doors' buckets, key for key", () => {
  const helper = read("../_lib/task-budget.ts");
  // One producer of the keys, and they are the literals /api/tasks writes inline.
  for (const key of ["`tasks-start:${cls}:${ip}`", "`tasks-start-ws:${cls}:${workspaceId}`"]) {
    assert.ok(helper.includes(key), `expected the shared key ${key} in enforceTaskBudget`);
  }
  const door = read("./tasks/route.ts");
  assert.ok(door.includes("`tasks-start:${cls}:${ip}`"), "the dock door must key its IP bucket the same way");
  assert.ok(door.includes("`tasks-start-ws:${cls}:${ws}`"), "…and its workspace bucket");
});

test("./devcase/lifecycle/route.ts budgets BEFORE it debits the case_designs meter", () => {
  const src = read("./devcase/lifecycle/route.ts");
  const budgetAt = src.indexOf("enforceTaskBudget(");
  const debitAt = src.indexOf("recordMeterUsage(");
  assert.ok(budgetAt > 0 && debitAt > budgetAt, "a refused start must not have charged the tenant's design quota");
});

test("./devcase/lifecycle/[id]/approve/route.ts budgets BEFORE the approve transition", () => {
  const src = read("./devcase/lifecycle/[id]/approve/route.ts");
  const budgetAt = src.indexOf("enforceTaskBudget(");
  const approveAt = src.indexOf("approveLifecycleCase(");
  assert.ok(budgetAt > 0 && approveAt > budgetAt, "a refused resume must not leave the case approved but unrun");
  // …and after the cheap refusals: the 404, the 409 and the probe 422 cost no slot.
  for (const cheap of ['NextResponse.json({ error: "lifecycle not found" }', "enforceProbeGate("]) {
    assert.ok(src.indexOf(cheap) < budgetAt, `${cheap} must be decided before a slot is spent`);
  }
});

test("./devcase/control/route.ts budgets EACH resumed lifecycle in the sweep", () => {
  const src = read("./devcase/control/route.ts");
  // The reconcile sweep enqueues up to 50 runs from one POST; a per-REQUEST check
  // would let one call spend a whole board on a single slot.
  const loopAt = src.indexOf("for (const lc of listLifecycles(50, workspaceId))");
  const budgetAt = src.indexOf("enforceTaskBudget(");
  const spendAt = src.indexOf('startTask("lifecycle"');
  assert.ok(loopAt > 0 && budgetAt > loopAt && spendAt > budgetAt, "the budget must be inside the sweep, ahead of the enqueue");
  // A truncated sweep is REPORTED, never a green `resumed` that hides the bound.
  assert.match(src, /budgetExhausted: true/, "the sweep must say it stopped at the budget");
  assert.match(src, /resumed === 0 && budgetExhausted/, "…and a sweep that resumed nothing at all is a refusal");
});

// EVERY startTask has a bucket. The two task doors are pinned by name above, but
// startTask is reachable from any route file, and each call is a real LLM call
// and/or a Python spawn. A route that acquires one without a limiter is the exact
// hole the 2026-08-22 sweep found on ./tasks/route.ts and the 2026-09-03 one found
// on ./jobs/[id]/agent-fit — both times because nothing walked the tree.
// Routes that reach startTask with NO limiter ahead of it — a ratchet in the idiom
// of error-response-contract.test.ts: a file not on it may not enqueue unthrottled
// at all, and REMOVING a line is the fix (a listed-but-fixed file is also reported,
// so the list cannot rot). It carried the three dev-case doors that enqueue
// `lifecycle` directly; /perfect wave 18b routed all three through the shared
// agent-class budget and the list is now EMPTY. Keep it that way: a new entry here
// is a hole waiting to be closed, never an exemption.
const UNTHROTTLED_ENQUEUE = new Set<string>([]);

/** Comments masked out — this repo documents its own call sites in prose, and
 *  ./tasks/[id]/retry/route.ts's header explains the replay as "startTask(kind,
 *  params)" ABOVE its limiter, which a naive scan reads as an unthrottled call. */
function withoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ 	]*\/\/.*$/gm, "");
}

test("every route that enqueues a task throttles first", () => {
  const offenders: string[] = [];
  let checked = 0;
  for (const file of walk(apiDir)) {
    const src = withoutComments(readFileSync(file, "utf8")).replace(/\r\n/g, "\n");
    // The CALL, not the import or the prose: `startTask(` with an argument.
    const call = src.search(/\bstartTask\(\s*[^)\s]/);
    if (call < 0) continue;
    checked += 1;
    // A limiter is either the raw bucket or the shared per-kind budget helper
    // (app/_lib/task-budget.ts `enforceTaskBudget`), which IS a rateLimit call under
    // the task doors' own keys — a route that goes through it is throttled, and a
    // walk that only knew the raw call would report it as a hole.
    const limiter = src.search(/\brateLimit\(|\benforceTaskBudget\(/);
    const rel = path.relative(apiDir, file).split(path.sep).join("/");
    if ((limiter < 0 || limiter > call) && !UNTHROTTLED_ENQUEUE.has(rel)) offenders.push(rel);
    if (limiter >= 0 && limiter < call && UNTHROTTLED_ENQUEUE.has(rel)) offenders.push(`${rel} (FIXED — delete it from UNTHROTTLED_ENQUEUE)`);
  }
  // The rule must not pass vacuously: if the CALL pattern ever stops matching, the
  // walk would report a clean tree it never actually looked at.
  assert.ok(checked >= 5, `expected the enqueueing routes, matched ${checked}`);
  assert.deepEqual(offenders, [], "these routes enqueue a background task with no throttle ahead of it");
});

// ── the credential PAGE's throttle (/perfect wave 20, token doors) ───────────
//
// Every spec above is a route handler, because until now every throttled door was
// one. /skill/[token] is an RSC PAGE and was the hole that shape left: its sibling
// GET /api/skill-profile/[token]/verify has been capped at 30/10min per client
// since the enumeration finding, while the page behind the SAME token space did a
// sqlite read plus an HMAC verification per hit with no limiter at all — so the
// cheap way to walk the token space was to ask for the HTML instead of the JSON.
//
// Two things differ from a route spec and both are asserted rather than assumed:
// the client address comes from `headers()` (a page has no NextRequest), and the
// refusal is a RENDERED STATE, not a 429 — a page cannot answer a status code, so
// the contract is that the throttled branch renders the throttled copy and never
// reaches the store.
const SKILL_PAGE = "../skill/[token]/page.tsx";
const SKILL_PAGE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };

test(`${SKILL_PAGE}: the credential read is throttled per client AND token, before the store`, () => {
  const src = read(SKILL_PAGE);
  assert.match(src, /from "@\/app\/_lib\/rate-limit"/, "must reuse the one shared limiter");

  const def = "const SKILL_VIEW_RATE_LIMIT = { limit: 30, windowMs: 10 * 60_000 };";
  const defAt = src.indexOf(def);
  assert.ok(defAt >= 0, `expected the pinned budget:\n  ${def}`);

  // Keyed per client AND token: with no trusted proxy configured every caller
  // shares one client key, so an IP-only bucket would let one reader's reloads
  // spend every other candidate's budget.
  const call = "rateLimit(`skill-view:${clientIpFrom(await headers())}:${token}`, SKILL_VIEW_RATE_LIMIT)";
  const at = src.indexOf(call);
  assert.ok(at >= 0, `expected the pinned limiter call:\n  ${call}`);
  assert.ok(defAt < at, "the budget must be defined before the limiter call");

  // Ahead of the expensive work — the sqlite read + signature verification.
  const expensiveAt = src.indexOf("verifySkillProfileToken(token)");
  assert.ok(expensiveAt > at, "the limiter must precede verifySkillProfileToken");

  // The refusal a page can actually give: rendered copy, in the reader's language.
  assert.match(src.slice(at, at + 1200), /t\("throttledTitle"\)/, "the throttled branch must render its own copy");
});

test(`${SKILL_PAGE}: hit ${SKILL_PAGE_LIMIT.limit + 1} inside one window is refused`, () => {
  const t0 = 20_000_000;
  const key = `${SKILL_PAGE}:skill-view:contract`;
  for (let i = 0; i < SKILL_PAGE_LIMIT.limit; i++) {
    assert.equal(rateLimit(key, SKILL_PAGE_LIMIT, t0 + i), true, `hit ${i + 1} must pass`);
  }
  assert.equal(rateLimit(key, SKILL_PAGE_LIMIT, t0 + SKILL_PAGE_LIMIT.limit), false, "the hit past the limit is refused");
  assert.equal(
    rateLimit(key, SKILL_PAGE_LIMIT, t0 + SKILL_PAGE_LIMIT.windowMs + 1),
    true,
    "a fresh window admits again — the cap is a rate, not a ban"
  );
});
