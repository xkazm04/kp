// Backlog #34 — the apply-flow language is the candidate's EXPLICIT choice and
// must land on the pipeline entry (the quick-apply/webhook routes pass the
// locale the candidate applied in; the conversational route does the same).
// Pins: an apply-with-cs lead files with locale "cs" AND its immediate
// acknowledgement already speaks Czech. Isolated throwaway DB (testing/unit-db
// stays the first project import).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator } from "next-intl";
import type { Locale } from "@/i18n/locales";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { intakeLead } from "./lead-intake.ts";
import { getPipelineEntry, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { parseCodedReason } from "./coded-reason.ts";
import { listOutboxFiltered } from "./db/devcase.ts";
import type { JobRecord } from "./db.ts";

after(() => cleanupUnitDb());

const job: JobRecord = { id: "lil-job-1", title: "Lead Locale Role" };

test("a lead applying in Czech files with locale 'cs' and is acknowledged in Czech", async () => {
  const outcome = await intakeLead({
    job,
    name: "Jana Testová",
    email: "jana@example.com",
    locale: "cs",
    sourceChannel: "quick-apply",
    channelLabel: "quick apply",
    failedKoIds: [],
    enrichLink: "https://kp.example.com/apply/lil-job-1?lang=cs",
  });
  assert.equal(outcome.result, "accepted");
  assert.ok(outcome.result === "accepted");

  const entry = getPipelineEntry(outcome.entryId);
  assert.ok(entry, "the lead filed a pipeline entry");
  assert.equal(entry.locale, "cs", "the applicant's explicit language choice is persisted on the entry");

  const catalog = (locale: Locale) =>
    createTranslator({
      locale,
      messages: JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8")),
      namespace: "comms",
    }) as unknown as (key: string, values?: Record<string, string | number>) => string;

  const ack = listOutboxFiltered({ ref: entry.id, kind: "acknowledgement" });
  assert.equal(ack.length, 1, "the instant acknowledgement went out");
  // `ack.subjectRole` — NOT `ack.subject`: the role-bearing subject is its own key
  // (`ack.subject` never carried a {role}, and rendering it with one produced the bare
  // sentence). Asserting the roleless key made this test claim the ack was localized
  // while comparing it against a string the dispatcher does not send.
  assert.equal(
    ack[0].subject,
    catalog("cs")("ack.subjectRole", { role: "Lead Locale Role" }),
    "the ack renders from the cs catalog"
  );
  assert.notEqual(
    ack[0].subject,
    catalog("en")("ack.subjectRole", { role: "Lead Locale Role" }),
    "…and is not the English fallback"
  );
});

// The other half of "the reader's language": the two strings the intake WRITES for a
// recruiter used to be English sentences built by interpolation — the degraded-intake
// reason on the entry and the `re_applied` event detail — so a Czech recruiter read
// English and nothing could re-render them later. They are now `reason:<code>:<params>`
// (app/_lib/coded-reason.ts). These pin the writer against the four catalogs: a code with
// no key renders as the raw token on screen, which is worse than the prose it replaced.
test("the degraded reason and the repeat event are stored as codes every locale can render", async () => {
  const koJob: JobRecord = { id: "lil-job-2", title: "Coded Reason Role" };
  const first = await intakeLead({
    job: koJob,
    name: "Karel Kód",
    email: "karel@example.com",
    locale: "cs",
    sourceChannel: "boards",
    channelLabel: "boards webhook",
    failedKoIds: [],
    ungatedKoIds: ["ko_auth", "ko_mode"],
    enrichLink: "https://kp.example.com/apply/lil-job-2?lang=cs",
  });
  assert.ok(first.result === "accepted");
  const entry = getPipelineEntry(first.entryId);
  assert.ok(entry);

  const reason = parseCodedReason(entry.intakeDegradedReason);
  assert.ok(reason, "the degraded reason is a code, not an English sentence");
  assert.equal(reason.code, "leadPendingUngated", "the ungated gates get their own sentence");
  assert.equal(reason.params.channel, "boards webhook");
  assert.equal(reason.params.ungated, "ko_auth, ko_mode");

  // A repeat lands on the same entry and records a coded event.
  const repeat = await intakeLead({
    job: koJob,
    name: "Karel Kód",
    email: "karel@example.com",
    locale: "cs",
    sourceChannel: "boards",
    channelLabel: "boards webhook",
    failedKoIds: [],
    enrichLink: "https://kp.example.com/apply/lil-job-2?lang=cs",
  });
  assert.ok(repeat.result === "accepted" && repeat.duplicate);
  const events = listPipelineEventsForEntry(first.entryId).filter((e) => e.kind === "re_applied");
  assert.equal(events.length, 1);
  const evReason = parseCodedReason(events[0].detail);
  assert.ok(evReason, "the repeat event detail is a code");
  assert.equal(evReason.code, "repeatApplication");
  assert.equal(evReason.params.channel, "boards webhook");

  // Every code this intake can write has a real sentence in all four catalogs, and the
  // params it carries are the ones those sentences interpolate.
  for (const locale of ["en", "cs", "de", "fr"] as Locale[]) {
    const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", `${locale}.json`), "utf-8"));
    for (const [ns, code, params] of [
      ["intakeReasons", "leadPending", { channel: "boards webhook" }],
      ["intakeReasons", "leadPendingUngated", { channel: "boards webhook", ungated: "ko_auth" }],
      ["eventReasons", "repeatApplication", { channel: "boards webhook" }],
      ["eventReasons", "repeatApplicationContact", { channel: "boards webhook" }],
    ] as [string, string, Record<string, string>][]) {
      const t = createTranslator({ locale, messages, namespace: `pipeline.${ns}` }) as unknown as (
        key: string,
        values?: Record<string, string>
      ) => string;
      const rendered = t(code, params);
      assert.ok(rendered && !rendered.includes("{"), `${locale} pipeline.${ns}.${code} renders with its params`);
      assert.ok(rendered.includes("boards webhook"), `${locale} pipeline.${ns}.${code} interpolates the channel`);
    }
  }
});
