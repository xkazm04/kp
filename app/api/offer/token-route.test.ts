// Handler-level coverage for /api/offer/[token] (the money route) against an
// ISOLATED throwaway DB — testing/unit-db.ts must stay the first project import
// so KP_DB_PATH points at the temp file before any store loads. The route
// module is imported directly and driven with constructed NextRequests: happy
// accept mutates the store (offer accepted, entry Hired), bad
// payloads and unknown tokens get the right 4xx envelope, expiry is 410.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { GET, POST } from "./[token]/route.ts";
import { createPipelineEntry, getPipelineEntry } from "../../_lib/db/pipeline.ts";
import { createOffer, getOfferByToken } from "../../_lib/offers-store.ts";

after(() => cleanupUnitDb());

let seq = 0;
function offerFixture() {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `route-c${seq}`,
    candidateLabel: `Route Candidate ${seq}`,
    jobId: `route-job-${seq}`,
    jobTitle: "Route Test Role",
    stage: "Offer",
    contact: `route-c${seq}@example.com`,
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: null,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 75_000,
    payload: {},
    ttlDays: 7,
  });
  return { entry, offer };
}

const params = (token: string) => ({ params: Promise.resolve({ token }) });

function post(token: string, body: unknown): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/offer/${token}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }),
    params(token)
  );
}

test("GET with an unknown token → 404 with the error envelope, leaking nothing", async () => {
  const res = await GET(new NextRequest("http://localhost/api/offer/tk-nope"), params("tk-nope"));
  assert.equal(res.status, 404);
  const body = await res.json();
  // The refusal envelope is the shared one: the canonical English PLUS the machine
  // code the card localizes. Still exactly two fields — nothing about the offer,
  // the entry or the store leaks onto a 404 for an unknown token.
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  assert.equal(body.code, "OFFER_NOT_FOUND");
});

test("GET renders the candidate view for a live offer", async () => {
  const { offer } = offerFixture();
  const res = await GET(new NextRequest(`http://localhost/api/offer/${offer.token}`), params(offer.token));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.offer.status, "extended");
  assert.equal(body.offer.salary, 75_000);
  assert.equal(body.offer.token, offer.token);
});

test("POST with a malformed response → 400 and no store mutation", async () => {
  const { entry, offer } = offerFixture();
  const res = await post(offer.token, { response: "maybe" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /accept.*decline/i);
  assert.equal(getOfferByToken(offer.token)!.status, "extended", "a rejected payload must not touch the offer");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer");
});

test("POST accept happy path: offer accepted, entry Hired", async () => {
  const { entry, offer } = offerFixture();
  const res = await post(offer.token, { response: "accept" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.status, "accepted");
  assert.equal(body.alreadyResponded, false);
  assert.equal(getOfferByToken(offer.token)!.status, "accepted");
  assert.equal(getPipelineEntry(entry.id)!.stage, "Hired");

  // The retry is idempotent — reported, not re-applied.
  const retry = await post(offer.token, { response: "accept" });
  assert.equal((await retry.json()).alreadyResponded, true);
});

test("POST decline → terminal declined entry; unknown token → 404", async () => {
  const { entry, offer } = offerFixture();
  const res = await post(offer.token, { response: "decline" });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, "declined");
  assert.equal(getPipelineEntry(entry.id)!.status, "declined");

  const missing = await post("tk-missing", { response: "accept" });
  assert.equal(missing.status, 404);
});

test("POST on a lapsed offer → 410 Gone with the expired flag", async () => {
  const { entry, offer } = offerFixture();
  // Force the deadline into the past on the isolated store.
  const { default: Database } = await import("better-sqlite3");
  const d = new Database(process.env.KP_DB_PATH!);
  try {
    d.pragma("busy_timeout = 5000");
    d.prepare(`UPDATE offers SET expires_at = ? WHERE token = ?`).run(
      new Date(Date.now() - 1000).toISOString(),
      offer.token
    );
  } finally {
    d.close();
  }
  const res = await post(offer.token, { response: "accept" });
  assert.equal(res.status, 410);
  assert.match((await res.json()).error, /expired/i);
  assert.equal(getPipelineEntry(entry.id)!.stage, "Offer", "an expired link must not move the entry");
});

// --- The PUBLIC projection, pinned ------------------------------------------

test("GET pins the EXACT field set that reaches the candidate — no silent leak", async () => {
  const { offer } = offerFixture();
  const res = await GET(new NextRequest(`http://localhost/api/offer/${offer.token}`), params(offer.token));
  assert.equal(res.status, 200);
  const body = await res.json();
  // A public token door carries a PROJECTION, not the row (.claude/CLAUDE.md).
  // offerView is hand-written, so a field appended to OfferRow — or to the view —
  // reaches an unauthenticated page unless something here says no. Exactly these,
  // and nothing else: no id, no entryId, no workspaceId, no payload, no
  // respondedAt/remindedAt, no ttlDays.
  assert.deepEqual(Object.keys(body).sort(), ["offer"]);
  assert.deepEqual(Object.keys(body.offer).sort(), [
    "candidateLabel",
    "company",
    "currency",
    "expiresAt",
    "hoursRemaining",
    "jobTitle",
    "salary",
    "status",
    "token",
  ]);
  // The countdown is SERVER-computed (offers-onboarding #5) and rides the same
  // instant as the deadline the letter states.
  assert.equal(typeof body.offer.hoursRemaining, "number");
  assert.ok(body.offer.hoursRemaining > 0 && body.offer.hoursRemaining <= 7 * 24);
});

test("POST pins the EXACT success field set", async () => {
  const { offer } = offerFixture();
  const res = await post(offer.token, { response: "accept" });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ["alreadyResponded", "candidateLabel", "jobTitle", "ok", "status"]);
});

// --- The throttle, driven live ----------------------------------------------
//
// Both verbs on this door are limited (rate-limit-contract.test.ts pins the call
// sites; these drive the limiter for real, so a budget that is wired but never
// reached — or reached one request early — is caught here). Unknown tokens are
// used deliberately: every request is a 404 that mutates nothing, and the limiter
// still counts it, which is the containment property that matters on a public door.

test("GET over its per-token budget answers a coded 429", async () => {
  const token = "tk-view-throttle";
  const req = () => GET(new NextRequest(`http://localhost/api/offer/${token}`), params(token));
  for (let i = 0; i < 60; i += 1) {
    assert.equal((await req()).status, 404, `request ${i + 1} of 60 must still be served`);
  }
  const over = await req();
  assert.equal(over.status, 429);
  const body = await over.json();
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
  assert.equal(body.code, "TOO_MANY_REQUESTS");
});

test("POST over its per-token budget answers a coded 429", async () => {
  const token = "tk-respond-throttle";
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await post(token, { response: "accept" })).status, 404, `request ${i + 1} of 10 must still be served`);
  }
  const over = await post(token, { response: "accept" });
  assert.equal(over.status, 429);
  const body = await over.json();
  assert.equal(body.code, "TOO_MANY_REQUESTS");
  // The throttle sits BEFORE the body read and the store hop, so a throttled
  // request cannot respond to an offer.
  assert.deepEqual(Object.keys(body).sort(), ["code", "error"]);
});
