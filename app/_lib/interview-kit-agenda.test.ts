// The JOB KIT as the spine of the interview (spark interview-kit-template, WP-B):
// what the agenda, the two briefs and the pinned link do once a job has one.
//
// Pinned here, DB-backed, because the whole point is a seam between stores — the kit
// version a LINK pinned (interview_sessions.kit_id), the candidate's own prep, and the
// agenda both provider briefs are composed from:
//   - the pin at mint, and that a job with no kit mints exactly as it always did;
//   - the kit-spined agenda on every branch, including the work-sample debrief, which
//     KEEPS its authorship probes and only appends the kit's must-asks;
//   - the per-candidate CV probes riding on top, bounded;
//   - the overlay's three operations (dropped / edited / added);
//   - weights and must-asks reaching the PRIVATE brief and nothing else, and the kit
//     FAQ reaching ROLE FACTS in BOTH briefs, identically;
//   - a job with no kit producing today's agenda, field for field;
//   - a kit block's questions reaching the interviewer in the kit's authored order;
//   - ONE booked length for a kit-pinned interview, whichever surface asks for it.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry, getPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { createPosting, createSubmission, saveDevCase, saveDevCaseScenario, saveSubmissionEvaluation } from "./db/devcase.ts";
import { createInterviewSession, getInterviewSessionById } from "./db/interviews.ts";
import { interviewKitAppendVersion } from "./db/interview-kits.ts";
import { getInterviewPrep, saveInterviewPrep } from "./interview-prep.ts";
import { insertJob } from "./job-ingest.ts";
import { buildRunOfShow, MAX_DURATION_MIN, MIN_DURATION_MIN } from "./run-of-show.ts";
import { interviewBriefStrings, rosStrings } from "./interview-prep-strings.ts";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT } from "./student-interview.ts";
import {
  applyKitOverlay,
  buildInterviewKit,
  buildKitOnlyInterviewKit,
  cvProbeId,
  kitBookedMin,
  MAX_KIT_CV_PROBES,
  toCandidateAgendaView,
  type InterviewKit,
} from "./interview-agenda.ts";
import { getJobWorkspace } from "./db/jobs.ts";
import { QUICK_SCREEN_MIN } from "./interview-duration.mjs";
import { plannedInterviewMinutes } from "./interview-planned-minutes.ts";
import { latestPublishedKit } from "./interview-kit.ts";
import { mintAndInviteVoiceScreen } from "./interview-invite.ts";
import { buildCandidateSafeBrief, buildGroundedInterview } from "./interview-run.ts";
import { EMPTY_KIT_OVERLAY, type InterviewKit as JobKit, type KitOverlay } from "./interview-kit-types.ts";
import type { InterviewAgenda } from "./voice/director-types.ts";

after(() => cleanupUnitDb());

let seq = 0;
const next = () => (seq += 1);

/** The authored kit every test spines with. Two competencies, one must-ask, one
 *  follow-up, one FAQ entry, and a note the interviewer never reads aloud. */
const KIT: JobKit = {
  version: 1,
  competencies: [
    {
      id: "c-strategy",
      title: "Test strategy",
      weight: 3,
      budgetMin: 6,
      questions: [
        { id: "q-first", text: "How do you decide what to automate first?", mustAsk: true },
        { id: "q-healthy", text: "What does a healthy suite look like to you?", mustAsk: false, followUp: "And an unhealthy one?" },
      ],
    },
    {
      id: "c-collab",
      title: "Collaboration",
      weight: 1,
      budgetMin: 4,
      questions: [{ id: "q-disagree", text: "Tell me about a disagreement with a developer.", mustAsk: false }],
    },
  ],
  faq: [{ id: "f-hybrid", question: "Is the team hybrid?", answer: "Two days in the Prague office, three remote." }],
  note: "Tone: curious, never a quiz. Never read aloud.",
};

const KIT_TITLES = ["Test strategy", "Collaboration"];

function publishKit(jobId: string, kit: JobKit = KIT): string {
  return interviewKitAppendVersion({ jobId, kit, source: "generated", status: "published" }).id;
}

const GAP_TOPIC = "Test automation fundamentals (missing must-have)";
const GOAL = "Listen for: risk-based ordering, not a checklist";
const RED_FLAG = "claims 8 skills, largely self-taught";

function job(description = "We build the test tooling every squad ships with.") {
  const n = next();
  return insertJob(
    { id: `job-kit-${n}`, title: "QA Engineer", company: "Acme", location: "Praha", workMode: "hybrid", description },
    undefined,
    "published"
  ).id;
}

