// W1.1 — the inbound WRITER: mapped ATS applications onto the board, keyed on the
// vendor's id (challenge-r05 ats-sync-egress/B).
//
// Before this module the inbound half had a validated mapper (applyFieldMap), a stored
// connection with a shipped Recruitee default map, and a per-tenant link table — and no
// writer used any of it. These cases pin the writer's contract:
//
//   1. a first import files ONE entry, through the application-filing core, at the
//      stage the connection's map names on the workspace's own axis, and links it;
//   2. a re-sync is idempotent: same entry, no new rows, only the link's bookkeeping moves;
//   3. links are per tenant — the same vendor id in another workspace is another entry;
//   4. an ERASED person is never refilled — neither through their surviving link nor
//      through the filing core's dedupe landing on the scrubbed row;
//   5. a vendor payload can never place anyone on the TERMINAL column;
//   6. one bad record is refused on its own, the batch goes on;
//   7. a missing/disabled connection or a job outside the caller's team refuses the call.
//
// Real throwaway DB: testing/unit-db.ts must stay the FIRST project import.
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { insertJob } from "../job-ingest.ts";
import { anonymizeEntry, getPipelineEntry, listEntriesForJob } from "../db/pipeline.ts";
import { createWorkspace } from "../db/workspaces.ts";
import { ATS_PROVIDERS, deleteAtsConnection, setAtsConnection } from "./connections-store.ts";
import { deleteAtsLinksForEntry, deleteAtsLinksForProviderEverywhere, findAtsLink } from "./links-store.ts";
import { ingestAtsApplications } from "./ingest.ts";

let W: string;
let W2: string;

function ownJob(id: string, workspaceId: string): string {
  insertJob({ id, title: `Role ${id}` } as never, undefined, "published", workspaceId);
  return id;
}

/** The Recruitee shape the shipped default map reads (field-map.ts DEFAULT_FIELD_MAPS). */
function recruitee(id: number | string | null, over: { name?: string; email?: string; stage?: string } = {}) {
  return {
    ...(id === null ? {} : { id }),
    candidate: { name: over.name ?? `Applicant ${id}`, emails: [over.email ?? `applicant-${id}@example.invalid`] },
    stage: { name: over.stage ?? "1st round" },
    offer: { id: 55, title: "Vendor title" },
    created_at: "2026-09-01T10:00:00Z",
  };
}

before(() => {
  W = createWorkspace("ATS ingest team A").id;
  W2 = createWorkspace("ATS ingest team B").id;
});

beforeEach(() => {
  for (const p of ATS_PROVIDERS) {
    deleteAtsConnection(p);
    deleteAtsLinksForProviderEverywhere(p);
  }
  // No fieldMap → the connection stores the shipped Recruitee default map.
  setAtsConnection({ provider: "recruitee", enabled: true });
});

after(() => cleanupUnitDb());

test("a first import files one entry at the mapped stage and links the vendor id to it", async () => {
  const J = ownJob("ats-ingest-first", W);
  const out = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(907)] });

  assert.equal(out.results.length, 1);
  const [r] = out.results;
  assert.equal(r.externalId, "907");
  assert.equal(r.outcome, "created");
  assert.ok(r.entryId);
  assert.equal(out.counts.created, 1);

  const entries = listEntriesForJob(J, W);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, r.entryId);
  assert.equal(entries[0].stage, "Interview", "the default map binds '1st round' to Interview");
  assert.equal(entries[0].workspaceId, W);
  assert.equal(entries[0].contact, "applicant-907@example.invalid");

  const link = findAtsLink("recruitee", "907", W);
  assert.equal(link?.entryId, r.entryId);
  assert.equal(link?.lastSeenStage, "1st round");
});

test("the vendor's free text is cleaned before it reaches the board or the link", async () => {
  const J = ownJob("ats-ingest-hygiene", W);
  const out = await ingestAtsApplications({
    provider: "recruitee",
    jobId: J,
    workspaceId: W,
    records: [recruitee(912, { name: "<b>Jana</b> [Nováková](https://evil.example)", stage: "<i>1st round</i>" })],
  });
  assert.equal(out.results[0].outcome, "created");
  const entry = getPipelineEntry(out.results[0].entryId!, W);
  assert.equal(entry?.candidateLabel, "Jana Nováková");
  assert.equal(findAtsLink("recruitee", "912", W)?.lastSeenStage, "1st round");
});

