// The interview kit editor's pure model (spark interview-kit-template, WP-C): the list
// grammar, the caps the editor enforces before a save, and — the part that must never
// drift — that "no blocking problem here" means the SERVER's own normalizer stores the
// draft exactly as sent: no refusal, no trimming, no re-minted ids.
import test from "node:test";
import assert from "node:assert/strict";
import {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_FAQ,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  type InterviewKit,
} from "../../../_lib/interview-kit-types.ts";
import { KIT_MAX_BUDGET_MIN, normalizeInterviewKit } from "../../../_lib/interview-kit-validate.ts";
import {
  addCompetency,
  addFaq,
  addQuestion,
  blankDraft,
  canMarkMustAsk,
  canPublishVersion,
  draftDiffers,
  draftFromKit,
  draftToKit,
  kitDraftProblems,
  kitRejection,
  knownAdjustments,
  moveCompetency,
  moveFaq,
  moveQuestion,
  mustAskCount,
  newerDraft,
  openVersion,
  patchCompetency,
  patchFaq,
  patchQuestion,
  rehearsalTarget,
  removeCompetency,
  removeFaq,
  removeQuestion,
  setMustAsk,
  type KitDraft,
  type KitState,
  type Mint,
} from "./jobsKitModel.ts";

/** Deterministic ids: c-1, q-2, f-3 … */
function counter(): Mint {
  let n = 0;
  return (prefix) => `${prefix}-${++n}`;
}

const KIT: InterviewKit = {
  version: 1,
  competencies: [
    {
      id: "c1",
      title: "Test strategy",
      weight: 3,
      budgetMin: 8,
      questions: [
        { id: "c1q1", text: "How do you decide what to automate first?", mustAsk: true },
        { id: "c1q2", text: "What does a healthy suite look like?", mustAsk: false, followUp: "And an unhealthy one?" },
      ],
    },
    { id: "c2", title: "Collaboration", weight: 1, budgetMin: 4, questions: [{ id: "c2q1", text: "Tell me about a disagreement.", mustAsk: false }] },
  ],
  faq: [{ id: "f1", question: "Is the team hybrid?", answer: "Two office days." }],
  note: "Curious, never a quiz.",
};

/** A draft the server accepts: every competency titled, weighed, budgeted, asked. */
function filled(draft: KitDraft): KitDraft {
  return {
    ...draft,
    competencies: draft.competencies.map((c, i) => ({
      ...c,
      title: c.title || `Competency ${i + 1}`,
      weight: c.weight ?? 2,
      budget: c.budget || "5",
      questions: c.questions.map((q, j) => ({ ...q, text: q.text || `Question ${i + 1}.${j + 1}?` })),
    })),
    faq: draft.faq.map((f, i) => ({ ...f, question: f.question || `FAQ ${i + 1}?`, answer: f.answer || `Answer ${i + 1}.` })),
  };
}

// ---- construction + the wire shape -------------------------------------------------

test("a stored kit round-trips through the draft unchanged", () => {
  const draft = draftFromKit(KIT);
  assert.deepEqual(draftToKit(draft), KIT);
  assert.equal(draftDiffers(draft, KIT), false);
  assert.equal(draftDiffers(patchCompetency(draft, "c1", { title: "Test strategy " }), KIT), false, "trailing space is not a change");
  assert.equal(draftDiffers(patchCompetency(draft, "c1", { title: "Strategy" }), KIT), true);
});

test("a blank kit starts un-weighed and un-budgeted — the editor never invents emphasis", () => {
  const d = blankDraft(counter());
  assert.equal(d.competencies.length, 1);
  assert.equal(d.competencies[0].weight, null);
  assert.equal(d.competencies[0].budget, "");
  const wire = draftToKit(d);
  assert.equal(wire.competencies[0].weight, null, "sent as null so the server would refuse it too");
  assert.equal(wire.competencies[0].budgetMin, null);
  const codes = kitDraftProblems(d).blocking.map((p) => p.code);
  assert.deepEqual(codes, ["titleMissing", "weightMissing", "budgetInvalid", "noQuestions"]);
});

// ---- the row grammar ------------------------------------------------------------------

test("competencies: add, remove, reorder — a move off either end is a no-op", () => {
  const mint = counter();
  let d = draftFromKit(KIT);
  d = addCompetency(d, mint);
  assert.deepEqual(d.competencies.map((c) => c.id), ["c1", "c2", "c-1"]);
  d = moveCompetency(d, "c-1", -1);
  assert.deepEqual(d.competencies.map((c) => c.id), ["c1", "c-1", "c2"]);
  assert.deepEqual(moveCompetency(d, "c1", -1).competencies.map((c) => c.id), ["c1", "c-1", "c2"]);
  assert.deepEqual(moveCompetency(d, "c2", 1).competencies.map((c) => c.id), ["c1", "c-1", "c2"]);
  d = removeCompetency(d, "c-1");
  assert.deepEqual(d.competencies.map((c) => c.id), ["c1", "c2"]);
});