/** An experienced candidate with a generated prep plan (the `prep` branch). */
async function prepEntry(opts: { imported?: string[]; questions?: number; overlay?: KitOverlay } = {}) {
  const n = next();
  const jobId = job();
  const { entry } = createPipelineEntry({
    candidateId: `cand-kit-${n}`,
    candidateLabel: `Kandidat ${n}`,
    jobId,
    jobTitle: "QA Engineer",
    locale: "en",
  });
  const qs = Array.from({ length: opts.questions ?? 1 }, (_, i) =>
    i === 0
      ? { competency: GAP_TOPIC, question: "Which tests would you write first?", whatsGoodLooksLike: GOAL, followUpIfAnswer: "What would you leave untested?" }
      : { competency: `Competency ${i + 1}`, question: `Question number ${i + 1}?`, whatsGoodLooksLike: GOAL }
  );
  const plan = buildRunOfShow(qs, ["automation"], entry.candidateLabel ?? null, "QA Engineer", await rosStrings("en"));
  saveInterviewPrep(entry.id, entry.candidateLabel ?? null, "QA Engineer", {
    ...plan,
    lang: "en",
    importedQuestions: opts.imported ?? [],
    ...(opts.overlay ? { kitOverlay: opts.overlay } : {}),
  });
  return { entryId: entry.id, jobId, workspaceId: entry.workspaceId };
}

/** A candidate who submitted a work sample: the debrief branch. */
function debriefEntry() {
  const n = next();
  const jobId = job();
  const posting = createPosting({ caseId: `case-kit-${n}`, channel: "local", token: `tok-kit-${n}`, roleTitle: "Backend", caseTitle: `Case ${n}` });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: `cand-kit-${n}`, repoRef: `repo-kit-${n}` });
  saveSubmissionEvaluation(
    submission.id,
    {
      evaluation: { summary: "ok", strengths: [], concerns: [], confidence: 0.8 },
      followups: {
        questions: [
          { decision: "Kept the ORM despite the N+1s", question: "What alternative did you consider before keeping the ORM?", listenFor: "trade-offs", redFlag: RED_FLAG },
          { decision: "No retries on the webhook", question: "Why no retries on the webhook?", listenFor: "failure modes" },
        ],
      },
    },
    80
  );
  const { entry } = createPipelineEntry({
    candidateId: `cand-kit-${n}`,
    candidateLabel: `K ${n}`,
    jobId,
    jobTitle: "Backend",
    locale: "en",
    devSubmissionId: submission.id,
  });
  return { entryId: entry.id, jobId };
}

/** An early-career candidate, with or without a designed case. */
function studentEntry(withCase: boolean) {
  const n = next();
  const jobId = job();
  let devCaseId: string | null = null;
  if (withCase) {
    devCaseId = saveDevCase({ need: {}, analysis: {}, role: { title: "Junior Backend" }, case: { title: `Case ${n}` } }).id;
    saveDevCaseScenario(devCaseId, DEMO_CASE_SCENARIO);
  }
  const { entry } = createPipelineEntry({
    candidateId: `stud-kit-${n}`,
    candidateLabel: `S ${n}`,
    jobId,
    jobTitle: "Junior Backend",
    archetype: "student",
    devCaseId,
  });
  return { entryId: entry.id, jobId };
}

/** The structural invariants the director relies on — the same ones the pre-kit
 *  agenda test pins, restated here so a kit-spined agenda cannot break them. */
