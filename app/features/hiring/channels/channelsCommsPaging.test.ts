// The ledger's paging arithmetic, pinned before it existed. The Comms ledger read
// `/api/comms?limit=500` and looked at `messages` only: the route has answered
// `hasMore` / `nextCursor` / `truncated` since the feed got a cursor contract
// (app/api/comms/route.ts), and a recruiter looking at a busy workspace was never
// told that older rows existed — the table simply ended.
//
// The rules below are the ones a component cannot be trusted to re-derive:
// a failure is not an empty ledger, an expired cursor is a page from the TOP (not
// something to append), and "hasMore with no cursor" is how a client pages forever.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_COMMS_PAGE, mergeCommsPage, type CommsPageState } from "./channelsCommsPaging";
import type { Message } from "./channelsCommsHelpers";

const row = (id: string): Message =>
  ({ id, recipient: null, subject: null, body: null, kind: null, channel: null, status: "sent", ref: null, createdAt: "2026-01-01T00:00:00.000Z" }) as Message;

const ids = (s: CommsPageState | null) => (s?.messages ?? []).map((m) => m.id);

test("a body with no messages array is a FAILURE, never an empty ledger", () => {
  assert.equal(mergeCommsPage(EMPTY_COMMS_PAGE, { error: "Unauthorized" }, "replace"), null);
  assert.equal(mergeCommsPage(EMPTY_COMMS_PAGE, null, "replace"), null);
  assert.equal(mergeCommsPage(EMPTY_COMMS_PAGE, { messages: null }, "replace"), null);
  // …but a genuinely empty ledger survives as an empty list.
  assert.deepEqual(ids(mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [] }, "replace")), []);
});

test("replace seeds the rows, the refs and the next cursor", () => {
  const next = mergeCommsPage(
    EMPTY_COMMS_PAGE,
    { messages: [row("m3"), row("m2")], entries: { e1: { label: "Ada", jobTitle: "Dev" } }, hasMore: true, nextCursor: "m2", truncated: false },
    "replace"
  );
  assert.deepEqual(ids(next), ["m3", "m2"]);
  assert.deepEqual(next?.refs, { e1: { label: "Ada", jobTitle: "Dev" } });
  assert.equal(next?.cursor, "m2");
  assert.equal(next?.hasMore, true);
  assert.equal(next?.truncated, false);
});

test("append keeps the older page BELOW the newer one and drops repeats", () => {
  const first = mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [row("m3"), row("m2")], hasMore: true, nextCursor: "m2" }, "replace")!;
  // A row can repeat across two reads when the ledger shifted between them.
  const second = mergeCommsPage(first, { messages: [row("m2"), row("m1")], hasMore: false, nextCursor: null }, "append")!;
  assert.deepEqual(ids(second), ["m3", "m2", "m1"]);
  assert.equal(second.cursor, null);
  assert.equal(second.hasMore, false);
});

test("hasMore without a cursor is not more — a client with no cursor pages forever", () => {
  const s = mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [row("m1")], hasMore: true, nextCursor: null }, "replace")!;
  assert.equal(s.hasMore, false);
  assert.equal(s.cursor, null);
  const blank = mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [row("m1")], hasMore: true, nextCursor: "  " }, "replace")!;
  assert.equal(blank.hasMore, false);
});

test("an expired cursor answers a page from the TOP, so it replaces rather than appends", () => {
  const first = mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [row("m9"), row("m8")], hasMore: true, nextCursor: "m8" }, "replace")!;
  const reset = mergeCommsPage(first, { messages: [row("m9"), row("m8"), row("m7")], cursorExpired: true, hasMore: false }, "append")!;
  assert.deepEqual(ids(reset), ["m9", "m8", "m7"]);
});

test("a known truncation is never downgraded by a later page", () => {
  const first = mergeCommsPage(EMPTY_COMMS_PAGE, { messages: [row("m3")], hasMore: true, nextCursor: "m3", truncated: true }, "replace")!;
  const second = mergeCommsPage(first, { messages: [row("m2")], hasMore: false, truncated: false }, "append")!;
  assert.equal(second.truncated, true);
  // A replace (the live-refresh path) re-reads the same window, so it may clear it.
  const refreshed = mergeCommsPage(second, { messages: [row("m3")], truncated: false }, "replace")!;
  assert.equal(refreshed.truncated, false);
});
