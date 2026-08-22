// Behavioral coverage for the offer lifecycle — offers-store.ts +
// offer-finalize.ts + offer-reminders.ts — against an ISOLATED throwaway DB
// (testing/unit-db.ts must stay the first project import). Pins the terminal
// finalization paths (accept → Hired; decline → terminal status),
// the stale-link guards around them, deadline expiry, and the at-most-once
// reminder claim.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, hasEvent } from "./db/pipeline.ts";
import {
  createOffer,
  dueOfferReminders,
  getOfferByToken,
  getOrCreateOpenOffer,
  lapseExpiredOffers,
  markOfferReminded,
} from "./offers-store.ts";
import { offerView, respondToOffer } from "./offer-finalize.ts";
import { sendDueOfferReminders } from "./offer-reminders.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { billingOverview } from "./billing/entitlements.ts";

after(() => cleanupUnitDb());

let seq = 0;
function entryAtOffer() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `offer-c${seq}`,
    candidateLabel: `Offer Candidate ${seq}`,
    jobId: `offer-job-${seq}`,
    jobTitle: "Offer Test Role",
    stage: "Offer",
    contact: `offer-c${seq}@example.com`,
  });
  return entry;
}

function mintOffer(entryId: string, ttlDays?: number) {
  return createOffer({
    entryId,
    candidateLabel: "Offer Candidate",
    jobId: null,
    jobTitle: "Offer Test Role",
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: ttlDays ?? null,
  });
}

/** Force an offer's deadline into the past directly (own WAL connection on the
 *  same isolated file), simulating time passing without a clock hook. */
function forceExpiry(token: string): void {
  const d = new Database(UNIT_DB_PATH);
  try {
    d.pragma("busy_timeout = 5000");
    d.prepare(`UPDATE offers SET expires_at = ? WHERE token = ?`).run(new Date(Date.now() - 60_000).toISOString(), token);
  } finally {
    d.close();
  }
}

test("accept claims once: offer accepted, entry → Hired; a retry is a no-op echo", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);

  const first = await respondToOffer(offer.token, "accept");
  assert.deepEqual(
    { ok: first.ok, status: first.ok ? first.status : null, already: first.ok ? first.alreadyResponded : null },
    { ok: true, status: "accepted", already: false }
  );
  assert.equal(getOfferByToken(offer.token)!.status, "accepted");
  const hired = getPipelineEntry(entry.id)!;
  assert.equal(hired.stage, "Hired");
  assert.equal(hired.status, "active", "Hired keeps status active by contract");
  assert.ok(hasEvent(entry.id, "offer_accepted"));

  // Idempotent second response (refresh / double-click): reports, mutates nothing.
  const retry = await respondToOffer(offer.token, "accept");
  assert.ok(retry.ok && retry.alreadyResponded);
  assert.equal(retry.ok ? retry.status : null, "accepted");
});

test("decline is terminal for the entry and audited", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);

  const result = await respondToOffer(offer.token, "decline");
  assert.ok(result.ok && result.status === "declined" && !result.alreadyResponded);
  assert.equal(getOfferByToken(offer.token)!.status, "declined");
  const closed = getPipelineEntry(entry.id)!;
  assert.equal(closed.status, "declined", "candidate declines get their own terminal status, not 'rejected'");
  assert.ok(hasEvent(entry.id, "offer_declined"));
});

test("a stale decline on a duplicate link cannot demote a candidate who has since been Hired", async () => {
  const entry = entryAtOffer();
  const firstOffer = mintOffer(entry.id);
  await respondToOffer(firstOffer.token, "accept"); // → Hired

  // A second link can exist (re-extend after the first closed); declining it must
  // not overwrite the hire.
  const staleLink = mintOffer(entry.id);
  const result = await respondToOffer(staleLink.token, "decline");
  assert.ok(result.ok, "the offer row itself records the decline");
  const still = getPipelineEntry(entry.id)!;
  assert.equal(still.stage, "Hired");
  assert.equal(still.status, "active", "markEntryStatus must refuse to demote a Hired entry");
  assert.equal(hasEvent(entry.id, "offer_declined"), false, "no phantom decline on the hire's timeline");
});

test("a lapsed deadline makes the link dead: respond reports expired, the row flips, the lapse is audited", async () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  forceExpiry(offer.token);

  const result = await respondToOffer(offer.token, "accept");
  // The refusal carries a CODE the candidate page localizes, not an English
  // sentence; `expired` is what the route reads to answer 410 rather than 404.
  assert.deepEqual(result, { ok: false, code: "OFFER_EXPIRED", expired: true });
  assert.equal(getOfferByToken(offer.token)!.status, "expired");
  assert.ok(hasEvent(entry.id, "offer_expired"));
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "an expired link must not move the entry");
  assert.equal(offerView(offer.token)!.status, "expired", "the candidate page sees the lapse immediately");

  // Unknown token stays a plain not-found.
  const missing = await respondToOffer("tk-does-not-exist", "accept");
  assert.deepEqual(missing, { ok: false, code: "OFFER_NOT_FOUND" });
});