function assertInvariants(agenda: InterviewAgenda) {
  assert.equal(agenda.version, 1);
  agenda.blocks.forEach((b, i) => assert.equal(b.id, `b${i}`, "ids are b0..bN in agenda order"));
  assert.equal(agenda.blocks.reduce((n, b) => n + b.budgetMin, 0), agenda.durationMin, "Σ budget == duration");
  assert.equal(agenda.hardCapMin, Math.round(agenda.durationMin * 1.2));
  const kinds = agenda.blocks.map((b) => b.kind);
  assert.equal(kinds[0], "warmup");
  assert.deepEqual(kinds.slice(-2), ["role_qa", "close"]);
  assert.equal(
    agenda.closeReserveMin,
    agenda.blocks[agenda.blocks.length - 2].budgetMin + agenda.blocks[agenda.blocks.length - 1].budgetMin
  );
  for (const b of agenda.blocks) {
    assert.equal(b.scored, b.kind === "topic" || b.kind === "open", `${b.id}: scored only for topic/open`);
    assert.ok(Number.isInteger(b.budgetMin) && b.budgetMin >= 1, `${b.id}: a whole, positive budget`);
    assert.doesNotMatch(b.title, /[([]/, `${b.id}: no bracketed annotation in the title`);
  }
}

const titles = (agenda: InterviewAgenda) => agenda.blocks.map((b) => b.title);

// ---- 1. the pin at mint ------------------------------------------------------------

test("a link is pinned to the kit version PUBLISHED when it was minted; a job with no kit pins nothing", async () => {
  const { entryId, jobId, workspaceId } = await prepEntry();
  const first = publishKit(jobId);
  assert.equal(latestPublishedKit(jobId, workspaceId)?.id, first);

  const minted = await mintAndInviteVoiceScreen({ entryId, workspaceId });
  assert.ok(minted.ok);
  assert.equal(minted.session.kitId, first, "the session carries the published kit's id");
  assert.equal(getInterviewSessionById(minted.session.id)?.kitId, first, "…and it is on the row, not just the return value");

  // A SECOND published version does not move an already-minted link.
  const second = publishKit(jobId, { ...KIT, note: "v2" });
  assert.notEqual(second, first);
  assert.equal(getInterviewSessionById(minted.session.id)?.kitId, first, "the pin does not follow the job's latest kit");
  const later = await mintAndInviteVoiceScreen({ entryId, workspaceId, force: true });
  assert.ok(later.ok);
  assert.equal(later.session.kitId, second, "a link minted afterwards pins the new version");

  // A job with no kit mints exactly as it always did.
  const bare = await prepEntry();
  const bareMint = await mintAndInviteVoiceScreen({ entryId: bare.entryId, workspaceId: bare.workspaceId });
  assert.ok(bareMint.ok);
  assert.equal(bareMint.session.kitId, null);
});

test("the store round-trips kit_id, and a session created without one keeps NULL", () => {
  const withKit = createInterviewSession({ provider: "openai", mode: "candidate", kitId: "ikit-pinned" });
  assert.equal(getInterviewSessionById(withKit.id)?.kitId, "ikit-pinned");
  const without = createInterviewSession({ provider: "openai", mode: "test" });
  assert.equal(getInterviewSessionById(without.id)?.kitId, null);
});

// ---- 2. a job with no kit is byte-for-byte today's agenda ---------------------------

test("no kit: the agenda is identical to the pre-kit one, field for field", async () => {
  const { entryId } = await prepEntry({ imported: ["How do you handle flaky tests?"] });
  const today = (await buildInterviewKit(entryId)) as InterviewKit;
  assert.ok(today);
  assert.equal(today.branch, "prep");
  assert.deepEqual(today.faq, [], "no kit, no FAQ");
  // The kit path is inert without a pin, and an unresolvable pin falls back to it.
  assert.deepEqual(await buildInterviewKit(entryId, undefined, { kitId: null }), today);
  assert.deepEqual(await buildInterviewKit(entryId, undefined, { kitId: "ikit-does-not-exist" }), today);
  for (const b of today.agenda.blocks) {
    assert.deepEqual(
      Object.keys(b).sort(),
      ["budgetMin", "competency", "id", "kind", "questions", "scored", "title"],
      `${b.id}: a kitless block grows no fields`
    );
  }
});

// ---- 3. the kit-spined agenda, per branch -------------------------------------------

test("prep branch: the kit's competencies replace the generated topics, in the kit's order", async () => {
  const { entryId, jobId } = await prepEntry();
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 25 })) as InterviewKit;
  assert.ok(built);
  assert.equal(built.branch, "prep");
  assertInvariants(built.agenda);
  assert.deepEqual(built.agenda.durationMin, 25, "the booking is still the input");

  const topics = built.agenda.blocks.filter((b) => b.kind === "topic");
  assert.deepEqual(topics.map((b) => b.title).slice(0, 2), KIT_TITLES, "the kit's order is the agenda's order");
  assert.doesNotMatch(titles(built.agenda).join(" | "), /Test automation fundamentals/, "the CV-derived topic is no longer a block of its own");

  const strategy = topics[0];
  assert.deepEqual(strategy.questions, ["How do you decide what to automate first?", "What does a healthy suite look like to you?"]);
  assert.deepEqual(strategy.mustAsks, [{ id: "q-first", text: "How do you decide what to automate first?" }]);
  assert.equal(strategy.weight, 3);
  assert.equal(strategy.competency, "Test strategy");
  assert.match(built.privateNotes[strategy.id], /Optional follow-up: “And an unhealthy one\?”/);
  assert.equal(
    (built.privateNotes[strategy.id] ?? "").split("automate first").length - 1,
    1,
    "the must-ask is listed once, in its own place, marked inline",
  );

  const collab = topics[1];
  assert.equal(collab.weight, 1);
  assert.equal(collab.mustAsks, undefined, "a competency with no required question carries no marker");
  assert.deepEqual(built.faq, KIT.faq);
});

test("prep branch: this candidate's own probes ride ON TOP of the kit, bounded, recruiter imports first", async () => {
  const { entryId, jobId } = await prepEntry({ questions: 6, imported: ["How do you handle flaky tests?"] });
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 30 })) as InterviewKit;
  assert.ok(built);
  assertInvariants(built.agenda);
  const s = await interviewBriefStrings("en");
  const probes = built.agenda.blocks.find((b) => b.title === s.recruiterAddedQuestions);
  assert.ok(probes, "the candidate's probes get one block of their own");
  assert.equal(probes.questions.length, MAX_KIT_CV_PROBES, "bounded: the kit already fills the booking");
  assert.equal(probes.questions[0], "How do you handle flaky tests?", "the recruiter's own import outranks a generated probe");
  assert.equal(probes.mustAsks, undefined, "a per-candidate probe is never required");
  assert.equal(probes.weight, undefined);
});

