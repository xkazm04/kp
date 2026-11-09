// The read lifecycle (stale-while-revalidate): `loading` only for a URL that never
// answered, a cached URL draws at once, a refresh keeps the data on screen, a failed refresh
// keeps it too and says so — the rules that stop /one's views from blinking.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createReadStore, foldRead, FRESH_MS, markPending, needsFetch, parseOnce, requestKey, settle, type Raw } from "./readCache.ts";

const parse = (b: unknown) => (b && typeof b === "object" && Array.isArray((b as { rows?: unknown }).rows) ? (b as { rows: number[] }) : null);
const K0 = requestKey("/api/x", 0, 0);
const K1 = requestKey("/api/x", 1, 0);

test("loading is only 'never answered'; a cached URL draws at once while it refreshes", () => {
  assert.deepEqual(foldRead(undefined, K0, parse), { state: "loading" });
  assert.deepEqual(foldRead(markPending(undefined, K0, 0), K0, parse), { state: "loading" });
  const answered = settle(markPending(undefined, K0, 0), K0, { ok: true, body: { rows: [1] } }, 10);
  assert.deepEqual(foldRead(answered, K0, parse), { state: "ready", data: { rows: [1] }, refreshing: false });
  // An epoch bump (a new key) keeps the data on screen, refreshing.
  assert.deepEqual(foldRead(answered, K1, parse), { state: "ready", data: { rows: [1] }, refreshing: true });
  assert.deepEqual(foldRead(markPending(answered, K1, 20), K1, parse), { state: "ready", data: { rows: [1] }, refreshing: true });
});

test("a failed refresh keeps the data and says so; a failure with no data is an error", () => {
  const answered = settle(undefined, K0, { ok: true, body: { rows: [1] } }, 10);
  const failed = settle(markPending(answered, K1, 20), K1, { ok: false, body: { code: "STORE_UNAVAILABLE" } }, 30);
  assert.deepEqual(foldRead(failed, K1, parse), { state: "ready", data: { rows: [1] }, refreshing: false, refreshFailed: { payload: { code: "STORE_UNAVAILABLE" } } });
  // Another view's newer good answer makes the old failure history.
  const later = settle(failed, requestKey("/api/x", 1, 1), { ok: true, body: { rows: [2] } }, 40);
  assert.equal(foldRead(later, K1, parse).state, "ready");
  assert.equal((foldRead(later, K1, parse) as { refreshFailed?: unknown }).refreshFailed, undefined);
  const never = settle(undefined, K0, null, 5);
  assert.deepEqual(foldRead(never, K0, parse), { state: "error", payload: null });
  // A body the parser does not recognise is an error, never an empty list.
  assert.deepEqual(foldRead(settle(undefined, K0, { ok: true, body: { nope: 1 } }, 5), K0, parse), { state: "error", payload: null });
});

test("a freshly settled key is not asked again; a stale one and a new key are", () => {
  const e = settle(undefined, K0, { ok: true, body: { rows: [] } }, 1000);
  assert.equal(needsFetch(e, K0, 1000 + FRESH_MS - 1), false);
  assert.equal(needsFetch(e, K0, 1000 + FRESH_MS), true);
  assert.equal(needsFetch(e, K1, 1001), true);
  assert.equal(needsFetch(markPending(e, K1, 1001), K1, 99_999), false);
});

test("the same body parses to the SAME object (identity survives renders and views)", () => {
  const body = { rows: [3] };
  assert.equal(parseOnce(parse, body), parseOnce(parse, body));
});

test("the store shares one request per key and notifies every view on the URL", async () => {
  let calls = 0;
  let now = 0;
  const store = createReadStore(async (): Promise<Raw> => {
    calls += 1;
    return { ok: true, body: { rows: [calls] } };
  }, () => now);
  let notified = 0;
  store.subscribe("/api/x", () => (notified += 1));
  await Promise.all([store.request("/api/x", K0), store.request("/api/x", K0)]);
  assert.equal(calls, 1);
  assert.ok(notified >= 2, "pending + settled");
  await store.request("/api/x", K0); // fresh: answered from the cache
  assert.equal(calls, 1);
  now += FRESH_MS;
  await store.request("/api/x", K0);
  assert.equal(calls, 2);
  assert.deepEqual(foldRead(store.get("/api/x"), K0, parse), { state: "ready", data: { rows: [2] }, refreshing: false });
});