test("lapseExpiredOffers sweeps every due open offer exactly once", () => {
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id);
  forceExpiry(offer.token);
  assert.equal(lapseExpiredOffers(), 1);
  assert.equal(getOfferByToken(offer.token)!.status, "expired");
  assert.equal(lapseExpiredOffers(), 0, "a second sweep finds nothing to lapse");
});

test("reminder eligibility: only open offers inside the T-48h window, and the CAS claim fires at most once", () => {
  const soonEntry = entryAtOffer();
  const soon = mintOffer(soonEntry.id, 1); // expires in 24h → inside the 48h lead
  const farEntry = entryAtOffer();
  const far = mintOffer(farEntry.id, 30); // expires in 30d → not yet due

  const dueTokens = new Set(dueOfferReminders().map((o) => o.token));
  assert.ok(dueTokens.has(soon.token), "an offer inside the lead window is due");
  assert.ok(!dueTokens.has(far.token), "an offer far from its deadline is not due");

  // CAS: exactly one claimer wins; a claimed offer leaves the due set.
  assert.equal(markOfferReminded(soon.token), true);
  assert.equal(markOfferReminded(soon.token), false);
  assert.ok(!new Set(dueOfferReminders().map((o) => o.token)).has(soon.token));
});

test("sendDueOfferReminders dispatches each due offer once across sweeps", async () => {
  const entry = entryAtOffer();
  mintOffer(entry.id, 1); // due immediately (24h < 48h lead)
  const sent = await sendDueOfferReminders();
  assert.equal(sent, 1);
  assert.equal(await sendDueOfferReminders(), 0, "the claim persists — no duplicate nudge on the next tick");
});

test("offerView ships a SERVER-computed hoursRemaining so the countdown can't drift on a skewed client clock", () => {
  // bug-ui-scan-2026-07-09 (offers-onboarding #5): the candidate page must render the
  // hours-left from the server's clock, not Date.now() on an untrusted device.
  const entry = entryAtOffer();
  const offer = mintOffer(entry.id, 1); // 1-day TTL → ~24h out
  const view = offerView(offer.token)!;
  assert.equal(typeof view.hoursRemaining, "number", "the view must carry a server-side hours-left figure");
  assert.ok(view.hoursRemaining! >= 23 && view.hoursRemaining! <= 24, `expected ~24h, got ${view.hoursRemaining}`);
});

test("getOrCreateOpenOffer reuses the one open offer per entry instead of minting a second live link", () => {
  const entry = entryAtOffer();
  const input = {
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 90_000,
    payload: {},
  };
  const first = getOrCreateOpenOffer(input);
  const second = getOrCreateOpenOffer(input);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.offer.token, first.offer.token, "a re-extend re-sends the SAME link");
});

test("a re-extend that only widens the deadline is honored — the ttlDays lever is not discarded", () => {
  // The guard used to be salary/currency-only, so re-approving unchanged terms with the
  // window widened 7 -> 14 days left the offer lapsing on the ORIGINAL deadline while
  // the recruiter believed they had given the candidate another week.
  const entry = entryAtOffer();
  const base = {
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 95_000,
    payload: {},
  };
  const first = getOrCreateOpenOffer({ ...base, ttlDays: 7 });
  assert.equal(first.created, true);
  assert.equal(first.offer.ttlDays, 7, "the applied window is persisted with the offer");
  const firstDeadline = Date.parse(first.offer.expiresAt!);

  const second = getOrCreateOpenOffer({ ...base, ttlDays: 14 });
  assert.equal(second.offer.token, first.offer.token, "still the same candidate link");
  assert.equal(second.updated, true, "the deadline change must be applied, not swallowed");
  assert.equal(second.offer.ttlDays, 14);
  assert.ok(
    Date.parse(second.offer.expiresAt!) - firstDeadline > 6 * 24 * 3600_000,
    "the deadline actually moved out by ~a week"
  );

  // A double-clicked approval re-sends the identical window — still verbatim.
  const third = getOrCreateOpenOffer({ ...base, ttlDays: 14 });
  assert.equal(third.updated, false, "an identical re-approval stays a verbatim re-send");
  assert.equal(third.offer.expiresAt, second.offer.expiresAt, "and does not push the deadline out again");
});

// ---- "advanced a stage" is NOT "hired" -------------------------------------
//
// A workspace composes its own board (decision-config `pipelineStages`, written
// through /api/pipeline/stage-migration); the validator only requires entry-first
// and exactly-one-terminal-last. Both axes below are legal, and both used to be
// misread — the offer paths asked a stage's NAME (or the shipped axis's last
// element) a question only its ROLE can answer.

