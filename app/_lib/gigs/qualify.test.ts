// Gig qualification (qualify.ts): the pure arithmetic, then the store-backed
// qualifyAndMatch on an isolated throwaway DB. unit-db.ts must be the first project import.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { Gig, GigSpecialist, GigSpecialistSpec } from "./types.ts";
import {
  DEADLINE_COMFORT_DAYS,
  QUALIFY_THRESHOLD,
  QUALIFY_WEIGHTS,
  deadlineHeadroomDays,
  qualifies,
  qualifyAndMatch,
  qualifyGig,
  qualifyGigHook,
} from "./qualify.ts";
import { createManualGig, getGig, upsertGigFromRaw } from "../db/gigs.ts";
import { createGigSpecialist } from "../db/gigs-specialists.ts";
import { createHiredAgent, updateHiredAgentStatus } from "../db/agents.ts";

after(() => cleanupUnitDb());

const NOW = new Date("2026-09-24T12:00:00.000Z");
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000).toISOString();

function spec(arena: GigSpecialistSpec["arena"], niche = "web"): GigSpecialistSpec {
  return {
    arena,
    niche,
    taxonomyFamily: "software_engineering",
    recipes: [],
    exemplars: [],
    connectors: [],
    budgetUsdPerAttempt: 5,
    promptVersion: "gig-specialist.v1",
  };
}

function fakeSpecialist(arena: GigSpecialistSpec["arena"]): GigSpecialist {
  return { id: "gspec-1", hiredAgentId: "agent-1", name: "S", spec: spec(arena), registry: "unavailable", createdAt: "", updatedAt: "" };
}

type QGig = Pick<Gig, "arena" | "reward" | "deadlineAt" | "status" | "suspectReasons">;
function g(over: Partial<QGig> = {}): QGig {
  return { arena: "security", reward: { amount: 500, currency: "USD", text: "$500" }, deadlineAt: inDays(30), status: "new", suspectReasons: [], ...over };
}

test("the weights are the documented arithmetic and a perfect gig scores 100", () => {
  const q = qualifyGig(g(), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.score, QUALIFY_WEIGHTS.arenaFit + QUALIFY_WEIGHTS.rewardKnown + QUALIFY_WEIGHTS.deadlineFull + QUALIFY_WEIGHTS.specialistAvailable);
  assert.equal(q.score, 100);
  assert.deepEqual(q.factors, { arenaFit: true, rewardKnown: true, deadlineHeadroomDays: 30, specialistAvailable: true, suspect: false });
  assert.equal(q.source, "deterministic");
  assert.equal(q.note, null);
  assert.equal(q.fallbackReason, null);
  assert.ok(qualifies(q));
});

