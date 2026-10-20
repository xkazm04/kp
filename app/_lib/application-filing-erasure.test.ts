// Entry ids stop embedding the applicant's email; erasure frees the identity.
// (Challenge r06 candidate-apply-flow/A.)
//
// Before: every inbound filing was stored under a PRIMARY KEY built from the email in
// clear (`m-appl-jana-example-invalid-<job>`), and an erased applicant who applied
// again regenerated that same id, landed on the anonymized row and — through the
// filing core's raced repeat — had their address backfilled onto it, an
// acknowledgement sent to it and their consent renewed on a record they asked us to
// forget. Now the id is an opaque surrogate, the dedupe identity lives in an erasable
// hashed `applicant_key` column (partial UNIQUE index), and erasure nulls it.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import. The
// profile builder is injected, so nothing spawns Python; the ack is captured, never sent.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { fileApplication, type ProfileBuilder } from "./application-filing.ts";
import { applicantKey } from "./applicant-key.ts";
import { insertJob } from "./job-ingest.ts";
import { getJob } from "./db/jobs.ts";
import {
  anonymizeEntry,
  createPipelineEntry,
  getPipelineEntry,
  listConsentEvents,
  listPipelineEventsForEntry,
} from "./db/pipeline.ts";
import { saveProfile } from "./db/profiles.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { ensureDb } from "./db/core.ts";

after(() => cleanupUnitDb());

const builder: ProfileBuilder = async (_job, answers, _into, workspaceId) => {
  const saved = saveProfile(
    { label: answers.name, archetype: "backend", roleFamily: null, completeness: 60, payload: { displayName: answers.name } },
    workspaceId
  );
  return { ok: true, id: saved.id, archetype: "backend", missingGaps: [] };
};

function openJob(id: string, workspaceId: string) {
  insertJob({ id, title: `Role ${id}` } as never, undefined, "published", workspaceId);
  const job = getJob(id);
  assert.ok(job, `precondition: job ${id} exists`);
  return job;
}

