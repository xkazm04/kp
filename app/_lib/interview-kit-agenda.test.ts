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
//   - a job with no kit producing today's agenda, field for field.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createPosting, createSubmission, saveDevCase, saveDevCaseScenario, saveSubmissionEvaluation } from "./db/devcase.ts";
import { createInterviewSession, getInterviewSessionById } from "./db/interviews.ts";
import { interviewKitAppendVersion } from "./db/interview-kits.ts";
import { saveInterviewPrep } from "./interview-prep.ts";
import { insertJob } from "./job-ingest.ts";
import { buildRunOfShow } from "./run-of-show.ts";
import { interviewBriefStrings, rosStrings } from "./interview-prep-strings.ts";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT } from "./student-interview.ts";
import {
  applyKitOverlay,
  buildInterviewKit,
  cvProbeId,
  MAX_KIT_CV_PROBES,
  toCandidateAgendaView,
  type InterviewKit,
} from "./interview-agenda.ts";
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
  assert.doesNotMatch(built.privateNotes[strategy.id] ?? "", /automate first/, "a must-ask is not also listed as an ordinary Ask");

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

  // The private brief states the requirement and the emphasis.
  assert.match(privateBrief, /Required, never skipped even if you are over time: “How do you decide what to automate first\?”/);
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
