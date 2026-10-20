// The director's agenda (spark ai-interview-parity, WP1a): ONE agenda, built at
// connect from the entry's CURRENT kit, that both provider briefs list and the
// director validates against.
//
// Pinned here, DB-backed because the defect this replaces lived between the stores
// (two providers reading two different kits):
//   - all four branches (submission debrief > case-grounded student > generic
//     student > prep chronology) and the null path — which must NOT generate a prep;
//   - every agenda invariant: ids b0..bN in order, Σ budget == duration, the hard cap,
//     the closing reserve, `scored` only on topic/open, a leading warm-up and a
//     trailing role-questions + close pair of ≥ 2 min each;
//   - the candidate view carries no competency / questions, and the candidate-safe
//     brief lists the same block ids/titles/budgets as the private one while staying
//     allow-list clean.
//
// testing/unit-db.ts MUST be the first project import (it sets KP_DB_PATH).
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createPipelineEntry } from "./db/pipeline.ts";
import { createPosting, createSubmission, saveDevCase, saveDevCaseScenario, saveSubmissionEvaluation } from "./db/devcase.ts";
import { getInterviewPrep, saveInterviewPrep } from "./interview-prep.ts";
import { insertJob } from "./job-ingest.ts";
import { buildRunOfShow } from "./run-of-show.ts";
import { interviewBriefStrings, rosStrings } from "./interview-prep-strings.ts";
import { DEMO_CASE_SCENARIO, STUDENT_SCRIPT, STUDENT_SCRIPT_MIN } from "./student-interview.ts";
import {
  buildInterviewAgenda,
  buildInterviewKit,
  CLOSE_MIN,
  fitAgendaDrafts,
  reconcileKitWithStoredAgenda,
  ROLE_QA_MIN,
  toCandidateAgendaView,
  type InterviewKit,
} from "./interview-agenda.ts";
import { buildCandidateSafeBrief, buildGroundedInterview } from "./interview-run.ts";
import { LOCALES } from "@/i18n/locales";
import type { InterviewAgenda, ResumeContext } from "./voice/director-types.ts";

after(() => cleanupUnitDb());

let seq = 0;
const next = () => (seq += 1);

// Interviewer-internal markers that must never reach a candidate-facing surface.
const GAP_TOPIC = "Test automation fundamentals (missing must-have)";
const GOAL = "Listen for: risk-based ordering, not a checklist";
const RED_FLAG = "claims 8 skills, largely self-taught";
function assertCandidateClean(text: string, where: string) {
  for (const marker of ["missing must-have", "Listen for", "red flag", "never say this aloud", "Evidence for", RED_FLAG, "observe whether"]) {
    assert.ok(!text.includes(marker), `${where}: ${JSON.stringify(marker)} must not survive`);
  }
}

