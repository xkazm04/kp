// Pure editing model for the job interview kit (spark interview-kit-template, WP-C).
//
// No JSX, no hooks, no fetch — so every rule the Kit tab enforces is unit-testable, and
// so the editor can answer "would the server refuse this?" BEFORE it asks. The server's
// trust boundary is app/_lib/interview-kit-validate.ts; this is its local echo, and it
// reads that module's own caps (KIT_MAX_* from the contract, KIT_MAX_BUDGET_MIN from the
// validator) rather than restating any number. jobsKitModel.test.ts runs the draft
// through the REAL normalizer and pins that "no blocking problem here" means "the
// server stores it untrimmed" — the same client-echo shape pipelineAxisDraft.ts holds
// for the pipeline axis.
//
// THE ROW GRAMMAR is the pipeline-axis editor's (PipelineStepRow / pipelineAxisDraft):
// an ordered list, one move up / move down / remove per row, a move off either end is a
// no-op rather than an error, and an add past the cap is a no-op too (the button is
// disabled there; a keyboard repeat must not throw).
//
// IDS ARE MINTED HERE, not left to the server. A kit question's id is what a candidate's
// overlay names (KitOverlay.dropped / edited), and the validator mints a missing id
// POSITIONALLY ("c1q2"): a new question saved without an id could inherit the position
// — and so the overlay entries — of a question deleted in an earlier version. A random
// id per new item cannot. An existing item keeps its stored id for the same reason in
// reverse: an edit must not orphan the overlays already written against it.

import {
  KIT_MAX_COMPETENCIES,
  KIT_MAX_FAQ,
  KIT_MAX_FAQ_ANSWER_CHARS,
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  KIT_MAX_TEXT_CHARS,
  KIT_WEIGHTS,
  type InterviewKit,
  type KitWeight,
  type StoredInterviewKit,
} from "@/app/_lib/interview-kit-types";
import { KIT_MAX_BUDGET_MIN, type KitAdjustment, type KitRejection } from "@/app/_lib/interview-kit-validate";

export type KitDraftQuestion = { id: string; text: string; mustAsk: boolean; followUp: string };

export type KitDraftCompetency = {
  id: string;
  title: string;
  /** Null for a competency the author has not weighed yet. Never defaulted: the
   *  validator REFUSES a missing weight because an invented one would present the
   *  product's guess as the recruiter's emphasis, and the editor holds the same line. */
  weight: KitWeight | null;
  /** The minutes field as typed, so a half-typed value is not coerced mid-edit. */
  budget: string;
  questions: KitDraftQuestion[];
};

export type KitDraftFaq = { id: string; question: string; answer: string };

export type KitDraft = { competencies: KitDraftCompetency[]; faq: KitDraftFaq[]; note: string };

/** Mints a new, kit-unique id. Injected so tests are deterministic. */
export type Mint = (prefix: "c" | "q" | "f") => string;

