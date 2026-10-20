import test from "node:test";
import assert from "node:assert/strict";
import { handoffExits, parseSetupSeat, seatAllows } from "./setupSeat";
import type { Capability } from "@/app/_lib/auth/roles";

// The wizard's seat: WHO is answering, as the capability set the finish doors gate
// on. The '/' gate fires per user and a redeemed invite lands on '/', so the
// wizard's second audience is the owner's teammates — and every rule below exists
// so that an unknown seat reproduces today's (owner) run, never a smaller one.

const RECRUITER: Capability[] = ["pipeline:write", "read"];
const VIEWER: Capability[] = ["read"];

test("parseSetupSeat keeps only real capabilities off the wire", () => {
  assert.deepEqual(parseSetupSeat({ seat: { capabilities: ["org:manage", "bogus", 7] } }), ["org:manage"]);
});

test("parseSetupSeat answers null — the fail-open seat — for anything without a seat", () => {
  assert.equal(parseSetupSeat({}), null);
  assert.equal(parseSetupSeat(null), null);
  assert.equal(parseSetupSeat({ seat: null }), null);
  assert.equal(parseSetupSeat({ seat: { capabilities: "org:manage" } }), null);
});

test("an empty capability list is a REAL seat (a caller who may do nothing), not an unknown one", () => {
  assert.deepEqual(parseSetupSeat({ seat: { capabilities: [] } }), []);
  assert.equal(seatAllows([], "read"), false);
});

test("seatAllows: an unknown seat allows everything; a known one allows what it holds", () => {
  assert.equal(seatAllows(null, "org:manage"), true);
  assert.equal(seatAllows(RECRUITER, "pipeline:write"), true);
  assert.equal(seatAllows(RECRUITER, "org:manage"), false);
});

test("handoffExits: the tour tile follows TOUR_CAPABILITY, like the shell's palette", () => {
  assert.deepEqual(handoffExits(VIEWER), ["solo"]);
  assert.deepEqual(handoffExits(RECRUITER), ["tour", "solo"]);
  assert.deepEqual(handoffExits(null), ["tour", "solo"], "an unknown seat is today's hand-off");
});
