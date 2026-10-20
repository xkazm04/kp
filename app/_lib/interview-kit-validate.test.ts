// The kit trust boundary (interview-kit-validate.ts) — the one module that stands
// between untrusted JSON and the append-only `interview_kits` table.
//
// It is worth its own behavioural suite rather than a source guard, because both of its
// callers hand it adversary-shaped input for different reasons: a browser PUT is arbitrary
// JSON from a client this app does not control, and the generator's output is arbitrary
// JSON from a language model. The two must be repaired and refused by the SAME rules, or
// the caps stop meaning the same thing depending on which door a kit came through.
//
// Pure module, no DB, no request — so this file imports it directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  KIT_MAX_BUDGET_MIN,
  normalizeInterviewKit,
  type KitNormalizeResult,
} from "./interview-kit-validate.ts";
import {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_FAQ,
  KIT_MAX_FAQ_ANSWER_CHARS,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  KIT_MAX_TEXT_CHARS,
  KIT_WEIGHTS,
} from "./interview-kit-types.ts";

/** A minimal valid competency, overridable field by field. */
function competency(over: Record<string, unknown> = {}) {
  return {
    title: "Service ownership",
    weight: 2,
    budgetMin: 10,
    questions: [{ text: "Walk me through a service you owned end to end.", mustAsk: false }],
    ...over,
  };
}

