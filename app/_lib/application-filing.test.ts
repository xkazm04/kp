// The application-filing core (application-filing.ts) — the ONE place a door files an
// applicant: tenant, name hygiene, identity BEFORE any profile build, the profile build
// carrying the tenant + locale, the entry at the axis's ENTRY column, consent, and the
// acknowledgement. These cases were live defects on the headless CV door
// (cv-intake.ts), which filed on its own:
//
//   1. TENANT SPLIT — the entry went to the job/webhook's workspace while the profile
//      was saved into the DEFAULT one (buildApplicantProfile got no workspaceId), so
//      the recruiter found no profile behind the applicant and Match never saw them.
//   2. BUILD-THEN-DEDUPE — the CV door built + saved a profile and only then let
//      createPipelineEntry's dedupe hand back the existing row: an orphan profile.
//   3. ANONYMOUS COLLAPSE — "" became the "Applicant" label and the label became the
//      dedupe key ("appl-applicant"), so two nameless, email-less CVs merged.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import. The
// profile builder is injected, so nothing spawns Python.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { fileApplication, type ProfileBuilder } from "./application-filing.ts";
import { ingestCvApplication } from "./cv-intake.ts";
import { intakeLead } from "./lead-intake.ts";
import { insertJob } from "./job-ingest.ts";
import { getJob } from "./db/jobs.ts";
import { createPipelineEntry, getPipelineEntry, listConsentEvents, listEntriesForJob, listPipelineEventsForEntry } from "./db/pipeline.ts";
import { getProfileRecord, saveProfile } from "./db/profiles.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { ensureDb } from "./db/core.ts";

after(() => cleanupUnitDb());

const HERE = path.dirname(fileURLToPath(import.meta.url));

type BuildCall = { workspaceId: string | undefined; locale: string | undefined; intoProfileId: string | null | undefined };

/** A builder that behaves like buildApplicantProfile's persistence half: it saves the
 *  profile into WHATEVER workspace it is handed — so a missing tenant shows up as a
 *  profile in the default workspace, exactly like the real one. */
function recordingBuilder(calls: BuildCall[], outcome: "ok" | "fail" = "ok"): ProfileBuilder {
  return async (_job, answers, intoProfileId, workspaceId, locale) => {
    calls.push({ workspaceId, locale, intoProfileId });
    if (outcome === "fail") return { ok: false, reason: "normalizer unavailable" };
    const saved = saveProfile(
      { label: answers.name, archetype: "backend", roleFamily: null, completeness: 60, payload: { displayName: answers.name } },
      workspaceId
    );
    return { ok: true, id: saved.id, archetype: "backend", missingGaps: [] };
  };
}

function profileCount(workspaceId: string): number {
  return (ensureDb().prepare(`SELECT COUNT(*) AS c FROM profiles WHERE workspace_id = ?`).get(workspaceId) as { c: number }).c;
}

function openJob(id: string, workspaceId: string) {
  insertJob({ id, title: `Role ${id}` } as never, undefined, "published", workspaceId);
  const job = getJob(id);
  assert.ok(job, `precondition: job ${id} exists`);
  return job;
}

// ---------------------------------------------------------------------------
// 1. Tenant
// ---------------------------------------------------------------------------

test("CV door: the profile is filed into the SAME non-default workspace as the entry", async () => {
  const W = "team-cv-owner";
  const job = openJob("af-tenant-job", W);
  const calls: BuildCall[] = [];
  const defaultBefore = profileCount(DEFAULT_WORKSPACE_ID);

  const out = await ingestCvApplication({
    job,
    name: "Petra Nováková",
    email: "petra@example.invalid",
    cvText: "Senior backend engineer, 8 years of Go and Postgres.",
    sourceChannel: "email",
    locale: "cs",
    sendAck: false,
    workspaceId: W,
    buildProfile: recordingBuilder(calls),
  });

  assert.equal(out.created, true);
  const entry = getPipelineEntry(out.entryId, W);
  assert.ok(entry, "the entry is filed in W");
  assert.ok(getProfileRecord(entry.candidateId ?? "", W), "the entry's profile is findable in W — the recruiter's own tenant");
  assert.equal(profileCount(DEFAULT_WORKSPACE_ID), defaultBefore, "nothing leaked into the default workspace");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workspaceId, W, "the builder is handed the tenant explicitly");
  assert.equal(calls[0].locale, "cs", "…and the applicant's locale");
});

// ---------------------------------------------------------------------------
// 2. Identity before build (and the tightened merge path)
// ---------------------------------------------------------------------------

