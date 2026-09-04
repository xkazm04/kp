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
import { dispatchApplicationReceived, dispatchOffer, dispatchRejection } from "./comms-dispatch.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import { createWorkspace } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const ROOT = path.join(process.cwd(), "messages");
function catalog(locale: "en" | "cs" | "de") {
  const messages = JSON.parse(readFileSync(path.join(ROOT, `${locale}.json`), "utf-8"));
  return createTranslator({ locale, messages, namespace: "comms" }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
}

let seq = 0;
function entryFixture(locale: string | null, workspaceId?: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `cdlo-c${seq}`,
    candidateLabel: `Locale Candidate ${seq}`,
    jobId: `cdlo-job-${seq}`,
    jobTitle: "Locale Test Role",
    locale,
    workspaceId,
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
  // The deadline NAMES ITS TIMEZONE (perfect: an-offer-carries-validated-terms):
  // offer expiry is elapsed time, so a window crossing a DST boundary lands an hour
  // off the local time it was minted at, and a bare "10. 7. 2026 18:00" in a letter
  // read in another country is ambiguous besides. Same components as
  // formatOfferDeadline — dateStyle/timeStyle cannot be mixed with timeZoneName.
  const deadline = new Intl.DateTimeFormat("cs", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(expiresAt));
  assert.ok(
    body.includes(catalog("cs")("offer.deadlineLine", { deadline })),
    `the letter must state the offer's actual deadline (looked for "${deadline}") — got:\n${body}`
  );
  // …and the zone is really in the letter, not just in this test's expectation.
  const zone = new Intl.DateTimeFormat("cs", { timeZoneName: "short" }).format(new Date(expiresAt)).split(" ").pop()!;
  assert.ok(body.includes(zone), `the stated deadline must name its timezone (looked for "${zone}") — got:\n${body}`);
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

// --- the applicant acknowledgement -------------------------------------------
//
// The ack rendered `comms.ack.bodyEnrich` / `comms.ack.statusLine`, which exist in NO
// locale, plus `ack.subject` with a `{role}` that key never had. next-intl returns the
// KEY PATH for a missing message, so a quick-apply lead's confirmation email arrived
// with the body "comms.ack.bodyEnrich" — a non-empty, placeholder-free string the
// catalog test happily rendered. These pin the composed letter instead.

test("the acknowledgement letter is real localized copy — never a raw catalog key path", async () => {
  const entry = entryFixture("en");
  await dispatchApplicationReceived(entry, {
    enrichLink: "https://kp.example.com/apply/job-1/quick?e=1",
    statusLink: "https://kp.example.com/status/tk-ack",
  });

  const rows = listOutboxFiltered({ ref: entry.id, kind: "acknowledgement" });
  assert.equal(rows.length, 1);
  const { subject, body } = rows[0];
  const t = catalog("en");
  // The tell: an unresolved next-intl key path is literally "comms.<key>".
  assert.ok(!/comms\.[a-z]/i.test(subject ?? ""), `the subject shipped a raw key path: ${subject}`);
  assert.ok(!/comms\.[a-z]/i.test(body ?? ""), `the body shipped a raw key path:\n${body}`);
  assert.equal(subject, t("ack.subjectRole", { role: "Locale Test Role" }), "the subject names the role");
  assert.ok((body ?? "").includes(t("ack.greeting", { name: entry.candidateLabel })), "the candidate is greeted by name");
  assert.ok((body ?? "").includes(t("ack.bodyRole", { role: "Locale Test Role" })), "the body is the role-aware ack copy");
  assert.ok((body ?? "").includes(t("ack.signoff")), "the letter is signed off");
  // Both links ride the letter, each under a label (a bare URL reads as spam).
  assert.ok((body ?? "").includes("https://kp.example.com/apply/job-1/quick?e=1"), "the enrichment link ships");
  assert.ok((body ?? "").includes("https://kp.example.com/status/tk-ack"), "the status link ships");
});

test("a NULL-locale ack still renders in the candidate's resolved language (cs), not English", async () => {
  const entry = entryFixture(null);
  await dispatchApplicationReceived(entry);
  const body = listOutboxFiltered({ ref: entry.id, kind: "acknowledgement" })[0].body ?? "";
  assert.ok(body.includes(catalog("cs")("ack.signoff")), `expected the cs sign-off, got:\n${body}`);
});

// --- the tenant the language fallback is read from ---------------------------

test("a NULL-locale entry falls back to ITS OWN team's default language, not the default team's", async () => {
  const team = createWorkspace("Deutsches Team");
  ensureDb().prepare(`UPDATE workspaces SET default_locale = 'de' WHERE id = ?`).run(team.id);

  const entry = entryFixture(null, team.id);
  assert.equal(entry.workspaceId, team.id, "the fixture must be filed into the second team");
  await dispatchRejection(entry);

  const rows = listOutboxFiltered({ ref: entry.id, kind: "rejection" }, team.id);
  assert.equal(rows.length, 1, "the rejection landed in the second team's outbox");
  assert.equal(
    rows[0].subject,
    catalog("de")("rejection.subject", { role: "Locale Test Role" }),
    "the letter must come from the entry's OWN workspace default (de)"
  );
  assert.notEqual(
    rows[0].subject,
    catalog("cs")("rejection.subject", { role: "Locale Test Role" }),
    "the DEFAULT workspace's language must not decide another team's candidate letter"
  );
});
