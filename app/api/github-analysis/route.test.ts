// FINDING #1 + #2 (bug-ui-scan-2026-07-09, github-evidence-cv-utilities):
//
//   #1 — GET /users/{login} resolves ORGANIZATIONS too (same handle grammar), so an
//        org handle (vercel, a mistyped github.com/facebook) used to attribute the
//        org's whole repo portfolio to one candidate. The route must reject a
//        non-"User" account the moment it is first seen — BEFORE any repo is fetched.
//
//   #2 — the /languages fan-out and the deep-review bundle fetch each swallow a
//        sub-request error to a benign default, so a partial GitHub throttle (403 on
//        some repos) silently produced a thin-but-non-empty "successful" result. The
//        route must distinguish three states — evidence found, no evidence, could not
//        determine — and never assert a Potential Gap from missing data.
//
// Isolated onto a throwaway DB (unit-db must be the FIRST project import so KP_DB_PATH
// is set before the route's db layer loads) with the GitHub HTTP layer mocked, so the
// handler runs for real without touching github.com or Gemini.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
// Side-effect import: sets KP_DB_PATH to a throwaway file BEFORE ./route.ts pulls in
// the db layer. Keep it first (ESM evaluates imports in source order).
import "../../_lib/testing/unit-db.ts";
import { POST } from "./route.ts";
import { hasEvidenceIncomplete, type GithubNote } from "../../_lib/github-evidence.ts";

const realFetch = globalThis.fetch;

// Every GitHub path the mock hits this test file — reset per test so an assertion can
// prove which sub-requests actually ran (finding #1: /repos must NOT run for an org).
let fetchedPaths: string[] = [];
// The abort signal each call carried, so a test can prove EVERY outbound GitHub call is
// time-bounded (self-hosted `next start` ignores maxDuration).
let fetchedSignals: Array<AbortSignal | null | undefined> = [];

