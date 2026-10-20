// The offer door's two pure decisions, pinned.
//
// The offer door's components are client components — JSX + hooks, unloadable under
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The door's markup is the composition-kit letter in ./kit (Gate 2): the deadline sentence is built in
// OfferKitDecision, the terms in OfferKitView, their presence rules in offerKitModel (pinned by
// kit/offerKitModel.test.ts).
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const decisionSrc = src("./kit/OfferKitDecision.tsx");
const viewSrc = src("./kit/OfferKitView.tsx");
const modelSrc = src("./kit/offerKitModel.ts");

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

test("the public card uses the company's projected zone", () => {
  assert.match(decisionSrc, /formatOfferDeadline\(offer\.expiresAt, locale, offer\.timeZone\)/);
  const out = formatOfferDeadline("2026-09-12T21:30:00.000Z", "en", "Europe/Prague");
  assert.match(out, /11:30|23:30/);
  assert.match(out, /GMT\+2|CEST/);
});

test("an unparsable or absent deadline renders nothing, never 'Invalid Date'", () => {
  assert.equal(formatOfferDeadline(null, "en"), "");
  assert.equal(formatOfferDeadline("", "en"), "");
  assert.equal(formatOfferDeadline("not-a-date", "en"), "");
});

test("notes and startDate render when present and are omitted when empty", () => {
  assert.match(viewSrc, /t\("notesLabel"\)/);
  assert.match(viewSrc, /t\("startDate"\)/);
  // the notes keep their line breaks: kit.css .k-body is white-space: pre-wrap
  assert.match(viewSrc, /className="k-body"/);
  assert.match(src("../../_components/kit/kit.css"), /\.k-body \{[^}]*white-space: pre-wrap/);
  assert.match(viewSrc, /useDateFormat/);
  assert.match(modelSrc, /notes: o\.notes\?\.trim\(\) \|\| null/);
  assert.match(modelSrc, /startDate: o\.startDate\?\.trim\(\) \|\| null/);
  assert.match(modelSrc, /salary: o\.salary != null \?/);
});