test("the same payload again is 'unchanged': no new entry, same binding, refreshed sync time", async () => {
  const J = ownJob("ats-ingest-resync", W);
  const first = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(908)] });
  const before = findAtsLink("recruitee", "908", W);
  await new Promise((r) => setTimeout(r, 5));

  const again = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(908)] });
  assert.equal(again.results[0].outcome, "unchanged");
  assert.equal(again.results[0].entryId, first.results[0].entryId);
  assert.equal(listEntriesForJob(J, W).length, 1);

  const after = findAtsLink("recruitee", "908", W);
  assert.equal(after?.entryId, before?.entryId);
  assert.ok(after!.lastSyncedAt > before!.lastSyncedAt, "the sync bookkeeping moved");
});

test("a vendor stage change is recorded on the link, never applied to the board", async () => {
  const J = ownJob("ats-ingest-stage-move", W);
  const first = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(913)] });
  const again = await ingestAtsApplications({
    provider: "recruitee",
    jobId: J,
    workspaceId: W,
    records: [recruitee(913, { stage: "Phone screen" })],
  });
  assert.equal(again.results[0].outcome, "unchanged");
  assert.equal(getPipelineEntry(first.results[0].entryId!, W)?.stage, "Interview", "kp owns its funnel");
  assert.equal(findAtsLink("recruitee", "913", W)?.lastSeenStage, "Phone screen");
});

test("links are per tenant: the same vendor id in another workspace is another entry", async () => {
  const JA = ownJob("ats-ingest-tenant-a", W);
  const JB = ownJob("ats-ingest-tenant-b", W2);
  const a = await ingestAtsApplications({ provider: "recruitee", jobId: JA, workspaceId: W, records: [recruitee(909)] });
  const linkA = findAtsLink("recruitee", "909", W);

  const b = await ingestAtsApplications({ provider: "recruitee", jobId: JB, workspaceId: W2, records: [recruitee(909)] });
  assert.equal(b.results[0].outcome, "created");
  assert.notEqual(b.results[0].entryId, a.results[0].entryId);
  assert.equal(getPipelineEntry(b.results[0].entryId!, W2)?.workspaceId, W2);
  assert.equal(getPipelineEntry(b.results[0].entryId!, W), null, "W2's entry is not readable from W");

  assert.deepEqual(findAtsLink("recruitee", "909", W), linkA, "W's link is untouched");
  assert.equal(findAtsLink("recruitee", "909", W2)?.entryId, b.results[0].entryId);
  assert.equal(listEntriesForJob(JA, W).length, 1);
});

test("a link whose entry was anonymized answers 'erased' and writes nothing", async () => {
  const J = ownJob("ats-ingest-erased-link", W);
  const first = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(910)] });
  const entryId = first.results[0].entryId!;
  anonymizeEntry(entryId, "erasure", W);
  const scrubbed = getPipelineEntry(entryId, W)!;
  const linkBefore = findAtsLink("recruitee", "910", W);

  const again = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(910)] });
  assert.equal(again.results[0].outcome, "erased");
  const now = getPipelineEntry(entryId, W)!;
  assert.equal(now.contact, null, "no contact refilled");
  assert.equal(now.candidateLabel, scrubbed.candidateLabel, "no name refilled");
  assert.equal(listEntriesForJob(J, W).length, 1, "no new entry");
  assert.deepEqual(findAtsLink("recruitee", "910", W), linkBefore, "the link outlives the scrub, untouched");
});

test("an erased person's scrubbed row is never refilled through the filing core", async () => {
  // The link is gone (a disconnect with forgetLinks), so the vendor id resolves nothing
  // and the record goes to the filing core. Erasure NULLed the row's applicant_key and
  // the entry id no longer derives from the address (challenge r06
  // candidate-apply-flow/A), so the core cannot land on the SCRUBBED row: the vendor
  // record files as a NEW entry, exactly as the ats_links erasure-exemption note says a
  // forgotten link does. That row must not get the person's contact back, and no link
  // may bind the vendor id to it. (Suppressing the re-import by the old email-bearing id
  // was an accident of keeping the address in a primary key after erasure.)
  const J = ownJob("ats-ingest-erased-dedupe", W);
  const first = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(914)] });
  const entryId = first.results[0].entryId!;
  anonymizeEntry(entryId, "erasure", W);
  deleteAtsLinksForEntry(entryId, W);

  const again = await ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(914)] });
  assert.equal(again.results[0].outcome, "created");
  assert.notEqual(again.results[0].entryId, entryId, "a separate entry, never the scrubbed row");
  assert.equal(getPipelineEntry(entryId, W)?.contact, null, "the scrubbed row keeps no contact");
  assert.notEqual(findAtsLink("recruitee", "914", W)?.entryId, entryId, "no link re-binds the vendor id to the erased row");
  assert.equal(listEntriesForJob(J, W).length, 2);
});

