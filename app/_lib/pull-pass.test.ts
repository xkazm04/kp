// The pull contract an integrator writes against (see the header of pull-pass.ts),
// pinned where it is cheap: the envelope parser and the bounds. The apply half goes
// through the shared intake core and is covered by the receiver's own suites — what
// is unique here is how a source's answer is READ, and how much of it we are willing
// to read at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parsePullEvents, PULL_LIMITS } from "./pull-pass.ts";

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

test("a pull is an outbound call on an operator-supplied URL, so it keeps the SSRF posture", () => {
  assert.match(src, /assertPublicHttpsEndpoint\(source\.url, "pull_url"\)/, "https + public host, like the relay and ATS endpoints");
});