test("work-sample debrief: the authorship probes are KEPT and the kit only appends its must-asks", async () => {
  const { entryId, jobId } = debriefEntry();
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entryId, undefined, { kitId })) as InterviewKit;
  assert.ok(built);
  assert.equal(built.branch, "debrief");
  assertInvariants(built.agenda);
  const en = await interviewBriefStrings("en");

  const decision1 = built.agenda.blocks.find((b) => b.title === en.agenda.decision(1));
  const decision2 = built.agenda.blocks.find((b) => b.title === en.agenda.decision(2));
  assert.deepEqual(decision1?.questions, ["What alternative did you consider before keeping the ORM?"], "the authorship probe survives");
  assert.deepEqual(decision2?.questions, ["Why no retries on the webhook?"]);
  assert.match(built.privateNotes[decision1!.id], /Internal red flag — never say this aloud: claims 8 skills/);

  const appended = built.agenda.blocks.find((b) => b.title === en.recruiterAddedQuestions);
  assert.ok(appended, "the kit's must-asks are appended as one block");
  assert.deepEqual(appended.questions, ["How do you decide what to automate first?"]);
  assert.deepEqual(appended.mustAsks, [{ id: "q-first", text: "How do you decide what to automate first?" }]);
  // …and ONLY the must-asks: the kit does not become the spine here.
  assert.doesNotMatch(titles(built.agenda).join(" | "), /Test strategy|Collaboration/);
  assert.doesNotMatch(JSON.stringify(built.agenda), /healthy suite|disagreement with a developer/);
});

test("early-career: the kit replaces the script's middle; its opening and closing moves stay", async () => {
  for (const [withCase, branch, script] of [
    [false, "student", STUDENT_SCRIPT.map((p) => p.phase)],
    [true, "case", DEMO_CASE_SCENARIO.phases.map((p) => p.phase)],
  ] as const) {
    const { entryId, jobId } = studentEntry(withCase);
    const kitId = publishKit(jobId);
    const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 30 })) as InterviewKit;
    assert.ok(built, branch);
    assert.equal(built.branch, branch);
    assertInvariants(built.agenda);
    const topicTitles = built.agenda.blocks.filter((b) => b.kind === "topic").map((b) => b.title);
    assert.deepEqual(topicTitles, [script[0], ...KIT_TITLES, script[script.length - 1]], `${branch}: opening + kit + closing`);
    for (const dropped of script.slice(1, -1)) {
      assert.ok(!topicTitles.includes(dropped), `${branch}: the generated middle phase ${dropped} is replaced`);
    }
  }
});

test("a kit alone grounds a candidate who has no prep at all", async () => {
  const n = next();
  const jobId = job();
  const { entry } = createPipelineEntry({ candidateId: `bare-kit-${n}`, candidateLabel: "Bare", jobId, jobTitle: "QA Engineer", locale: "en" });
  assert.equal(await buildInterviewKit(entry.id), null, "no kit, no prep: nothing to direct, exactly as before");
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entry.id, undefined, { kitId })) as InterviewKit;
  assert.ok(built);
  assert.equal(built.branch, "kit");
  assertInvariants(built.agenda);
  assert.deepEqual(built.agenda.blocks.filter((b) => b.kind === "topic").map((b) => b.title), KIT_TITLES);
});

// ---- 4. the overlay ------------------------------------------------------------------

test("applyKitOverlay: dropped removes, edited rewrites in place, added appends", () => {
  const overlay: KitOverlay = {
    version: 1,
    dropped: ["q-healthy"],
    edited: [{ id: "q-first", text: "Where would you start automating on this codebase?" }],
    added: [
      { id: "a-1", competencyId: "c-collab", text: "How do you handle a reviewer who blocks you?", mustAsk: false },
      { id: "a-2", competencyId: null, text: "Why this role, now?", mustAsk: true },
      { id: "a-3", competencyId: "c-gone", text: "A competency this version no longer has.", mustAsk: false },
    ],
  };
  const out = applyKitOverlay(KIT, overlay, "Recruiter-added questions");
  const strategy = out.competencies[0];
  assert.deepEqual(strategy.questions.map((q) => q.id), ["q-first"], "dropped is gone");
  assert.equal(strategy.questions[0].text, "Where would you start automating on this codebase?", "edited is rewritten");
  assert.equal(strategy.questions[0].mustAsk, true, "…keeping its id, its position and its must-ask flag");

  assert.deepEqual(out.competencies[1].questions.map((q) => q.id), ["q-disagree", "a-1"], "added lands on its competency, last");

  const trailing = out.competencies[2];
  assert.equal(trailing.title, "Recruiter-added questions");
  assert.equal(trailing.weight, 1, "a per-candidate addition is not a competency the role is hired on");
  assert.deepEqual(trailing.questions.map((q) => q.id), ["a-2", "a-3"], "no competency, or one this version lost, gets a block of its own");
  assert.equal(trailing.questions[0].mustAsk, true, "an added question may itself be required");

  assert.deepEqual(applyKitOverlay(KIT, EMPTY_KIT_OVERLAY, "x"), KIT, "an empty overlay changes nothing");
  assert.deepEqual(KIT.competencies[0].questions.map((q) => q.id), ["q-first", "q-healthy"], "the authored kit is not mutated");
});

