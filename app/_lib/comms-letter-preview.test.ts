// The offer approval gate shows the EXACT letter it will send, and whether it will
// reach anyone (challenge-r06 comms-dispatch-relay/B).
//
// The offer card used to render the band, the pricing basis and the deadline input -
// and nothing of the letter. The letter is assembled only at dispatch: the model's
// body, then the deterministic terms (a deadline the recruiter's ttlDays decides),
// then the response footer, then the GDPR footers, in the CANDIDATE's language. These
// cases pin a preview built from the SAME composer dispatchOffer uses, that writes
// nothing (no token minted, no offer row), plus a delivery forecast read off the send
// path's own predicates.
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { ensureDb } from "./db/core.ts";
import { createPipelineEntry, getPipelineEntry, setApproval } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { dispatchOffer, formatOfferDeadline } from "./comms-dispatch.ts";
import { commsTranslator } from "./comms-translator.ts";
import { setRelayHostLookupForTests } from "./comms.ts";
import { offerExpiresAtMs } from "./offer-policy.ts";
import { previewOfferLetter } from "./comms-letter-preview.ts";
import type { PipelineEntry } from "./db/core.ts";

after(() => cleanupUnitDb());

const WS = "team-letter";
const ORIGIN = "http://localhost:3000";
const NOW = Date.parse("2026-09-01T10:00:00.000Z");
const DRAFT = {
  subject: "Nabídka: Backend Engineer",
  body: "Dobrý den,\n\nrádi bychom Vám nabídli pozici.",
  recommended: 140000,
  currency: "CZK",
  startDate: "2026-10-01",
};

let seq = 0;
function offerEntry(extra: Record<string, unknown> = {}, draft: Record<string, unknown> = DRAFT): PipelineEntry {
  seq += 1;
  const { entry } = createPipelineEntry({
    candidateId: `letter-c${seq}`,
    candidateLabel: `Letter Candidate ${seq}`,
    jobId: `letter-job-${seq}`,
    jobTitle: "Backend Engineer",
    contact: `letter-c${seq}@example.com`,
    stage: "Offer",
    locale: "cs",
    workspaceId: WS,
    ...extra,
  });
  setApproval(entry.id, "offer_review", JSON.stringify(draft), WS);
  const fresh = getPipelineEntry(entry.id, WS);
  assert.ok(fresh);
  return fresh;
}

/** Links carry minted tokens on the send side and placeholders on the preview side. */
function normaliseLinks(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "<link>");
}

async function withRelay<T>(fn: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  process.env.COMMS_WEBHOOK_URL = "https://relay.invalid/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  try {
    return await fn();
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    setRelayHostLookupForTests(undefined);
    globalThis.fetch = realFetch;
  }
}

test("1. the preview speaks the candidate's language and states the deadline ttlDays will produce", async () => {
  const entry = offerEntry();
  const preview = await previewOfferLetter(entry, { ttlDays: 10, now: NOW, origin: ORIGIN });
  const t = await commsTranslator("cs");
  const deadline = formatOfferDeadline(new Date(offerExpiresAtMs(NOW, 10)).toISOString(), "cs", WS);
  assert.equal(preview.locale, "cs");
  assert.equal(preview.subject, DRAFT.subject);
  assert.ok(preview.body.startsWith(DRAFT.body), "the model's letter leads the body");
  assert.ok(preview.body.includes(t("offer.deadlineLine", { deadline })), "the deadline line for THIS ttlDays");
  const footerHead = t("offer.responseFooter", { link: "\u0000" }).split("\u0000")[0];
  assert.ok(preview.body.includes(footerHead), "the candidate-locale response footer");
  assert.equal(preview.ttlDays, 10);
  assert.equal(preview.expiresAt, new Date(offerExpiresAtMs(NOW, 10)).toISOString());
});

test("2. one composer: the preview's body equals the letter dispatchOffer writes, links aside", async () => {
  const entry = offerEntry();
  const preview = await previewOfferLetter(entry, { ttlDays: 10, now: NOW, origin: ORIGIN });
  await dispatchOffer(entry, DRAFT, `${ORIGIN}/offer/real-token`, {
    expiresAt: new Date(offerExpiresAtMs(NOW, 10)).toISOString(),
    startDate: DRAFT.startDate,
  });
  const rows = listOutboxFiltered({ ref: entry.id, kind: "offer" }, WS);
  assert.equal(rows.length, 1);
  assert.equal(normaliseLinks(preview.body), normaliseLinks(rows[0].body ?? ""));
  assert.equal(preview.subject, rows[0].subject);
});

test("3. the preview writes nothing: no outbox row, no offer, no token, no event", async () => {
  const entry = offerEntry();
  const db = ensureDb();
  const snapshot = () => ({
    outbox: (db.prepare(`SELECT COUNT(*) AS n FROM dev_outbox`).get() as { n: number }).n,
    // offers-store creates its table lazily; "no table" and "no row" are the same fact here.
    offers: db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offers'`).get()
      ? db.prepare(`SELECT * FROM offers WHERE entry_id = ?`).all(entry.id)
      : [],
    tokens: db.prepare(`SELECT erasure_token, optout_token, updated_at FROM pipeline_entries WHERE id = ?`).get(entry.id),
    events: db.prepare(`SELECT * FROM pipeline_events WHERE entry_id = ?`).all(entry.id),
  });
  const before = JSON.stringify(snapshot());
  await previewOfferLetter(entry, { ttlDays: 10, now: NOW, origin: ORIGIN });
  await withRelay(() => previewOfferLetter(entry, { ttlDays: 21, now: NOW, origin: ORIGIN }));
  assert.equal(JSON.stringify(snapshot()), before);
});

test("4. a draft with no subject previews the candidate-locale fallback subject", async () => {
  const entry = offerEntry({}, { body: "Dobrý den.", recommended: 1, currency: "CZK" });
  const preview = await previewOfferLetter(entry, { ttlDays: 7, now: NOW, origin: ORIGIN });
  const t = await commsTranslator("cs");
  assert.equal(preview.subject, t("offer.subjectFallback", { role: "Backend Engineer" }));
});

test("5. the forecast reads the send path's own predicates", async () => {
  const keyless = await previewOfferLetter(offerEntry(), { now: NOW, origin: ORIGIN });
  assert.equal(keyless.forecast, "local");

  const relayed = await withRelay(() => previewOfferLetter(offerEntry(), { now: NOW, origin: ORIGIN }));
  assert.equal(relayed.forecast, "relay");
  assert.ok(relayed.recipient?.includes("@example.com"), "the address the relay will be handed");

  const expired = offerEntry();
  ensureDb()
    .prepare(`UPDATE pipeline_entries SET consent_given_at = ?, consent_expires_at = ? WHERE id = ?`)
    .run("2020-01-01T00:00:00.000Z", "2020-06-01T00:00:00.000Z", expired.id);
  const suppressed = await withRelay(() => previewOfferLetter(getPipelineEntry(expired.id, WS)!, { now: NOW, origin: ORIGIN }));
  assert.equal(suppressed.forecast, "suppressed");
  assert.equal(suppressed.forecastReason, "consent_expired");

  const agent = { ...offerEntry(), population: "agent" as const };
  const refused = await withRelay(() => previewOfferLetter(agent, { now: NOW, origin: ORIGIN }));
  assert.equal(refused.forecast, "refused");
  assert.equal(refused.recipient, null);

  const sim = await withRelay(() => previewOfferLetter(offerEntry({ jobTitle: "Backend Engineer (SIM)" }), { now: NOW, origin: ORIGIN }));
  assert.equal(sim.forecast, "simulation");
});
