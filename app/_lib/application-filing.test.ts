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
import { applicantKey } from "./applicant-key.ts";

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
    applicantKey: applicantKey("Tomas Stub", "tomas@example.invalid"),
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
    applicantKey: applicantKey("Tomas Stub", "other@example.invalid"),
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
    applicantKey: applicantKey("Dana Known", null),
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
// 6b. Proof 'token' — the proven merge, the only repeat that may rebuild
// ---------------------------------------------------------------------------

test("proof 'token': the proven merge backfills, REBUILDS the profile over the stub, in the entry's own workspace", async () => {
  const W = "team-token-merge";
  const job = openJob("af-token-job", W);
  const { entry: stub } = createPipelineEntry({
    candidateId: "lead-token-stub",
    candidateLabel: "Ema Lead",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    applicantKey: applicantKey("Ema Lead", null),
    contact: null,
    intakeDegraded: true,
    intakeDegradedReason: "lead pending",
    sourceChannel: "quick-apply",
    workspaceId: W,
  });
  const calls: BuildCall[] = [];
  const consentBefore = listConsentEvents(stub.id, W).length;
  const defaultProfilesBefore = profileCount(DEFAULT_WORKSPACE_ID);

  const out = await fileApplication({
    job,
    workspaceId: W,
    // The typed name/email need not match: the TOKEN is the identity.
    name: "Ema L.",
    email: "ema@example.invalid",
    githubHandle: "ema-codes",
    locale: "cs",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "token",
    tokenEntry: stub,
    answers: { skills: "Go", cvText: "Full CV" },
    buildProfile: recordingBuilder(calls),
    sendAck: false,
  });

  assert.equal(out.kind, "duplicate");
  assert.ok(out.kind === "duplicate" && out.merged, "a proven repeat is a merge");
  assert.equal(out.entry.id, stub.id);
  assert.equal(calls.length, 1, "the proven walk rebuilds the profile");
  assert.equal(calls[0].intoProfileId, "lead-token-stub", "…INTO the entry's own profile id");
  assert.equal(calls[0].workspaceId, W, "…in the entry's workspace");
  assert.equal(calls[0].locale, "cs");
  const after = getPipelineEntry(stub.id, W);
  assert.ok(after);
  assert.equal(after.contact, "ema@example.invalid", "contact backfilled");
  assert.equal(after.githubHandle, "ema-codes", "handle backfilled");
  assert.equal(after.intakeDegraded, false, "the stub is recovered");
  assert.ok(getProfileRecord(after.candidateId ?? "", W), "the rebuilt profile is findable in W");
  assert.equal(profileCount(DEFAULT_WORKSPACE_ID), defaultProfilesBefore, "nothing leaked into the default workspace");
  assert.equal(listConsentEvents(stub.id, W).length, consentBefore + 1, "consent refreshed once");
  assert.ok(out.kind === "duplicate" && out.rebuilt?.ok, "the outcome carries the rebuild for the door's gap follow-up");
  assert.ok(listPipelineEventsForEntry(stub.id, 50, W).some((e) => e.kind === "re_applied"), "the repeat is recorded");
});

test("proof 'channel': a repeat backfills a missing contact but never builds", async () => {
  const W = "team-channel-backfill";
  const job = openJob("af-channel-job", W);
  const { entry: stub } = createPipelineEntry({
    candidateId: "profile-channel",
    candidateLabel: "Ota Kanal",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    applicantKey: applicantKey("Ota Kanal", null),
    contact: null,
    sourceChannel: "email",
    workspaceId: W,
  });
  const calls: BuildCall[] = [];
  const out = await fileApplication({
    job,
    workspaceId: W,
    name: "Ota Kanal",
    email: "ota@example.invalid",
    locale: "en",
    sourceChannel: "email",
    channelLabel: "inbound CV",
    proof: "channel",
    answers: { skills: "", cvText: "a CV" },
    buildProfile: recordingBuilder(calls),
    sendAck: false,
  });
  assert.equal(out.kind, "duplicate");
  assert.equal(calls.length, 0, "a channel repeat never rebuilds");
  const after = getPipelineEntry(stub.id, W);
  assert.equal(after?.contact, "ota@example.invalid", "fill-only contact backfill");
  assert.equal(after?.candidateId, "profile-channel", "the profile is not re-pointed");
});

