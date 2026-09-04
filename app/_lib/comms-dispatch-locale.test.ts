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
import {
  dispatchApplicationReceived,
  dispatchInterviewConfirmation,
  dispatchInterviewReminder,
  dispatchInterviewerBrief,
  dispatchOffer,
  dispatchRejection,
} from "./comms-dispatch.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import { ensureDb } from "./db/core.ts";
import { createWorkspace } from "./db/workspaces.ts";

after(() => cleanupUnitDb());

const ROOT = path.join(process.cwd(), "messages");
function catalog(locale: "en" | "cs" | "de" | "fr") {
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

// --- the letter states the slot in the CANDIDATE's zone and language -------------
//
// The stored `slot` column is minted by schedule-slots.slotLabel from hardcoded
// English DOW/MON arrays in the INTERVIEWER's zone, with no zone marker — and it was
// the only thing the localized confirmation and reminder templates interpolated. So a
// Czech candidate in New York got a Czech letter whose one load-bearing fact read
// "Tue 9 Jun 10:00": English inside Czech prose, naming an hour on a clock they are
// not on, while schedule_invites.candidate_tz had captured their real zone at confirm
// and was never used outbound. These pin the fix across cs/de/fr.

// A Tuesday 10:00 Prague booking. In New York that is 04:00 the same morning — the
// gap that makes the difference visible rather than cosmetic.
const SLOT_AT = "2026-06-09T08:00:00.000Z";
const LEGACY_LABEL = "Tue 9 Jun 10:00";
const CANDIDATE_TZ = "America/New_York";

function expectedSlot(locale: "en" | "cs" | "de" | "fr", tz: string) {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: tz,
  }).format(new Date(SLOT_AT));
}

for (const locale of ["cs", "de", "fr"] as const) {
  test(`the interview confirmation (${locale}) states the slot in the candidate's captured zone, marked`, async () => {
    const entry = entryFixture(locale);
    await dispatchInterviewConfirmation(entry, LEGACY_LABEL, {
      durationMin: 45,
      slotAtIso: SLOT_AT,
      candidateTz: CANDIDATE_TZ,
    });
    const body = listOutboxFiltered({ ref: entry.id, kind: "interview_confirmation" })[0].body ?? "";
    const want = expectedSlot(locale, CANDIDATE_TZ);
    assert.ok(body.includes(want), `expected the slot as "${want}" — got:\n${body}`);
    assert.ok(!body.includes(LEGACY_LABEL), "the English interviewer-zone label must not reach the candidate");
    // The zone is NAMED: an hour with no clock attached is not an appointment.
    const zone = want.split(" ").pop()!;
    assert.ok(zone.length > 0 && body.includes(zone), `the stated time must name its zone (looked for "${zone}")`);
  });

  test(`the interview reminder (${locale}) states the same zone-marked slot`, async () => {
    const entry = entryFixture(locale);
    await dispatchInterviewReminder(entry, LEGACY_LABEL, {
      durationMin: 45,
      slotAtIso: SLOT_AT,
      candidateTz: CANDIDATE_TZ,
    });
    const row = listOutboxFiltered({ ref: entry.id, kind: "interview_reminder" })[0];
    const want = expectedSlot(locale, CANDIDATE_TZ);
    assert.ok((row.body ?? "").includes(want), `expected the slot as "${want}" — got:\n${row.body}`);
    assert.ok(!(row.body ?? "").includes(LEGACY_LABEL), "no English label in a localized reminder");
    assert.ok((row.subject ?? "").includes(want), "the subject line carries the same formatted slot");
  });
}

test("no captured candidate zone: the letter falls back to the INTERVIEW zone, still marked and localized", async () => {
  const entry = entryFixture("cs");
  await dispatchInterviewConfirmation(entry, LEGACY_LABEL, { slotAtIso: SLOT_AT, candidateTz: null });
  const body = listOutboxFiltered({ ref: entry.id, kind: "interview_confirmation" })[0].body ?? "";
  assert.ok(body.includes(expectedSlot("cs", "Europe/Prague")), `expected the interview-zone time — got:\n${body}`);
});