test("the overlay rides the candidate's prep and reaches the agenda", async () => {
  const overlay: KitOverlay = {
    version: 1,
    dropped: ["q-first"],
    edited: [{ id: "q-disagree", text: "Tell me about a disagreement you lost." }],
    added: [{ id: "a-9", competencyId: null, text: "What would make you say no to this role?", mustAsk: true }],
  };
  const { entryId, jobId } = await prepEntry({ overlay });
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 30 })) as InterviewKit;
  assert.ok(built);
  assertInvariants(built.agenda);
  const raw = JSON.stringify(built.agenda);
  assert.doesNotMatch(raw, /automate first/, "the dropped question is not asked");
  assert.match(raw, /Tell me about a disagreement you lost\./, "the edit is what the interviewer asks");
  const added = built.agenda.blocks.find((b) => b.questions.includes("What would make you say no to this role?"));
  assert.ok(added, "the addition got a block");
  assert.deepEqual(added.mustAsks, [{ id: "a-9", text: "What would make you say no to this role?" }]);
  // A required question the recruiter DROPPED stops being required for this candidate.
  const stillRequired = built.agenda.blocks.flatMap((b) => b.mustAsks ?? []).map((m) => m.id);
  assert.deepEqual(stillRequired, ["a-9"]);
});

test("the overlay reaches this candidate's own probes too, by a text-derived id", async () => {
  // Which probes the plan produces is the generator's business; read them first, then
  // drop the first and rewrite the second through the ids the editor would compute.
  const base = await prepEntry({ questions: 6, imported: ["How do you handle flaky tests?"] });
  const baseKit = (await buildInterviewKit(base.entryId, undefined, { kitId: publishKit(base.jobId), bookedMin: 30 })) as InterviewKit;
  const s = await interviewBriefStrings("en");
  const before = baseKit.agenda.blocks.find((b) => b.title === s.recruiterAddedQuestions)?.questions ?? [];
  assert.equal(before.length, MAX_KIT_CV_PROBES);

  const overlay: KitOverlay = {
    version: 1,
    dropped: [cvProbeId(before[0])],
    edited: [{ id: cvProbeId(before[1]), text: "Rewritten probe for this candidate?" }],
    added: [],
  };
  assert.match(cvProbeId(before[0]), /^cv-[0-9a-f]{8}$/);
  assert.equal(cvProbeId(`  ${before[0]}  `), cvProbeId(before[0]), "whitespace does not move the id");
  const edited = await prepEntry({ questions: 6, imported: ["How do you handle flaky tests?"], overlay });
  const built = (await buildInterviewKit(edited.entryId, undefined, { kitId: publishKit(edited.jobId), bookedMin: 30 })) as InterviewKit;
  const after = built.agenda.blocks.find((b) => b.title === s.recruiterAddedQuestions)?.questions ?? [];
  assert.ok(!after.includes(before[0]), "the dropped probe is gone");
  assert.equal(after[0], "Rewritten probe for this candidate?", "the edited one is asked as rewritten");
  assert.equal(after.length, MAX_KIT_CV_PROBES, "the next probe moved up into the freed place");
});

test("a malformed overlay is no overlay — the kit still runs", async () => {
  const { entryId, jobId } = await prepEntry({ overlay: { version: 7, dropped: "nope" } as unknown as KitOverlay });
  const kitId = publishKit(jobId);
  const built = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 30 })) as InterviewKit;
  assert.ok(built);
  assert.match(JSON.stringify(built.agenda), /How do you decide what to automate first\?/);
});

// ---- 5. the two briefs ----------------------------------------------------------------