test("CV door: a repeat by email resolves to the existing entry BEFORE any profile is built", async () => {
  const W = "team-cv-dupe";
  const job = openJob("af-dupe-job", W);
  // The quick-apply stub the CV repeats onto, and a bystander on the same job.
  const { entry: stub } = createPipelineEntry({
    candidateId: "lead-stub-1",
    candidateLabel: "Tomas Stub",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    dedupeKey: "appl-tomas-example-invalid",
    contact: "tomas@example.invalid",
    intakeDegraded: true,
    sourceChannel: "quick-apply",
    workspaceId: W,
  });
  const { entry: bystander } = createPipelineEntry({
    candidateId: "lead-bystander-1",
    candidateLabel: "Tomas Stub", // SAME name, different address: a different person
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    dedupeKey: "appl-other-example-invalid",
    contact: "other@example.invalid",
    sourceChannel: "quick-apply",
    workspaceId: W,
  });
  const calls: BuildCall[] = [];
  const profilesBefore = profileCount(W);
  const entriesBefore = listEntriesForJob(job.id, W).length;
  const stubConsentBefore = listConsentEvents(stub.id, W).length;
  const bystanderConsentBefore = listConsentEvents(bystander.id, W).length;
  const bystanderEventsBefore = listPipelineEventsForEntry(bystander.id, 50, W).length;

  const out = await ingestCvApplication({
    job,
    name: "Tomas Stub",
    email: "TOMAS@example.invalid ", // normalized identity, not a byte match
    cvText: "Full CV text",
    sourceChannel: "email",
    locale: "en",
    sendAck: false,
    workspaceId: W,
    buildProfile: recordingBuilder(calls),
  });

  assert.equal(out.created, false, "the outcome is a duplicate");
  assert.equal(out.entryId, stub.id, "…of the entry holding that ADDRESS, not the same-named bystander");
  assert.equal(calls.length, 0, "no profile is built for a known applicant");
  assert.equal(profileCount(W), profilesBefore, "no orphan profile row");
  assert.equal(listEntriesForJob(job.id, W).length, entriesBefore, "no second entry");
  // The merge landed on the right row, and only there.
  assert.equal(listConsentEvents(stub.id, W).length, stubConsentBefore + 1, "the matched entry's consent is refreshed exactly once");
  assert.equal(listConsentEvents(bystander.id, W).length, bystanderConsentBefore, "the bystander's consent is untouched");
  assert.equal(listPipelineEventsForEntry(bystander.id, 50, W).length, bystanderEventsBefore, "nothing is written onto the bystander's timeline");
  assert.ok(
    listPipelineEventsForEntry(stub.id, 50, W).some((e) => e.kind === "re_applied"),
    "the repeat is recorded on the matched entry"
  );
  const after = getPipelineEntry(stub.id, W);
  assert.equal(after?.candidateId, "lead-stub-1", "a channel-proved repeat never re-points the stored profile");
});

// ---------------------------------------------------------------------------
// 3. The anonymous label is never an identity
// ---------------------------------------------------------------------------

test("CV door: two nameless, email-less CVs are two applicants", async () => {
  const W = "team-cv-anon";
  const job = openJob("af-anon-job", W);
  const calls: BuildCall[] = [];
  const input = {
    job,
    name: "   ",
    email: null,
    cvText: "An unsigned CV",
    sourceChannel: "email",
    locale: "en",
    sendAck: false,
    workspaceId: W,
    buildProfile: recordingBuilder(calls),
  };
  const first = await ingestCvApplication(input);
  const second = await ingestCvApplication(input);

  assert.equal(first.created, true);
  assert.equal(second.created, true, "the second anonymous CV is a NEW applicant");
  assert.notEqual(first.entryId, second.entryId);
  assert.equal(listEntriesForJob(job.id, W).length, 2);
  assert.equal(first.candidateLabel, "Applicant", "the fallback stays a display label");
});

// ---------------------------------------------------------------------------
// 4 + 5. Entry column and consent, on every door the core serves
// ---------------------------------------------------------------------------

