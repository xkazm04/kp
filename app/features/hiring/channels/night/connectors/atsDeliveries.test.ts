// C5 — the first UI reader of GET /api/ats/deliveries, driven against the REAL route (used as it
// is, its contract unchanged): with dead-lettered deliveries (the webhook answered 500 until the
// ladder gave up) the plumbing's headline on level 0 reads "n outcomes did not reach your ATS"
// (the council must-address for ats-candidate-egress: a dead-letter with no recruiter-visible
// alert), and the deck's Replay, through the route's own POST { replayId }, re-queues the row.
//
// unit-db.ts must stay the first project import.
import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { createTranslator } from "next-intl";
import { cleanupUnitDb } from "../../../../../_lib/testing/unit-db.ts";
import { GET, POST } from "../../../../../api/ats/deliveries/route.ts";
import { MAX_ATTEMPTS, finalizeAtsDelivery, getAtsDelivery, recordAtsDeliveryStart } from "../../../../../_lib/ats-delivery-store.ts";
import { NEEDS_SHOWN, plumbingModel, type PlumbingInput } from "../channelsNightPlumbing.ts";
import { deadDeliveries, deliveryCounts, parseDeliveriesBody, replayRequest } from "./atsDeliveriesModel.ts";
import { replayDelivery, type Fetcher } from "./connectorsDeckReads.ts";

after(() => cleanupUnitDb());
afterEach(() => {
  delete process.env.KP_NO_COMMS_EGRESS;
});

/** A delivery the webhook answered 500 until the retry ladder parked it: a dead letter. */
function deadAt500(entryId: string): number {
  const id = recordAtsDeliveryStart("candidate.hired", entryId);
  for (let i = 0; i < MAX_ATTEMPTS; i++) finalizeAtsDelivery(id, { delivered: false, status: 500, reason: "HTTP 500" });
  return id;
}

/** The deck's wire, answered by the real route handlers instead of a browser. */
const routeFetch: Fetcher = async (url, init) => {
  assert.equal(url, "/api/ats/deliveries");
  if ((init?.method ?? "GET") === "GET") return GET();
  return POST(new NextRequest(`http://localhost${url}`, { method: init?.method, headers: init?.headers, body: init?.body as string }));
};

async function readLedger() {
  const d = parseDeliveriesBody(await (await GET()).json());
  assert.ok(d, "the route's body parses");
  return d;
}

const QUIET: PlumbingInput = {
  jobs: [{ id: "job-1" }], receivers: [], receiversTruncated: false, waiting: 0, messages: [], olderExist: false,
  relay: "configured", edge: null, settled: true,
};

function en() {
  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "en.json"), "utf-8"));
  return createTranslator({ locale: "en", messages }) as unknown as { markup: (k: string, v?: Record<string, unknown>) => string };
}

test("dead deliveries at 500 -> the L0 headline reads 'n outcomes did not reach your ATS'", async () => {
  const ids = [deadAt500("pe-c5-a"), deadAt500("pe-c5-b"), deadAt500("pe-c5-c")];
  const ledger = await readLedger();
  assert.equal(ledger.dead, 3);
  assert.deepEqual(deadDeliveries(ledger).map((r) => r.id).sort(), [...ids].sort());
  assert.equal(deadDeliveries(ledger)[0].lastStatus, 500);

  const model = plumbingModel({ ...QUIET, ats: deliveryCounts(ledger) });
  assert.equal(model.headline.kind, "need");
  const need = model.headline.kind === "need" ? model.headline.need : null;
  assert.equal(need?.key, "atsDead");
  assert.equal(need?.n.count, 3);
  assert.ok((need?.sev ?? 0) >= NEEDS_SHOWN, "listed on level 0, not hidden in a level");
  assert.deepEqual(need?.target, { level: 1, deck: "connectors", focus: "ats" }, "its door opens the deck on the ATS deliveries");
  const words = en().markup("channelsNight.plumbing.need.atsDead.title", { count: 3, em: (c: string) => c });
  assert.equal(words, "3 outcomes did not reach your ATS");
  assert.equal(en().markup("channelsNight.plumbing.need.atsDead.title", { count: 1, em: (c: string) => c }), "1 outcome did not reach your ATS");
});

test("Replay goes through the route's POST { replayId } and re-queues the row", async () => {
  const id = deadAt500("pe-c5-replay");
  const before = (await readLedger()).dead;
  // Sealed, so the sweep after the requeue leaves the row waiting instead of dialing out: what is
  // proven is the requeue itself, not a delivery.
  process.env.KP_NO_COMMS_EGRESS = "1";
  const out = await replayDelivery(id, routeFetch);
  assert.deepEqual(out, { ok: true });
  const row = getAtsDelivery(id);
  assert.ok(row?.nextAttemptAt, "a next attempt is scheduled: the row is due again, not dead");
  const after = await readLedger();
  assert.equal(after.dead, before - 1);
  assert.ok(!deadDeliveries(after).some((r) => r.id === id), "off the dead list");
});

test("Replay of a row that is not dead answers the route's refusal code, which the deck resolves", async () => {
  const id = recordAtsDeliveryStart("candidate.hired", "pe-c5-delivered");
  finalizeAtsDelivery(id, { delivered: true, status: 200 });
  const out = await replayDelivery(id, routeFetch);
  assert.deepEqual(out, { ok: false, code: "ATS_DELIVERY_NOT_REPLAYABLE", status: 409 });
});

test("no dead letters, no need; an unread ledger is not 'nothing dead'", () => {
  assert.ok(!plumbingModel({ ...QUIET, ats: { due: 2, dead: 0, stranded: 1 } }).needs.some((n) => n.key === "atsDead"));
  assert.ok(!plumbingModel({ ...QUIET, ats: null }).needs.some((n) => n.key === "atsDead"));
  assert.equal(parseDeliveriesBody({ error: "Unauthorized" }), null);
  assert.equal(deliveryCounts(null), null);
});

test("the replay request is the route's contract, unchanged", () => {
  const r = replayRequest(42);
  assert.equal(r.url, "/api/ats/deliveries");
  assert.equal(r.init.method, "POST");
  assert.deepEqual(JSON.parse(String(r.init.body)), { replayId: 42 });
});
