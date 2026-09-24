import { test } from "node:test";
import assert from "node:assert/strict";
import { foldGigKpi, type GigKpiAttemptRow, type GigKpiInput, type GigKpiOutcomeRow } from "./kpi.ts";
import type { GigReview } from "./types.ts";

// A hand-counted fixture. Every expected number below is derived in the comments from
// the rows, not from running the fold.

const NOW = "2026-09-24T12:00:00.000Z";

function review(disclosure: boolean): GigReview {
  return { checklist: { disclosure, scope: true }, note: null, reviewMs: 1000, reviewedAt: "2026-09-20T00:00:00.000Z" };
}

function attempt(p: Partial<GigKpiAttemptRow> & Pick<GigKpiAttemptRow, "id" | "gigId" | "specialistId" | "status">): GigKpiAttemptRow {
  return { costUsd: null, review: null, sentAt: null, createdAt: "2026-09-10T00:00:00.000Z", ...p };
}

function outcome(p: Partial<GigKpiOutcomeRow> & Pick<GigKpiOutcomeRow, "id" | "gigId" | "verdict">): GigKpiOutcomeRow {
  return { attemptId: null, recordedAt: "2026-09-22T00:00:00.000Z", ...p };
}

const fixture: GigKpiInput = {
  now: NOW,
  gigs: [
    { id: "g1", arena: "security" },
    { id: "g2", arena: "security" },
    { id: "g3", arena: "freelance" },
    { id: "g4", arena: "competition" },
  ],
  specialists: [{ id: "s1" }, { id: "s2" }, { id: "s3" }],
  attempts: [
    // g1: a2 was discarded (cost 1.0), a1 sent (cost 2.0, disclosed).
    attempt({ id: "a1", gigId: "g1", specialistId: "s1", status: "sent", costUsd: 2, review: review(true), sentAt: "2026-09-15T00:00:00.000Z" }),
    attempt({ id: "a2", gigId: "g1", specialistId: "s1", status: "discarded", costUsd: 1 }),
    // g2: two sent attempts; a3 is the LATER one (so a null-attempt outcome lands on it).
    attempt({ id: "a3", gigId: "g2", specialistId: "s1", status: "sent", costUsd: null, review: review(false), sentAt: "2026-09-16T00:00:00.000Z" }),
    attempt({ id: "a4", gigId: "g2", specialistId: "s2", status: "sent", costUsd: 0.5, review: review(true), sentAt: "2026-09-14T00:00:00.000Z" }),
    // g3: a5 sent (no_response), a6 still running with no cost.
    attempt({ id: "a5", gigId: "g3", specialistId: "s2", status: "sent", costUsd: 3, review: review(true), sentAt: "2026-09-15T00:00:00.000Z" }),
    attempt({ id: "a6", gigId: "g3", specialistId: "s2", status: "running", costUsd: null }),
    // g4: a7 sent with NO review recorded.
    attempt({ id: "a7", gigId: "g4", specialistId: "s1", status: "sent", costUsd: 4, review: null, sentAt: "2026-09-15T00:00:00.000Z" }),
  ],
  outcomes: [
    // a1: rejected, then corrected to accepted - the LATEST wins.
    outcome({ id: "o1", gigId: "g1", attemptId: "a1", verdict: "rejected", recordedAt: "2026-09-18T00:00:00.000Z" }),
    outcome({ id: "o2", gigId: "g1", attemptId: "a1", verdict: "accepted", recordedAt: "2026-09-19T00:00:00.000Z" }),
    // g2 with no attempt -> the gig's latest sent attempt, a3.
    outcome({ id: "o3", gigId: "g2", attemptId: null, verdict: "rejected" }),
    outcome({ id: "o4", gigId: "g3", attemptId: "a5", verdict: "no_response" }),
    outcome({ id: "o5", gigId: "g4", attemptId: "a7", verdict: "accepted" }),
    // Ignored: an unknown gig, and an attempt that was never sent.
    outcome({ id: "o6", gigId: "gX", attemptId: null, verdict: "accepted" }),
    outcome({ id: "o7", gigId: "g3", attemptId: "a6", verdict: "accepted" }),
  ],
};

