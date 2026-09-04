// The pull contract an integrator writes against (see the header of pull-pass.ts),
// pinned where it is cheap: the envelope parser and the bounds. The apply half goes
// through the shared intake core and is covered by the receiver's own suites — what
// is unique here is how a source's answer is READ, and how much of it we are willing
// to read at all.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// unit-db is the FIRST project import (points KP_DB_PATH at a throwaway file):
// pullOneSource records its outcome on the source row, so this file now touches the DB.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { parsePullEvents, PULL_LIMITS } from "./pull-pass.ts";

after(() => cleanupUnitDb());

const src = readFileSync(fileURLToPath(new URL("./pull-pass.ts", import.meta.url)), "utf8");

test("the documented envelope parses: {events:[{id,payload}]}", () => {
  assert.deepEqual(
    parsePullEvents({ events: [{ id: "evt-1", payload: { email: "a@example.cz" } }], cursor: "c1" }),
    [{ id: "evt-1", payload: { email: "a@example.cz" } }]
  );
});

test("a source that just returns leads (no envelope) is accepted as itself", () => {
  // The common case for a small integration: an array of leads, no wrapper. Refusing
  // it would push every integrator into writing an adapter for no reason.
  assert.deepEqual(parsePullEvents({ events: [{ email: "a@example.cz", name: "A" }] }), [
    { id: null, payload: { email: "a@example.cz", name: "A" } },
  ]);
});

test("a missing or non-array `events` yields nothing rather than throwing", () => {
  // A source answering `{}` (nothing new) is the NORMAL steady state, not an error.
  assert.deepEqual(parsePullEvents({}), []);
  assert.deepEqual(parsePullEvents({ events: null }), []);
  assert.deepEqual(parsePullEvents({ events: "soon" }), []);
});

test("the source's id becomes the idempotency key, and only when it is usable", () => {
  const [withId] = parsePullEvents({ events: [{ id: "abc", payload: {} }] });
  assert.equal(withId.id, "abc", "a string id is the delivery's identity");
  const [numeric] = parsePullEvents({ events: [{ id: 7, payload: {} }] });
  assert.equal(numeric.id, null, "a non-string id is ignored — the core then hashes the body");
  const [empty] = parsePullEvents({ events: [{ id: "", payload: { email: "a@b.cz" } }] });
  assert.equal(empty.id, null, "an empty id must not collapse every event onto one key");
  const [long] = parsePullEvents({ events: [{ id: "x".repeat(500), payload: {} }] });
  assert.equal(long.id?.length, 200, "an unbounded id is clamped, not trusted");
});

test("an explicit null payload survives as null instead of becoming the envelope", () => {
  // `"payload" in row` rather than a truthiness check: a source that legitimately
  // sends {id, payload: null} must not have the WRAPPER filed as the lead.
  assert.deepEqual(parsePullEvents({ events: [{ id: "a", payload: null }] }), [{ id: "a", payload: null }]);
});

test("one pull is bounded — a source cannot hand us an unbounded page", () => {
  const events = Array.from({ length: PULL_LIMITS.maxEvents + 25 }, (_, i) => ({ id: `e${i}`, payload: {} }));
  assert.equal(parsePullEvents({ events }).length, PULL_LIMITS.maxEvents, "the page is clamped");
  // The remainder is not dropped: the cursor only advances over what was applied, so
  // the next tick asks again. That property is what makes clamping safe.
  assert.match(src, /nextCursor/, "guard the guard: the cursor is still source-owned");
  assert.ok(PULL_LIMITS.maxBytes > 0 && PULL_LIMITS.timeoutMs > 0, "a body cap and a timeout both exist");
});

test("a failed pull holds the cursor; only a clean pass advances it", () => {
  // The failure mode: advancing past a window we could not read loses every lead in
  // it, permanently and silently — the source is the only thing that can replay it.
  const cleanAdvance = src.indexOf("recordPullResult(source.token, { cursor: nextCursor, error: null })");
  assert.ok(cleanAdvance >= 0, "the ONLY advancing write");
  const advancingWrites = [...src.matchAll(/recordPullResult\([^)]*cursor:/g)];
  assert.equal(advancingWrites.length, 1, "exactly one place may move a source's cursor");
  for (const m of src.matchAll(/recordPullResult\(source\.token, \{ error: [^}]+\}\)/g)) {
    assert.ok(m[0].includes("error"), "every failure path records a reason and no cursor");
  }
});

// --- the SSRF boundary ----------------------------------------------------------
// A pull is an outbound server call, on an operator-stored URL, carrying that
// source's bearer secret. `setChannelPull` vets the URL at the WRITE, but the pull
// runs off a clock: the gap between the two is unbounded, so the name that was
// public when it was saved is not the address that answers now. These pin that the
// pull resolves the host at fetch time and refuses a private answer — the DNS
// rebinding pivot the string-level guard cannot see.

test("a stored URL whose host now RESOLVES private is refused before the fetch", async () => {
  const { pullOneSource } = await import("./pull-pass.ts");
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => {
    fetched += 1;
    throw new Error("the guard must refuse before any request leaves");
  }) as typeof fetch;
  try {
    const outcome = await pullOneSource(
      {
        token: "tok-unrouted",
        channel: "boards",
        jobId: "job-1",
        lang: null,
        workspaceId: "ws-1",
        // Public NAME, private ANSWER: exactly what a rebinding host looks like at
        // the moment of the fetch, and what the string-level check cannot detect.
        url: "https://rebind.example.com/leads",
        secret: "pull-secret",
        cursor: null,
      },
      "https://kp.example.com",
      async () => [{ address: "169.254.169.254" }]
    );
    assert.equal(fetched, 0, "no request may leave for a host that resolves to link-local space");
    assert.match(String(outcome.error), /non-public address/, "the outcome must say why, on the source's own row");
    assert.equal(outcome.applied, 0);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a host that resolves public still pulls (the guard is not a blanket refusal)", async () => {
  const { pullOneSource } = await import("./pull-pass.ts");
  const realFetch = globalThis.fetch;
  let asked: string | null = null;
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked = String(input);
    return new Response(JSON.stringify({ events: [], cursor: "c9" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  try {
    const outcome = await pullOneSource(
      {
        token: "tok-ok",
        channel: "boards",
        jobId: "job-1",
        lang: null,
        workspaceId: "ws-1",
        url: "https://leads.example.com/feed",
        secret: null,
        cursor: "c8",
      },
      "https://kp.example.com",
      async () => [{ address: "93.184.216.34" }]
    );
    assert.equal(outcome.error, null, "a public host must still be pulled");
    assert.match(String(asked), /^https:\/\/leads\.example\.com\/feed\?since=c8$/, "the cursor still rides the query");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the fetch-time guard is the RESOLVED one, not the string-level check", () => {
  // Guard the guard: a refactor that swaps `assertPublicHttpsEndpointResolved` back
  // for `assertPublicHttpsEndpoint` here reopens the rebinding pivot silently, and
  // both stubs above would keep passing (a stubbed lookup is simply never called).
  const text = src.replace(/\r\n/g, "\n");
  assert.match(text, /await assertPublicHttpsEndpointResolved\(source\.url, "pull_url", lookupFn\)/);
  assert.doesNotMatch(text, /\bassertPublicHttpsEndpoint\(/, "the string-only guard must not be the fetch-time gate");
});
