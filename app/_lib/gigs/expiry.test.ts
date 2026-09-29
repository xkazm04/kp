// The expiry sweep (gigs/expiry.ts) on an isolated DB with a fake clock: only a `new` or
// `qualified` gig whose deadline is before "now" moves to `expired`; an undated gig, an
// unparseable deadline, a future deadline and every other status stay where they are; the
// sweep is scoped to its workspace; a lost race (the gig moved between the read and the
// write) is skipped, not counted; and the walk pages through more than one store page.
//
// unit-db.ts must be the first project import (it sets KP_DB_PATH before any store opens).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createManualGig, getGig, transitionGig } from "../db/gigs.ts";
import { GIG_EXPIRY_PAGE, gigDeadlinePassed, sweepExpiredGigs, type GigExpiryDeps } from "./expiry.ts";
import type { Gig, GigStatus } from "./types.ts";

after(() => cleanupUnitDb());

const NOW = "2026-09-29T12:00:00.000Z";
const PAST = "2026-09-28T12:00:00.000Z";
const FUTURE = "2026-10-05T12:00:00.000Z";

let seq = 0;
function makeGig(ws: string, deadlineAt: string | null, status: GigStatus = "new"): string {
  seq += 1;
  const { gig } = createManualGig(ws, {
    arena: "freelance",
    url: `https://example.test/expiry/${seq}`,
    title: `Gig ${seq}`,
    bodyText: `Body ${seq}`,
    org: null,
    reward: null,
    deadlineAt,
    tags: [],
    suspectReasons: status === "suspect" ? ["agent_addressed"] : [],
  });
  const path: Record<string, GigStatus[]> = {
    new: [],
    suspect: [],
    qualified: ["qualified"],
    declined: ["declined"],
    dispatched: ["qualified", "dispatched"],
    withdrawn: ["withdrawn"],
  };
  let from: GigStatus = gig.status;
  for (const to of path[status] ?? []) {
    const moved = transitionGig(ws, gig.id, { from, to });
    assert.ok(moved.ok, `fixture move ${from} -> ${to}`);
    from = to;
  }
  return gig.id;
}

test("only new/qualified gigs past their deadline expire; undated, future, unparseable and every other status stay", () => {
  const ws = "ws-expiry-1";
  const ids = {
    newPast: makeGig(ws, PAST, "new"),
    qualifiedPast: makeGig(ws, PAST, "qualified"),
    newFuture: makeGig(ws, FUTURE, "new"),
    undated: makeGig(ws, null, "new"),
    garbage: makeGig(ws, "next friday", "qualified"),
    suspectPast: makeGig(ws, PAST, "suspect"),
    dispatchedPast: makeGig(ws, PAST, "dispatched"),
    declinedPast: makeGig(ws, PAST, "declined"),
  };
  const other = makeGig("ws-expiry-other", PAST, "new");

  assert.equal(sweepExpiredGigs(ws, NOW), 2);
  const status = (id: string, w = ws) => getGig(w, id)?.status;
  assert.equal(status(ids.newPast), "expired");
  assert.equal(status(ids.qualifiedPast), "expired");
  assert.equal(status(ids.newFuture), "new");
  assert.equal(status(ids.undated), "new", "an undated gig never expires");
  assert.equal(status(ids.garbage), "qualified", "an unparseable deadline is not a passed one");
  assert.equal(status(ids.suspectPast), "suspect", "a flagged gig waits on the operator");
  assert.equal(status(ids.dispatchedPast), "dispatched", "in-flight work is the send-time lint's");
  assert.equal(status(ids.declinedPast), "declined");
  assert.equal(status(other, "ws-expiry-other"), "new", "the sweep never reaches another workspace");

  // Idempotent; and the fake clock decides - a week later the future gig expires too.
  assert.equal(sweepExpiredGigs(ws, NOW), 0);
  assert.equal(sweepExpiredGigs(ws, new Date("2026-10-06T00:00:00.000Z")), 1);
  assert.equal(status(ids.newFuture), "expired");
  assert.equal(status(ids.undated), "new");
});

test("a deadline exactly at now has not passed; an invalid clock expires nothing", () => {
  const nowMs = Date.parse(NOW);
  assert.equal(gigDeadlinePassed({ deadlineAt: NOW }, nowMs), false);
  assert.equal(gigDeadlinePassed({ deadlineAt: PAST }, nowMs), true);
  assert.equal(gigDeadlinePassed({ deadlineAt: null }, nowMs), false);
  assert.equal(gigDeadlinePassed({ deadlineAt: "" }, nowMs), false);
  const ws = "ws-expiry-2";
  const id = makeGig(ws, PAST);
  assert.equal(sweepExpiredGigs(ws, "not a date"), 0);
  assert.equal(getGig(ws, id)?.status, "new");
});

/** The fields the sweep reads - a store fake answers nothing else. */
function fakeGig(id: string): Gig {
  const partial: Pick<Gig, "id" | "deadlineAt" | "status" | "updatedAt"> = { id, deadlineAt: PAST, status: "new", updatedAt: "2026-09-29T00:00:00.000Z" };
  return partial as Gig;
}

test("a lost race is skipped, not counted; the move re-asserts both expirable statuses", () => {
  const moves: { id: string; from: unknown }[] = [];
  const deps: GigExpiryDeps = {
    listGigs: () => [fakeGig("a"), fakeGig("b")],
    transitionGig: (_ws, id, move) => {
      moves.push({ id, from: move.from });
      return id === "a" ? { ok: false, reason: "stale" } : { ok: true, gig: fakeGig(id) };
    },
  };
  assert.equal(sweepExpiredGigs("ws-x", NOW, deps), 1);
  assert.deepEqual(moves.map((m) => m.from), [["new", "qualified"], ["new", "qualified"]]);
});

test("the walk pages until a short page, moving only after it has read every page", () => {
  const calls: (string | undefined)[] = [];
  let moved = 0;
  const page1 = Array.from({ length: GIG_EXPIRY_PAGE }, (_, i) => ({ ...fakeGig(`p1-${i}`), updatedAt: `2026-09-29T00:00:${String(i % 60).padStart(2, "0")}.000Z` }) as Gig);
  const page2 = [fakeGig("p2-0"), { ...fakeGig("p2-1"), deadlineAt: null } as Gig];
  const deps: GigExpiryDeps = {
    listGigs: (_ws, opts) => {
      assert.deepEqual(opts?.statuses, ["new", "qualified"]);
      assert.equal(opts?.limit, GIG_EXPIRY_PAGE);
      assert.equal(moved, 0, "no move before the walk is done (a move rewrites the cursor's column)");
      calls.push(opts?.before);
      return calls.length === 1 ? page1 : page2;
    },
    transitionGig: (_ws, id) => {
      moved += 1;
      return { ok: true, gig: fakeGig(id) };
    },
  };
  assert.equal(sweepExpiredGigs("ws-x", NOW, deps), GIG_EXPIRY_PAGE + 1);
  assert.deepEqual(calls, [undefined, page1[page1.length - 1].updatedAt]);
});