test("byArena matches the hand count", () => {
  const kpi = foldGigKpi(fixture);
  // security = a1 (accepted), a2 (discarded), a3 (rejected via o3), a4 (sent, pending).
  // resolved 2, accepted 1, pending 1, rate 1/2. cost 2 + 1 + 0.5 = 3.5 over 1 accepted;
  // a3 unreported.
  assert.deepEqual(kpi.byArena.security, {
    resolved: 2,
    accepted: 1,
    rate: 0.5,
    pending: 1,
    costPerAcceptedUsd: 3.5,
    costUnreported: 1,
    smallSample: true,
  });
  // freelance = a5 (no_response: resolved, not accepted), a6 (running, no cost).
  assert.deepEqual(kpi.byArena.freelance, {
    resolved: 1,
    accepted: 0,
    rate: 0,
    pending: 0,
    costPerAcceptedUsd: null,
    costUnreported: 1,
    smallSample: true,
  });
  // competition = a7 accepted at cost 4.
  assert.deepEqual(kpi.byArena.competition, {
    resolved: 1,
    accepted: 1,
    rate: 1,
    pending: 0,
    costPerAcceptedUsd: 4,
    costUnreported: 0,
    smallSample: true,
  });
  // oss_bounty: nothing - unmeasured, never 0%.
  assert.deepEqual(kpi.byArena.oss_bounty, {
    resolved: 0,
    accepted: 0,
    rate: null,
    pending: 0,
    costPerAcceptedUsd: null,
    costUnreported: 0,
    smallSample: true,
  });
});

test("bySpecialist matches the hand count, and an idle specialist still has a cell", () => {
  const kpi = foldGigKpi(fixture);
  // s1 = a1 (accepted), a2 (discarded, 1), a3 (rejected, no cost), a7 (accepted, 4).
  // resolved 3, accepted 2, rate 2/3, cost (2 + 1 + 4) / 2 = 3.5, unreported 1.
  assert.equal(kpi.bySpecialist.s1.resolved, 3);
  assert.equal(kpi.bySpecialist.s1.accepted, 2);
  assert.equal(kpi.bySpecialist.s1.rate, 2 / 3);
  assert.equal(kpi.bySpecialist.s1.pending, 0);
  assert.equal(kpi.bySpecialist.s1.costPerAcceptedUsd, 3.5);
  assert.equal(kpi.bySpecialist.s1.costUnreported, 1);
  // s2 = a4 (pending, 0.5), a5 (no_response, 3), a6 (running, no cost).
  assert.deepEqual(kpi.bySpecialist.s2, {
    resolved: 1,
    accepted: 0,
    rate: 0,
    pending: 1,
    costPerAcceptedUsd: null,
    costUnreported: 1,
    smallSample: true,
  });
  assert.deepEqual(kpi.bySpecialist.s3, {
    resolved: 0,
    accepted: 0,
    rate: null,
    pending: 0,
    costPerAcceptedUsd: null,
    costUnreported: 0,
    smallSample: true,
  });
});

test("disclosureRate is over SENT attempts only, and a missing review is not a tick", () => {
  // sent: a1 (T), a3 (F), a4 (T), a5 (T), a7 (no review) -> 3 / 5.
  assert.equal(foldGigKpi(fixture).disclosureRate, 0.6);
  assert.equal(foldGigKpi({ ...fixture, attempts: fixture.attempts.filter((a) => a.status !== "sent") }).disclosureRate, null);
});

test("computedAt is the input clock, and the fold is pure (same input, same output)", () => {
  const a = foldGigKpi(fixture);
  assert.equal(a.computedAt, NOW);
  assert.deepEqual(foldGigKpi(fixture), a);
});