function ok(result: KitNormalizeResult) {
  assert.equal(result.ok, true, `expected a usable kit, got ${result.ok === false ? result.reason : "?"}`);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

test("a well-formed kit survives unchanged, and carries no adjustments", () => {
  const { kit, adjusted } = ok(
    normalizeInterviewKit({
      version: 1,
      competencies: [{ ...competency(), id: "c-own" , questions: [{ id: "q-own", text: "What did you own?", mustAsk: true }] }],
      faq: [{ id: "f-loc", question: "Where is the role based?", answer: "Brno, hybrid." }],
      note: "Keep it conversational.",
    })
  );
  assert.equal(kit.version, 1);
  assert.deepEqual(
    kit.competencies[0],
    { id: "c-own", title: "Service ownership", weight: 2, budgetMin: 10, questions: [{ id: "q-own", text: "What did you own?", mustAsk: true }] },
    "author-supplied ids must be PRESERVED — an overlay already names them"
  );
  assert.deepEqual(kit.faq, [{ id: "f-loc", question: "Where is the role based?", answer: "Brno, hybrid." }]);
  assert.equal(kit.note, "Keep it conversational.");
  assert.deepEqual(adjusted, [], "nothing was repaired, so nothing may be reported as repaired");
});

test("ids are minted where missing and are unique across the WHOLE kit, not per list", () => {
  // The collision that matters: a FAQ entry that claims the id a question already has.
  // A KitOverlay drops questions by id, so a shared id would let one drop take two things.
  const { kit, adjusted } = ok(
    normalizeInterviewKit({
      competencies: [
        competency({ questions: [{ id: "shared", text: "A?" }, { text: "B?" }] }),
        competency({ title: "Second", questions: [{ text: "C?" }] }),
      ],
      faq: [{ id: "shared", question: "Q?", answer: "A." }],
    })
  );
  const ids = [
    ...kit.competencies.map((c) => c.id),
    ...kit.competencies.flatMap((c) => c.questions.map((q) => q.id)),
    ...kit.faq.map((f) => f.id),
  ];
  assert.equal(new Set(ids).size, ids.length, `ids must be unique across the kit: ${ids.join(", ")}`);
  assert.ok(ids.includes("shared"), "the first claimant of an id keeps it");
  assert.ok(adjusted.includes("ids_minted"));
});

test("caps are REPAIRED by truncation, and the repair is reported", () => {
  const tooMany = Array.from({ length: KIT_MAX_COMPETENCIES + 3 }, (_, i) => competency({ title: `Area ${i}` }));
  const { kit, adjusted } = ok(normalizeInterviewKit({ competencies: tooMany }));
  assert.equal(kit.competencies.length, KIT_MAX_COMPETENCIES);
  assert.equal(kit.competencies[0].title, "Area 0", "truncation keeps the author's own order");
  assert.ok(adjusted.includes("competencies_truncated"));

  const longList = Array.from({ length: KIT_MAX_QUESTIONS_PER_COMPETENCY + 2 }, (_, i) => ({ text: `Q${i}?` }));
  const questions = ok(normalizeInterviewKit({ competencies: [competency({ questions: longList })] }));
  assert.equal(questions.kit.competencies[0].questions.length, KIT_MAX_QUESTIONS_PER_COMPETENCY);
  assert.ok(questions.adjusted.includes("questions_truncated"));

  const faq = Array.from({ length: KIT_MAX_FAQ + 4 }, (_, i) => ({ question: `Q${i}?`, answer: `A${i}.` }));
  const faqResult = ok(normalizeInterviewKit({ competencies: [competency()], faq }));
  assert.equal(faqResult.kit.faq.length, KIT_MAX_FAQ);
  assert.ok(faqResult.adjusted.includes("faq_truncated"));
});

test("a must-ask over the kit-wide cap is DEMOTED, never dropped", () => {
  // The distinction the header draws: the question still gets asked, it just stops being
  // the one the director overruns the clock for.
  const questions = Array.from({ length: KIT_MAX_MUST_ASKS + 2 }, (_, i) => ({ text: `Q${i}?`, mustAsk: true }));
  const competencies = questions.map((q, i) => competency({ title: `Area ${i}`, questions: [q] }));
  const { kit, adjusted } = ok(normalizeInterviewKit({ competencies }));
  const all = kit.competencies.flatMap((c) => c.questions);
  assert.equal(all.length, questions.length, "no question may be lost to the must-ask cap");
  assert.equal(all.filter((q) => q.mustAsk).length, KIT_MAX_MUST_ASKS);
  assert.ok(adjusted.includes("must_asks_demoted"));
});

test("text is trimmed and capped, and the cut is reported", () => {
  const { kit, adjusted } = ok(
    normalizeInterviewKit({
      competencies: [competency({ title: `  ${"t".repeat(KIT_MAX_TEXT_CHARS + 50)}  ` })],
      faq: [{ question: "Q?", answer: "a".repeat(KIT_MAX_FAQ_ANSWER_CHARS + 50) }],
    })
  );
  assert.equal(kit.competencies[0].title.length, KIT_MAX_TEXT_CHARS);
  assert.equal(kit.faq[0].answer.length, KIT_MAX_FAQ_ANSWER_CHARS);
  assert.ok(adjusted.includes("text_truncated"));
});

test("a WRONG VALUE is refused rather than defaulted — the author has to be told", () => {
  // The other half of the repair/refuse line: silently substituting a weight nobody typed
  // would present the product's guess as the recruiter's own emphasis.
  for (const weight of [0, 4, 2.5, "2", null, undefined]) {
    const result = normalizeInterviewKit({ competencies: [competency({ weight })] });
    assert.equal(result.ok, false, `weight ${String(weight)} must be refused`);
    if (!result.ok) assert.equal(result.reason, "weight_invalid");
  }
  for (const weight of KIT_WEIGHTS) {
    assert.equal(normalizeInterviewKit({ competencies: [competency({ weight })] }).ok, true);
  }
  for (const budgetMin of [0, -5, 7.5, "10", null, KIT_MAX_BUDGET_MIN + 1]) {
    const result = normalizeInterviewKit({ competencies: [competency({ budgetMin })] });
    assert.equal(result.ok, false, `budget ${String(budgetMin)} must be refused`);
    if (!result.ok) assert.equal(result.reason, "budget_invalid");
  }
});

test("a kit with nothing to ask is refused, and says which part is empty", () => {
  for (const [input, reason] of [
    [null, "not_an_object"],
    ["a kit", "not_an_object"],
    [[], "not_an_object"],
    [{}, "no_competencies"],
    [{ competencies: [] }, "no_competencies"],
    [{ competencies: [competency({ title: "   " })] }, "competency_has_no_title"],
    [{ competencies: [competency({ questions: [] })] }, "competency_has_no_questions"],
    [{ competencies: [competency({ questions: [{ text: "  " }, 7] })] }, "competency_has_no_questions"],
  ] as const) {
    const result = normalizeInterviewKit(input);
    assert.equal(result.ok, false, `${JSON.stringify(input)} must be refused`);
    if (!result.ok) assert.equal(result.reason, reason);
  }
});

test("a half-written FAQ row is dropped, not refused — a save must not be blocked by it", () => {
  const { kit } = ok(
    normalizeInterviewKit({
      competencies: [competency()],
      faq: [{ question: "Is there a bonus?" }, { answer: "Yes." }, { question: "Remote?", answer: "Two days a week." }],
    })
  );
  assert.deepEqual(
    kit.faq.map((f) => f.question),
    ["Remote?"],
    "a question with no answer invites the interviewer to improvise a role fact"
  );
});

test("the normalizer never throws, whatever it is handed", () => {
  for (const hostile of [
    undefined,
    0,
    { competencies: "not a list" },
    { competencies: [competency({ questions: { text: "not a list" } })] },
    { competencies: [competency()], faq: "no" },
    { competencies: [competency()], note: { nested: true } },
    { competencies: [competency({ id: "x".repeat(500) })] },
  ]) {
    assert.doesNotThrow(() => normalizeInterviewKit(hostile), `threw on ${JSON.stringify(hostile)}`);
  }
});