// One dispatcher keyed on the REST pathname, covering all three scenarios. An
// unmapped path throws so an unexpected sub-fetch (e.g. a deep-review call that should
// have been short-circuited) fails the test loudly instead of hanging.
function githubResponse(pathname: string): Response {
  switch (pathname) {
    // --- #1: organization handle -------------------------------------------------
    case "/users/vercel":
      // An ORG resolves 200 with public_repos/followers — the trap the fix closes.
      return Response.json({
        login: "vercel",
        html_url: "https://github.com/vercel",
        public_repos: 400,
        followers: 90000,
        type: "Organization",
      });
    case "/users/vercel/repos":
      // Mocked so pre-fix code WOULD proceed to analyze the org's portfolio — the fix
      // must ensure this path is never reached.
      return Response.json([]);

    // --- #2: partial throttle (octocat) -----------------------------------------
    case "/users/octocat":
      return Response.json({
        login: "octocat",
        html_url: "https://github.com/octocat",
        public_repos: 2,
        followers: 10,
        type: "User",
      });
    case "/users/octocat/repos":
      return Response.json([
        repo("octocat", "app", "A TypeScript service"),
        repo("octocat", "lib", "A TypeScript library"),
      ]);
    case "/repos/octocat/app/languages":
      // Throttled — this is where the candidate's (hypothetical) secondary language
      // would live. A 403 must degrade coverage, not silently vanish.
      return new Response("rate limited", { status: 403 });
    case "/repos/octocat/lib/languages":
      return Response.json({ TypeScript: 1000 });

    // --- #2: genuinely empty account (emptyuser) --------------------------------
    case "/users/emptyuser":
      return Response.json({
        login: "emptyuser",
        html_url: "https://github.com/emptyuser",
        public_repos: 1,
        followers: 0,
        type: "User",
      });
    case "/users/emptyuser/repos":
      return Response.json([repo("emptyuser", "repo", null, null)]);
    case "/repos/emptyuser/repo/languages":
      return Response.json({}); // 200 + empty = genuine absence, NOT a coverage loss
    case "/repos/emptyuser/repo/readme":
      return new Response("not found", { status: 404 }); // no README — genuine 404
    case "/repos/emptyuser/repo/commits":
      return Response.json([]);
    case "/repos/emptyuser/repo/contents":
      return Response.json([]);

    // --- bounded fetching: a stalled GitHub connection ---------------------------
    case "/users/slowuser":
      // What `AbortSignal.timeout` throws when GitHub never answers.
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");

    // --- #4: overlapping-bucket dedupe (pyuser: python-only evidence) -----------
    case "/users/pyuser":
      return Response.json({
        login: "pyuser",
        html_url: "https://github.com/pyuser",
        public_repos: 1,
        followers: 0,
        type: "User",
      });
    case "/users/pyuser/repos":
      // A python-only candidate — NO react/typescript/javascript/next.js token anywhere,
      // so a React requirement in the JD is a genuine, single gap.
      return Response.json([repo("pyuser", "svc", "A python service", "Python")]);
    case "/repos/pyuser/svc/languages":
      return Response.json({ Python: 1000 });

    // --- throttles that NAME their reset ------------------------------------------
    case "/users/throttled":
      // GitHub's secondary limiter: an RFC-7231 delta-seconds Retry-After.
      return new Response("rate limited", { status: 403, headers: { "retry-after": "42" } });
    case "/users/resetuser":
      // The primary limiter names an absolute epoch second instead.
      return new Response("rate limited", {
        status: 403,
        headers: { "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 600) },
      });
    case "/users/mutebot":
      // A throttle with NO hint at all: the panel must then say nothing, not guess.
      return new Response("rate limited", { status: 403 });

    default:
      throw new Error(`unexpected GitHub fetch in test: ${pathname}`);
  }
}

// A minimal owned (non-fork) GithubRepo the route accepts. No "rust" token anywhere in
// the metadata, so a rust gap can only come from the throttled /languages map.
function repo(owner: string, name: string, description: string | null, language: string | null = "TypeScript") {
  return {
    name,
    full_name: `${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
    description,
    fork: false,
    stargazers_count: 3,
    forks_count: 1,
    language,
    updated_at: "2026-06-01T00:00:00.000Z",
    pushed_at: "2026-06-01T00:00:00.000Z",
    topics: [] as string[],
    size: 100,
    open_issues_count: 0,
  };
}

before(() => {
  process.env.KP_LOG_DIR = mkdtempSync(path.join(os.tmpdir(), "kp-gh-log-"));
  // Trust one forwarding hop so `postFrom` really does key its own limiter bucket.
  process.env.KP_TRUSTED_PROXY = "1";
  // Deterministic: no Gemini key by default, so the deep review short-circuits to
  // "disabled" (no network) for the org + partial-throttle cases. The empty-account
  // case sets one explicitly to reach the bundle path.
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const pathname = new URL(String(url)).pathname;
    fetchedPaths.push(pathname);
    fetchedSignals.push(init?.signal);
    return githubResponse(pathname);
  }) as typeof fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  delete process.env.KP_TRUSTED_PROXY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});

beforeEach(() => {
  fetchedPaths = [];
  fetchedSignals = [];
});

function post(body: unknown): Request {
  return new Request("http://localhost/api/github-analysis", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The same request from a NAMED caller IP, so a test that adds requests gets its own
 *  per-IP bucket instead of eating the shared 10/10min budget the older tests share.
 *  `KP_TRUSTED_PROXY` is set in before(): without it every caller collapses onto the
 *  one SHARED_CLIENT_KEY bucket (rate-limit.ts's documented trap) and these tests
 *  would meet our own 429 instead of the behaviour they are about. */
function postFrom(body: unknown, ip: string): Request {
  return new Request("http://localhost/api/github-analysis", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

// --- Finding #1 ---------------------------------------------------------------------

test("#1 an organization handle is rejected BEFORE any repo analysis runs", async () => {
  const res = await POST(post({ profile: "vercel", jobDescriptionText: "" }) as never);
  const body = (await res.json()) as { error?: string; username?: string };

  // A clear, user-facing error — not an analysis of the org's portfolio.
  assert.match(body.error ?? "", /organization/i, "must tell the user it's an org, not a person");
  assert.equal(body.username, undefined, "no analysis payload for an org");

  // The /users lookup happened; the /repos deep-dive did NOT — the whole portfolio
  // was never fetched, let alone attributed to a candidate.
  assert.ok(fetchedPaths.includes("/users/vercel"), "the account is looked up");
  assert.ok(
    !fetchedPaths.some((p) => p.includes("/repos")),
    `rejection must precede repo analysis; saw ${JSON.stringify(fetchedPaths)}`,
  );
  // NON-VACUITY: against pre-fix code (no user.type check) the route proceeds to
  // GET /users/vercel/repos and returns a full 0-repo analysis with no `error`, so
  // BOTH the /organization/ match and the "no /repos fetched" assertion fail.
});

// --- Finding #2 ---------------------------------------------------------------------

test("#2 a 403 on a /languages sub-request yields 'could not determine', never an empty-but-successful gap", async () => {
  const res = await POST(
    post({ profile: "octocat", jobDescriptionText: "We need a strong rust and typescript developer." }) as never,
  );
  const body = (await res.json()) as {
    error?: string;
    jobFitSignals: { matchingSkills: string[]; potentialGaps: string[] };
    limitations: GithubNote[];
    codeReview?: { status: string };
  };

  assert.equal(body.error, undefined, "the run still succeeds — this is degraded, not failed");

  // Positive evidence survives a partial read: TypeScript came back 200, so it's a match.
  assert.ok(body.jobFitSignals.matchingSkills.includes("typescript"), "found evidence is still asserted");

  // A gap is NEVER asserted from missing data: rust's evidence was in the throttled
  // /languages map, so it must not appear as a Potential Gap. deepEqual([]) is
  // strictly stronger than a "does not include rust" check — no gap survives at all.
  assert.deepEqual(body.jobFitSignals.potentialGaps, [], "gaps suppressed under partial coverage");

  // "Could not determine" is propagated to the panel via the shared limitation note.
  assert.ok(
    hasEvidenceIncomplete(body.limitations),
    "the panel-facing could-not-determine finding must be present",
  );
  // NON-VACUITY: pre-fix, the 403 emptied app's language map so rust became a gap
  // (potentialGaps === ["rust"]) and the incomplete note was never appended — so both
  // the deepEqual([]) and the hasEvidenceIncomplete(...) assertions fail.
});

test("#2 a genuinely empty account yields 'no evidence' (codeReview 'empty'), not a coverage warning", async () => {
  process.env.GEMINI_API_KEY = "test-key-empty"; // reach the deep-review bundle path
  try {
    const res = await POST(post({ profile: "emptyuser", jobDescriptionText: "We need a python developer." }) as never);
    const body = (await res.json()) as {
      error?: string;
      jobFitSignals: { potentialGaps: string[] };
      limitations: GithubNote[];
      codeReview?: { status: string };
    };

    assert.equal(body.error, undefined);

    // Every sub-fetch succeeded (or was a genuine 404) — this is real "no evidence",
    // a distinct, successful state from "could not determine".
    assert.equal(body.codeReview?.status, "empty", "no signals + complete coverage = empty, not error");
    assert.ok(
      !hasEvidenceIncomplete(body.limitations),
      "a complete run must NOT carry the could-not-determine finding",
    );
    // Coverage is complete, so a real gap is legitimately asserted.
    assert.ok(body.jobFitSignals.potentialGaps.includes("python"), "a genuine gap is still reported");
    // NON-VACUITY: pre-fix, an all-empty bundle set returned codeReview.status
    // "error" (insufficient_evidence) regardless of whether the fetches succeeded, so
    // asserting "empty" fails against the old binary any-signal-vs-none logic.
  } finally {
    delete process.env.GEMINI_API_KEY;
  }
});

test("#2 a degraded run is NOT cached, so the panel's 'retry for a complete read' is a real retry", async () => {
  // octocat's /languages 403s, so this run is knowingly incomplete: gaps suppressed and
  // the could-not-determine limitation attached. The panel tells the reader to retry —
  // caching that payload made the retry a silent no-op for the whole 15-minute TTL,
  // freezing an incomplete read of a real engineer's work as if it were the answer.
  const jd = "We need a strong rust and typescript developer (degraded-cache case).";
  const first = (await (await POST(post({ profile: "octocat", jobDescriptionText: jd }) as never)).json()) as {
    limitations: GithubNote[];
  };
  assert.ok(hasEvidenceIncomplete(first.limitations), "precondition: this run is degraded");

  fetchedPaths = [];
  const second = (await (await POST(post({ profile: "octocat", jobDescriptionText: jd }) as never)).json()) as {
    limitations: GithubNote[];
  };
  assert.ok(
    fetchedPaths.includes("/users/octocat"),
    `the retry must re-run against GitHub, not replay the cache; saw ${JSON.stringify(fetchedPaths)}`,
  );
  assert.ok(hasEvidenceIncomplete(second.limitations), "still degraded here — the mock still 403s");
  // NON-VACUITY: pre-fix the route cached every 200, so the second POST returned the
  // stored degraded payload with zero GitHub calls and fetchedPaths stayed empty.
});

test("a COMPLETE run is still cached — the cost guard is intact", async () => {
  // No Gemini key here, so codeReview is "disabled" — a deterministic, non-transient
  // state a retry cannot change. It must keep serving from the cache.
  const jd = "We need a python developer (cacheable case).";
  await POST(post({ profile: "emptyuser", jobDescriptionText: jd }) as never);
  fetchedPaths = [];
  const res = await POST(post({ profile: "emptyuser", jobDescriptionText: jd }) as never);
  assert.equal(((await res.json()) as { error?: string }).error, undefined);
  assert.deepEqual(fetchedPaths, [], "a complete run must still be served from the cache");
});

// --- Bounded fetching -----------------------------------------------------------------

test("every GitHub call is time-bounded, and a stall answers with a classified code", async () => {
  // A stalled GitHub connection is otherwise bounded only by undici's 300s default,
  // and `maxDuration` does nothing on a self-hosted `next start` — so each call must
  // carry its own abort signal.
  const ok = await POST(post({ profile: "octocat", jobDescriptionText: "typescript" }) as never);
  assert.equal(((await ok.json()) as { error?: string }).error, undefined);
  assert.ok(fetchedSignals.length > 0, "precondition: calls were made");
  assert.ok(
    fetchedSignals.every((s) => s instanceof AbortSignal),
    "every outbound GitHub call must carry a timeout signal",
  );

  // And when the abort fires, it must reach the panel as a localizable code, not as a
  // raw "operation was aborted" string under the catch-all.
  const res = await POST(post({ profile: "slowuser", jobDescriptionText: "" }) as never);
  const body = (await res.json()) as { error?: string; code?: string };
  assert.equal(body.code, "API_ERROR", `a stall must classify; saw ${JSON.stringify(body)}`);
  // The wire now carries the CODE's canonical sentence, not the throw's own text: the
  // "(no response within 20s)" detail is the log's, so the client answer stays one
  // message per code (api-contracts.md §1.1). What must never appear is the raw abort.
  assert.equal(body.error, "GitHub returned an unexpected error.");
  assert.doesNotMatch(body.error ?? "", /aborted|TimeoutError/i);
  // NON-VACUITY: pre-fix no `signal` was passed (every entry was undefined) and the
  // TimeoutError fell through to the route's catch-all as code ANALYSIS_FAILED.
});

// --- Finding #4 ---------------------------------------------------------------------

test("#4 one JD skill produces ONE gap, not several, across overlapping buckets", async () => {
  // A React requirement against a python-only candidate. "react" used to be an alias of
  // three buckets (typescript, javascript, react), so this fanned into THREE gap bullets
  // for one underlying missing skill.
  const res = await POST(post({ profile: "pyuser", jobDescriptionText: "We need a strong react developer." }) as never);
  const body = (await res.json()) as {
    error?: string;
    jobFitSignals: { matchingSkills: string[]; potentialGaps: string[] };
  };

  assert.equal(body.error, undefined);
  // Exactly one concept-level gap — the buckets are now mutually exclusive.
  assert.deepEqual(body.jobFitSignals.potentialGaps, ["react"], "one skill = one gap");
  assert.ok(!body.jobFitSignals.potentialGaps.includes("typescript"), "no phantom typescript gap");
  assert.ok(!body.jobFitSignals.potentialGaps.includes("javascript"), "no phantom javascript gap");
  // NON-VACUITY: against pre-fix aliases, "react" fired the typescript, javascript AND
  // react buckets, so potentialGaps was ["typescript","javascript","react"] — the
  // deepEqual(["react"]) assertion fails.
});


// --- the door itself: authorization, bounds, and honest throttles -------------------

test("the door asks a CAPABILITY: an authenticated-but-unseated caller is refused before any spend", async () => {
  // Open dev folds every caller to owner, so the question only becomes visible once a
  // password is configured. With no session cookie the caller is unauthenticated, and
  // the route must refuse BEFORE it opens a single GitHub connection or a Gemini one.
  process.env.KP_OPERATOR_PASSWORD = "test-operator-password";
  try {
    const res = await POST(postFrom({ profile: "octocat", jobDescriptionText: "" }, "10.0.0.9") as never);
    assert.equal(res.status, 401, "no session, no analysis");
    assert.deepEqual(fetchedPaths, [], `the refusal precedes every outbound call; saw ${JSON.stringify(fetchedPaths)}`);
    const body = (await res.json()) as { username?: string };
    assert.equal(body.username, undefined, "and certainly no analysis payload");
  } finally {
    delete process.env.KP_OPERATOR_PASSWORD;
  }
  // NON-VACUITY: before the gate landed this route had NO capability call at all
  // (route-capability-coverage listed it as unjudged debt), so the same request
  // returned a full 200 analysis and fetchedPaths was non-empty.
});

test("an over-long job description is refused with a code and the limit as DATA, spending nothing", async () => {
  const res = await POST(
    postFrom({ profile: "octocat", jobDescriptionText: "x".repeat(20_001) }, "10.0.0.10") as never,
  );
  assert.equal(res.status, 413);
  const body = (await res.json()) as { code?: string; max?: number; error?: string };
  assert.equal(body.code, "JD_TOO_LONG");
  assert.equal(body.max, 20_000, "the limit rides as data so the panel can name it in any language");
  assert.deepEqual(fetchedPaths, [], "an over-budget prompt never reaches GitHub or Gemini");
  // NON-VACUITY: only the CACHE KEY was capped before this; the prompt took the whole
  // string, so a 2 MB paste ran the full ~31 calls and one paid Gemini completion.
});

test("a JD exactly at the cap is accepted — the bound is a limit, not an off-by-one", async () => {
  const res = await POST(postFrom({ profile: "octocat", jobDescriptionText: "x".repeat(20_000) }, "10.0.0.11") as never);
  assert.notEqual(res.status, 413);
});

test("a GitHub throttle forwards its own Retry-After as retryAfterSec", async () => {
  const res = await POST(postFrom({ profile: "throttled", jobDescriptionText: "" }, "10.0.0.12") as never);
  const body = (await res.json()) as { code?: string; retryAfterSec?: number };
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(body.retryAfterSec, 42, "the boundary said WHEN; the panel gets to say it too");
});

test("…and reads x-ratelimit-reset when that is the header GitHub sent", async () => {
  const res = await POST(postFrom({ profile: "resetuser", jobDescriptionText: "" }, "10.0.0.13") as never);
  const body = (await res.json()) as { code?: string; retryAfterSec?: number };
  assert.equal(body.code, "RATE_LIMITED");
  assert.ok(
    typeof body.retryAfterSec === "number" && body.retryAfterSec > 540 && body.retryAfterSec <= 600,
    `an epoch reset becomes a delta; saw ${body.retryAfterSec}`,
  );
});

test("a throttle with no hint carries no retryAfterSec — the panel must not invent one", async () => {
  const res = await POST(postFrom({ profile: "mutebot", jobDescriptionText: "" }, "10.0.0.14") as never);
  const body = (await res.json()) as { code?: string; retryAfterSec?: number };
  assert.equal(body.code, "RATE_LIMITED");
  assert.equal(body.retryAfterSec, undefined);
});

test("KP_OFFLINE: the route answers a code without touching the network", async () => {
  process.env.KP_OFFLINE = "1";
  try {
    const res = await POST(postFrom({ profile: "octocat", jobDescriptionText: "" }, "10.0.0.15") as never);
    const body = (await res.json()) as { code?: string; error?: string };
    assert.equal(body.code, "OFFLINE");
    assert.deepEqual(fetchedPaths, [], "an air-gapped install opens no socket");
    assert.doesNotMatch(body.error ?? "", /fetch|undici|blocked/i, "a coded refusal, not a guard's internals");
  } finally {
    delete process.env.KP_OFFLINE;
  }
});

test("a failure answers with the CODE's canonical message, never the thrown error's own", async () => {
  const res = await POST(postFrom({ profile: "slowuser", jobDescriptionText: "" }, "10.0.0.16") as never);
  const body = (await res.json()) as { code?: string; error?: string };
  assert.equal(body.code, "API_ERROR");
  assert.doesNotMatch(body.error ?? "", /aborted|TimeoutError|DOMException/i);
});