/** A board with a column AFTER the offer step. An accept advances ONE stage, so it
 *  lands on "Background check" — the candidate is NOT hired. */
const POST_OFFER_AXIS = {
  stages: [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Background check", label: "Background check", role: "custom" },
    { id: "Hired", label: "Hired", role: "terminal" },
  ],
  retired: [],
};

/** A board whose terminal column is called something else (the shipped "Hired" is
 *  retired). Hires stand on "Onboarded". */
const RENAMED_TERMINAL_AXIS = {
  stages: [
    { id: "Accepted", label: "Accepted", role: "entry" },
    { id: "Screened", label: "Screened", role: "screening" },
    { id: "Interview", label: "Interview", role: "interview" },
    { id: "Offer", label: "Offer", role: "offer" },
    { id: "Onboarded", label: "Onboarded", role: "terminal" },
  ],
  retired: [{ id: "Hired", label: "Hired", role: "terminal" }],
};

/** Hires debited this period — the headline unit of the outcome-priced product. */
const hiresUsed = (ws: string): number => billingOverview(new Date(), ws).meters.find((m) => m.meter === "hires")?.used ?? -1;

function entryIn(ws: string, stage: string) {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `axis-c${seq}`,
    candidateLabel: `Axis Candidate ${seq}`,
    jobId: `axis-job-${seq}`,
    jobTitle: "Axis Test Role",
    stage,
    workspaceId: ws,
    contact: `axis-c${seq}@example.com`,
  });
  return entry;
}

const offerFor = (entryId: string, label: string) =>
  createOffer({
    entryId,
    candidateLabel: label,
    jobId: null,
    jobTitle: "Axis Test Role",
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: 7,
  });

test("an accept that only advances onto a post-offer column is not a hire — nothing is metered", async () => {
  const WS = "team-post-offer";
  setDecisionConfig("pipelineStages", POST_OFFER_AXIS, WS, "team");
  const entry = entryIn(WS, "Offer");
  const offer = offerFor(entry.id, entry.candidateLabel);
  const before = hiresUsed(WS);

  const res = await respondToOffer(offer.token, "accept");
  assert.ok(res.ok, "the candidate's acceptance is still recorded");
  assert.equal(
    getPipelineEntry(entry.id, WS)!.stage,
    "Background check",
    "accept advances ONE stage on this board — the hire is a column further on"
  );
  assert.ok(hasEvent(entry.id, "offer_accepted", WS), "the acceptance is still on the timeline");
  // Pre-fix: actOnPipelineEntry returning a non-null entry was read as "hired", so
  // the hire meter was debited (and candidate.hired mirrored to the customer's HRIS)
  // for someone sitting on a background check.
  assert.equal(hiresUsed(WS), before, "no hire is debited for a candidate who has not reached the terminal column");
});

test("a stale decline cannot demote a hire whose board calls the terminal column something else", async () => {
  const WS = "team-renamed-terminal";
  setDecisionConfig("pipelineStages", RENAMED_TERMINAL_AXIS, WS, "team");
  const entry = entryIn(WS, "Offer");

  const accepted = offerFor(entry.id, entry.candidateLabel);
  await respondToOffer(accepted.token, "accept");
  assert.equal(getPipelineEntry(entry.id, WS)!.stage, "Onboarded", "the hire lands on THIS board's terminal column");

  // A duplicate / re-extended link on the same entry; declining it must not undo the hire.
  const stale = offerFor(entry.id, entry.candidateLabel);
  const res = await respondToOffer(stale.token, "decline");
  assert.ok(res.ok, "the offer row itself records the decline");
  const still = getPipelineEntry(entry.id, WS)!;
  // Pre-fix: markEntryStatus guarded `stage != 'Hired'` (the shipped axis's last
  // element), so "Onboarded" sailed through and the hire was flipped to declined.
  assert.equal(still.status, "active", "a terminal column is terminal whatever the team called it");
  assert.equal(still.stage, "Onboarded");
  assert.equal(hasEvent(entry.id, "offer_declined", WS), false, "no phantom decline on the hire's timeline");
});

test("re-extending an offer whose deadline lapsed before the sweep ran refreshes it instead of re-sending a dead link", () => {
  const entry = entryAtOffer();
  const input = {
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 88_000,
    payload: {},
    ttlDays: 7,
  };
  const first = getOrCreateOpenOffer(input);
  forceExpiry(first.offer.token); // past its deadline, but the heartbeat hasn't swept it yet

  const again = getOrCreateOpenOffer(input); // identical terms AND identical window
  assert.equal(again.offer.token, first.offer.token, "the re-extend still re-uses the one link");
  assert.equal(again.updated, true, "a lapsed deadline must be re-based");
  assert.ok(Date.parse(again.offer.expiresAt!) > Date.now(), "the link the candidate receives is live");
  assert.equal(getOfferByToken(first.offer.token)!.status, "extended");
});