test("the dedupe backstop race is the same applicant: it refreshes consent and records the repeat even at proof 'none'", async () => {
  const W = "team-race";
  const job = openJob("af-race-job", W);
  const calls: BuildCall[] = [];
  // The concurrent first filing: same applicant key the core derives, but invisible to
  // findApplicationByApplicant (a different stored label + no contact).
  const { entry: first } = createPipelineEntry({
    candidateId: "profile-race",
    candidateLabel: "Somebody Else",
    jobId: job.id,
    jobTitle: job.title,
    stage: "Accepted",
    applicantKey: applicantKey("Rita Race", "rita.race@example.invalid"),
    contact: "other@example.invalid",
    sourceChannel: "apply",
    workspaceId: W,
  });
  const consentBefore = listConsentEvents(first.id, W).length;
  const out = await fileApplication({
    job,
    workspaceId: W,
    name: "Rita Race",
    email: "rita.race@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "none",
    answers: { skills: "", cvText: "" },
    buildProfile: recordingBuilder(calls),
    sendAck: false,
  });
  if (out.kind === "duplicate" && out.raced) {
    assert.equal(listConsentEvents(first.id, W).length, consentBefore + 1, "the raced filing still records consent once");
    assert.ok(listPipelineEventsForEntry(first.id, 50, W).some((e) => e.kind === "re_applied"));
  } else {
    // The derived key did not collide with this fixture's; the race is then untestable
    // here, which the assertion below makes loud rather than vacuous.
    assert.fail(`expected the dedupe backstop to catch the race, got ${out.kind}`);
  }
});

// ---------------------------------------------------------------------------
// Tenancy on the lead door (the conversational door's is pinned by the route test
// app/api/apply/[id]/filing-core-door.test.ts, over the real handler)
// ---------------------------------------------------------------------------

test("lead door: the webhook's workspace override carries the entry, its consent and its events", async () => {
  const W = "team-lead-webhook";
  // The job is owned by the DEFAULT team; the webhook belongs to W.
  const job = openJob("af-lead-tenant-job", DEFAULT_WORKSPACE_ID);
  const out = await intakeLead({
    job,
    workspaceId: W,
    name: "Hana Webhook",
    email: "hana@example.invalid",
    locale: "en",
    sourceChannel: "boards",
    channelLabel: "boards webhook",
    failedKoIds: [],
    enrichLink: "https://kp.example.invalid/apply/af-lead-tenant-job?lang=en",
  });
  assert.equal(out.result, "accepted");
  const entryId = out.result === "accepted" ? out.entryId : "";
  assert.ok(getPipelineEntry(entryId, W), "filed in the webhook's workspace");
  assert.equal(getPipelineEntry(entryId, DEFAULT_WORKSPACE_ID), null, "not in the job owner's");
  assert.equal(listConsentEvents(entryId, W).length, 1, "consent in W");
  assert.ok(out.result === "accepted" && out.leadToken, "the lead token is minted on the entry");
  const again = await intakeLead({
    job,
    workspaceId: W,
    name: "Hana Webhook",
    email: "hana@example.invalid",
    locale: "en",
    sourceChannel: "boards",
    channelLabel: "boards webhook",
    failedKoIds: [],
    enrichLink: "https://kp.example.invalid/apply/af-lead-tenant-job?lang=en",
  });
  assert.ok(again.result === "accepted" && again.duplicate && again.entryId === entryId, "the repeat resolves in W");
  assert.equal(again.result === "accepted" ? again.leadToken : null, out.result === "accepted" ? out.leadToken : "", "same token");
  assert.equal(listConsentEvents(entryId, W).length, 2, "the channel repeat refreshes consent in W");
});

// ---------------------------------------------------------------------------
// 7. The contract lives in one place
// ---------------------------------------------------------------------------