test("every door files at the workspace axis's ENTRY column and records consent exactly once", async () => {
  const W = "team-inbox-axis";
  setDecisionConfig(
    "pipelineStages",
    {
      stages: [
        { id: "Inbox", label: "Inbox", role: "entry" },
        { id: "Screened", label: "Screened", role: "screening" },
        { id: "Interview", label: "Interview", role: "interview" },
        { id: "Offer", label: "Offer", role: "offer" },
        { id: "Hired", label: "Hired", role: "terminal" },
      ],
      retired: [],
    },
    W
  );
  const job = openJob("af-axis-job", W);

  const viaCore = await fileApplication({
    job,
    workspaceId: W,
    name: "Core Door",
    email: "core@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "none",
    answers: { skills: "", cvText: "" },
    buildProfile: recordingBuilder([]),
    sendAck: false,
  });
  assert.equal(viaCore.kind, "created");

  const viaCv = await ingestCvApplication({
    job,
    name: "Cv Door",
    email: "cv@example.invalid",
    cvText: "CV",
    sourceChannel: "email",
    locale: "en",
    sendAck: false,
    workspaceId: W,
    buildProfile: recordingBuilder([], "fail"), // a degraded build still lands in the entry column
  });

  const viaLead = await intakeLead({
    job,
    workspaceId: W,
    name: "Lead Door",
    email: "lead@example.invalid",
    locale: "en",
    sourceChannel: "quick-apply",
    channelLabel: "quick apply",
    failedKoIds: [],
    enrichLink: "https://kp.example.invalid/apply/af-axis-job?lang=en",
  });
  assert.equal(viaLead.result, "accepted");

  const ids = [viaCore.entry.id, viaCv.entryId, viaLead.result === "accepted" ? viaLead.entryId : ""];
  for (const id of ids) {
    const entry = getPipelineEntry(id, W);
    assert.ok(entry, `entry ${id} exists in W`);
    assert.equal(entry.stage, "Inbox", `${entry.sourceChannel} lands in this board's entry column`);
    assert.equal(listConsentEvents(id, W).length, 1, `${entry.sourceChannel} records consent exactly once on a fresh filing`);
  }
});

// ---------------------------------------------------------------------------
// 6. No proof, no write
// ---------------------------------------------------------------------------

test("proof 'none': a name+email match moves nothing on the matched entry", async () => {
  const W = DEFAULT_WORKSPACE_ID;
  const job = openJob("af-none-job", W);
  const { entry: victim } = createPipelineEntry({
    candidateId: "profile-victim",
    candidateLabel: "Dana Known",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    dedupeKey: "apply-dana-known",
    contact: null,
    sourceChannel: "apply",
    workspaceId: W,
  });
  const calls: BuildCall[] = [];
  const eventsBefore = listPipelineEventsForEntry(victim.id, 50, W).length;
  const consentBefore = listConsentEvents(victim.id, W).length;

  const out = await fileApplication({
    job,
    workspaceId: W,
    name: "Dana Known",
    email: "attacker@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "none",
    answers: { skills: "", cvText: "poisoned CV" },
    buildProfile: recordingBuilder(calls),
    sendAck: false,
  });

  assert.equal(out.kind, "duplicate");
  assert.equal(out.entry.id, victim.id);
  assert.equal(out.kind === "duplicate" && out.merged, false, "an unproven repeat is not a merge");
  assert.equal(calls.length, 0, "no profile is built over the matched person");
  const after = getPipelineEntry(victim.id, W);
  assert.equal(after?.contact, null, "the contact is not backfilled");
  assert.equal(after?.candidateId, "profile-victim");
  assert.equal(listPipelineEventsForEntry(victim.id, 50, W).length, eventsBefore, "no timeline write");
  assert.equal(listConsentEvents(victim.id, W).length, consentBefore, "no consent refresh");
});

// ---------------------------------------------------------------------------
// 7. The contract lives in one place
// ---------------------------------------------------------------------------

test("source guard: the filing writes live in the core, not in the doors it serves", () => {
  const core = readFileSync(path.join(HERE, "application-filing.ts"), "utf8");
  assert.match(core, /createPipelineEntry\(/, "the core files the entry");
  assert.match(core, /recordEntryConsent\(/, "the core records consent");
  assert.match(core, /stageWithRole\("entry", getPipelineAxis\(workspaceId\)\.stages\) \?\? "Accepted"/, "the entry-column rule lives here");
  for (const door of ["cv-intake.ts"]) {
    const src = readFileSync(path.join(HERE, door), "utf8");
    assert.doesNotMatch(src, /createPipelineEntry\(/, `${door} must file through the core`);
    assert.doesNotMatch(src, /recordEntryConsent\(/, `${door} must record consent through the core`);
    assert.doesNotMatch(src, /buildApplicantProfile\(/, `${door} must build the profile through the core (which always passes the tenant)`);
  }
});