/** Every structural invariant the director relies on. */
function assertInvariants(agenda: InterviewAgenda) {
  assert.equal(agenda.version, 1);
  agenda.blocks.forEach((b, i) => assert.equal(b.id, `b${i}`, "ids are b0..bN in agenda order"));
  assert.equal(new Set(agenda.blocks.map((b) => b.id)).size, agenda.blocks.length, "ids are unique");
  assert.equal(agenda.blocks.reduce((n, b) => n + b.budgetMin, 0), agenda.durationMin, "Σ budget == duration");
  assert.equal(agenda.hardCapMin, Math.round(agenda.durationMin * 1.2));
  const kinds = agenda.blocks.map((b) => b.kind);
  assert.equal(kinds[0], "warmup", "a leading warm-up");
  assert.deepEqual(kinds.slice(-2), ["role_qa", "close"], "role questions then close, last");
  const roleQa = agenda.blocks[agenda.blocks.length - 2];
  const close = agenda.blocks[agenda.blocks.length - 1];
  assert.ok(roleQa.budgetMin >= ROLE_QA_MIN && close.budgetMin >= CLOSE_MIN, "the closing reserve is ≥ 2 + 2");
  assert.equal(agenda.closeReserveMin, roleQa.budgetMin + close.budgetMin);
  for (const b of agenda.blocks) {
    assert.equal(b.scored, b.kind === "topic" || b.kind === "open", `${b.id}: scored only for topic/open`);
    assert.ok(Number.isInteger(b.budgetMin) && b.budgetMin >= 1, `${b.id}: a whole, positive budget`);
    assert.ok(b.title.trim().length > 0, `${b.id}: a title`);
    assert.doesNotMatch(b.title, /[([]/, `${b.id}: the title carries no bracketed annotation`);
    if (!b.scored) assert.equal(b.competency, null, `${b.id}: fixed blocks gather no competency`);
    for (const q of b.questions) assertCandidateClean(q, `${b.id} question`);
  }
  assert.equal(kinds.filter((k) => k === "warmup").length, 1);
  assert.ok(kinds.filter((k) => k === "open").length <= 1, "at most one slack block");
}

// ---- fixtures -----------------------------------------------------------------------

function job(status: "published" | "draft", description = "We build the test tooling every squad ships with.") {
  const n = next();
  return insertJob(
    { id: `job-agenda-${n}`, title: "QA Engineer", company: "Acme", location: "Praha", workMode: "hybrid", description },
    undefined,
    status
  ).id;
}

async function prepEntry(opts: { jobStatus?: "published" | "draft"; imported?: string[]; questions?: number; locale?: string } = {}) {
  const n = next();
  const jobId = job(opts.jobStatus ?? "published");
  const { entry } = createPipelineEntry({ candidateId: `cand-agenda-${n}`, candidateLabel: `Kandidat ${n}`, jobId, jobTitle: "QA Engineer", locale: opts.locale ?? "en" });
  const qs = Array.from({ length: opts.questions ?? 1 }, (_, i) =>
    i === 0
      ? { competency: GAP_TOPIC, question: "Which tests would you write first?", whatsGoodLooksLike: GOAL, followUpIfAnswer: "What would you leave untested?" }
      : { competency: `Competency ${i + 1}`, question: `Question number ${i + 1}?`, whatsGoodLooksLike: GOAL }
  );
  const plan = buildRunOfShow(qs, ["automation"], entry.candidateLabel ?? null, "QA Engineer", await rosStrings("en"));
  saveInterviewPrep(entry.id, entry.candidateLabel ?? null, "QA Engineer", { ...plan, lang: "en", importedQuestions: opts.imported ?? [] });
  return entry.id;
}

function debriefEntry(locale: string | null) {
  const n = next();
  const posting = createPosting({ caseId: `case-ag-${n}`, channel: "local", token: `tok-ag-${n}`, roleTitle: "Backend", caseTitle: `Case ${n}` });
  const { submission } = createSubmission({ postingId: posting.id, candidateRef: `cand-ag-${n}`, repoRef: `repo-ag-${n}` });
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
  const { entry } = createPipelineEntry({ candidateId: `cand-ag-${n}`, candidateLabel: `K ${n}`, jobId: `jd-ag-${n}`, jobTitle: "Backend", locale, devSubmissionId: submission.id });
  return entry.id;
}

function studentEntry(withCase: boolean) {
  const n = next();
  let devCaseId: string | null = null;
  if (withCase) {
    devCaseId = saveDevCase({ need: {}, analysis: {}, role: { title: "Junior Backend" }, case: { title: `Case ${n}` } }).id;
    saveDevCaseScenario(devCaseId, DEMO_CASE_SCENARIO);
  }
  const { entry } = createPipelineEntry({ candidateId: `stud-ag-${n}`, candidateLabel: `S ${n}`, jobId: `jd-st-${n}`, jobTitle: "Junior Backend", archetype: "student", devCaseId });
  return entry.id;
}

// ---- the four branches --------------------------------------------------------------

test("prep chronology: the plan's own opening and closing become the warm-up and the closing reserve", async () => {
  const entryId = await prepEntry({ imported: ["How do you handle flaky tests?"] });
  const kit = await buildInterviewKit(entryId);
  assert.ok(kit);
  assert.equal(kit.branch, "prep");
  const { agenda } = kit;
  assertInvariants(agenda);
  // 1 question → intro 3 + question 4 + open 4 + wrap 4 = the 15-minute floor plan.
  assert.equal(agenda.durationMin, 15);
  assert.deepEqual(agenda.blocks.map((b) => b.kind), ["warmup", "topic", "topic", "open", "role_qa", "close"]);
  const [warmup, gap, imported, open] = agenda.blocks;
  assert.equal(warmup.budgetMin, 3, "the plan's 3-minute intro is the warm-up — not a second opening");
  assert.deepEqual(warmup.questions, [(await interviewBriefStrings("en")).agenda.warmupQuestion]);
  assert.equal(gap.title, "Test automation fundamentals", "the annotation is scrubbed from the title");
  assert.equal(gap.competency, GAP_TOPIC, "…and kept, raw, on the server-side competency");
  assert.deepEqual(gap.questions, ["Which tests would you write first?", "What would you leave untested?"]);
  assert.equal(gap.budgetMin, 4);
  assert.equal(imported.title, (await interviewBriefStrings("en")).recruiterAddedQuestions);
  assert.deepEqual(imported.questions, ["How do you handle flaky tests?"]);
  // The imported block's minutes came out of the slack block, the designated casualty.
  assert.equal(open.budgetMin, 2);
  assert.equal(kit.privateNotes[gap.id].includes(GOAL), true, "the goal rides the private notes");
  assert.match(kit.privateNotes[gap.id], /Optional follow-up: “What would you leave untested\?”/);
});

test("prep chronology with a full question set: no slack block, the plan's length is kept", async () => {
  const entryId = await prepEntry({ questions: 6 });
  const agenda = await buildInterviewAgenda(entryId);
  assert.ok(agenda);
  assertInvariants(agenda);
  assert.equal(agenda.blocks.some((b) => b.kind === "open"), false);
  assert.equal(agenda.blocks.filter((b) => b.kind === "topic").length, 6);
  assert.equal(agenda.durationMin, 25, "intro 3 + 6 × 3 + wrap 4");
});

test("the session's BOOKED length wins: a 25-minute prep booked at 19 is fitted to 19", async () => {
  const entryId = await prepEntry({ questions: 6 });
  const agenda = await buildInterviewAgenda(entryId, undefined, { bookedMin: 19 });
  assert.ok(agenda);
  assertInvariants(agenda);
  assert.equal(agenda.durationMin, 19);
  assert.equal(agenda.blocks.reduce((n, b) => n + b.budgetMin, 0), 19, "Σ budgets == the booking");
  assert.equal(agenda.hardCapMin, 23, "round(19 × 1.2)");
  // The overrun came out of the warm-up and the topics — never the closing reserve.
  assert.equal(agenda.closeReserveMin, ROLE_QA_MIN + CLOSE_MIN);
  assert.equal(agenda.blocks.filter((b) => b.kind === "topic").length, 6, "every topic keeps a block");
  // With no booking the kit's own length is the fallback (see the full-question-set test: 25).
  for (const none of [undefined, null, 0, Number.NaN]) {
    assert.equal((await buildInterviewAgenda(entryId, undefined, { bookedMin: none }))?.durationMin, 25);
  }
});

test("submission debrief: one decision block per minted question, in the entry's language", async () => {
  const kit = await buildInterviewKit(debriefEntry("de"));
  assert.ok(kit);
  assert.equal(kit.branch, "debrief");
  assertInvariants(kit.agenda);
  const de = await interviewBriefStrings("de");
  assert.equal(kit.agenda.durationMin, 14, "debriefDurationMin(2) = 8 + 3 × 2");
  assert.deepEqual(kit.agenda.blocks.map((b) => b.title), [
    de.agenda.warmup,
    de.debriefRunOfShow[0],
    de.agenda.decision(1),
    de.agenda.decision(2),
    de.agenda.roleQuestions,
    de.agenda.close,
  ]);
  const decision1 = kit.agenda.blocks[2];
  assert.equal(decision1.competency, "Kept the ORM despite the N+1s");
  assert.deepEqual(decision1.questions, ["What alternative did you consider before keeping the ORM?"]);
  assert.match(kit.privateNotes[decision1.id], /Internal red flag — never say this aloud: claims 8 skills/);
  assertCandidateClean(JSON.stringify(toCandidateAgendaView(kit.agenda)), "debrief view");
});

test("generic student script: six phases fitted into the booked 22 minutes, the coachability hint kept private", async () => {
  const kit = await buildInterviewKit(studentEntry(false));
  assert.ok(kit);
  assert.equal(kit.branch, "student");
  assertInvariants(kit.agenda);
  assert.equal(kit.agenda.durationMin, STUDENT_SCRIPT_MIN, "the booking is an input, not an output");
  const topics = kit.agenda.blocks.filter((b) => b.kind === "topic");
  assert.deepEqual(topics.map((b) => b.title), STUDENT_SCRIPT.map((p) => p.phase));
  const coach = topics.find((b) => b.title === "Coachability injection");
  assert.ok(coach);
  assert.deepEqual(coach.questions, [], "the scripted hint is a stage direction, never an aloud question");
  assert.match(kit.privateNotes[coach.id], /Ask: “Have you considered the case where the input arrives out of order\?”/);
  assert.match(coach.competency ?? "", /Coachability/);
});

test("case-grounded student: the designed scenario's phases, its probes aloud except the hint", async () => {
  const kit = await buildInterviewKit(studentEntry(true));
  assert.ok(kit);
  assert.equal(kit.branch, "case");
  assertInvariants(kit.agenda);
  assert.equal(kit.agenda.durationMin, DEMO_CASE_SCENARIO.durationMin);
  const mechanism = kit.agenda.blocks.find((b) => b.title === "Mechanism probes");
  assert.ok(mechanism?.questions[0]?.includes("queue instead of being called directly"));
  const coach = kit.agenda.blocks.find((b) => b.title === "Coachability injection");
  assert.deepEqual(coach?.questions, []);
  assert.match(kit.privateNotes[coach!.id], /offer ONE gentle hint/);
});

test("nothing grounded → null, and the public door never GENERATES a prep", async () => {
  const n = next();
  const { entry } = createPipelineEntry({ candidateId: `bare-${n}`, candidateLabel: "Bare", jobId: `jd-bare-${n}`, jobTitle: "Role" });
  assert.equal(await buildInterviewKit(entry.id), null);
  assert.equal(await buildInterviewAgenda(entry.id), null);
  assert.equal(getInterviewPrep(entry.id, entry.workspaceId), null, "read-only: no prep was generated");
  assert.equal(await buildInterviewAgenda("no-such-entry"), null);
  // The read-only grounded build says so instead of generating one either.
  const built = await buildGroundedInterview(entry.id, undefined, { readOnly: true });
  assert.equal(built.grounded, false);
  assert.equal(getInterviewPrep(entry.id, entry.workspaceId), null);
});

// ---- the candidate view -----------------------------------------------------------------

test("toCandidateAgendaView is a projection: id/kind/title/budget only", async () => {
  const agenda = await buildInterviewAgenda(await prepEntry());
  assert.ok(agenda);
  const view = toCandidateAgendaView(agenda);
  assert.deepEqual(Object.keys(view).sort(), ["blocks", "durationMin", "hardCapMin"]);
  for (const b of view.blocks) assert.deepEqual(Object.keys(b).sort(), ["budgetMin", "id", "kind", "title"]);
  const raw = JSON.stringify(view);
  assert.doesNotMatch(raw, /"(competency|questions|scored)":/);
  assertCandidateClean(raw, "candidate view");
});

// ---- both briefs, one agenda -------------------------------------------------------------

function heads(agenda: InterviewAgenda): string[] {
  return agenda.blocks.map((b) => `${b.id} · ${b.title} (${b.budgetMin} min)`);
}

test("both briefs list the SAME blocks exactly once; the candidate-safe one stays allow-list clean", async () => {
  const entryId = await prepEntry({ imported: ["How do you handle flaky tests?"] });
  const kit = (await buildInterviewKit(entryId)) as InterviewKit;
  const privateBrief = (await buildGroundedInterview(entryId, undefined, { readOnly: true, kit })).instructions;
  const candidateBrief = (await buildCandidateSafeBrief(entryId, { kit })) ?? "";
  for (const head of heads(kit.agenda)) {
    assert.equal(privateBrief.split(head).length - 1, 1, `private brief lists ${head} once`);
    assert.equal(candidateBrief.split(head).length - 1, 1, `candidate brief lists ${head} once`);
  }
  // The agenda REPLACES the legacy run-of-show — never a second listing.
  for (const brief of [privateBrief, candidateBrief]) {
    assert.doesNotMatch(brief, /run of show/);
    assert.doesNotMatch(brief, /recruiter-added questions wherever they fit/);
    assert.match(brief, /lead them through 3 short topics in about 15 minutes/);
    assert.match(brief, /begin_topic/);
    assert.match(brief, /\[Director\] are private stage directions/);
    assert.match(brief, /Published posting: “We build the test tooling/);
    // Persona order is untouched: one question → craft → gender grammar → language lock,
    // and the protocol sits after the agenda, before the no-judgement close.
    const at = (s: string) => brief.indexOf(s);
    assert.ok(at("Ask exactly ONE question") < at("Interviewing craft"));
    assert.ok(at("You are male") < at("LOCK onto"));
    assert.ok(at("b0 · ") < at("Director protocol"));
    assert.ok(at("Director protocol") < at("Do not give feedback"));
  }
  // Private keeps the coaching; the candidate-safe brief keeps none of it.
  assert.match(privateBrief, /Evidence for: Test automation fundamentals \(missing must-have\)/);
  assert.ok(privateBrief.includes(GOAL));
  assertCandidateClean(candidateBrief, "candidate-safe brief");
});

test("a draft job's posting text never rides the brief; the public facts still do", async () => {
  const entryId = await prepEntry({ jobStatus: "draft" });
  const kit = (await buildInterviewKit(entryId)) as InterviewKit;
  const candidateBrief = (await buildCandidateSafeBrief(entryId, { kit })) ?? "";
  assert.match(candidateBrief, /ROLE FACTS — title: QA Engineer; company: Acme; location: Praha; work mode: hybrid\./);
  assert.doesNotMatch(candidateBrief, /Published posting/);
});

test("a resumed call appends the addendum to both briefs", async () => {
  const entryId = await prepEntry();
  const kit = (await buildInterviewKit(entryId)) as InterviewKit;
  const resume: ResumeContext = { attempt: 2, activeBlockId: "b1", coveredBlockIds: ["b0"], elapsedSec: 180, priorTurns: [] };
  const privateBrief = (await buildGroundedInterview(entryId, undefined, { readOnly: true, kit, resume })).instructions;
  const candidateBrief = (await buildCandidateSafeBrief(entryId, { kit, resume })) ?? "";
  for (const brief of [privateBrief, candidateBrief]) {
    assert.match(brief, /RESUMED CALL — the line dropped and this is attempt 2/);
    assert.match(brief, /Continue with b1 · Test automation fundamentals/);
  }
});

test("the undirected (create-time) brief is unchanged by the agenda work", async () => {
  const entryId = await prepEntry();
  const legacy = (await buildGroundedInterview(entryId)).instructions;
  assert.match(legacy, /Then lead the conversation through this run of show/);
  assert.doesNotMatch(legacy, /begin_topic|Director protocol|b0 · /);
});

// ---- reconcile + fit -----------------------------------------------------------------------

test("a resumed attempt keeps the stored agenda its resume state was recorded against", async () => {
  const fresh = (await buildInterviewKit(await prepEntry())) as InterviewKit;
  const stored: InterviewAgenda = { ...fresh.agenda, blocks: fresh.agenda.blocks.map((b) => ({ ...b, title: `${b.title}!` })) };
  assert.equal(reconcileKitWithStoredAgenda(fresh, stored, false), fresh, "a first attempt takes the fresh build");
  const kept = reconcileKitWithStoredAgenda(fresh, stored, true);
  assert.equal(kept?.agenda, stored, "a resume keeps the stored agenda");
  assert.deepEqual(kept?.privateNotes, {}, "…and drops notes written for different blocks");
  const same = reconcileKitWithStoredAgenda(fresh, fresh.agenda, true);
  assert.deepEqual(same?.privateNotes, fresh.privateNotes, "same shape → the notes still apply");
});

test("fit: slack goes to ONE block, an overrun never eats the closing reserve", () => {
  const base = [
    { kind: "warmup" as const, budgetMin: 1 },
    { kind: "topic" as const, budgetMin: 4 },
    { kind: "topic" as const, budgetMin: 4 },
    { kind: "role_qa" as const, budgetMin: 2 },
    { kind: "close" as const, budgetMin: 2 },
  ];
  const under = fitAgendaDrafts(base, 16);
  assert.equal(under.durationMin, 16);
  assert.deepEqual(under.blocks.map((b) => b.budgetMin), [1, 4, 4, 5, 2], "no open block → the candidate's questions absorb the slack");
  const over = fitAgendaDrafts(base, 9);
  assert.equal(over.durationMin, 9);
  assert.deepEqual(over.blocks.slice(-2).map((b) => b.budgetMin), [2, 2], "the reserve is protected");
  // Degenerate: even the floors do not fit — the agenda states the honest longer total.
  const floor = fitAgendaDrafts(base, 3);
  assert.equal(floor.durationMin, floor.blocks.reduce((n, b) => n + b.budgetMin, 0));
  assert.ok(floor.durationMin > 3);
});

// ---- the catalog -------------------------------------------------------------------------

test("the agenda's candidate-facing strings render in all four locales", async () => {
  for (const l of LOCALES) {
    const { agenda } = await interviewBriefStrings(l);
    for (const v of [agenda.warmup, agenda.warmupQuestion, agenda.open, agenda.roleQuestions, agenda.close, agenda.decision(2), agenda.topicFallback(3)]) {
      assert.ok(typeof v === "string" && v.trim().length > 0, `${l}: renders`);
      assert.doesNotMatch(v, /^interview\.brief\./, `${l}: no missing-key echo`);
    }
    assert.match(agenda.decision(2), /2/);
    assert.match(agenda.topicFallback(3), /3/);
  }
});
