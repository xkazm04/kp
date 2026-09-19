// sendDueOfferReminders CAS-claims reminded_at then dispatches. A throw used to
// be console.error only, so a recruiter saw reminded_at set and an offer that
// would lapse in silence. The catch now writes offer_comms_failed (the live
// comms-failed kind) and does not re-arm the claim.
import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";

after(() => cleanupUnitDb());

const REAL_COMMS = new URL("./comms-dispatch.ts", import.meta.url).href;
const STUB_URL =
  "data:text/javascript," +
  encodeURIComponent(
    `export * from ${JSON.stringify(REAL_COMMS)};\n` +
      `export async function dispatchOfferReminder() { throw new Error("unit-test dispatch throw"); }\n`
  );

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL ?? "";
    if (parent.includes("offer-reminders") && specifier.includes("comms-dispatch")) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

type RemindersMod = typeof import("./offer-reminders.ts");
type PipelineMod = typeof import("./db/pipeline.ts");
type OffersMod = typeof import("./offers-store.ts");

let sendDueOfferReminders: RemindersMod["sendDueOfferReminders"];
let createPipelineEntry: PipelineMod["createPipelineEntry"];
let listPipelineEventsForEntry: PipelineMod["listPipelineEventsForEntry"];
let createOffer: OffersMod["createOffer"];

before(async () => {
  ({ sendDueOfferReminders } = await import("./offer-reminders.ts"));
  ({ createPipelineEntry, listPipelineEventsForEntry } = await import("./db/pipeline.ts"));
  ({ createOffer } = await import("./offers-store.ts"));
});

function remindedAt(token: string): string | null {
  const d = new Database(UNIT_DB_PATH);
  try {
    d.pragma("busy_timeout = 5000");
    const row = d.prepare(`SELECT reminded_at FROM offers WHERE token = ?`).get(token) as
      | { reminded_at: string | null }
      | undefined;
    return row?.reminded_at ?? null;
  } finally {
    d.close();
  }
}

test("a throwing dispatch still has reminded_at set and one offer_comms_failed event", async () => {
  const { entry } = createPipelineEntry({
    candidateId: "orm-fail-c1",
    candidateLabel: "Offer Reminder Fail",
    jobId: "orm-fail-job",
    jobTitle: "Offer Reminder Role",
    stage: "Offer",
    contact: "orm-fail@example.com",
  });
  const offer = createOffer({
    entryId: entry.id,
    candidateLabel: entry.candidateLabel,
    jobId: entry.jobId,
    jobTitle: entry.jobTitle,
    currency: "CZK",
    salary: 80_000,
    payload: { recommended: 80_000 },
    ttlDays: 1,
  });

  const realError = console.error;
  console.error = () => {};
  let sent: number;
  try {
    sent = await sendDueOfferReminders();
  } finally {
    console.error = realError;
  }

  assert.equal(sent, 0, "a throw is not a send");
  assert.ok(remindedAt(offer.token), "the CAS claim must stay set — do not re-arm");
  const failed = listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "offer_comms_failed");
  assert.equal(failed.length, 1, "the miss must be one auditable pipeline event");
  assert.equal(
    listPipelineEventsForEntry(entry.id).some((e) => e.kind === "offer_reminder_sent"),
    false,
    "a throw must not also claim the reminder was sent"
  );

  const again = await sendDueOfferReminders();
  assert.equal(again, 0, "the claim persists — no retry on the next tick");
  assert.equal(
    listPipelineEventsForEntry(entry.id).filter((e) => e.kind === "offer_comms_failed").length,
    1,
    "a second sweep must not write a second failure"
  );
});