export const mintKitId: Mint = (prefix) => {
  const rand =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}-${rand}`;
};

/** The weights, heaviest first — the order the editor offers them in. */
export const KIT_WEIGHTS_DESC: readonly KitWeight[] = [...KIT_WEIGHTS].sort((a, b) => b - a);

export const isKitWeight = (v: unknown): v is KitWeight => (KIT_WEIGHTS as readonly unknown[]).includes(v);

// ---- construction ---------------------------------------------------------------------

export function draftFromKit(kit: InterviewKit): KitDraft {
  return {
    competencies: (kit.competencies ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      weight: isKitWeight(c.weight) ? c.weight : null,
      budget: String(c.budgetMin),
      questions: (c.questions ?? []).map((q) => ({ id: q.id, text: q.text, mustAsk: q.mustAsk === true, followUp: q.followUp ?? "" })),
    })),
    faq: (kit.faq ?? []).map((f) => ({ id: f.id, question: f.question, answer: f.answer })),
    note: kit.note ?? "",
  };
}

function blankQuestion(mint: Mint): KitDraftQuestion {
  return { id: mint("q"), text: "", mustAsk: false, followUp: "" };
}

function blankCompetency(mint: Mint): KitDraftCompetency {
  return { id: mint("c"), title: "", weight: null, budget: "", questions: [blankQuestion(mint)] };
}

/** A kit written from scratch: one blank competency with one blank question. */
export function blankDraft(mint: Mint = mintKitId): KitDraft {
  return { competencies: [blankCompetency(mint)], faq: [], note: "" };
}

/** A whole number of minutes, or NaN. "12" is 12; "12.5", "", "abc" are NaN. */
export function parseBudget(raw: string): number {
  const s = raw.trim();
  return /^\d+$/.test(s) ? Number(s) : NaN;
}

/** Whether a typed budget is one the server stores: a whole number of minutes from 1
 *  to the validator's KIT_MAX_BUDGET_MIN. The field and the problem list read this one
 *  rule, so the red border and the listed problem can never disagree. */
export function budgetValid(raw: string): boolean {
  const n = parseBudget(raw);
  return Number.isFinite(n) && n > 0 && n <= KIT_MAX_BUDGET_MIN;
}

/** The draft as the PUT body's `kit`. Texts are trimmed (the server trims too, so the
 *  dirty check compares like with like); empty optional fields are omitted. A missing
 *  weight or an unparseable budget is sent as null so the SERVER still refuses it if the
 *  editor's own block were ever bypassed — never replaced with a number nobody typed. */
export function draftToKit(draft: KitDraft) {
  const note = draft.note.trim();
  return {
    version: 1 as const,
    competencies: draft.competencies.map((c) => {
      const budget = parseBudget(c.budget);
      return {
        id: c.id,
        title: c.title.trim(),
        weight: c.weight,
        budgetMin: Number.isFinite(budget) ? budget : null,
        questions: c.questions.map((q) => {
          const followUp = q.followUp.trim();
          return { id: q.id, text: q.text.trim(), mustAsk: q.mustAsk, ...(followUp ? { followUp } : {}) };
        }),
      };
    }),
    faq: draft.faq.map((f) => ({ id: f.id, question: f.question.trim(), answer: f.answer.trim() })),
    ...(note ? { note } : {}),
  };
}

/** True when the draft says something different from `base` — what "Save" and the
 *  leave-without-saving guard ask. Compared on the wire shape, so whitespace a
 *  recruiter typed and the server would trim is not a change. */
export function draftDiffers(draft: KitDraft, base: InterviewKit | null): boolean {
  if (!base) return true;
  return JSON.stringify(draftToKit(draft)) !== JSON.stringify(draftToKit(draftFromKit(base)));
}

// ---- list grammar (the PipelineStepRow rules, for any list keyed by id) ----------------

/** Move one item up (-1) or down (+1). Off either end is a no-op — mirrors moveStage. */
export function moveById<T extends { id: string }>(list: readonly T[], id: string, delta: -1 | 1): T[] {
  const from = list.findIndex((x) => x.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

const patchById = <T extends { id: string }>(list: readonly T[], id: string, patch: Partial<NoInfer<T>>): T[] =>
  list.map((x) => (x.id === id ? { ...x, ...patch } : x));

// ---- competencies ---------------------------------------------------------------------

export const canAddCompetency = (draft: KitDraft) => draft.competencies.length < KIT_MAX_COMPETENCIES;

export function addCompetency(draft: KitDraft, mint: Mint = mintKitId): KitDraft {
  if (!canAddCompetency(draft)) return draft;
  return { ...draft, competencies: [...draft.competencies, blankCompetency(mint)] };
}

export function removeCompetency(draft: KitDraft, id: string): KitDraft {
  return { ...draft, competencies: draft.competencies.filter((c) => c.id !== id) };
}

export function moveCompetency(draft: KitDraft, id: string, delta: -1 | 1): KitDraft {
  return { ...draft, competencies: moveById(draft.competencies, id, delta) };
}

export function patchCompetency(
  draft: KitDraft,
  id: string,
  patch: Partial<Pick<KitDraftCompetency, "title" | "weight" | "budget">>
): KitDraft {
  return { ...draft, competencies: patchById(draft.competencies, id, patch) };
}

// ---- questions ------------------------------------------------------------------------

export const canAddQuestion = (c: KitDraftCompetency) => c.questions.length < KIT_MAX_QUESTIONS_PER_COMPETENCY;

function withQuestions(draft: KitDraft, competencyId: string, fn: (qs: KitDraftQuestion[]) => KitDraftQuestion[]): KitDraft {
  return {
    ...draft,
    competencies: draft.competencies.map((c) => (c.id === competencyId ? { ...c, questions: fn(c.questions) } : c)),
  };
}

export function addQuestion(draft: KitDraft, competencyId: string, mint: Mint = mintKitId): KitDraft {
  const c = draft.competencies.find((x) => x.id === competencyId);
  if (!c || !canAddQuestion(c)) return draft;
  return withQuestions(draft, competencyId, (qs) => [...qs, blankQuestion(mint)]);
}

export function removeQuestion(draft: KitDraft, competencyId: string, questionId: string): KitDraft {
  return withQuestions(draft, competencyId, (qs) => qs.filter((q) => q.id !== questionId));
}

export function moveQuestion(draft: KitDraft, competencyId: string, questionId: string, delta: -1 | 1): KitDraft {
  return withQuestions(draft, competencyId, (qs) => moveById(qs, questionId, delta));
}

export function patchQuestion(
  draft: KitDraft,
  competencyId: string,
  questionId: string,
  patch: Partial<Pick<KitDraftQuestion, "text" | "followUp">>
): KitDraft {
  return withQuestions(draft, competencyId, (qs) => patchById(qs, questionId, patch));
}

export const mustAskCount = (draft: KitDraft) =>
  draft.competencies.reduce((n, c) => n + c.questions.filter((q) => q.mustAsk).length, 0);

/** Whether this question's must-ask toggle may be switched ON. The cap is KIT-wide
 *  (every must-ask can hold the call past its booked time), so the last free slot
 *  anywhere in the kit closes every other toggle; turning one off is always allowed. */
export const canMarkMustAsk = (draft: KitDraft, q: KitDraftQuestion) => q.mustAsk || mustAskCount(draft) < KIT_MAX_MUST_ASKS;

export function setMustAsk(draft: KitDraft, competencyId: string, questionId: string, on: boolean): KitDraft {
  const q = draft.competencies.find((c) => c.id === competencyId)?.questions.find((x) => x.id === questionId);
  if (!q || q.mustAsk === on) return draft;
  if (on && !canMarkMustAsk(draft, q)) return draft;
  return withQuestions(draft, competencyId, (qs) => patchById(qs, questionId, { mustAsk: on }));
}

// ---- FAQ + note -----------------------------------------------------------------------

export const canAddFaq = (draft: KitDraft) => draft.faq.length < KIT_MAX_FAQ;

export function addFaq(draft: KitDraft, mint: Mint = mintKitId): KitDraft {
  if (!canAddFaq(draft)) return draft;
  return { ...draft, faq: [...draft.faq, { id: mint("f"), question: "", answer: "" }] };
}

export const removeFaq = (draft: KitDraft, id: string): KitDraft => ({ ...draft, faq: draft.faq.filter((f) => f.id !== id) });

export const moveFaq = (draft: KitDraft, id: string, delta: -1 | 1): KitDraft => ({ ...draft, faq: moveById(draft.faq, id, delta) });

export const patchFaq = (draft: KitDraft, id: string, patch: Partial<Pick<KitDraftFaq, "question" | "answer">>): KitDraft => ({
  ...draft,
  faq: patchById(draft.faq, id, patch),
});

export const setNote = (draft: KitDraft, note: string): KitDraft => ({ ...draft, note });

// ---- what the server would say ----------------------------------------------------------

/** A reason the draft cannot be saved (BLOCKING — the validator would refuse it or
 *  trim it), or something a save will quietly leave out (a NOTE). Machine codes; the
 *  view owns the words. `competency` is 1-based, the way the list numbers its rows. */
export type KitDraftProblem =
  | { code: "noCompetencies" }
  | { code: "titleMissing"; competency: number }
  | { code: "weightMissing"; competency: number }
  | { code: "budgetInvalid"; competency: number; max: number }
  | { code: "noQuestions"; competency: number }
  | { code: "textTooLong" }
  | { code: "emptyQuestionsSkipped"; count: number }
  | { code: "faqIncompleteSkipped"; count: number };

export type KitDraftCheck = { blocking: KitDraftProblem[]; notes: KitDraftProblem[] };

/** Every reason the server would refuse (or trim) this draft, in list order, plus what a
 *  save would silently drop. `blocking` empty ⇒ normalizeInterviewKit accepts the draft
 *  with no truncation (pinned by jobsKitModel.test.ts). The COUNT caps (competencies,
 *  questions, FAQ, must-asks) cannot be exceeded through the reducers above, so they
 *  are enforced where they are reached — the disabled add/toggle — not listed here. */
export function kitDraftProblems(draft: KitDraft): KitDraftCheck {
  const blocking: KitDraftProblem[] = [];
  const notes: KitDraftProblem[] = [];
  if (draft.competencies.length === 0) blocking.push({ code: "noCompetencies" });
  let emptyQuestions = 0;
  let tooLong = false;
  draft.competencies.forEach((c, i) => {
    const n = i + 1;
    if (!c.title.trim()) blocking.push({ code: "titleMissing", competency: n });
    if (c.weight === null) blocking.push({ code: "weightMissing", competency: n });
    if (!budgetValid(c.budget)) {
      blocking.push({ code: "budgetInvalid", competency: n, max: KIT_MAX_BUDGET_MIN });
    }
    const asked = c.questions.filter((q) => q.text.trim() !== "");
    if (asked.length === 0) blocking.push({ code: "noQuestions", competency: n });
    emptyQuestions += c.questions.length - asked.length;
    if (c.title.trim().length > KIT_MAX_TEXT_CHARS) tooLong = true;
    for (const q of c.questions) {
      if (q.text.trim().length > KIT_MAX_TEXT_CHARS || q.followUp.trim().length > KIT_MAX_TEXT_CHARS) tooLong = true;
    }
  });
  for (const f of draft.faq) {
    if (f.question.trim().length > KIT_MAX_TEXT_CHARS || f.answer.trim().length > KIT_MAX_FAQ_ANSWER_CHARS) tooLong = true;
  }
  if (draft.note.trim().length > KIT_MAX_FAQ_ANSWER_CHARS) tooLong = true;
  if (tooLong) blocking.push({ code: "textTooLong" });
  if (emptyQuestions > 0) notes.push({ code: "emptyQuestionsSkipped", count: emptyQuestions });
  const incompleteFaq = draft.faq.filter((f) => !f.question.trim() || !f.answer.trim()).length;
  if (incompleteFaq > 0) notes.push({ code: "faqIncompleteSkipped", count: incompleteFaq });
  return { blocking, notes };
}

/** The repairs the server reports in `adjusted`, in a stable display order. Unknown
 *  strings (a newer server) are dropped rather than rendered as a raw slug. */
const ADJUSTMENTS: readonly KitAdjustment[] = [
  "competencies_truncated",
  "questions_truncated",
  "faq_truncated",
  "must_asks_demoted",
  "text_truncated",
  "ids_minted",
];
export function knownAdjustments(adjusted: unknown): KitAdjustment[] {
  if (!Array.isArray(adjusted)) return [];
  return ADJUSTMENTS.filter((a) => adjusted.includes(a));
}

const REJECTIONS: readonly KitRejection[] = [
  "not_an_object",
  "no_competencies",
  "competency_has_no_title",
  "competency_has_no_questions",
  "weight_invalid",
  "budget_invalid",
];

/** The field an INTERVIEW_KIT_INVALID refusal points at, from its `reason`/`at` data:
 *  which rule tripped and the 1-based competency it tripped on (null for a kit-wide one). */
export function kitRejection(body: unknown): { reason: KitRejection; competency: number | null } | null {
  const b = body as { reason?: unknown; at?: unknown } | null;
  const reason = REJECTIONS.find((r) => r === b?.reason);
  if (!reason) return null;
  const m = typeof b?.at === "string" ? /^competencies\[(\d+)\]$/.exec(b.at) : null;
  return { reason, competency: m ? Number(m[1]) + 1 : null };
}

// ---- versions -------------------------------------------------------------------------

/** One row of the version list (GET's `versions` — a summary, no payload). */
export type KitVersionSummary = Omit<StoredInterviewKit, "kit">;

/** GET /api/jobs/[id]/interview-kit. */
export type KitState = {
  published: StoredInterviewKit | null;
  draft: StoredInterviewKit | null;
  versions: KitVersionSummary[];
};

/** The latest draft when it is NEWER than the latest published version — the one work
 *  in progress. A draft older than the live version is history, not the thing being
 *  worked on (the store's `draft` read answers the highest draft whatever its age). */
export function newerDraft(state: KitState | null): StoredInterviewKit | null {
  const d = state?.draft ?? null;
  if (!d) return null;
  const p = state?.published ?? null;
  return !p || d.version > p.version ? d : null;
}

/** The version the editor opens: work in progress first, else the live version. */
export function openVersion(state: KitState | null): StoredInterviewKit | null {
  return newerDraft(state) ?? state?.published ?? state?.draft ?? null;
}

/** Whether publishing this version would change anything. Only drafts can be published,
 *  and new links mint from the HIGHEST published version — so publishing a draft OLDER
 *  than the live one would succeed and change nothing, which is exactly the kind of
 *  green lie the surface must not offer. */
export function canPublishVersion(v: Pick<KitVersionSummary, "status" | "version">, state: KitState | null): boolean {
  if (v.status !== "draft") return false;
  const p = state?.published ?? null;
  return !p || v.version > p.version;
}

// ---- the rehearsal link ------------------------------------------------------------------

/** The `url` a rehearsal answers, accepted ONLY as a same-origin interview path. The
 *  editor opens it in a new tab, so a body that named another origin (or a
 *  protocol-relative `//host`) is refused rather than followed. */
export function rehearsalTarget(body: unknown): string | null {
  const url = (body as { url?: unknown } | null)?.url;
  if (typeof url !== "string") return null;
  return /^\/interview\/[^/\\?#\s][^\s\\]*$/.test(url) ? url : null;
}