function rawRow(id: string): Record<string, unknown> | undefined {
  return ensureDb().prepare(`SELECT * FROM pipeline_entries WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}

/** File through the core with the ack CAPTURED: `acked` collects every entry id an
 *  acknowledgement was prepared for (the link mint runs before any dispatch). */
async function file(job: ReturnType<typeof openJob>, workspaceId: string, name: string, email: string | null, acked: string[], proof: "none" | "channel" = "none") {
  return fileApplication({
    job,
    workspaceId,
    name,
    email,
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof,
    answers: { skills: "", cvText: "" },
    buildProfile: builder,
    statusLinkFor: (entry) => {
      acked.push(entry.id);
      return null;
    },
    defer: () => {
      /* captured, never dispatched: the unit suite has no relay */
    },
  });
}

test("a fresh filing's entry id carries none of the applicant's name or address", async () => {
  const W = "team-erasure-id";
  const job = openJob("afe-id-job", W);
  const out = await file(job, W, "Jana Novakova", "jana@example.invalid", []);
  assert.equal(out.kind, "created");
  for (const pii of ["jana", "novakova", "example", "invalid"]) {
    assert.ok(!out.entry.id.toLowerCase().includes(pii), `entry id ${out.entry.id} must not contain '${pii}'`);
  }
});

test("the lookup-miss race: two creates with one applicantKey collapse onto the FIRST entry, one row", () => {
  const W = "team-erasure-race";
  const job = openJob("afe-race-job", W);
  const key = applicantKey("Rita Race", "rita@example.invalid");
  const base = { candidateLabel: "Rita Race", jobId: job.id, jobTitle: job.title, stage: "Accepted", applicantKey: key, workspaceId: W };
  const first = createPipelineEntry({ ...base, candidateId: "profile-rita-1" });
  const second = createPipelineEntry({ ...base, candidateId: "profile-rita-2" });
  assert.equal(first.created, true);
  assert.equal(second.created, false, "the second filing is the same applicant");
  assert.equal(second.entry.id, first.entry.id);
  const n = ensureDb()
    .prepare(`SELECT COUNT(*) AS c FROM pipeline_entries WHERE workspace_id = ? AND job_id = ? AND applicant_key = ?`)
    .get(W, job.id, key) as { c: number };
  assert.equal(n.c, 1, "exactly one row carries the identity");
});

test("erasure nulls the applicant_key alongside the contact", async () => {
  const W = "team-erasure-null";
  const job = openJob("afe-null-job", W);
  const out = await file(job, W, "Nela Null", "nela@example.invalid", []);
  assert.equal(out.kind, "created");
  assert.ok(rawRow(out.entry.id)?.applicant_key, "precondition: the filing stored its key");
  anonymizeEntry(out.entry.id, "erasure", W);
  const row = rawRow(out.entry.id);
  assert.equal(row?.contact, null);
  assert.equal(row?.applicant_key, null, "an erased identity can no longer be matched");
});

test("an erased applicant who applies again is a NEW applicant: the erased row is not revived, re-acked or re-consented", async () => {
  const W = "team-erasure-reapply";
  const job = openJob("afe-reapply-job", W);
  const acked: string[] = [];
  const first = await file(job, W, "Jana Novakova", "jana@example.invalid", acked);
  assert.equal(first.kind, "created");
  const erasedId = first.entry.id;
  ensureDb().prepare(`UPDATE pipeline_entries SET status = 'rejected' WHERE id = ?`).run(erasedId);
  anonymizeEntry(erasedId, "erasure", W);
  const consentBefore = listConsentEvents(erasedId, W).length;
  acked.length = 0;

  const again = await file(job, W, "Jana Novakova", "jana@example.invalid", acked);
  assert.equal(again.kind, "created", "a new application, not a repeat onto the erased row");
  assert.notEqual(again.entry.id, erasedId, "a NEW entry id");

  const erased = getPipelineEntry(erasedId, W);
  assert.equal(erased?.contact ?? null, null, "the address is not backfilled onto the erased row");
  assert.equal(erased?.status, "rejected", "the erased row is not flipped back to active");
  assert.ok(
    !listPipelineEventsForEntry(erasedId, 50, W).some((e) => e.kind === "re_applied"),
    "the erased row gains no re_applied event"
  );
  assert.equal(listConsentEvents(erasedId, W).length, consentBefore, "no consent is renewed on the erased row");
  assert.ok(!acked.includes(erasedId), "no acknowledgement is prepared for the erased row");
  assert.deepEqual(acked, [again.entry.id], "the new application is acknowledged, once");
});

test("a LEGACY erased row (email-bearing id, no applicant_key) stays untouched when the same address files again", async () => {
  const job = openJob("job-1", DEFAULT_WORKSPACE_ID);
  // The pre-change shape, minted through the candidateId-keyed path that still exists:
  // id `m-<key>-<job>` with the key being the old applyDedupeKey output.
  const { entry: legacy } = createPipelineEntry({
    candidateId: "appl-tomas-example-invalid",
    candidateLabel: "Tomas Example",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    contact: "tomas@example.invalid",
    sourceChannel: "apply",
    workspaceId: DEFAULT_WORKSPACE_ID,
  });
  assert.equal(legacy.id, "m-appl-tomas-example-invalid-job-1", "fixture: the legacy id shape");
  anonymizeEntry(legacy.id, "erasure", DEFAULT_WORKSPACE_ID);
  const snapshot = rawRow(legacy.id);
  assert.equal(snapshot?.contact, null);
  assert.equal(snapshot?.applicant_key ?? null, null);
  assert.ok(snapshot?.anonymized_at, "fixture: the legacy row is erased");
  const acked: string[] = [];

  const out = await file(job, DEFAULT_WORKSPACE_ID, "Tomas Example", "tomas@example.invalid", acked, "channel");
  assert.equal(out.kind, "created", "a fresh application");
  assert.notEqual(out.entry.id, legacy.id, "a fresh random id, not the regenerated legacy one");
  assert.ok(!out.entry.id.includes("tomas"), "and it carries no PII");
  assert.deepEqual(rawRow(legacy.id), snapshot, "the legacy row is byte-identical");
  assert.ok(!listPipelineEventsForEntry(legacy.id, 50, DEFAULT_WORKSPACE_ID).some((e) => e.kind === "re_applied"));
  assert.ok(!acked.includes(legacy.id), "no ack for the legacy row");
});

test("an erased row's MASKED label is not an identity: a same-named, address-less applicant files fresh", async () => {
  const W = "team-erasure-mask";
  const job = openJob("afe-mask-job", W);
  const first = await file(job, W, "Jana Novakova", null, []);
  assert.equal(first.kind, "created");
  const erased = anonymizeEntry(first.entry.id, "erasure", W);
  assert.ok(erased?.candidateLabel, "precondition: the label is masked");
  const acked: string[] = [];
  const again = await file(job, W, erased.candidateLabel, null, acked, "channel");
  assert.equal(again.kind, "created", "the masked label of an erased row never matches a new applicant");
  assert.ok(!acked.includes(first.entry.id));
});