test("must-asks and weights reach the PRIVATE brief only; the kit FAQ reaches BOTH, word for word", async () => {
  const { entryId, jobId } = await prepEntry();
  const kitId = publishKit(jobId);
  const kit = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 25 })) as InterviewKit;
  const privateBrief = (await buildGroundedInterview(entryId, undefined, { readOnly: true, kit })).instructions;
  const candidateBrief = (await buildCandidateSafeBrief(entryId, { kit })) ?? "";

  // The private brief states the requirement — on the question itself — and the emphasis.
  assert.match(privateBrief, /“How do you decide what to automate first\?” — Required, never skipped even if you are over time\./);
  assert.equal(privateBrief.split("How do you decide what to automate first?").length - 1, 1, "a required question is stated once");
  assert.match(privateBrief, /This competency carries the most of the decision — protect its time\./);
  assert.equal(privateBrief.split("protect its time").length - 1, 1, "only the heaviest competency is marked");

  // The FAQ answers are role facts meant for the candidate: BOTH providers carry them,
  // through one sanitizer, so the two briefs answer from identical words.
  const FAQ_LINE = "The recruiter also answered these, and you may answer them the same way: “Is the team hybrid?” — Two days in the Prague office, three remote.";
  assert.ok(privateBrief.includes(FAQ_LINE), "the private brief carries the FAQ");
  assert.ok(candidateBrief.includes(FAQ_LINE), "the client-sent brief carries the SAME FAQ");
  assert.doesNotMatch(candidateBrief, /f-hybrid/, "the entry's id never rides");

  // Everything else about the kit stays private — the questions themselves are asked
  // aloud and do ride, but the marker, the emphasis and the author's note do not.
  assert.match(candidateBrief, /How do you decide what to automate first\?/, "an aloud question is still aloud");
  for (const marker of ["Required, never skipped", "carries the most of the decision", "protect its time", "Never read aloud", "Tone: curious"]) {
    assert.ok(!candidateBrief.includes(marker), `${JSON.stringify(marker)} must not reach the client-sent prompt`);
  }
  // Both still list the same blocks, once each, and both know the tool.
  for (const b of kit.agenda.blocks) {
    const head = `${b.id} · ${b.title} (${b.budgetMin} min)`;
    assert.equal(privateBrief.split(head).length - 1, 1, `private brief lists ${head} once`);
    assert.equal(candidateBrief.split(head).length - 1, 1, `candidate brief lists ${head} once`);
  }
  for (const brief of [privateBrief, candidateBrief]) assert.match(brief, /report_extra_time/);
});

test("the candidate's own view of a kit-spined agenda carries no weight and no must-ask marker", async () => {
  const { entryId, jobId } = await prepEntry();
  const kitId = publishKit(jobId);
  const kit = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: 25 })) as InterviewKit;
  const view = toCandidateAgendaView(kit.agenda);
  assert.deepEqual(Object.keys(view).sort(), ["blocks", "durationMin", "hardCapMin"]);
  for (const b of view.blocks) assert.deepEqual(Object.keys(b).sort(), ["budgetMin", "id", "kind", "title"]);
  assert.doesNotMatch(JSON.stringify(view), /"(mustAsks|weight|competency|questions|scored)":/);
});

// ---- 6. the ORDER a kit's questions reach the interviewer in ------------------------
//
// The interview simulator's first live sweep read a private brief that listed a block's
// optional question and its follow-up BEFORE the must-ask that introduces the subject,
// so the interviewer met "What would you change in THAT service?" before the question
// that names the service. The listing is now the kit's authored order, each must-ask
// marked on its own question, each follow-up right after the question it follows.

/** First question optional, second a must-ask WITH a follow-up, third leaning on the
 *  second ("that service") with a follow-up of its own. */
const ORDER_KIT: JobKit = {
  version: 1,
  competencies: [
    {
      id: "c-own",
      title: "Service ownership",
      weight: 3,
      budgetMin: 6,
      questions: [
        { id: "q-enjoy", text: "Which part of your current stack do you enjoy most?", mustAsk: false },
        { id: "q-own", text: "Walk me through a service you owned end to end.", mustAsk: true, followUp: "Which decision in it was yours alone?" },
        { id: "q-change", text: "What would you change in that service today?", mustAsk: false, followUp: "Why not before?" },
      ],
    },
  ],
  faq: [],
};

/** A candidate with no candidate profile, so no prep exists and none can be generated:
 *  the quick-screen fallback of buildGroundedInterview. */
function noPlanEntry(jobId: string) {
  const n = next();
  const { entry } = createPipelineEntry({ candidateId: `noplan-kit-${n}`, candidateLabel: `N ${n}`, jobId, jobTitle: "QA Engineer", locale: "en" });
  return { entryId: entry.id, workspaceId: entry.workspaceId };
}

