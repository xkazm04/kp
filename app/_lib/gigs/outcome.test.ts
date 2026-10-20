// Recording a verdict (outcome.ts) on an isolated throwaway DB. unit-db.ts first.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { getGig, transitionGig } from "../db/gigs.ts";
import { createGigSource, getGigSource } from "../db/gigs-sources.ts";
import { listGigOutcomes, listPendingGigLessons } from "../db/gigs-outcomes.ts";
import { GIG_INVALID_STREAK_LIMIT } from "./types.ts";
import { gigRecipeSlugs } from "./recipes.ts";
import { hasPollerOutcome, latestSentAttempt, OUTCOME_GIG_STATUS, recordGigOutcome } from "./outcome.ts";
import { fixtureDraftedGig, fixtureGig, fixtureSentGig, fixtureSpecialist } from "./__fixtures__/sent-gig.ts";

after(() => cleanupUnitDb());

const WS = "ws-gig-outcome";

test("the verdict -> gig status table: duplicate is a rejection, no_response is expiry", () => {
  assert.deepEqual(OUTCOME_GIG_STATUS, { accepted: "accepted", rejected: "rejected", duplicate: "rejected", no_response: "expired" });
});

test("accepted: appended against the latest sent attempt, the gig moves, lessons queue per recipe", () => {
  const spec = fixtureSpecialist(WS, "oss_bounty");
  const { gig, attempt } = fixtureSentGig(WS, spec, { ticks: { disclosure: true, tests_pass: true } });
  const res = recordGigOutcome(WS, {
    gigId: gig.id,
    attemptId: null,
    verdict: "accepted",
    amount: 300,
    currency: "USD",
    feedbackText: "Acme Robotics merged it - see https://github.com/acme/widgets/pull/42. Clean, well-tested change.",
    source: "manual",
  });
  assert.ok(res.ok);
  if (!res.ok) return;
  assert.equal(res.outcome.attemptId, attempt.id, "attemptId defaults to the latest sent attempt");
  assert.equal(res.outcome.amount, 300);
  assert.equal(res.gig.status, "accepted");
  assert.equal(res.statusMoved, true);
  assert.equal(res.correction, false);
  assert.deepEqual(
    res.lessons.map((l) => l.recipe.slug),
    gigRecipeSlugs("oss_bounty")
  );
  for (const l of res.lessons) {
    assert.equal(l.outcomeId, res.outcome.id);
    assert.equal(l.verdict, "accepted");
    assert.equal(l.landedAt, null);
    for (const b of l.bullets) assert.ok(!/acme|github\.com/i.test(b), `no client name or URL in a lesson: ${b}`);
  }
  assert.match(res.lessons[0].bullets[0], /^accepted: open-source bounty work whose evidence included test and whose checklist had 2\/6 items ticked$/);
  assert.equal(listPendingGigLessons(WS).filter((l) => l.outcomeId === res.outcome.id).length, gigRecipeSlugs("oss_bounty").length);
});

test("duplicate -> rejected, no_response -> expired", () => {
  const spec = fixtureSpecialist(WS, "security");
  const a = fixtureSentGig(WS, spec);
  const r1 = recordGigOutcome(WS, { gigId: a.gig.id, attemptId: a.attempt.id, verdict: "duplicate", amount: null, currency: null, feedbackText: null, source: "manual" });
  assert.ok(r1.ok && r1.gig.status === "rejected");
  const b = fixtureSentGig(WS, spec);
  const r2 = recordGigOutcome(WS, { gigId: b.gig.id, attemptId: null, verdict: "no_response", amount: null, currency: null, feedbackText: null, source: "manual" });
  assert.ok(r2.ok && r2.gig.status === "expired");
});

test("refusals: unknown gig, a gig never sent, an unknown attempt, an attempt that is not sent", () => {
  const spec = fixtureSpecialist(WS, "freelance");
  const base = { attemptId: null, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "manual" } as const;
  assert.deepEqual(recordGigOutcome(WS, { ...base, gigId: "gig-nope" }), { ok: false, code: "GIG_NOT_FOUND" });
  const drafted = fixtureDraftedGig(WS, spec);
  assert.deepEqual(recordGigOutcome(WS, { ...base, gigId: drafted.gig.id }), { ok: false, code: "GIG_OUTCOME_NOT_SENT" });
  const sent = fixtureSentGig(WS, spec);
  assert.deepEqual(recordGigOutcome(WS, { ...base, gigId: sent.gig.id, attemptId: "gatt-nope" }), { ok: false, code: "GIG_ATTEMPT_NOT_FOUND" });
  // Another tenant cannot record against this gig.
  assert.deepEqual(recordGigOutcome("ws-other", { ...base, gigId: sent.gig.id }), { ok: false, code: "GIG_NOT_FOUND" });
  assert.equal(listGigOutcomes(WS, { gigId: drafted.gig.id }).length, 0, "a refusal appends nothing");
});