const DOORS = {
  core: "application-filing.ts",
  cv: "cv-intake.ts",
  lead: "lead-intake.ts",
  apply: "../api/apply/[id]/route.ts",
  quick: "../api/apply/[id]/quick/route.ts",
} as const;
const src = (rel: string) => readFileSync(path.join(HERE, rel), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

test("source guard: every door files through fileApplication", () => {
  // Three doors call the core directly; the quick form reaches it through the lead core.
  for (const door of [DOORS.cv, DOORS.lead, DOORS.apply]) {
    assert.match(src(door), /await fileApplication\(\{/, `${door} files through the core`);
  }
  assert.match(src(DOORS.quick), /await intakeLead\(\{/, "the quick door files through the lead core…");
  assert.match(src(DOORS.lead), /await fileApplication\(\{/, "…which files through the core");
});

test("source guard: the filing writes, the entry-stage rule, consent and the status-link mint exist ONCE, in the core", () => {
  const core = src(DOORS.core);
  assert.match(core, /createPipelineEntry\(/, "the core files the entry");
  assert.match(core, /mergeReapplication\(/, "the core merges a repeat");
  assert.match(core, /findApplicationByApplicant\(/, "the core resolves identity");
  assert.match(core, /buildApplicantProfile/, "the core builds the profile");
  const stageRule = /stageWithRole\("entry", getPipelineAxis\(workspaceId\)\.stages\) \?\? "Accepted"/g;
  const consent = /recordEntryConsent\(/g;
  const mint = /getOrCreateStatusLink\(/g;
  assert.equal(count(core, stageRule), 1, "the entry-column rule, once");
  assert.equal(count(core, consent), 1, "the best-effort consent block, once");
  assert.equal(count(core, mint), 1, "the best-effort status-link mint, once");
  for (const door of [DOORS.cv, DOORS.lead, DOORS.apply, DOORS.quick]) {
    const s = src(door);
    assert.equal(count(s, stageRule), 0, `${door} carries no copy of the entry-stage rule`);
    assert.equal(count(s, consent), 0, `${door} records consent only through the core`);
    assert.equal(count(s, mint), 0, `${door} mints the status link only through the core`);
    assert.doesNotMatch(s, /createPipelineEntry\(/, `${door} must file through the core`);
    assert.doesNotMatch(s, /mergeReapplication\(/, `${door} must merge through the core`);
    assert.doesNotMatch(s, /buildApplicantProfile\(/, `${door} must build the profile through the core (which always passes the tenant)`);
    assert.doesNotMatch(s, /function safeStatus(Link|Token)\(/, `${door} keeps no private status-link mint`);
  }
});

test("source guard: the core hands the builder the tenant and the locale on BOTH builds, and never dedupes on the label", () => {
  const core = src(DOORS.core);
  assert.match(core, /await build\(job, answers, null, workspaceId, locale\)/, "the first build carries tenant + locale");
  assert.match(core, /await build\(job, answers, existing\.candidateId, workspaceId, locale\)/, "the proven rebuild carries them too");
  assert.doesNotMatch(core, /build\(job, [^)]*\)(?<!workspaceId, locale\))/, "no tenant-less build shape");
  assert.match(core, /applicantKey: applicantKey\(providedName, email\)/, "keyed on the PROVIDED name");
  assert.doesNotMatch(core, /applicantKey\(label/, "the anonymous label is never a key");
  assert.doesNotMatch(core, /dedupeKey|applyDedupeKey/, "the email-bearing id key is gone");
});

// ---------------------------------------------------------------------------
// Legacy identity (challenge r06 candidate-apply-flow/A): rows filed before the
// surrogate id carry an email-bearing id and NO applicant_key. The contact lookup
// still finds them, so a live legacy applicant is still one person.
// ---------------------------------------------------------------------------

test("a legacy row (email-bearing id, no applicant_key) is still the applicant's entry: a new filing is a duplicate onto it", async () => {
  const job = openJob("job-1", DEFAULT_WORKSPACE_ID);
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
  const calls: BuildCall[] = [];
  const out = await fileApplication({
    job,
    workspaceId: DEFAULT_WORKSPACE_ID,
    name: "Tomas Example",
    email: "tomas@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    proof: "none",
    answers: { skills: "", cvText: "" },
    buildProfile: recordingBuilder(calls),
    sendAck: false,
  });
  assert.equal(out.kind, "duplicate");
  assert.equal(out.entry.id, legacy.id, "identity lookup unchanged");
  assert.equal(calls.length, 0, "resolved before any build");
  assert.equal(listEntriesForJob(job.id, DEFAULT_WORKSPACE_ID).length, 1, "no second row");
});
