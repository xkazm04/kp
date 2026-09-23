// Pins the commit-cadence "bursty" heuristic (idea-b3b254d6). The old rule compared a duration
// in hours against a commit count (`spanHours <= Math.max(6, times.length)`) — a unit mismatch
// no one could tune. The replacement is a named, unit-correct rule, locked here with a clearly
// bursty fixture (a cluster in one sitting) and a clearly spread-out one (commits over weeks).
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  BURSTY_MIN_COMMITS,
  BURSTY_WINDOW_HOURS,
  buildRepoSnapshot,
  fetchRepoSignals,
  summarizeCadence,
} from "./repo-snapshot.ts";

const at = (iso: string) => ({ date: iso });

// ---------------------------------------------------------------------------
// The named rule.
// ---------------------------------------------------------------------------

test("the rule constants are the documented 6h window / 3-commit minimum", () => {
  assert.equal(BURSTY_WINDOW_HOURS, 6);
  assert.equal(BURSTY_MIN_COMMITS, 3);
});

// ---------------------------------------------------------------------------
// Clearly bursty: a real cluster inside one sitting.
// ---------------------------------------------------------------------------

test("4 commits within ~2 hours is bursty", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T09:30:00.000Z"),
    at("2026-01-10T10:15:00.000Z"),
    at("2026-01-10T11:00:00.000Z"),
  ]);
  assert.equal(cadence.count, 4);
  assert.equal(cadence.spanHours, 2);
  assert.equal(cadence.bursty, true);
});

test("a cluster spanning exactly the window boundary is bursty (inclusive)", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T12:00:00.000Z"),
    at("2026-01-10T15:00:00.000Z"), // exactly 6h after the first
  ]);
  assert.equal(cadence.spanHours, BURSTY_WINDOW_HOURS);
  assert.equal(cadence.bursty, true);
});

// ---------------------------------------------------------------------------
// Clearly NOT bursty.
// ---------------------------------------------------------------------------

test("commits spread across weeks are not bursty", () => {
  const cadence = summarizeCadence([
    at("2026-01-01T09:00:00.000Z"),
    at("2026-01-08T14:00:00.000Z"),
    at("2026-01-15T11:00:00.000Z"),
    at("2026-01-23T16:00:00.000Z"),
  ]);
  assert.equal(cadence.count, 4);
  assert.ok((cadence.spanHours ?? 0) > BURSTY_WINDOW_HOURS);
  assert.equal(cadence.bursty, false);
});

test("a tight pair is NOT bursty — below the minimum-commit floor", () => {
  // Two commits an hour apart fits the window but isn't a genuine cluster, so the
  // count floor keeps it from being labelled bursty.
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at("2026-01-10T10:00:00.000Z"),
  ]);
  assert.equal(cadence.spanHours, 1);
  assert.equal(cadence.bursty, false);
});

// ---------------------------------------------------------------------------
// Degenerate inputs: too few dated commits to judge.
// ---------------------------------------------------------------------------

test("fewer than two dated commits yields null span and null bursty", () => {
  assert.deepEqual(summarizeCadence([]), { count: 0, spanHours: null, bursty: null });
  assert.deepEqual(summarizeCadence([at("2026-01-10T09:00:00.000Z")]), {
    count: 1,
    spanHours: null,
    bursty: null,
  });
});

test("undated commits are ignored for span/bursty but still counted", () => {
  const cadence = summarizeCadence([
    at("2026-01-10T09:00:00.000Z"),
    at(""), // no date — counted, but contributes no timestamp
    at("not-a-date"),
  ]);
  assert.equal(cadence.count, 3); // every commit counts
  assert.equal(cadence.spanHours, null); // only one parseable date → no span
  assert.equal(cadence.bursty, null);
});

// ---------------------------------------------------------------------------
// Unreadable is not absent (challenge-r04 github-repo-intelligence/A).
//
// The reads go through the one GitHub transport (client.ts githubRead), so a
// throttle / 5xx / timeout is reported as "could not read" at every layer instead
// of collapsing to null -> "no commit history" -> an authenticity penalty the
// candidate never earned. A 404 stays null: a link that does not resolve is a
// fact about the link.
// ---------------------------------------------------------------------------

type Route = { status: number; body?: unknown; headers?: Record<string, string> };