test("a correction on a resolved gig is appended, moves nothing, and leaves the source streak alone", () => {
  const spec = fixtureSpecialist(WS, "oss_bounty");
  const src = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "api.github.com", config: {} });
  const { gig } = fixtureSentGig(WS, spec, { sourceId: src.id });
  const first = recordGigOutcome(WS, { gigId: gig.id, attemptId: null, verdict: "rejected", amount: null, currency: null, feedbackText: null, source: "manual" });
  assert.ok(first.ok);
  assert.equal(getGigSource(WS, src.id)!.invalidStreak, 1);
  const fix = recordGigOutcome(WS, { gigId: gig.id, attemptId: null, verdict: "accepted", amount: 50, currency: "USD", feedbackText: null, source: "manual" });
  assert.ok(fix.ok);
  if (!fix.ok) return;
  assert.equal(fix.correction, true);
  assert.equal(fix.statusMoved, false);
  assert.equal(getGig(WS, gig.id)!.status, "rejected", "a terminal status never moves");
  assert.equal(getGigSource(WS, src.id)!.invalidStreak, 1, "one piece of work judged twice is one judgment of the source");
  assert.equal(listGigOutcomes(WS, { gigId: gig.id }).length, 2, "append-only: the correction is a newer row");
});

test("the invalid streak pauses the source on the verdict that trips it, and says so once", () => {
  const spec = fixtureSpecialist(WS, "security");
  const src = createGigSource(WS, { adapter: "github_bounty", arena: "oss_bounty", host: "api.github.com", config: {} });
  const paused: boolean[] = [];
  for (let i = 0; i < GIG_INVALID_STREAK_LIMIT + 1; i++) {
    const { gig } = fixtureSentGig(WS, spec, { sourceId: src.id });
    const r = recordGigOutcome(WS, { gigId: gig.id, attemptId: null, verdict: i % 2 ? "duplicate" : "rejected", amount: null, currency: null, feedbackText: null, source: "manual" });
    assert.ok(r.ok);
    if (r.ok) paused.push(r.sourcePaused);
  }
  assert.deepEqual(paused, [false, false, false, false, true, false]);
  assert.equal(getGigSource(WS, src.id)!.pausedReason, "invalid_streak");
});

test("a sent gig with no attempt and no specialist still records its verdict, with no lesson to queue", () => {
  const gig = fixtureGig(WS, { arena: "competition" });
  for (const [from, to] of [
    ["new", "qualified"],
    ["qualified", "dispatched"],
    ["dispatched", "drafted"],
    ["drafted", "in_review"],
    ["in_review", "sent"],
  ] as const) {
    assert.ok(transitionGig(WS, gig.id, { from, to }).ok, `${from} -> ${to}`);
  }
  const r = recordGigOutcome(WS, { gigId: gig.id, attemptId: null, verdict: "accepted", amount: null, currency: null, feedbackText: null, source: "manual" });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.outcome.attemptId, null);
  assert.deepEqual(r.lessons, []);
  assert.equal(r.gig.status, "accepted");
});

test("latestSentAttempt and hasPollerOutcome", () => {
  const mk = (id: string, status: "sent" | "drafted", sentAt: string | null, createdAt: string) =>
    ({ id, status, sentAt, createdAt }) as Parameters<typeof latestSentAttempt>[0][number];
  assert.equal(latestSentAttempt([mk("a", "sent", "2026-09-01", "2026-08-01"), mk("b", "sent", "2026-09-02", "2026-08-01"), mk("c", "drafted", null, "2026-09-03")])!.id, "b");
  assert.equal(latestSentAttempt([mk("c", "drafted", null, "2026-09-03")]), null);
  const o = (attemptId: string, source: "manual" | "poller:github") =>
    ({ id: "o", gigId: "g", attemptId, verdict: "accepted", amount: null, currency: null, feedbackText: null, source, recordedAt: "x" }) as const;
  assert.equal(hasPollerOutcome([o("a", "manual")], "a"), false, "a manual verdict does not stop a poller");
  assert.equal(hasPollerOutcome([o("a", "poller:github")], "a"), true);
  assert.equal(hasPollerOutcome([o("b", "poller:github")], "a"), false);
});