test("the private listing keeps the kit's authored order: must-ask marked inline, follow-up right after its question", async () => {
  const jobId = job();
  const kitId = publishKit(jobId, ORDER_KIT);
  const { entryId } = noPlanEntry(jobId);
  const kit = (await buildInterviewKit(entryId, undefined, { kitId, bookedMin: kitBookedMin(ORDER_KIT) })) as InterviewKit;
  assert.ok(kit);
  assert.equal(kit.branch, "kit");
  const privateBrief = (await buildGroundedInterview(entryId, undefined, { readOnly: true, kit })).instructions;
  const candidateBrief = (await buildCandidateSafeBrief(entryId, { kit })) ?? "";

  const LISTING =
    "Ask in this order: 1) “Which part of your current stack do you enjoy most?” " +
    "2) “Walk me through a service you owned end to end.” — Required, never skipped even if you are over time. " +
    "Optional follow-up: “Which decision in it was yours alone?” " +
    "3) “What would you change in that service today?” Optional follow-up: “Why not before?”";
  const head = privateBrief.indexOf("b1 ·");
  assert.ok(privateBrief.includes(LISTING), `the listing, in order:\n${privateBrief.slice(head, head + 700)}`);
  const at = (s: string) => privateBrief.indexOf(s);
  assert.ok(at("enjoy most") < at("service you owned") && at("service you owned") < at("that service today"), "questions in authored order");
  assert.ok(at("service you owned") < at("yours alone") && at("yours alone") < at("that service today"), "a follow-up follows ITS question, before the next one");
  assert.equal(privateBrief.split("Required, never skipped").length - 1, 1, "the requirement is stated once, on its own question — no second must-ask line");

  // The client-sent brief keeps its allow-list: the questions are aloud material and ride
  // in the same order; the follow-ups and the must-ask marker are the recruiter's.
  const c = (s: string) => candidateBrief.indexOf(s);
  assert.ok(c("enjoy most") >= 0 && c("enjoy most") < c("service you owned") && c("service you owned") < c("that service today"));
  for (const privateOnly of ["Which decision in it was yours alone?", "Why not before?", "Required, never skipped", "Optional follow-up"]) {
    assert.ok(!candidateBrief.includes(privateOnly), `${JSON.stringify(privateOnly)} must not reach the client-sent prompt`);
  }
});

// ---- 7. ONE booking rule for a kit-pinned interview --------------------------------
//
// The kit's length used to be computed in four places that disagreed: the mint booked
// the quick screen's 5 minutes for a candidate with no plan (connect then squeezed a
// 20-minute kit to its floors) and the CV plan's own length for one with a plan (whose
// topics the kit REPLACES), the rehearsal booked max(20, natural) with no ceiling, the
// scheduling estimate knew nothing of the kit, and the saved fallback brief said "under
// 5 minutes". Every surface now reads interview-kit-booking.ts kitBookedMin.

/** 1 warm-up + 9 + 7 + 2 role questions + 2 closing = 21 with no plan. */
const BOOKING_KIT: JobKit = { ...KIT, competencies: KIT.competencies.map((c, i) => ({ ...c, budgetMin: i === 0 ? 9 : 7 })) };

test("ONE booking rule: the mint, connect, the rehearsal and the scheduling estimate agree on a kit-pinned interview's length", async () => {
  type Row = { name: string; entry: { entryId: string; workspaceId: string }; jobId: string; expected: number; topicBudgets: number[] };
  const noPlanJob = job();
  const planned = await prepEntry({ questions: 6, imported: ["How do you handle flaky tests?"] });
  const rows: Row[] = [
    {
      name: "no plan — the kit-only agenda",
      jobId: noPlanJob,
      entry: noPlanEntry(noPlanJob),
      expected: 21,
      topicBudgets: [9, 7],
    },
    {
      // The plan's own opening (3) + the kit (16) + the three CV probes that ride (a
      // 3-minute block) + the plan's role questions and closing (2 + 2). The plan's slack
      // block is not booked: it is slack, and connect drops it instead of a competency.
      name: "a CV plan — the kit replaces its topics, three probes ride",
      jobId: planned.jobId,
      entry: { entryId: planned.entryId, workspaceId: planned.workspaceId },
      expected: 3 + 16 + 3 + 2 + 2,
      topicBudgets: [9, 7, 3],
    },
  ];
  for (const r of rows) {
    const kitId = publishKit(r.jobId, BOOKING_KIT);
    const prep = getInterviewPrep(r.entry.entryId, r.entry.workspaceId)?.payload as Parameters<typeof kitBookedMin>[1];
    assert.equal(kitBookedMin(BOOKING_KIT, prep), r.expected, `${r.name}: the rule itself`);

    // The scheduling estimate, BEFORE any link exists — the kit a link would pin now.
    const entry = getPipelineEntry(r.entry.entryId, r.entry.workspaceId);
    assert.ok(entry);
    assert.equal(plannedInterviewMinutes(entry), r.expected, `${r.name}: the scheduling estimate`);

    // The mint: the booking, the reservation it sizes, and the saved fallback brief.
    const minted = await mintAndInviteVoiceScreen({ entryId: r.entry.entryId, workspaceId: r.entry.workspaceId });
    assert.ok(minted.ok);
    assert.equal(minted.session.kitId, kitId);
    assert.equal(getInterviewSessionById(minted.session.id)?.durationMin, r.expected, `${r.name}: the minted booking`);
    const saved = getInterviewSessionById(minted.session.id)?.instructions ?? "";
    assert.ok(saved.includes(`${r.expected} minutes`), `${r.name}: the saved fallback brief states the booked length`);
    assert.ok(!saved.includes("under 5 minutes"), `${r.name}: …not the quick screen's`);

    // Connect, exactly as /api/interview/connect builds it: every competency at its
    // authored budget — nothing squeezed.
    const built = (await buildInterviewKit(r.entry.entryId, undefined, { kitId, bookedMin: minted.session.durationMin })) as InterviewKit;
    assert.ok(built);
    assertInvariants(built.agenda);
    assert.equal(built.agenda.durationMin, r.expected, `${r.name}: the agenda fills the booking exactly`);
    assert.deepEqual(
      built.agenda.blocks.filter((b) => b.kind === "topic").map((b) => b.budgetMin),
      r.topicBudgets,
      `${r.name}: no competency squeezed`,
    );
    // …and a build with no booking at all reads the same rule.
    const unbooked = (await buildInterviewKit(r.entry.entryId, undefined, { kitId })) as InterviewKit;
    assert.equal(unbooked.agenda.durationMin, r.expected, `${r.name}: a build with no booking`);
  }

  // The rehearsal: what the rehearse door books is the kit-only agenda's own length —
  // the SAME no-plan value a candidate link is minted at (the door itself is pinned in
  // connect-rehearsal.test.ts).
  const rehearsed = await buildKitOnlyInterviewKit(publishKit(job(), BOOKING_KIT), DEFAULT_WORKSPACE_ID, { locale: "en" });
  assert.ok(rehearsed);
  assert.equal(rehearsed.agenda.durationMin, rows[0].expected, "the rehearsal books the no-plan value");
});

