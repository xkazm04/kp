// The politeness contract on a FAKE clock: robots.txt is honoured before a byte
// leaves, Crawl-delay spaces the host, a denial is `blocked` and is never retried,
// an interstitial on a 200 is `blocked`, KP_OFFLINE answers before any network.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _resetPolitenessForTests,
  _setPoliteFetchDepsForTests,
  jitterFor,
  MIN_SPACING_MS,
  politeFetch,
  spacingFor,
} from "./politeFetch.ts";
import { crawlDelayFor, isPathAllowed, parseRobots } from "./robots.ts";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__");
const robotsTxt = readFileSync(path.join(FIXTURES, "robots.txt"), "utf8");
const interstitial = readFileSync(path.join(FIXTURES, "cloudflare-interstitial.html"), "utf8");

type Call = { url: string; method: string; headers: Record<string, string> };

/** A scripted fetch: `routes` maps a URL (or a `*` catch-all) to a response factory;
 *  every call is recorded. Time never advances on its own — `sleep` records the
 *  requested wait and jumps the clock, so a test reads the arithmetic directly. */
function harness(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const sleeps: number[] = [];
  let now = 1_000_000;
  _setPoliteFetchDepsForTests({
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      calls.push({ url, method: init?.method ?? "GET", headers });
      const factory = routes[url] ?? routes["*"];
      if (!factory) return new Response("not routed", { status: 404 });
      return factory();
    },
  });
  return { calls, sleeps, advance: (ms: number) => (now += ms) };
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

beforeEach(() => {
  _resetPolitenessForTests();
  delete process.env.KP_OFFLINE;
});
afterEach(() => {
  _resetPolitenessForTests();
  delete process.env.KP_OFFLINE;
});

test("robots.txt: groups, longest match, empty Disallow, Crawl-delay", () => {
  const rules = parseRobots(robotsTxt);
  assert.equal(isPathAllowed(rules, "/nabidka/123"), true);
  assert.equal(isPathAllowed(rules, "/search?q=java"), false);
  assert.equal(isPathAllowed(rules, "/api/jobs"), false);
  assert.equal(isPathAllowed(rules, "/api/public/jobs"), true, "the longer Allow beats the shorter Disallow");
  assert.equal(isPathAllowed(rules, "/prace/?sort=date"), false, "a wildcard pattern matches the query");
  assert.equal(crawlDelayFor(rules), 5);
  // Our own group wins over `*` when the host names us; SomeOtherBot's total ban is not ours.
  const own = parseRobots("User-agent: *\nDisallow: /\n\nUser-agent: kp-jobseeker\nAllow: /jobs/\nDisallow: /\n");
  assert.equal(isPathAllowed(own, "/jobs/1"), true);
  assert.equal(isPathAllowed(own, "/admin"), false);
  assert.equal(isPathAllowed(parseRobots("User-agent: *\nDisallow:\n"), "/anything"), true, "an empty Disallow allows everything");
});

test("a robots Disallow means the page is never requested", async () => {
  const h = harness({
    "https://board.example/robots.txt": () => new Response(robotsTxt, { status: 200 }),
    "*": () => html("<html>should not be fetched</html>"),
  });
  const out = await politeFetch("https://board.example/search?q=java", { sourceId: "s1" });
  assert.equal(out.kind, "robots_disallowed");
  assert.deepEqual(
    h.calls.map((c) => c.url),
    ["https://board.example/robots.txt"],
    "exactly one request left: the robots.txt read"
  );
});

test("Crawl-delay is honoured on the fake clock; the jitter is a deterministic function of the source id", async () => {
  const h = harness({
    "https://board.example/robots.txt": () => new Response(robotsTxt, { status: 200 }),
    "*": () => html("<html><body>ok</body></html>"),
  });
  const first = await politeFetch("https://board.example/nabidka/1", { sourceId: "s1" });
  assert.equal(first.kind, "ok");
  assert.deepEqual(h.sleeps, [], "the first request to a host does not wait");
  const second = await politeFetch("https://board.example/nabidka/2", { sourceId: "s1" });
  assert.equal(second.kind, "ok");
  const expected = spacingFor("s1", 5);
  assert.equal(expected, 5000 + jitterFor("s1"), "Crawl-delay 5 → 5 s plus the source's jitter");
  assert.deepEqual(h.sleeps, [expected], "the second request waited exactly the spacing");
  assert.equal(h.calls.filter((c) => c.url.endsWith("robots.txt")).length, 1, "robots.txt is fetched once per host");
  assert.equal(jitterFor("s1"), jitterFor("s1"));
  assert.ok(jitterFor("s1") < 700 && jitterFor("s2") < 700);
  assert.equal(spacingFor("s1", null), MIN_SPACING_MS + jitterFor("s1"), "no Crawl-delay → the 2 s floor");
  assert.equal(spacingFor("s1", 1), MIN_SPACING_MS + jitterFor("s1"), "a Crawl-delay under the floor is raised to it");
  for (const call of h.calls) {
    assert.match(call.headers["user-agent"], /^kp-jobseeker\/1\.0 \(\+https:\/\/github\.com\/xkazm04\/kp; owner-operated\)$/);
  }
});

