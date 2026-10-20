// Dispatchers return their delivery VERDICT (challenge-r06 comms-dispatch-relay/A).
//
// The channel has two failure signals: a THROW (the send gate refused) and a RETURNED
// `failed` row (the relay dead-lettered, or the recipient was refused). The candidate
// dispatchers used to return `void`, so every caller heard only the first: a
// dead-lettered offer cleared the recruiter's approval and answered
// `offerExtended: true`, and a dead-lettered rejection was stamped `rejection_sent`
// and counted as notified by every reject door. These cases drive the REAL
// WebhookChannel with a stubbed fetch (the comms-dispatch-population.test.ts shape).
//
// unit-db.ts MUST be the first project import.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry, getPipelineEntry, listPipelineEventsForEntry, setApproval } from "./db/pipeline.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { listOffersForEntry } from "./offers-store.ts";
import { dispatchRejection } from "./comms-dispatch.ts";
import { setRelayHostLookupForTests } from "./comms.ts";
import { extendDraftedOffer, runPipelineEntryAction } from "./pipeline-entry-action.ts";
import { runScreenWave } from "./screen-wave.ts";
import type { PipelineEntry } from "./db/core.ts";

after(() => cleanupUnitDb());

const WS = "team-verdict";
const ORIGIN = "http://localhost:3000";
const OFFER_DRAFT = JSON.stringify({ subject: "Offer", body: "Hi", recommended: 140000, currency: "CZK" });

let seq = 0;
function entryFixture(stage: string, extra: Record<string, unknown> = {}): PipelineEntry {
  seq += 1;
  return createPipelineEntry({
    candidateId: `verdict-c${seq}`,
    candidateLabel: `Verdict Candidate ${seq}`,
    jobId: `verdict-job-${seq}`,
    jobTitle: "Verdict Role",
    contact: `verdict-c${seq}@example.com`,
    stage,
    locale: "en",
    workspaceId: WS,
    ...extra,
  }).entry;
}

function kinds(entryId: string): string[] {
  return listPipelineEventsForEntry(entryId, 100, WS).map((e) => e.kind);
}

/** Run `fn` with a configured relay whose every POST answers `status` (never sent). */
async function withRelay<T>(status: number, fn: () => Promise<T>): Promise<{ result: T; posted: string[] }> {
  const posted: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    posted.push(String(init?.body ?? input));
    return new Response("{}", { status });
  }) as typeof fetch;
  process.env.COMMS_WEBHOOK_URL = "https://relay.invalid/hook";
  setRelayHostLookupForTests(async () => [{ address: "93.184.216.34" }]);
  try {
    const result = await fn();
    return { result, posted };
  } finally {
    delete process.env.COMMS_WEBHOOK_URL;
    setRelayHostLookupForTests(undefined);
    globalThis.fetch = realFetch;
  }
}

test("1. a dead-lettered rejection resolves { claim: 'failed' } and records NO rejection_sent", async () => {
  const entry = entryFixture("Screened");
  const { result } = await withRelay(400, () => dispatchRejection(entry));
  assert.equal((result as { claim?: string } | undefined)?.claim, "failed", "the dispatcher returns the row's verdict");
  assert.ok(!kinds(entry.id).includes("rejection_sent"), "a dead letter is never stamped as sent");
});

test("2. reject door: a RESOLVED dead letter answers 200 commsFailed and records exactly one rejection_comms_failed", async () => {
  const entry = entryFixture("Screened");
  const { result: res } = await withRelay(400, () =>
    runPipelineEntryAction({ id: entry.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS })
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.commsFailed, true);
  const k = kinds(entry.id);
  assert.equal(k.filter((x) => x === "rejection_comms_failed").length, 1, `one nudge marker (got ${k.join(",")})`);
  assert.ok(!k.includes("rejection_sent"));
  assert.equal(getPipelineEntry(entry.id, WS)!.status, "rejected", "the committed decision is never undone");
});

// Cases 3 and 4 share one entry: the dead letter, then the retry.
const offerEntry = entryFixture("Offer");
setApproval(offerEntry.id, "offer_review", OFFER_DRAFT, WS);

test("3. a dead-lettered offer is NOT out: 502 OFFER_NOT_DISPATCHED, approval kept, no offer_sent", async () => {
  const fresh = getPipelineEntry(offerEntry.id, WS)!;
  const { result: res } = await withRelay(400, () => extendDraftedOffer(fresh, WS, ORIGIN, 10));
  assert.equal(res.status, 502);
  assert.equal(res.body.code, "OFFER_NOT_DISPATCHED");
  assert.equal(res.body.offerExtended, false);
  assert.equal(getPipelineEntry(offerEntry.id, WS)!.approvalKind, "offer_review", "the recruiter's approval stays on the card");
  const k = kinds(offerEntry.id);
  assert.equal(k.filter((x) => x === "offer_comms_failed").length, 1, `one offer_comms_failed (got ${k.join(",")})`);
  assert.ok(!k.includes("offer_sent"), "a dead-lettered offer is never recorded as sent");
});