test("the competency cap: an add past KIT_MAX_COMPETENCIES is a no-op", () => {
  const mint = counter();
  let d = blankDraft(mint);
  for (let i = 0; i < KIT_MAX_COMPETENCIES + 3; i += 1) d = addCompetency(d, mint);
  assert.equal(d.competencies.length, KIT_MAX_COMPETENCIES);
});

test("questions: add, remove, reorder inside their competency, and the per-competency cap", () => {
  const mint = counter();
  let d = draftFromKit(KIT);
  d = addQuestion(d, "c1", mint);
  assert.deepEqual(d.competencies[0].questions.map((q) => q.id), ["c1q1", "c1q2", "q-1"]);
  d = moveQuestion(d, "c1", "q-1", -1);
  assert.deepEqual(d.competencies[0].questions.map((q) => q.id), ["c1q1", "q-1", "c1q2"]);
  d = patchQuestion(d, "c1", "q-1", { text: "Who owns flaky tests?", followUp: "And who fixes them?" });
  assert.equal(d.competencies[0].questions[1].text, "Who owns flaky tests?");
  d = removeQuestion(d, "c1", "c1q1");
  assert.deepEqual(d.competencies[0].questions.map((q) => q.id), ["q-1", "c1q2"]);
  assert.deepEqual(d.competencies[1].questions.map((q) => q.id), ["c2q1"], "the other competency is untouched");
  for (let i = 0; i < KIT_MAX_QUESTIONS_PER_COMPETENCY + 2; i += 1) d = addQuestion(d, "c2", mint);
  assert.equal(d.competencies[1].questions.length, KIT_MAX_QUESTIONS_PER_COMPETENCY);
});

test("must-asks: the cap is kit-wide, so the last free slot closes every other toggle", () => {
  const mint = counter();
  let d = blankDraft(mint);
  while (d.competencies.length < 3) d = addCompetency(d, mint);
  for (const c of [...d.competencies]) for (let i = 0; i < 2; i += 1) d = addQuestion(d, c.id, mint);
  const all = d.competencies.flatMap((c) => c.questions.map((q) => ({ c: c.id, q: q.id })));
  for (const { c, q } of all) d = setMustAsk(d, c, q, true);
  assert.equal(mustAskCount(d), KIT_MAX_MUST_ASKS, "switching on past the cap is a no-op");
  const off = all.find(({ c, q }) => !d.competencies.find((x) => x.id === c)!.questions.find((x) => x.id === q)!.mustAsk)!;
  const offQ = d.competencies.find((x) => x.id === off.c)!.questions.find((x) => x.id === off.q)!;
  assert.equal(canMarkMustAsk(d, offQ), false);
  const on = all[0];
  d = setMustAsk(d, on.c, on.q, false);
  assert.equal(mustAskCount(d), KIT_MAX_MUST_ASKS - 1, "switching one OFF is always allowed");
  assert.equal(canMarkMustAsk(d, offQ), true, "and it reopens the slot");
});

test("FAQ: add, remove, reorder, and its cap", () => {
  const mint = counter();
  let d = draftFromKit(KIT);
  d = addFaq(d, mint);
  d = patchFaq(d, "f-1", { question: "Is there on-call?", answer: "One week in six." });
  d = moveFaq(d, "f-1", -1);
  assert.deepEqual(d.faq.map((f) => f.id), ["f-1", "f1"]);
  d = removeFaq(d, "f1");
  assert.deepEqual(d.faq.map((f) => f.id), ["f-1"]);
  for (let i = 0; i < KIT_MAX_FAQ + 2; i += 1) d = addFaq(d, mint);
  assert.equal(d.faq.length, KIT_MAX_FAQ);
});

// ---- the editor's limits ARE the server's ---------------------------------------------

test("no blocking problem ⇔ the server normalizer stores the draft as sent, with no repair", () => {
  const mint = counter();
  let d = blankDraft(mint);
  for (let i = 0; i < KIT_MAX_COMPETENCIES; i += 1) d = addCompetency(d, mint);
  for (const c of d.competencies) for (let i = 0; i < KIT_MAX_QUESTIONS_PER_COMPETENCY; i += 1) d = addQuestion(d, c.id, mint);
  for (let i = 0; i < KIT_MAX_FAQ; i += 1) d = addFaq(d, mint);
  for (const c of d.competencies) for (const q of c.questions) d = setMustAsk(d, c.id, q.id, true);
  d = filled(d);
  assert.deepEqual(kitDraftProblems(d).blocking, []);
  const res = normalizeInterviewKit(draftToKit(d));
  assert.ok(res.ok, "a draft at every cap is accepted");
  if (res.ok) {
    assert.deepEqual(res.adjusted, [], "…and nothing is trimmed, demoted or re-minted");
    assert.deepEqual(res.kit, draftToKit(d), "the stored kit is byte-for-byte the draft (ids kept)");
  }
});

