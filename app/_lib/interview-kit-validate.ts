// The ONE trust boundary for an incoming job interview kit (spark
// interview-kit-template, WP-A).
//
// Everything that can put a kit into `interview_kits` goes through here: the recruiter's
// PUT (arbitrary JSON from a browser) and the generator's own output (arbitrary JSON from
// a language model). Both are untrusted in exactly the same way, so there is one
// normalizer rather than a validator for the human and a coercer for the machine —
// otherwise the two drift and the caps stop meaning the same thing on the two paths.
//
// PURE. No DB, no request, no i18n: it takes `unknown` and answers a contract-shaped
// `InterviewKit` or a refusal reason. The route turns the reason into a coded refusal;
// this module never throws, because a malformed body is an expected outcome on a public
// write door, not a fault.
//
// THE REPAIR/REFUSE LINE, stated once so both callers inherit it:
//
//   * A CAP is repaired by TRUNCATION. The caps in interview-kit-types.ts exist because
//     a kit is read aloud inside a booked call, and a kit that cannot fit its own
//     interview is an authoring error. Dropping the overflow is a safe, deterministic
//     repair (the first N in the author's own order), and the caller is told what was
//     trimmed through `adjusted` so the editor can say so rather than silently losing
//     work. A must-ask over the cap is DEMOTED, never dropped — the question survives,
//     it just stops being unskippable.
//   * A VALUE the author got wrong is REFUSED. A weight outside KIT_WEIGHTS or a budget
//     that is not a positive whole number of minutes is not a cap collision, it is a
//     mistake, and silently substituting a number nobody typed is how a scorecard ends
//     up emphasising a competency the recruiter never chose.
//   * NOTHING USABLE is refused. A kit with no competency, or a competency with no
//     question, cannot run an interview.
//
// IDS. Question ids are what a per-candidate overlay names (KitOverlay.dropped/edited),
// so they must be unique ACROSS the whole kit, not just within their list — an overlay
// that drops "q1" must not silently drop a FAQ entry too. A valid, unique, incoming id is
// PRESERVED (an edit must not orphan the overlays already written against it); anything
// missing, malformed or colliding is minted positionally.

import {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_FAQ,
  KIT_MAX_FAQ_ANSWER_CHARS,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  KIT_MAX_TEXT_CHARS,
  KIT_WEIGHTS,
  type InterviewKit,
  type KitCompetency,
  type KitFaqEntry,
  type KitQuestion,
  type KitWeight,
} from "./interview-kit-types";

/** Why a kit could not be made valid. A stable slug, not a sentence: the route answers
 *  the coded refusal `INTERVIEW_KIT_INVALID` (localized by the reader's catalog) and
 *  carries this alongside as diagnostic data for the editor. */
export type KitRejection =
  | "not_an_object"
  | "no_competencies"
  | "competency_has_no_title"
  | "competency_has_no_questions"
  | "weight_invalid"
  | "budget_invalid";

/** A repair this module made on the way in. Reported so the caller can tell the author
 *  their kit was trimmed instead of pretending it arrived this way. */
export type KitAdjustment =
  | "competencies_truncated"
  | "questions_truncated"
  | "faq_truncated"
  | "must_asks_demoted"
  | "text_truncated"
  | "ids_minted";

export type KitNormalizeResult =
  | { ok: true; kit: InterviewKit; adjusted: KitAdjustment[] }
  | { ok: false; reason: KitRejection; at?: string };

/** The longest a competency's planned minutes may be. Not a technical bound — past this
 *  a "competency budget" is a whole interview, and the agenda fits the kit to the length
 *  the candidate was actually booked for anyway, so a four-hour block is a typo. */
export const KIT_MAX_BUDGET_MIN = 240;

function text(value: unknown, cap: number): { value: string; truncated: boolean } {
  if (typeof value !== "string") return { value: "", truncated: false };
  const trimmed = value.trim();
  return trimmed.length > cap ? { value: trimmed.slice(0, cap).trim(), truncated: true } : { value: trimmed, truncated: false };
}

function isWeight(value: unknown): value is KitWeight {
  return typeof value === "number" && (KIT_WEIGHTS as readonly number[]).includes(value);
}

/** An id is usable when it is a short, non-empty string that no earlier element in this
 *  kit already claimed. Bounded because it is persisted and echoed back into an overlay. */
const MAX_ID_CHARS = 64;
function usableId(value: unknown, taken: Set<string>): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id || id.length > MAX_ID_CHARS || taken.has(id)) return null;
  return id;
}

/**
 * Narrow untrusted input to a storable `InterviewKit`, or say why it cannot be one.
 *
 * Never throws. Never reaches a store, a request or a catalog — see the header for the
 * repair/refuse line every caller inherits.
 */
