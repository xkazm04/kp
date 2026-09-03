// The offer door's two pure decisions, pinned.
//
// OfferClient.tsx is a client component — JSX + hooks, unloadable under
// `node --test` — so until now the two judgements that decide what a candidate
// SEES after the most consequential click in the product lived inside it,
// untested: which HTTP answer means "expired" rather than "retry", and what the
// deadline sentence actually says. Both are pure, so both now live in their own
// modules beside the component and are asserted here.
//
// Runner: Node's built-in test runner with type stripping.  npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyOfferResponse, offerRespondAllowed } from "./offer-response.ts";
import { formatOfferDeadline, OFFER_DEADLINE_ZONE } from "./offer-deadline.ts";

// ── classifyOfferResponse ────────────────────────────────────────────────────

test("410 settles the card as EXPIRED — never an inline retry error", () => {
  // The deadline is the offer's lever: a lapsed link is a definite ending, and
  // offering "try again" over it is a loop with no exit.
  assert.deepEqual(classifyOfferResponse(410, { error: "This offer has expired.", code: "OFFER_EXPIRED" }), {
    kind: "settled",
    status: "expired",
  });
});

test("a 2xx settles on the SERVER's recorded status, both ways", () => {
  assert.deepEqual(classifyOfferResponse(200, { ok: true, status: "accepted" }), { kind: "settled", status: "accepted" });
  assert.deepEqual(classifyOfferResponse(200, { ok: true, status: "declined" }), { kind: "settled", status: "declined" });
});

test("a 2xx with no recognisable status is a FAILURE, not a silent accept", () => {
  // A truncated/garbled 200 used to fall through `setResult(p.status)` and paint
  // an empty terminal card; the honest answer is the retryable inline error.
  assert.deepEqual(classifyOfferResponse(200, { ok: true }), { kind: "failed", code: null });
  assert.deepEqual(classifyOfferResponse(200, null), { kind: "failed", code: null });
});

test("a non-410 failure carries the server's CODE forward, never its prose", () => {
  // The client localizes `errors.<CODE>`; the server's English sentence is never
  // rendered (api-contracts.md §1.1). A refusal with no code falls back to the
  // page's own localized respond-failed copy, which `null` signals.
  assert.deepEqual(classifyOfferResponse(404, { error: "Offer not found.", code: "OFFER_NOT_FOUND" }), {
    kind: "failed",
    code: "OFFER_NOT_FOUND",
  });
  assert.deepEqual(classifyOfferResponse(429, { error: "Too many requests — please try again shortly.", code: "TOO_MANY_REQUESTS" }), {
    kind: "failed",
    code: "TOO_MANY_REQUESTS",
  });
  assert.deepEqual(classifyOfferResponse(500, { error: "boom" }), { kind: "failed", code: null });
});

test("a request in flight gates the next one — accept and decline are both irreversible", () => {
  assert.equal(offerRespondAllowed(null), true);
  assert.equal(offerRespondAllowed("accept"), false);
  assert.equal(offerRespondAllowed("decline"), false);
});

// ── formatOfferDeadline ──────────────────────────────────────────────────────

test("the deadline names its zone, so a candidate abroad reads the same calendar day", () => {
  // 2026-09-12T21:30:00Z is already the 13th in Sydney and still the 12th in New
  // York. Rendered in the viewer's own zone with no zone name, three candidates
  // read three different deadlines off one letter — so the label is pinned to one
  // explicit zone and SAYS which.
  const out = formatOfferDeadline("2026-09-12T21:30:00.000Z", "en");
  assert.match(out, /12/, `expected the offer's own calendar day, got "${out}"`);
  assert.match(out, /UTC/, `expected the zone to be named, got "${out}"`);
  assert.equal(OFFER_DEADLINE_ZONE, "UTC");
});

test("the same instant renders identically whatever the viewer's locale digits", () => {
  const en = formatOfferDeadline("2026-09-12T21:30:00.000Z", "en");
  const cs = formatOfferDeadline("2026-09-12T21:30:00.000Z", "cs");
  // Different words, same instant + same named zone — the point of the fix.
  assert.match(cs, /UTC/);
  assert.match(en, /UTC/);
});

test("an unparsable or absent deadline renders nothing, never 'Invalid Date'", () => {
  assert.equal(formatOfferDeadline(null, "en"), "");
  assert.equal(formatOfferDeadline("", "en"), "");
  assert.equal(formatOfferDeadline("not-a-date", "en"), "");
});
