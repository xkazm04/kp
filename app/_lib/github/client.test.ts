// ONE GitHub transport (challenge-r04 github-repo-intelligence/A).
//
// kp used to talk to api.github.com through two helpers: the analyzer's hardened
// `githubFetch` (timeout, 4 MB byte cap, KP_OFFLINE refusal, a status-carrying error)
// and the dev-case path's private `gh()` in repo-snapshot.ts, which turned every
// failure into `null`. Downstream, a 403 on a candidate's submission repo read as
// "no commit history, no DECISIONS log" and cost the candidate authenticity points.
//
// `githubRead` is the single transport: it never throws, it answers a discriminated
// outcome, and `githubFetch` is a throw-on-failure wrapper over it. These cases pin
// the outcome vocabulary and that the wrapper's thrown shapes did not move.
//
// Runner: npm run test:unit
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GithubAnalysisError, GithubHttpError, githubFetch, githubRead } from "./client.ts";

const realFetch = globalThis.fetch;
const realOffline = process.env.KP_OFFLINE;
let calls = 0;

function stubFetch(answer: () => Response | Promise<Response>) {
  calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return answer();
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realOffline === undefined) delete process.env.KP_OFFLINE;
  else process.env.KP_OFFLINE = realOffline;
});

const URL_ = "https://api.github.com/repos/octocat/hello/commits";

test("a 403 with retry-after is a throttle that names when to come back", async () => {
  stubFetch(() => new Response("{}", { status: 403, headers: { "retry-after": "120" } }));
  const out = await githubRead(URL_);
  assert.deepEqual(out, { ok: false, kind: "throttled", status: 403, retryAfterSec: 120 });
});

test("a 429 is the same throttle", async () => {
  stubFetch(() => new Response("{}", { status: 429 }));
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "throttled");
  assert.equal(!out.ok && out.status, 429);
});

test("a 404 is not_found: a fact about the link, not a read failure", async () => {
  stubFetch(() => new Response("{}", { status: 404 }));
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "not_found");
  assert.equal(!out.ok && out.status, 404);
});

test("a 5xx is an http_error carrying its status (could not read)", async () => {
  stubFetch(() => new Response("oops", { status: 502 }));
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "http_error");
  assert.equal(!out.ok && out.status, 502);
});

test("a TimeoutError abort is unreachable", async () => {
  stubFetch(() => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "unreachable");
});

test("a network throw is unreachable too, never an exception", async () => {
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "unreachable");
});

test("a 200 '[]' is a read, with the parsed data", async () => {
  stubFetch(() => new Response("[]", { status: 200 }));
  assert.deepEqual(await githubRead(URL_), { ok: true, data: [] });
});

test("a 200 that is not JSON is bad_shape", async () => {
  stubFetch(() => new Response("<html>", { status: 200 }));
  const out = await githubRead(URL_);
  assert.equal(!out.ok && out.kind, "bad_shape");
});

test("a 200 body past the 4 MB cap is too_large, never buffered whole", async () => {
  const big = "[" + '"x",'.repeat(1_100_000) + '"x"]'; // ~4.4 MB of valid JSON
  stubFetch(() => new Response(big, { status: 200 }));
  const out = await githubRead(URL_);
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.kind, "too_large");
});

test("KP_OFFLINE refuses before any socket: offline, and fetch is never called", async () => {
  process.env.KP_OFFLINE = "1";
  stubFetch(() => new Response("[]", { status: 200 }));
  const out = await githubRead(URL_);
  assert.deepEqual(out, { ok: false, kind: "offline" });
  assert.equal(calls, 0);
});

test("one credential rule: GH_TOKEN authenticates when GITHUB_TOKEN is unset", async () => {
  const savedA = process.env.GITHUB_TOKEN;
  const savedB = process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.GH_TOKEN = "gh-only";
  let auth: string | null = null;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    auth = new Headers(init?.headers).get("authorization");
    return new Response("[]", { status: 200 });
  }) as typeof fetch;
  try {
    await githubRead(URL_);
    assert.equal(auth, "Bearer gh-only");
  } finally {
    if (savedA === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = savedA;
    if (savedB === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = savedB;
  }
});

// ── githubFetch keeps its thrown shapes (the analyzer relies on them) ─────────

test("githubFetch: 404 still throws GithubHttpError(404, PROFILE_NOT_FOUND)", async () => {
  stubFetch(() => new Response("{}", { status: 404 }));
  await assert.rejects(githubFetch(URL_), (e: unknown) => e instanceof GithubHttpError && e.status === 404 && e.code === "PROFILE_NOT_FOUND");
});

test("githubFetch: 403 still throws RATE_LIMITED with the retry hint", async () => {
  stubFetch(() => new Response("{}", { status: 403, headers: { "retry-after": "90" } }));
  await assert.rejects(
    githubFetch(URL_),
    (e: unknown) => e instanceof GithubHttpError && e.status === 403 && e.code === "RATE_LIMITED" && e.retryAfterSec === 90,
  );
});

test("githubFetch: 5xx still throws API_ERROR naming the status", async () => {
  stubFetch(() => new Response("", { status: 503 }));
  await assert.rejects(
    githubFetch(URL_),
    (e: unknown) => e instanceof GithubHttpError && e.status === 503 && e.code === "API_ERROR" && /HTTP 503/.test(e.message),
  );
});

test("githubFetch: timeout, too-large, bad-shape and offline keep their codes", async () => {
  stubFetch(() => {
    throw new DOMException("timeout", "TimeoutError");
  });
  await assert.rejects(githubFetch(URL_), (e: unknown) => e instanceof GithubAnalysisError && e.code === "API_ERROR" && /no response within/.test(e.message));

  stubFetch(() => new Response("[" + '"x",'.repeat(1_100_000) + '"x"]', { status: 200 }));
  await assert.rejects(githubFetch(URL_), (e: unknown) => e instanceof GithubAnalysisError && e.code === "RESPONSE_TOO_LARGE");

  stubFetch(() => new Response("not json", { status: 200 }));
  await assert.rejects(githubFetch(URL_), (e: unknown) => e instanceof GithubAnalysisError && e.code === "BAD_SHAPE");

  process.env.KP_OFFLINE = "1";
  await assert.rejects(githubFetch(URL_), (e: unknown) => e instanceof GithubAnalysisError && e.code === "OFFLINE");
});

test("githubFetch: a raw network throw still propagates unclassified", async () => {
  const boom = new TypeError("fetch failed");
  stubFetch(() => {
    throw boom;
  });
  await assert.rejects(githubFetch(URL_), (e: unknown) => e === boom);
});

test("githubFetch: an empty 200 body is still null", async () => {
  stubFetch(() => new Response("", { status: 200 }));
  assert.equal(await githubFetch(URL_), null);
});