function routeFetch(route: (url: string) => Route) {
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    const r = route(url);
    const body = r.body === undefined ? "" : JSON.stringify(r.body);
    return new Response(body, { status: r.status, headers: r.headers });
  }) as typeof fetch;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const commitRow = (i: number) => ({
  sha: `sha${String(i).padStart(4, "0")}abcdef`,
  commit: { message: `commit ${i}`, author: { date: `2026-01-${String(1 + i).padStart(2, "0")}T09:00:00Z` } },
});

test("fetchRepoSignals: a throttled commits list is UNREADABLE, not null", async () => {
  routeFetch((url) =>
    /\/commits\?/.test(url) ? { status: 403, body: {}, headers: { "retry-after": "120" } } : { status: 200, body: [] },
  );
  const out = await fetchRepoSignals("octocat/hello");
  assert.deepEqual(out, { ok: false, unreadable: "throttled", retryAfterSec: 120 });
});

test("fetchRepoSignals: a commits list that 404s stays null (the link does not resolve)", async () => {
  routeFetch(() => ({ status: 404, body: {} }));
  assert.equal(await fetchRepoSignals("octocat/hello"), null);
});

test("fetchRepoSignals: a /contents 5xx marks the tree unread instead of empty", async () => {
  const list = [0, 1, 2].map(commitRow);
  routeFetch((url) => {
    if (/\/commits\?/.test(url)) return { status: 200, body: list };
    if (/\/contents$/.test(url)) return { status: 502, body: {} };
    return { status: 200, body: { stats: { additions: 1, deletions: 0 }, files: [{ filename: "a.ts" }] } };
  });
  const out = await fetchRepoSignals("octocat/hello");
  assert.ok(out && out.ok);
  assert.equal(out.topLevelReadable, false);
  assert.deepEqual(out.topLevel, []);
  assert.equal(out.statsReadable, true);
});

test("fetchRepoSignals: a /contents 404 is an empty tree that WAS read", async () => {
  routeFetch((url) => {
    if (/\/commits\?/.test(url)) return { status: 200, body: [commitRow(0)] };
    if (/\/contents$/.test(url)) return { status: 404, body: {} };
    return { status: 200, body: { stats: { additions: 1, deletions: 0 }, files: [] } };
  });
  const out = await fetchRepoSignals("octocat/hello");
  assert.ok(out && out.ok);
  assert.equal(out.topLevelReadable, true);
});

test("fetchRepoSignals: 3 of 12 commit-detail calls failing is a PARTIAL stats read", async () => {
  const list = Array.from({ length: 12 }, (_, i) => commitRow(i));
  const failing = new Set([list[1].sha, list[5].sha, list[9].sha]);
  routeFetch((url) => {
    if (/\/commits\?/.test(url)) return { status: 200, body: list };
    if (/\/contents$/.test(url)) return { status: 200, body: [{ name: "DECISIONS.md", type: "file" }] };
    const sha = url.split("/commits/")[1];
    if (failing.has(sha)) return { status: 403, body: {} };
    return { status: 200, body: { stats: { additions: 2, deletions: 1 }, files: [{ filename: `f-${sha}.ts` }] } };
  });
  const out = await fetchRepoSignals("octocat/hello");
  assert.ok(out && out.ok);
  assert.equal(out.statsReadable, "partial");
  assert.equal(out.topLevelReadable, true);
  assert.equal(out.changedPaths.length, 9);
  for (const sha of failing) assert.ok(!out.changedPaths.includes(`f-${sha}.ts`));
});

test("buildRepoSnapshot: throttled languages + readme are NAMED as unread, not silently empty", async () => {
  routeFetch((url) => {
    if (/\/languages$/.test(url) || /\/readme$/.test(url)) return { status: 403, body: {} };
    if (/\/commits\?/.test(url)) return { status: 200, body: [commitRow(0)] };
    if (/\/contents$/.test(url)) return { status: 200, body: [{ name: "src", type: "dir" }] };
    return { status: 404, body: {} };
  });
  const snap = await buildRepoSnapshot("octocat/hello");
  assert.ok(snap);
  assert.deepEqual(snap.unreadable, ["languages", "readme"]);
  assert.deepEqual(snap.topDirs, ["src"]);
});

test("buildRepoSnapshot: a repo with no README (404) is read, not unreadable", async () => {
  routeFetch((url) => {
    if (/\/readme$/.test(url)) return { status: 404, body: {} };
    if (/\/languages$/.test(url)) return { status: 200, body: { TypeScript: 100 } };
    return { status: 200, body: [] };
  });
  const snap = await buildRepoSnapshot("octocat/hello");
  assert.ok(snap);
  assert.deepEqual(snap.unreadable, []);
});