test("403 → blocked (no body read, no retry); a 200 interstitial → blocked; 404 → gone; 5xx → outage", async () => {
  let hits = 0;
  const h = harness({
    "https://wall.example/robots.txt": () => new Response("", { status: 404 }),
    "https://wall.example/a": () => {
      hits += 1;
      return html("forbidden", 403);
    },
    "https://wall.example/b": () => html(interstitial),
    "https://wall.example/c": () => html("gone", 404),
    "https://wall.example/d": () => html("boom", 503),
    "https://wall.example/e": () => html("<html><body>Just a normal ad about g-recaptcha? no.</body></html>"),
  });
  const a = await politeFetch("https://wall.example/a", { sourceId: "s1" });
  assert.equal(a.kind, "blocked");
  assert.equal(hits, 1, "a blocked status is never retried by the fetcher");
  const b = await politeFetch("https://wall.example/b", { sourceId: "s1" });
  assert.deepEqual(b, { kind: "blocked", status: 200, detail: "interstitial" });
  assert.equal((await politeFetch("https://wall.example/c", { sourceId: "s1" })).kind, "gone");
  assert.equal((await politeFetch("https://wall.example/d", { sourceId: "s1" })).kind, "outage");
  assert.equal(h.calls.filter((c) => c.url.endsWith("robots.txt")).length, 1, "an unreachable robots.txt is read once and treated as allow");
});

test("KP_OFFLINE answers offline with zero fetch calls", async () => {
  const h = harness({ "*": () => html("nope") });
  process.env.KP_OFFLINE = "1";
  const out = await politeFetch("https://board.example/nabidka/1", { sourceId: "s1" });
  assert.deepEqual(out, { kind: "offline", detail: "KP_OFFLINE" });
  assert.equal(h.calls.length, 0);
});

test("a 5xx robots.txt is an outage for the host; a body over 2 MB is too_large; a non-http scheme is refused", async () => {
  harness({
    "https://down.example/robots.txt": () => new Response("", { status: 500 }),
    "https://big.example/robots.txt": () => new Response("", { status: 404 }),
    "https://big.example/file": () => html("x".repeat(2 * 1024 * 1024 + 1)),
  });
  const down = await politeFetch("https://down.example/x", { sourceId: "s1" });
  assert.deepEqual(down, { kind: "outage", status: 503, detail: "robots_5xx" });
  const big = await politeFetch("https://big.example/file", { sourceId: "s1" });
  assert.equal(big.kind, "outage");
  assert.equal((big as { detail: string }).detail, "too_large");
  assert.equal((await politeFetch("ftp://x.example/a", { sourceId: "s1" })).kind, "outage");
});

test("a cross-host redirect re-checks robots on the new host", async () => {
  const h = harness({
    "https://a.example/robots.txt": () => new Response("", { status: 404 }),
    "https://a.example/go": () => new Response(null, { status: 302, headers: { location: "https://b.example/landing" } }),
    "https://b.example/robots.txt": () => new Response("User-agent: *\nDisallow: /landing\n", { status: 200 }),
    "*": () => html("landed"),
  });
  const out = await politeFetch("https://a.example/go", { sourceId: "s1" });
  assert.equal(out.kind, "robots_disallowed");
  assert.ok(h.calls.some((c) => c.url === "https://b.example/robots.txt"), "the second host's robots.txt was read");
  assert.ok(!h.calls.some((c) => c.url === "https://b.example/landing"), "…and the disallowed page was not requested");
});

test("an authorization header reaches the starting host only; a cross-host redirect drops it; robots.txt never carries it", async () => {
  const h = harness({
    "https://api.a.example/robots.txt": () => new Response("", { status: 404 }),
    "https://api.a.example/list": () => new Response(null, { status: 302, headers: { location: "https://api.a.example/list2" } }),
    "https://api.a.example/list2": () => new Response(null, { status: 302, headers: { location: "https://cdn.b.example/list3" } }),
    "https://cdn.b.example/robots.txt": () => new Response("", { status: 404 }),
    "*": () => new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
  });
  const out = await politeFetch("https://api.a.example/list", { sourceId: "s1", authorization: "Bearer secret-token" });
  assert.equal(out.kind, "ok");
  const auth = (url: string) => h.calls.find((c) => c.url === url)?.headers.authorization;
  assert.equal(auth("https://api.a.example/list"), "Bearer secret-token");
  assert.equal(auth("https://api.a.example/list2"), "Bearer secret-token", "a same-host hop keeps it");
  assert.equal(auth("https://cdn.b.example/list3"), undefined, "a hop onto another host drops it");
  assert.equal(auth("https://api.a.example/robots.txt"), undefined);
});

test("a hopGuard refuses a redirect target before it is requested (SSRF through a redirect)", async () => {
  const h = harness({
    "https://public.example/robots.txt": () => new Response("", { status: 404 }),
    "https://public.example/go": () => new Response(null, { status: 302, headers: { location: "http://internal.example/admin" } }),
    "*": () => html("should never be fetched"),
  });
  const seen: string[] = [];
  const out = await politeFetch("https://public.example/go", {
    sourceId: "s1",
    hopGuard: async (next) => {
      seen.push(next.href);
      return next.hostname === "internal.example" ? "not_public_host" : null;
    },
  });
  assert.equal(out.kind, "blocked");
  assert.equal(out.kind === "blocked" ? out.detail : "", "redirect_refused:not_public_host");
  assert.deepEqual(seen, ["http://internal.example/admin"], "the guard saw the hop target");
  assert.ok(!h.calls.some((c) => c.url.startsWith("http://internal.example")), "the private target was never requested, robots.txt included");
});
