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
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { intakeLead } from "./lead-intake.ts";
import { getPipelineEntry } from "./db/pipeline.ts";
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

  const messages = JSON.parse(readFileSync(path.join(process.cwd(), "messages", "cs.json"), "utf-8"));
  const t = createTranslator({ locale: "cs", messages, namespace: "comms" }) as unknown as (
    key: string,
    values?: Record<string, string | number>
  ) => string;
  const ack = listOutboxFiltered({ ref: entry.id, kind: "acknowledgement" });
  assert.equal(ack.length, 1, "the instant acknowledgement went out");
  assert.equal(ack[0].subject, t("ack.subject", { role: "Lead Locale Role" }), "the ack renders from the cs catalog");
});