test("every blocking problem is a draft the server refuses or trims", () => {
  const good = filled(draftFromKit(KIT));
  const cases: [string, KitDraft][] = [
    ["no competencies", { ...good, competencies: [] }],
    ["no title", patchCompetency(good, "c1", { title: "  " })],
    ["no weight", patchCompetency(good, "c1", { weight: null })],
    ["budget 0", patchCompetency(good, "c1", { budget: "0" })],
    ["budget fraction", patchCompetency(good, "c1", { budget: "7.5" })],
    ["budget too long", patchCompetency(good, "c1", { budget: String(KIT_MAX_BUDGET_MIN + 1) })],
    ["only empty questions", patchQuestion(patchQuestion(good, "c1", "c1q1", { text: "" }), "c1", "c1q2", { text: " " })],
    ["question too long", patchQuestion(good, "c1", "c1q1", { text: "x".repeat(601) })],
  ];
  for (const [label, d] of cases) {
    assert.ok(kitDraftProblems(d).blocking.length > 0, `${label}: the editor blocks it`);
    const res = normalizeInterviewKit(draftToKit(d));
    assert.ok(!res.ok || res.adjusted.length > 0, `${label}: and the server would refuse or trim it`);
  }
  const atCeiling = patchCompetency(good, "c1", { budget: String(KIT_MAX_BUDGET_MIN) });
  assert.equal(kitDraftProblems(atCeiling).blocking.length, 0, "the budget ceiling itself is allowed");
  assert.ok(normalizeInterviewKit(draftToKit(atCeiling)).ok);
});

test("what a save quietly drops is a NOTE, not a block — and the server really does drop it", () => {
  let d = filled(draftFromKit(KIT));
  d = addQuestion(d, "c1", counter()); // one empty question
  d = addFaq(d, counter());
  d = patchFaq(d, d.faq.at(-1)!.id, { question: "Half typed?" }); // no answer
  const check = kitDraftProblems(d);
  assert.deepEqual(check.blocking, []);
  assert.deepEqual(check.notes.map((n) => n.code), ["emptyQuestionsSkipped", "faqIncompleteSkipped"]);
  const res = normalizeInterviewKit(draftToKit(d));
  assert.ok(res.ok);
  if (res.ok) {
    assert.equal(res.kit.competencies[0].questions.length, 2, "the empty question is not stored");
    assert.equal(res.kit.faq.length, 1, "the half-typed FAQ entry is not stored");
  }
});

// ---- the server's reports, read back -------------------------------------------------

test("adjustments and rejections are read from the server's data, never rendered raw", () => {
  assert.deepEqual(knownAdjustments(["text_truncated", "competencies_truncated", "something_new"]), ["competencies_truncated", "text_truncated"]);
  assert.deepEqual(knownAdjustments(null), []);
  assert.deepEqual(kitRejection({ code: "INTERVIEW_KIT_INVALID", reason: "weight_invalid", at: "competencies[2]" }), { reason: "weight_invalid", competency: 3 });
  assert.deepEqual(kitRejection({ reason: "no_competencies", at: null }), { reason: "no_competencies", competency: null });
  assert.equal(kitRejection({ reason: "made_up" }), null);
});

// ---- versions ------------------------------------------------------------------------

const v = (version: number, status: "draft" | "published") => ({
  id: `ikit-${version}`,
  workspaceId: "w",
  jobId: "j",
  version,
  status,
  source: "edited" as const,
  createdAt: "2026-09-18T00:00:00.000Z",
  kit: KIT,
});

test("the editor opens work in progress first, else the live version", () => {
  const state = (published: number | null, draft: number | null): KitState => ({
    published: published ? v(published, "published") : null,
    draft: draft ? v(draft, "draft") : null,
    versions: [],
  });
  assert.equal(openVersion(state(2, 3))?.version, 3);
  assert.equal(newerDraft(state(3, 2)), null, "a draft older than the live version is history");
  assert.equal(openVersion(state(3, 2))?.version, 3);
  assert.equal(openVersion(state(null, 1))?.version, 1);
  assert.equal(openVersion(null), null);
});

test("publishing is offered only where it changes what new links mint from", () => {
  const state: KitState = { published: v(3, "published"), draft: v(4, "draft"), versions: [] };
  assert.equal(canPublishVersion({ status: "draft", version: 4 }, state), true);
  assert.equal(canPublishVersion({ status: "draft", version: 2 }, state), false, "an older draft would publish and change nothing");
  assert.equal(canPublishVersion({ status: "published", version: 3 }, state), false);
  assert.equal(canPublishVersion({ status: "draft", version: 1 }, { published: null, draft: null, versions: [] }), true);
});

test("a rehearsal link is followed only as a same-origin interview path", () => {
  assert.equal(rehearsalTarget({ url: "/interview/tk_abc123" }), "/interview/tk_abc123");
  assert.equal(rehearsalTarget({ url: "https://evil.test/interview/x" }), null);
  assert.equal(rehearsalTarget({ url: "//evil.test/interview/x" }), null);
  assert.equal(rehearsalTarget({ url: "/interview/" }), null);
  assert.equal(rehearsalTarget({ url: "/interview//evil.test" }), null);
  assert.equal(rehearsalTarget({ url: "/interview/\\evil" }), null);
  assert.equal(rehearsalTarget({ url: "/apply/x" }), null);
  assert.equal(rehearsalTarget({}), null);
  assert.equal(rehearsalTarget(null), null);
});
