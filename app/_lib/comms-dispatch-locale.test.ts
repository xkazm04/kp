// Behavioral coverage for backlog #34 (pa-l2-null-locale) + #37/OO-L1-04:
//   - a NULL-locale entry's letters render in the WORKSPACE default (cs for the
//     ČS seed) — never silently English under the bank's brand;
//   - an EXPLICIT entry locale (en or cs) is honored verbatim;
//   - the dispatched offer letter states the offer's actual response deadline
//     (and the start date when known), injected deterministically at dispatch.
//
// Runs against an ISOLATED throwaway DB (testing/unit-db.ts stays the first
// project import). Expected copy is rendered from the SAME catalogs the
// dispatcher loads, so concurrent copy edits can't break these assertions —
// they pin the LANGUAGE choice and the terms lines, not the prose.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { dispatchOffer, dispatchRejection } from "./comms-dispatch.ts";
import { listOutboxFiltered } from "./db/devcase.ts";

after(() => cleanupUnitDb());

const ROOT = path.join(process.cwd(), "messages");
function catalog(locale: "en" | "cs") {
  const messages = JSON.parse(readFileSync(path.join(ROOT, `${locale}.json`), "utf-8"));
  return createTranslator({ locale, messages, namespace: "comms" }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
}

let seq = 0;
function entryFixture(locale: string | null) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `cdlo-c${seq}`,
    candidateLabel: `Locale Candidate ${seq}`,
    jobId: `cdlo-job-${seq}`,
    jobTitle: "Locale Test Role",
    locale,
  }).entry;
}

test("NULL-locale entry: the rejection letter renders in the workspace default (cs), not English", async () => {
  const entry = entryFixture(null);
  assert.equal(entry.locale, null, "fixture must model the 60/65 legacy NULL rows");

  await dispatchRejection(entry);

  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" });
  assert.equal(rows.length, 1);
  const expectCs = catalog("cs")("rejection.subject", { role: "Locale Test Role" });
  const expectEn = catalog("en")("rejection.subject", { role: "Locale Test Role" });
  assert.equal(rows[0].subject, expectCs, "the subject must come from the cs catalog (workspace default)");
  assert.notEqual(rows[0].subject, expectEn, "a NULL locale must no longer produce the English letter");
});

test("explicit locales are kept: en gets the English letter, cs the Czech one", async () => {
  const en = entryFixture("en");
  const cs = entryFixture("cs");
  await dispatchRejection(en);
  await dispatchRejection(cs);

  const enRow = listOutboxFiltered({ ref: en.id, kind: "rejection" })[0];
  const csRow = listOutboxFiltered({ ref: cs.id, kind: "rejection" })[0];
  assert.equal(enRow.subject, catalog("en")("rejection.subject", { role: "Locale Test Role" }));
  assert.equal(csRow.subject, catalog("cs")("rejection.subject", { role: "Locale Test Role" }));
});

test("the dispatched offer letter states the response deadline (localized) + the start date when known", async () => {
  const entry = entryFixture("cs");
  const expiresAt = "2026-07-10T16:00:00.000Z";
  await dispatchOffer(
    entry,
    { subject: "Nabídka — Locale Test Role", body: "Milá kandidátko/kandidáte, nabízíme Vám pozici." },
    "https://kp.example.com/offer/tk-unit",
    { expiresAt, startDate: "1. 9. 2026" }
  );

  const rows = listOutboxFiltered({ ref: entry.id, kind: "offer" });
  assert.equal(rows.length, 1);
  const body = rows[0].body ?? "";
  const deadline = new Intl.DateTimeFormat("cs", { dateStyle: "medium", timeStyle: "short" }).format(new Date(expiresAt));
  assert.ok(
    body.includes(catalog("cs")("offer.deadlineLine", { deadline })),
    `the letter must state the offer's actual deadline (looked for "${deadline}") — got:\n${body}`
  );
  assert.ok(body.includes(catalog("cs")("offer.startLine", { date: "1. 9. 2026" })), "the letter states the known start date");
  assert.ok(body.includes("https://kp.example.com/offer/tk-unit"), "the response link footer still rides the letter");
});

test("no deadline/start date known: no terms lines are fabricated", async () => {
  const entry = entryFixture("en");
  await dispatchOffer(entry, { subject: "Offer", body: "Hi" }, "https://kp.example.com/offer/tk-unit2");

  const rows = listOutboxFiltered({ ref: entry.id, kind: "offer" });
  assert.equal(rows.length, 1);
  const body = rows[0].body ?? "";
  const deadlinePrefix = catalog("en")("offer.deadlineLine", { deadline: "X" }).split("X")[0];
  assert.ok(!body.includes(deadlinePrefix), "no deadline line without a real deadline");
  const startPrefix = catalog("en")("offer.startLine", { date: "X" }).split("X")[0];
  assert.ok(!body.includes(startPrefix), "no start-date line without a real date");
});