test("an unusable candidate zone never costs the candidate their confirmation", async () => {
  const entry = entryFixture("de");
  // Intl THROWS on an unknown timeZone; a stale browser or a hand-edited row must
  // degrade to the interview zone, not to a 500 on the confirm path.
  await dispatchInterviewConfirmation(entry, LEGACY_LABEL, { slotAtIso: SLOT_AT, candidateTz: "Mars/Olympus_Mons" });
  const body = listOutboxFiltered({ ref: entry.id, kind: "interview_confirmation" })[0].body ?? "";
  assert.ok(body.includes(expectedSlot("de", "Europe/Prague")), `expected the interview-zone fallback — got:\n${body}`);
});

test("no instant at all: the stored label is the fallback, and a label-less row gets localized copy", async () => {
  const withLabel = entryFixture("fr");
  await dispatchInterviewReminder(withLabel, LEGACY_LABEL, {});
  assert.ok(
    (listOutboxFiltered({ ref: withLabel.id, kind: "interview_reminder" })[0].body ?? "").includes(LEGACY_LABEL),
    "with no instant to format, the legacy column is still better than nothing"
  );
  // …and the bare English "your scheduled time" the sweep used to substitute is a
  // catalog key now, so a French reader gets French.
  const bare = entryFixture("fr");
  await dispatchInterviewReminder(bare, null, {});
  const body = listOutboxFiltered({ ref: bare.id, kind: "interview_reminder" })[0].body ?? "";
  const fallback = catalog("fr")("interviewReminder.slotFallback");
  assert.ok(body.includes(fallback), `expected the localized fallback "${fallback}" — got:\n${body}`);
  assert.ok(!body.includes("your scheduled time"), "the English fallback must not reach a French letter");
});

// --- the interviewer's calendar hold is the SAME length as the interview ---------

test("the interviewer .ics holds DEFAULT_INTERVIEW_MINUTES when the plan names no length", async () => {
  const { DEFAULT_INTERVIEW_MINUTES } = await import("./calendar/constants.ts");
  const entry = entryFixture("en");
  const sent = await dispatchInterviewerBrief(entry, LEGACY_LABEL, {
    interviewer: "Dana Reviewer <dana@example.com>",
    slotAtIso: SLOT_AT,
    durationMin: null, // nothing planned — the default decides
    lang: "en",
  });
  assert.equal(sent, true, "an addressable interviewer is briefed");
  const body = listOutboxFiltered({ kind: "interviewer_brief", ref: entry.id })[0].body ?? "";
  const start = /DTSTART:(\d{8}T\d{6}Z)/.exec(body);
  const end = /DTEND:(\d{8}T\d{6}Z)/.exec(body);
  assert.ok(start && end, `the brief must carry an .ics hold — got:\n${body}`);
  const toMs = (stamp: string) =>
    Date.parse(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
    );
  const minutes = (toMs(end[1]) - toMs(start[1])) / 60_000;
  // This inlined `30` while the candidate's own .ics, the free/busy window and the
  // slot proposer all used calendar/constants.DEFAULT_INTERVIEW_MINUTES (45), so the
  // interviewer's hold was quietly 15 minutes shorter than the call they were running.
  assert.equal(minutes, DEFAULT_INTERVIEW_MINUTES, "the hold is the one default interview length");
});

test("source guard: the interviewer .ics names the shared duration constant, never a literal", () => {
  // Normalized first — this checkout is CRLF while the worktree may be LF.
  const src = readFileSync(path.join(process.cwd(), "app", "_lib", "comms-dispatch.ts"), "utf-8").replace(/\r\n/g, "\n");
  const call = /buildIcs\(\{[\s\S]*?\}\)/.exec(src);
  assert.ok(call, "expected a buildIcs call in comms-dispatch.ts");
  assert.ok(
    /durationMin:[^,\n]*DEFAULT_INTERVIEW_MINUTES/.test(call[0]),
    `the .ics duration must fall back to DEFAULT_INTERVIEW_MINUTES — got:\n${call[0]}`
  );
  assert.ok(
    !/durationMin:[^,\n]*:\s*\d+\s*,/.test(call[0]),
    "no bare numeric fallback may sit beside the shared constant"
  );
});