test("with NO kit every length is exactly today's: the quick screen for no plan, the plan's own otherwise", async () => {
  const bare = noPlanEntry(job());
  const bareEntry = getPipelineEntry(bare.entryId, bare.workspaceId);
  assert.ok(bareEntry);
  assert.equal(plannedInterviewMinutes(bareEntry), QUICK_SCREEN_MIN);
  const bareMint = await mintAndInviteVoiceScreen({ entryId: bare.entryId, workspaceId: bare.workspaceId });
  assert.ok(bareMint.ok);
  assert.equal(bareMint.session.kitId, null);
  assert.equal(bareMint.session.durationMin, QUICK_SCREEN_MIN);
  assert.match(getInterviewSessionById(bareMint.session.id)?.instructions ?? "", /under 5 minutes/, "the quick-screen prompt, unchanged");

  const planned = await prepEntry();
  const planMin = (getInterviewPrep(planned.entryId, planned.workspaceId)?.payload as { durationMin?: number } | undefined)?.durationMin;
  assert.ok(typeof planMin === "number");
  const plannedEntry = getPipelineEntry(planned.entryId, planned.workspaceId);
  assert.ok(plannedEntry);
  assert.equal(plannedInterviewMinutes(plannedEntry), planMin);
  const plannedMint = await mintAndInviteVoiceScreen({ entryId: planned.entryId, workspaceId: planned.workspaceId });
  assert.ok(plannedMint.ok);
  assert.equal(plannedMint.session.durationMin, planMin);
});

test("kitBookedMin is clamped to the grounded run-of-show band, and a floored kit keeps every competency's budget", async () => {
  assert.deepEqual([MIN_DURATION_MIN, MAX_DURATION_MIN], [15, 30], "the band a CV-based plan is clamped to");
  const kitOf = (...budgets: number[]): JobKit => ({
    ...KIT,
    competencies: budgets.map((b, i) => ({ ...KIT.competencies[1], id: `c-band-${i}`, title: `Competency ${i + 1}`, budgetMin: b })),
  });
  assert.equal(kitBookedMin(kitOf(9, 7)), 21, "1 + 16 + 2 + 2");
  assert.equal(kitBookedMin(kitOf(3, 2)), 15, "1 + 5 + 4 = 10 is a stub, not an interview: floored at 15");
  assert.equal(kitBookedMin(kitOf(20, 20)), 30, "1 + 40 + 4 = 45 would outrun the provider's hard cap: capped at 30");

  // At the floor the surplus goes to the candidate's questions, never into a competency
  // and never out of one.
  const shortKit = kitOf(3, 2);
  const shortJob = job();
  const floored = await buildKitOnlyInterviewKit(publishKit(shortJob, shortKit), getJobWorkspace(shortJob), { locale: "en" });
  assert.ok(floored);
  assertInvariants(floored.agenda);
  assert.equal(floored.agenda.durationMin, 15);
  assert.deepEqual(floored.agenda.blocks.filter((b) => b.kind === "topic").map((b) => b.budgetMin), [3, 2]);
  assert.equal(floored.agenda.blocks.find((b) => b.kind === "role_qa")?.budgetMin, 2 + 5);
});