test("a vendor stage mapped to the terminal column (or unmapped) lands on the intake column", async () => {
  setAtsConnection({
    provider: "recruitee",
    fieldMap: {
      paths: { externalId: "id", displayName: "candidate.name", contact: "candidate.emails.0", externalStage: "stage.name" },
      stages: { hired: "Hired", "1st round": "Interview" },
    },
  });
  const J = ownJob("ats-ingest-terminal", W);
  const out = await ingestAtsApplications({
    provider: "recruitee",
    jobId: J,
    workspaceId: W,
    records: [recruitee(920, { stage: "Hired" }), recruitee(921, { stage: "Something we never mapped" })],
  });
  assert.deepEqual(
    out.results.map((r) => r.outcome),
    ["created", "created"]
  );
  for (const r of out.results) assert.equal(getPipelineEntry(r.entryId!, W)?.stage, "Accepted");
  assert.equal(findAtsLink("recruitee", "920", W)?.lastSeenStage, "Hired", "the vendor's own word is kept on the link");
  assert.equal(findAtsLink("recruitee", "921", W)?.lastSeenStage, "Something we never mapped");
});

test("a record with no external id is 'invalid' on its own; the rest of the batch lands", async () => {
  const J = ownJob("ats-ingest-invalid", W);
  const out = await ingestAtsApplications({
    provider: "recruitee",
    jobId: J,
    workspaceId: W,
    records: [recruitee(930), recruitee(null, { name: "Nobody", email: "nobody@example.invalid" }), "not an object", recruitee(931)],
  });
  assert.deepEqual(
    out.results.map((r) => r.outcome),
    ["created", "invalid", "invalid", "created"]
  );
  assert.equal(out.results[1].externalId, null);
  assert.equal(out.results[1].entryId, undefined);
  assert.equal(out.counts.invalid, 2);
  assert.equal(out.counts.created, 2);
  const labels = listEntriesForJob(J, W).map((e) => e.candidateLabel);
  assert.equal(labels.length, 2);
  assert.ok(!labels.includes("Nobody"), "nothing was written for the invalid record");
});

test("a missing or disabled connection, or a job outside the team, refuses the whole call with a code", async () => {
  const J = ownJob("ats-ingest-refusals", W);
  const foreign = ownJob("ats-ingest-foreign", W2);
  const code = async (p: Promise<unknown>): Promise<string | undefined> => {
    try {
      await p;
      return undefined;
    } catch (e) {
      return (e as { code?: string }).code;
    }
  };

  assert.equal(
    await code(ingestAtsApplications({ provider: "teamio", jobId: J, workspaceId: W, records: [recruitee(940)] })),
    "ATS_CONNECTION_NOT_FOUND"
  );
  setAtsConnection({ provider: "recruitee", enabled: false });
  assert.equal(
    await code(ingestAtsApplications({ provider: "recruitee", jobId: J, workspaceId: W, records: [recruitee(941)] })),
    "ATS_CONNECTION_NOT_FOUND"
  );
  setAtsConnection({ provider: "recruitee", enabled: true });
  assert.equal(
    await code(ingestAtsApplications({ provider: "recruitee", jobId: foreign, workspaceId: W, records: [recruitee(942)] })),
    "ATS_IMPORT_JOB_NOT_FOUND"
  );
  assert.equal(
    await code(ingestAtsApplications({ provider: "recruitee", jobId: "no-such-job", workspaceId: W, records: [recruitee(943)] })),
    "ATS_IMPORT_JOB_NOT_FOUND"
  );
  assert.equal(listEntriesForJob(J, W).length, 0);
  assert.equal(listEntriesForJob(foreign, W2).length, 0);
  for (const id of ["940", "941", "942", "943"]) assert.equal(findAtsLink("recruitee", id, W), null);
});