test("no deadline is neutral, not a penalty and not full marks", () => {
  const q = qualifyGig(g({ deadlineAt: null }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.deadlineHeadroomDays, null);
  assert.equal(q.score, 100 - QUALIFY_WEIGHTS.deadlineFull + QUALIFY_WEIGHTS.deadlineNeutral);
});

test("under two days of headroom is a heavy penalty that drops a good gig below the bar", () => {
  const q = qualifyGig(g({ deadlineAt: inDays(1) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.deadlineHeadroomDays, 1);
  assert.equal(q.score, 40 + 20 + 20 + QUALIFY_WEIGHTS.deadlineRushPenalty);
  assert.ok(q.score < QUALIFY_THRESHOLD);
  assert.equal(qualifies(q), false);
});

test("headroom between 2 and 7 days scales between neutral and full", () => {
  const mid = qualifyGig(g({ deadlineAt: inDays(4.5) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(mid.score, 80 + 15);
  const edge = qualifyGig(g({ deadlineAt: inDays(DEADLINE_COMFORT_DAYS) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(edge.score, 100);
});

test("a deadline already passed scores 0", () => {
  const q = qualifyGig(g({ deadlineAt: inDays(-1) }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.score, 0);
  assert.equal(qualifies(q), false);
});

test("suspect (status or recorded reasons) scores 0 and never qualifies", () => {
  for (const over of [{ status: "suspect" as const }, { suspectReasons: ["credential_request" as const] }]) {
    const q = qualifyGig(g(over), { specialist: fakeSpecialist("security"), now: NOW });
    assert.equal(q.score, 0);
    assert.equal(q.factors.suspect, true);
    assert.equal(qualifies(q), false);
  }
  // Even a forged verdict with a high score does not qualify while suspect.
  assert.equal(qualifies({ ...qualifyGig(g(), { specialist: null, now: NOW }), score: 99, factors: { ...qualifyGig(g(), { specialist: null, now: NOW }).factors, suspect: true } }), false);
});

test("no specialist caps the score below the bar; a specialist from another arena is not a fit", () => {
  const none = qualifyGig(g(), { specialist: null, now: NOW });
  assert.equal(none.score, QUALIFY_WEIGHTS.rewardKnown + QUALIFY_WEIGHTS.deadlineFull);
  assert.equal(qualifies(none), false);
  const wrong = qualifyGig(g(), { specialist: fakeSpecialist("freelance"), now: NOW });
  assert.equal(wrong.factors.arenaFit, false);
  assert.equal(wrong.factors.specialistAvailable, true);
});

test("a reward without a parseable amount is not a known reward", () => {
  const q = qualifyGig(g({ reward: { amount: null, currency: null, text: "competitive" } }), { specialist: fakeSpecialist("security"), now: NOW });
  assert.equal(q.factors.rewardKnown, false);
  assert.equal(qualifyGig(g({ reward: null }), { specialist: fakeSpecialist("security"), now: NOW }).factors.rewardKnown, false);
});

test("deadlineHeadroomDays: null for absent or unparseable, one decimal otherwise", () => {
  assert.equal(deadlineHeadroomDays(null, NOW), null);
  assert.equal(deadlineHeadroomDays("not a date", NOW), null);
  assert.equal(deadlineHeadroomDays(inDays(2.345), NOW), 2.3);
});

// ---------------------------------------------------------------------------
// Store-backed
// ---------------------------------------------------------------------------

const WS = "ws-gig-qualify";
let seq = 0;

function newGig(arena: Gig["arena"] = "security", over: { deadlineAt?: string | null; suspect?: boolean } = {}): Gig {
  seq += 1;
  return upsertGigFromRaw(WS, {
    sourceId: "gsrc-q",
    arena,
    raw: {
      externalKey: `q-${seq}`,
      url: `https://example.test/q/${seq}`,
      title: `Qualify ${seq}`,
      org: null,
      reward: { amount: 300, currency: "USD", text: "$300" },
      deadlineAt: over.deadlineAt === undefined ? inDays(20) : over.deadlineAt,
      postedAt: null,
      bodyText: "Find the bug.",
      bodyHtml: null,
      tags: [],
    },
    suspectReasons: over.suspect ? ["hidden_instructions"] : [],
  }).gig;
}

function hireSpecialist(arena: Gig["arena"], status: "pending_approval" | "active" | "failed" = "active"): GigSpecialist {
  const agent = createHiredAgent({ jobTitle: "Gig specialist - test", spec: {} }, WS);
  updateHiredAgentStatus(agent.id, status, { personaId: status === "active" ? `p-${agent.id}` : null }, WS);
  return createGigSpecialist(WS, { hiredAgentId: agent.id, name: "Spec", spec: spec(arena), registry: "unavailable" });
}

test("qualifyAndMatch: no specialist -> verdict recorded, gig stays new", () => {
  const gig = newGig("competition");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.moved, false);
  assert.equal(r.specialistId, null);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "new");
  assert.equal(stored.qualification?.factors.specialistAvailable, false);
});

test("qualifyAndMatch: a live specialist in the arena -> matched and moved new -> qualified", () => {
  const specialist = hireSpecialist("security");
  const gig = newGig("security");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.moved, true);
  assert.equal(r.specialistId, specialist.id);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "qualified");
  assert.equal(stored.specialistId, specialist.id);
  assert.equal(stored.qualification?.score, 100);
});

test("qualifyAndMatch: a specialist whose hire failed is not a match", () => {
  hireSpecialist("oss_bounty", "failed");
  const gig = newGig("oss_bounty");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved && r.specialistId === null);
});

test("qualifyAndMatch: a rushed deadline stays new with its low verdict", () => {
  const gig = newGig("security", { deadlineAt: inDays(1) });
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved);
  assert.equal(getGig(WS, gig.id)!.status, "new");
});

test("qualifyAndMatch: a suspect gig gets a zero verdict and no move", () => {
  const gig = newGig("security", { suspect: true });
  assert.equal(gig.status, "suspect");
  const r = qualifyAndMatch(WS, gig.id, { now: NOW });
  assert.ok(r.ok && !r.moved);
  const stored = getGig(WS, gig.id)!;
  assert.equal(stored.status, "suspect");
  assert.equal(stored.qualification?.score, 0);
});

test("qualifyAndMatch: not_found across workspaces, not_qualifiable past new", () => {
  const gig = newGig("security");
  assert.deepEqual(qualifyAndMatch("ws-other", gig.id), { ok: false, reason: "not_found" });
  assert.ok(qualifyAndMatch(WS, gig.id, { now: NOW }).ok);
  assert.equal(getGig(WS, gig.id)!.status, "qualified");
  assert.deepEqual(qualifyAndMatch(WS, gig.id), { ok: false, reason: "not_qualifiable" });
});

test("the hook shape the scan calls works on a manual gig too", () => {
  const { gig } = createManualGig(WS, {
    arena: "freelance",
    url: "https://example.test/brief",
    title: "Brief",
    org: null,
    reward: null,
    deadlineAt: null,
    bodyText: "Write me a landing page.",
    tags: [],
    suspectReasons: [],
  });
  const r = qualifyGigHook(WS, gig.id);
  assert.ok(r.ok);
  // The scan hands the row itself (scan.ts GigQualifyHook); the id is what is used.
  const row = newGig("competition");
  const stale: Gig = { ...row, status: "qualified" };
  const viaRow = qualifyGigHook(WS, stale);
  assert.ok(viaRow.ok, "the status is re-read from the store, not taken from the row handed in");
});
