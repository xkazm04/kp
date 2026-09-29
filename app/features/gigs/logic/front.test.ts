// Pure logic for the Gigs front page (front.ts): the urgency order every "what first?"
// reads, the header's wait counts, and walking a list from a proof with ← / →.
// Runner: node --test (npm run test:unit).
import { test } from "node:test";
import assert from "node:assert/strict";
import { gig, inDays, NOW } from "./fixtures.ts";
import { afterLeavingList, firstClosing, frontColumns, listNeighbours, nextInQueue, urgencyQueue, waitCounts } from "./front.ts";

test("urgencyQueue: nearest OPEN deadline first; closed and undated after every dated one; ties go to the move closest to done", () => {
  const gigs = [
    gig("undated-ready", "in_review"),
    gig("closed-proof", "drafted", { deadlineAt: inDays(-1) }),
    gig("d5-quar", "suspect", { deadlineAt: inDays(5) }),
    gig("d2-proof", "drafted", { deadlineAt: inDays(2) }),
    gig("d2-ready", "in_review", { deadlineAt: inDays(2) }),
    gig("with-agent", "dispatched", { deadlineAt: inDays(1) }),
    gig("qualified", "qualified", { deadlineAt: inDays(1) }),
  ];
  const q = urgencyQueue(gigs, {}, NOW).map((g) => g.id);
  assert.deepEqual(q.slice(0, 3), ["d2-ready", "d2-proof", "d5-quar"]);
  assert.deepEqual(new Set(q.slice(3)), new Set(["undated-ready", "closed-proof"]), "no deadline and a closed one both sort after the dated work");
  assert.ok(!q.includes("with-agent") && !q.includes("qualified"), "agent work and dispatch-when-you-choose never wait on you");
});

test("frontColumns + waitCounts: the three judgements and the verdicts to record, nothing else", () => {
  const gigs = [gig("a", "in_review"), gig("b", "drafted"), gig("c", "drafted"), gig("d", "suspect"), gig("e", "sent"), gig("f", "new"), gig("g", "dispatched")];
  const cols = frontColumns(gigs, {}, NOW);
  assert.deepEqual(waitCounts(cols), { clear: 1, review: 2, send: 1, record: 1, total: 5 });
});

test("nextInQueue walks the urgency order after the last opened, wrapping; null when nothing waits", () => {
  const q = [gig("a", "in_review"), gig("b", "drafted"), gig("c", "suspect")];
  assert.equal(nextInQueue(q, null)?.id, "a");
  assert.equal(nextInQueue(q, "a")?.id, "b");
  assert.equal(nextInQueue(q, "c")?.id, "a");
  assert.equal(nextInQueue(q, "gone")?.id, "a");
  assert.equal(nextInQueue([], null), null);
});

test("firstClosing names the nearest open deadline in the queue, never a closed one", () => {
  const q = urgencyQueue([gig("closed", "drafted", { deadlineAt: inDays(-2) }), gig("soon", "drafted", { deadlineAt: inDays(2.5) })], {}, NOW);
  assert.deepEqual(firstClosing(q, NOW)?.gig.id, "soon");
  assert.equal(firstClosing(q, NOW)?.days, 2);
  assert.equal(firstClosing([gig("x", "drafted")], NOW), null);
});

test("listNeighbours: no wrap, 1-based index, null when the gig left the list; afterLeavingList lands next, else previous", () => {
  const ids = ["a", "b", "c"];
  assert.deepEqual(listNeighbours(ids, "a"), { prev: null, next: "b", index: 1, total: 3 });
  assert.deepEqual(listNeighbours(ids, "c"), { prev: "b", next: null, index: 3, total: 3 });
  assert.equal(listNeighbours(ids, "z"), null);
  assert.equal(afterLeavingList(listNeighbours(ids, "b")), "c");
  assert.equal(afterLeavingList(listNeighbours(ids, "c")), "b");
  assert.equal(afterLeavingList(listNeighbours(["a"], "a")), null);
});