test("accepted work with no reported cost has no cost-per-accepted, not a free one", () => {
  const kpi = foldGigKpi({
    now: NOW,
    gigs: [{ id: "g", arena: "oss_bounty" }],
    specialists: [],
    attempts: [attempt({ id: "a", gigId: "g", specialistId: "sx", status: "sent", costUsd: null, sentAt: NOW })],
    outcomes: [outcome({ id: "o", gigId: "g", attemptId: "a", verdict: "accepted" })],
  });
  assert.equal(kpi.byArena.oss_bounty.accepted, 1);
  assert.equal(kpi.byArena.oss_bounty.costPerAcceptedUsd, null);
  assert.equal(kpi.byArena.oss_bounty.costUnreported, 1);
  // A specialist missing from the roster still gets its numbers.
  assert.equal(kpi.bySpecialist.sx.accepted, 1);
});

test("a same-timestamp correction resolves to the later row; smallSample clears at the threshold", () => {
  const gigs = Array.from({ length: 10 }, (_, i) => ({ id: `g${i}`, arena: "security" as const }));
  const attempts = gigs.map((g, i) =>
    attempt({ id: `a${i}`, gigId: g.id, specialistId: "s", status: "sent", costUsd: 1, sentAt: NOW })
  );
  const outcomes = gigs.flatMap((g, i) => [
    outcome({ id: `r${i}`, gigId: g.id, attemptId: `a${i}`, verdict: "rejected", recordedAt: NOW }),
    outcome({ id: `c${i}`, gigId: g.id, attemptId: `a${i}`, verdict: "accepted", recordedAt: NOW }),
  ]);
  const cell = foldGigKpi({ now: NOW, gigs, specialists: [], attempts, outcomes }).byArena.security;
  assert.equal(cell.resolved, 10);
  assert.equal(cell.accepted, 10);
  assert.equal(cell.smallSample, false);
  assert.equal(cell.costPerAcceptedUsd, 1);
});

test("money won is kept per currency from the counted verdicts only, never totalled; an accepted verdict with no amount is counted apart", () => {
  const gigs = [
    { id: "g1", arena: "security" as const },
    { id: "g2", arena: "freelance" as const },
    { id: "g3", arena: "oss_bounty" as const },
    { id: "g4", arena: "oss_bounty" as const },
    { id: "g5", arena: "competition" as const },
  ];
  const attempts = gigs.map((g, i) => attempt({ id: `a${i + 1}`, gigId: g.id, specialistId: "s", status: "sent", sentAt: NOW }));
  const kpi = foldGigKpi({
    now: NOW,
    gigs,
    specialists: [],
    attempts,
    outcomes: [
      outcome({ id: "o1", gigId: "g1", attemptId: "a1", verdict: "accepted", amount: 500, currency: "USD" }),
      outcome({ id: "o2", gigId: "g2", attemptId: "a2", verdict: "accepted", amount: 300, currency: "USD" }),
      // g3: accepted with an amount, then CORRECTED to rejected - its money is gone.
      outcome({ id: "o3", gigId: "g3", attemptId: "a3", verdict: "accepted", amount: 100, currency: "USDC", recordedAt: "2026-09-20T00:00:00.000Z" }),
      outcome({ id: "o4", gigId: "g3", attemptId: "a3", verdict: "rejected", recordedAt: "2026-09-21T00:00:00.000Z" }),
      outcome({ id: "o5", gigId: "g4", attemptId: "a4", verdict: "accepted", amount: 40, currency: "USDC" }),
      // g5: accepted, no amount recorded.
      outcome({ id: "o6", gigId: "g5", attemptId: "a5", verdict: "accepted" }),
    ],
  });
  assert.deepEqual(kpi.moneyWon, [
    { currency: "USD", amount: 800, count: 2 },
    { currency: "USDC", amount: 40, count: 1 },
  ]);
  assert.equal(kpi.acceptedWithoutAmount, 1);
});

test("with nothing accepted there is no money and nothing without an amount", () => {
  const kpi = foldGigKpi({ now: NOW, gigs: [], specialists: [], attempts: [], outcomes: [] });
  assert.deepEqual(kpi.moneyWon, []);
  assert.equal(kpi.acceptedWithoutAmount, 0);
});