export function normalizeInterviewKit(value: unknown): KitNormalizeResult {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, reason: "not_an_object" };
  }
  const raw = value as { competencies?: unknown; faq?: unknown; note?: unknown };
  const adjustments = new Set<KitAdjustment>();
  const taken = new Set<string>();

  const incomingCompetencies = Array.isArray(raw.competencies) ? raw.competencies : [];
  if (incomingCompetencies.length > KIT_MAX_COMPETENCIES) adjustments.add("competencies_truncated");

  const competencies: KitCompetency[] = [];
  let mustAsks = 0;

  for (const [index, entry] of incomingCompetencies.slice(0, KIT_MAX_COMPETENCIES).entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return { ok: false, reason: "competency_has_no_title", at: `competencies[${index}]` };
    }
    const c = entry as { id?: unknown; title?: unknown; weight?: unknown; budgetMin?: unknown; questions?: unknown };

    const title = text(c.title, KIT_MAX_TEXT_CHARS);
    if (title.truncated) adjustments.add("text_truncated");
    if (!title.value) return { ok: false, reason: "competency_has_no_title", at: `competencies[${index}]` };

    // A weight is REQUIRED and must be one of the three coarse steps. Absent is a
    // refusal rather than a default: the weights ORDER the scorecard, and an invented
    // "2" would present the product's own guess as the recruiter's emphasis.
    if (!isWeight(c.weight)) return { ok: false, reason: "weight_invalid", at: `competencies[${index}]` };
    if (
      typeof c.budgetMin !== "number" ||
      !Number.isInteger(c.budgetMin) ||
      c.budgetMin <= 0 ||
      c.budgetMin > KIT_MAX_BUDGET_MIN
    ) {
      return { ok: false, reason: "budget_invalid", at: `competencies[${index}]` };
    }

    const incomingQuestions = Array.isArray(c.questions) ? c.questions : [];
    if (incomingQuestions.length > KIT_MAX_QUESTIONS_PER_COMPETENCY) adjustments.add("questions_truncated");

    const competencyId = usableId(c.id, taken);
    if (!competencyId) adjustments.add("ids_minted");
    const resolvedCompetencyId = competencyId ?? `c${index + 1}`;
    // A minted id can itself collide with an author-supplied one further down the list;
    // suffix until it does not, so "unique within the kit" is a property, not a hope.
    let finalCompetencyId = resolvedCompetencyId;
    let bump = 1;
    while (taken.has(finalCompetencyId)) finalCompetencyId = `${resolvedCompetencyId}-${++bump}`;
    taken.add(finalCompetencyId);

    const questions: KitQuestion[] = [];
    for (const [qIndex, qEntry] of incomingQuestions.slice(0, KIT_MAX_QUESTIONS_PER_COMPETENCY).entries()) {
      if (qEntry === null || typeof qEntry !== "object" || Array.isArray(qEntry)) continue;
      const q = qEntry as { id?: unknown; text?: unknown; mustAsk?: unknown; followUp?: unknown };
      const qText = text(q.text, KIT_MAX_TEXT_CHARS);
      if (qText.truncated) adjustments.add("text_truncated");
      if (!qText.value) continue; // an empty question is nothing to ask, not a refusal

      const qId = usableId(q.id, taken);
      if (!qId) adjustments.add("ids_minted");
      const baseQId = qId ?? `${finalCompetencyId}q${qIndex + 1}`;
      let finalQId = baseQId;
      let qBump = 1;
      while (taken.has(finalQId)) finalQId = `${baseQId}-${++qBump}`;
      taken.add(finalQId);

      // The must-ask budget is kit-wide (KIT_MAX_MUST_ASKS), so it is spent in author
      // order and the overflow is DEMOTED — the question still gets asked when the
      // clock allows, it just stops being the one the director overruns for.
      let mustAsk = q.mustAsk === true;
      if (mustAsk) {
        if (mustAsks >= KIT_MAX_MUST_ASKS) {
          mustAsk = false;
          adjustments.add("must_asks_demoted");
        } else {
          mustAsks += 1;
        }
      }

      const followUp = text(q.followUp, KIT_MAX_TEXT_CHARS);
      if (followUp.truncated) adjustments.add("text_truncated");
      questions.push({
        id: finalQId,
        text: qText.value,
        mustAsk,
        ...(followUp.value ? { followUp: followUp.value } : {}),
      });
    }

    if (questions.length === 0) {
      return { ok: false, reason: "competency_has_no_questions", at: `competencies[${index}]` };
    }
    competencies.push({ id: finalCompetencyId, title: title.value, weight: c.weight, budgetMin: c.budgetMin, questions });
  }

  if (competencies.length === 0) return { ok: false, reason: "no_competencies" };

  const incomingFaq = Array.isArray(raw.faq) ? raw.faq : [];
  if (incomingFaq.length > KIT_MAX_FAQ) adjustments.add("faq_truncated");
  const faq: KitFaqEntry[] = [];
  for (const [index, entry] of incomingFaq.slice(0, KIT_MAX_FAQ).entries()) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const f = entry as { id?: unknown; question?: unknown; answer?: unknown };
    const question = text(f.question, KIT_MAX_TEXT_CHARS);
    const answer = text(f.answer, KIT_MAX_FAQ_ANSWER_CHARS);
    if (question.truncated || answer.truncated) adjustments.add("text_truncated");
    // Both halves are load-bearing: a question with no answer is a prompt for the
    // interviewer to improvise a role fact, which is the one thing the FAQ exists to
    // prevent. Dropped rather than refused — a half-typed FAQ row must not block a save.
    if (!question.value || !answer.value) continue;
    const fId = usableId(f.id, taken);
    if (!fId) adjustments.add("ids_minted");
    const baseFId = fId ?? `f${index + 1}`;
    let finalFId = baseFId;
    let fBump = 1;
    while (taken.has(finalFId)) finalFId = `${baseFId}-${++fBump}`;
    taken.add(finalFId);
    faq.push({ id: finalFId, question: question.value, answer: answer.value });
  }

  // The author's note to the interviewer is never read aloud, so it gets the FAQ
  // answer's budget rather than the question budget — it is a paragraph, not a label.
  const note = text(raw.note, KIT_MAX_FAQ_ANSWER_CHARS);
  if (note.truncated) adjustments.add("text_truncated");

  return {
    ok: true,
    kit: { version: 1, competencies, faq, ...(note.value ? { note: note.value } : {}) },
    adjusted: [...adjustments],
  };
}