test("4. the retry after a dead letter re-sends the SAME offer token; one open offer, no second token", async () => {
  const deadRow = listOutboxFiltered({ ref: offerEntry.id, kind: "offer" }, WS)[0];
  const deadToken = /\/offer\/([A-Za-z0-9_-]+)/.exec(deadRow?.body ?? "")?.[1];
  assert.ok(deadToken, "the dead-lettered row carried an offer link");
  const fresh = getPipelineEntry(offerEntry.id, WS)!;
  assert.equal(fresh.approvalKind, "offer_review", "the retry door is still on the card after the dead letter");
  const { result: res } = await withRelay(200, () => extendDraftedOffer(fresh, WS, ORIGIN, 10));
  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true);
  assert.match(String(res.body.link), new RegExp(`/offer/${deadToken}$`), "the retry carries the same token");
  const rows = listOutboxFiltered({ ref: offerEntry.id, kind: "offer" }, WS);
  const sent = rows.find((r) => r.status === "sent");
  assert.ok(sent && (sent.body ?? "").includes(`/offer/${deadToken}`), "the delivered letter's link carries the same token");
  const open = listOffersForEntry(offerEntry.id).filter((o) => o.status === "extended");
  assert.equal(open.length, 1, "one open offer for the entry");
  assert.ok(kinds(offerEntry.id).includes("offer_sent"));
});

test("5. keyless (no relay): the offer extends, the row is queued, and offer_sent is recorded", async () => {
  const entry = entryFixture("Offer");
  setApproval(entry.id, "offer_review", OFFER_DRAFT, WS);
  const res = await extendDraftedOffer(getPipelineEntry(entry.id, WS)!, WS, ORIGIN, 10);
  assert.equal(res.status, 200);
  assert.equal(res.body.offerExtended, true);
  const rows = listOutboxFiltered({ ref: entry.id, kind: "offer" }, WS);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "queued");
  assert.ok(kinds(entry.id).includes("offer_sent"), "keyless behaviour unchanged");
});

test("6. an agent-population entry is REFUSED: neither a nudge nor a send", async () => {
  const agent = { ...entryFixture("Screened"), population: "agent" } as PipelineEntry;
  const { result, posted } = await withRelay(200, () => dispatchRejection(agent));
  assert.equal((result as { claim?: string } | undefined)?.claim, "refused");
  assert.deepEqual(posted, [], "no relay contact for an entity with no mailbox");

  // Through the reject door (the core re-reads the row, so the refusal is driven via the
  // dispatcher seam with the population the store does not yet carry).
  const agent2 = entryFixture("Screened");
  const { result: res } = await withRelay(200, () =>
    runPipelineEntryAction(
      { id: agent2.id, action: "reject", expectedStage: "Screened", origin: ORIGIN, workspaceId: WS },
      {
        dispatchRejection: (e, o) => dispatchRejection({ ...e, population: "agent" } as PipelineEntry, o),
        dispatchAtsEvent: async () => {},
        invalidateGroupEvalSelection: () => 0,
      }
    )
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.commsFailed, undefined, "a refusal by design is not a nudge");
  const k = kinds(agent2.id);
  assert.ok(!k.includes("rejection_comms_failed"), `no nudge marker (got ${k.join(",")})`);
  assert.ok(!k.includes("rejection_sent"), "and no send claim");
});

test("7. a committed screen wave counts every dead-lettered letter as a comms failure", async () => {
  const jobId = "verdict-wave-job";
  const ids: string[] = [];
  for (const score of [10, 12]) {
    seq += 1;
    ids.push(
      createPipelineEntry({
        candidateId: `verdict-w${seq}`,
        candidateLabel: `Wave ${seq}`,
        jobId,
        jobTitle: "Verdict Wave Role",
        stage: "Screened",
        matchScore: score,
        archetype: "bau",
        contact: `verdict-w${seq}@example.com`,
        workspaceId: WS,
      }).entry.id
    );
  }
  const rule = { autoRejectEnabled: true, rejectBottomPercent: 100, maxMatchToReject: 100 };
  const preview = await runScreenWave(jobId, rule, { dryRun: true }, WS);
  const { result: wave } = await withRelay(400, () =>
    runScreenWave(jobId, rule, { dryRun: false, approval: { approvedBy: "Verdict Approver", token: preview.approvalToken! } }, WS)
  );
  assert.ok(wave.rejected > 0, "the wave rejected someone");
  assert.equal(wave.commsFailures, wave.rejected, "every dead-lettered letter is a comms failure");
  for (const d of wave.decisions.filter((x) => x.action === "reject")) {
    assert.equal(d.commsFailed, true, `${d.label} carries commsFailed`);
  }
});
