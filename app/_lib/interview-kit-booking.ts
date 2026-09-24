// How long a KIT-PINNED interview is booked — ONE authority (spark interview-kit-template;
// a finding of the interview simulator's first live sweep).
//
// A job's interview kit is the spine of every interview for that job, so the kit, not
// the candidate's CV plan and not the ungrounded quick screen, decides how long the call
// is booked. Before this module the kit's length was computed in four places that
// disagreed: the mint booked the quick screen's 5 minutes for a candidate with no plan
// (and a CV plan's own length for one with a plan, which the kit then REPLACED), the
// rehearsal booked max(20, natural) with no ceiling, the scheduling estimate knew
// nothing of the kit, and the saved fallback brief promised "under 5 minutes". Connect
// then fitted the kit into whatever was booked, squeezing competencies to their floors.
// Now every one of them asks `kitBookedMin`:
//
//   - the mint (interview-invite.ts → interview-run.ts buildGroundedInterview), which
//     also states the length in the saved fallback brief;
//   - the agenda builder (interview-agenda.ts), for a build with no booking and for a
//     rehearsal's booking (buildKitOnlyInterviewKit, which the rehearse door books);
//   - the scheduling estimate (interview-planned-minutes.ts plannedInterviewMinutes).
//
// The helpers below it — the overlay, the per-candidate probes, the plan's frame — are
// the agenda builder's own, MOVED here rather than copied, so the booking and the agenda
// read one set of rules (interview-agenda.ts imports and re-exports them). This module
// holds no store read beyond the overlay narrower, and it stays out of interview-agenda's
// graph (catalogs, dev cases) because the scheduling routes import it through
// interview-planned-minutes.ts, which is kept light on purpose.

import { coerceKitOverlay } from "./interview-kit";
import {
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  type InterviewKit as JobKit,
  type KitCompetency,
  type KitOverlay,
  type KitQuestion,
} from "./interview-kit-types";
import { MAX_DURATION_MIN, MIN_DURATION_MIN, type ChronologyBlock } from "./run-of-show";
import { chronologyAloudQuestions } from "./voice/candidate-brief";

/** The stored interview-prep payload as the briefs, the agenda and the booking read it. */
export type PrepPayload = {
  scenario?: string;
  durationMin?: number;
  focusAreas?: string[];
  chronology?: ChronologyBlock[];
  /** The recruiter's per-candidate edits to the job kit (interview-kit-types.ts
   *  KitOverlay). A HUMAN-owned key: the generator never writes it, so
   *  mergeRegeneratedPrep carries it across a Regenerate untouched. Untrusted on
   *  read — coerceKitOverlay narrows it, and a malformed one is simply no overlay. */
  kitOverlay?: unknown;
  // Interview-kit questions imported into the pack (written by /api/interview-prep
  // POST, rendered in the prep modal). Aloud-material the recruiter wants asked —
  // now carried into the voice brief alongside the generated chronology.
  importedQuestions?: string[];
  /** The language the pack was generated in (interview-prep-run stamps it). */
  lang?: string;
};

// ---- the fixed blocks --------------------------------------------------------------------

/** Minimum minutes of the protected closing reserve. */
export const ROLE_QA_MIN = 2;
export const CLOSE_MIN = 2;
/** Warm-up length when the kit has no opening block of its own to map onto. */
export const DEFAULT_WARMUP_MIN = 1;

/** How many of THIS candidate's own CV probes ride on top of a kit-spined agenda.
 *
 *  Three, because the kit already fills the booking: every probe added to a full plan
 *  shortens every kit block (registry: per-question-time-budget-that-tightens — "adding
 *  one question to a full plan shortens every other question"), and the whole point of
 *  the kit is that candidates in one round face the same instrument. Three is enough to
 *  chase what is distinctive about this CV without changing what the round measures.
 *  What is dropped is dropped silently from the AGENDA only — the recruiter's prep pack
 *  still lists every question it generated. */
export const MAX_KIT_CV_PROBES = 3;

/** How many questions ONE candidate's overlay may add. The kit's own per-competency
 *  cap, reused: an overlay that can add more than a competency may hold has stopped
 *  being an overlay on the round and become a different interview. */
export const MAX_OVERLAY_ADDED_QUESTIONS = KIT_MAX_QUESTIONS_PER_COMPETENCY;

export const cleanText = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

export const positiveMinutes = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;

/** A kit competency's planned minutes — its authored budget, 3 when it has none. */
export const kitCompetencyMin = (c: KitCompetency): number => positiveMinutes(c?.budgetMin, 3);

/** A chronology block's minutes (its toMin − fromMin), 3 when unreadable. */
export const chronologyBlockMin = (b: ChronologyBlock): number =>
  positiveMinutes(typeof b?.toMin === "number" && typeof b?.fromMin === "number" ? b.toMin - b.fromMin : NaN, 3);

// ---- imported questions ------------------------------------------------------------------

/** The imported interview-kit questions (prep payload `importedQuestions`) that
 *  should ride a grounded brief: trimmed, de-duplicated, and — the coordination
 *  guard with the sibling "weave into chronology" work — dropped when their exact
 *  text is already asked in a chronology block, so a woven question never
 *  double-renders. Pure/exported for the brief-construction unit tests. */
export function importedQuestionsForBrief(importedQuestions: unknown, alreadyAsked: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const q of alreadyAsked) if (typeof q === "string") seen.add(q.trim());
  const out: string[] = [];
  if (Array.isArray(importedQuestions)) {
    for (const raw of importedQuestions) {
      // Entries are legacy plain strings OR { question, blockRef? } objects (the
      // round-8 weave shape). Both must reach the brief — a woven question keeps
      // its single home in importedQuestions, so skipping objects would silently
      // drop exactly the questions the recruiter planned most deliberately.
      const text =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object" && typeof (raw as { question?: unknown }).question === "string"
            ? (raw as { question: string }).question
            : null;
      if (text === null) continue;
      const q = text.trim();
      if (!q || seen.has(q)) continue;
      seen.add(q);
      out.push(q);
    }
  }
  return out;
}

// ---- the kit and its overlay -------------------------------------------------------------

export const kitQuestionText = (q: KitQuestion | undefined | null): string | null =>
  q && typeof q.id === "string" && q.id !== "" ? cleanText(q.text) : null;

/** Every question a kit asks aloud, in kit order — what a CV probe is de-duplicated
 *  against so the same question is never asked twice under two labels. */
export function kitAloudQuestions(kit: JobKit): string[] {
  const out: string[] = [];
  for (const c of kit.competencies ?? []) {
    for (const q of c.questions ?? []) {
      const text = kitQuestionText(q);
      if (text) out.push(text);
    }
  }
  return out;
}

/**
 * Lay a recruiter's per-candidate edits over the AUTHORED kit and return a new kit.
 * Pure — no DB, no clock — and applied BEFORE anything is drafted, so every downstream
 * reader (the blocks, the must-asks, the debrief's appended required questions, the
 * booked length) sees one already-edited kit rather than each re-deciding what the
 * overlay meant.
 *
 * The three operations, by kit question id:
 *   - `dropped` removes the question (a dropped must-ask stops being required too —
 *     the recruiter decided it does not apply to this candidate, and a requirement the
 *     recruiter withdrew must not hold the call past its time);
 *   - `edited` rewrites its text in place, keeping its id, its must-ask flag and its
 *     position, so the record still names the same question;
 *   - `added` appends to the competency it names, or — with no competency, or one this
 *     kit version no longer has — to ONE trailing competency of its own.
 *
 * An entry naming an id this kit version does not carry is ignored rather than
 * refused: the overlay outlives the kit it was written against (a published edit mints
 * a new version), and an intent that no longer applies is simply not applied.
 */
export function applyKitOverlay(kit: JobKit, overlay: KitOverlay, addedBlockTitle: string): JobKit {
  const dropped = new Set(overlay.dropped);
  const edits = new Map(overlay.edited.map((e) => [e.id, e.text]));
  const known = new Set((kit.competencies ?? []).map((c) => c.id));
  const added = overlay.added.slice(0, MAX_OVERLAY_ADDED_QUESTIONS).filter((a) => !dropped.has(a.id));
  const addedByCompetency = new Map<string, KitQuestion[]>();
  const loose: KitQuestion[] = [];
  for (const a of added) {
    const q: KitQuestion = { id: a.id, text: a.text, mustAsk: a.mustAsk === true };
    if (!cleanText(q.text)) continue;
    if (a.competencyId && known.has(a.competencyId)) {
      addedByCompetency.set(a.competencyId, [...(addedByCompetency.get(a.competencyId) ?? []), q]);
    } else {
      loose.push(q);
    }
  }
  const competencies: KitCompetency[] = (kit.competencies ?? []).map((c) => ({
    ...c,
    questions: [
      ...(c.questions ?? [])
        .filter((q) => !dropped.has(q.id))
        .map((q) => (edits.has(q.id) ? { ...q, text: edits.get(q.id) as string } : q)),
      ...(addedByCompetency.get(c.id) ?? []),
    ],
  }));
  if (loose.length > 0) {
    // Its own block, last, at the lowest weight: a per-candidate addition is not a
    // competency the ROLE is hired on, and the emphasis the private brief renders
    // must not say otherwise.
    competencies.push({
      id: "overlay-added",
      title: addedBlockTitle,
      weight: 1,
      budgetMin: Math.min(4, Math.max(2, loose.length)),
      questions: loose,
    });
  }
  return { ...kit, competencies };
}

// ---- this candidate's own probes --------------------------------------------------------

/** A stable id for one of THIS candidate's generated probes, so the recruiter's overlay
 *  can drop or rewrite it exactly like a kit question (KitOverlay names "a question the
 *  generator or the kit produced"). A prep chronology carries no question ids, so the id
 *  is derived from the text (32-bit FNV-1a over the trimmed text): stable across reads,
 *  computable by any surface that shows the probe, and it simply stops matching when a
 *  regeneration rewrites the probe — the same "an intent that no longer applies is not
 *  applied" rule as a kit id that a newer version no longer carries. */
export function cvProbeId(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `cv-${h.toString(16).padStart(8, "0")}`;
}

/** THIS candidate's own probes that ride a kit-spined agenda, in order: the recruiter's
 *  imported questions first, then the prep chronology's aloud questions, de-duplicated
 *  against what `kit` (already overlaid) asks. The recruiter's overlay applies here too
 *  (by cvProbeId) — a dropped probe is gone and the next one moves up, an edited one is
 *  asked as rewritten — and what survives is capped at MAX_KIT_CV_PROBES. */
export function kitCvProbes(prep: PrepPayload | undefined, kit: JobKit, overlay: KitOverlay): string[] {
  if (!prep) return [];
  const asked = kitAloudQuestions(kit);
  // The recruiter's own imports come first: a question a human chose outranks one the
  // generator proposed when only three of them fit.
  const imported = importedQuestionsForBrief(prep.importedQuestions, asked);
  const ordered: string[] = [...imported];
  const seen = new Set(ordered.concat(asked).map((q) => q.trim()));
  for (const b of prep.chronology ?? []) {
    for (const q of chronologyAloudQuestions(b)) {
      const text = q.trim();
      if (!text || seen.has(text)) continue;
      seen.add(text);
      ordered.push(text);
    }
  }
  const dropped = new Set(overlay.dropped);
  const edits = new Map(overlay.edited.map((e) => [e.id, e.text]));
  const kept = chronologyAloudQuestions({ questions: ordered })
    .filter((q) => !dropped.has(cvProbeId(q)))
    .map((q) => edits.get(cvProbeId(q)) ?? q);
  return chronologyAloudQuestions({ questions: kept }).slice(0, MAX_KIT_CV_PROBES);
}

/** The minutes the per-candidate probe block takes: 2–4, and none without a probe. */
export const cvProbeBlockMin = (count: number): number => (count > 0 ? Math.min(4, Math.max(2, count)) : 0);

// ---- a CV plan's frame -------------------------------------------------------------------

/** What a prep chronology contributes once it is mapped onto the agenda: its fixed
 *  opening and closing — recognisable structurally as a first/last block with nothing to
 *  ask aloud — become the warm-up and the role-questions + close pair, and everything
 *  between them is the `middle` (topics, and possibly the plan's slack block). */
export type PrepFrame = {
  chron: ChronologyBlock[];
  middle: ChronologyBlock[];
  warmupMin: number;
  roleQaMin: number;
  closeMin: number;
};

export function prepFrame(prep: PrepPayload): PrepFrame {
  const chron = (prep.chronology ?? []).filter((b) => b && typeof b === "object");
  const first = chron[0];
  const last = chron.length > 1 ? chron[chron.length - 1] : undefined;
  const hasOpening = !!first && chronologyAloudQuestions(first).length === 0;
  const hasClosing = !!last && chronologyAloudQuestions(last).length === 0;
  const wrapMin = hasClosing && last ? chronologyBlockMin(last) : ROLE_QA_MIN + CLOSE_MIN;
  return {
    chron,
    middle: chron.slice(hasOpening ? 1 : 0, hasClosing ? chron.length - 1 : chron.length),
    warmupMin: hasOpening ? chronologyBlockMin(first) : DEFAULT_WARMUP_MIN,
    roleQaMin: Math.max(ROLE_QA_MIN, wrapMin - CLOSE_MIN),
    closeMin: CLOSE_MIN,
  };
}

// ---- THE booking -------------------------------------------------------------------------

/** Whether `kit` can spine an interview at all — a version with no competency directs
 *  nothing at connect, so it books nothing either. */
export function kitSpinesAnInterview(kit: JobKit | null | undefined): kit is JobKit {
  return !!kit && Array.isArray(kit.competencies) && kit.competencies.length > 0;
}

/**
 * THE booked length, in minutes, of an interview a job kit spines — for a candidate with
 * no CV-based plan and for one with a plan alike. `prep` is the candidate's stored prep
 * payload (absent, or without a chronology, for a candidate with no plan; a rehearsal has
 * none); its `kitOverlay` is applied to `kit` exactly as the agenda applies it.
 *
 *   - NO plan (the kit-only agenda): warm-up + the kit's competency budgets + role
 *     questions + closing.
 *   - A CV plan (the kit replaces its topics): the plan's own warm-up + the kit's
 *     competency budgets + the probe block the capped CV probes actually take + the
 *     plan's role questions + closing. The plan's slack block is NOT booked — it is slack,
 *     the designated casualty — so connect fits the kit without shortening a competency.
 *
 * Clamped to the band a CV-based plan is clamped to (run-of-show.ts MIN_DURATION_MIN –
 * MAX_DURATION_MIN, 15–30 min), for that band's two reasons: below 15 a directed screen is
 * a stub, not an interview (a short kit's surplus goes to the candidate's questions or the
 * plan's slack block — fitAgendaDrafts' slack sinks — and never into or out of a
 * competency); 30 is the length the provider's hard cap is sized to clear
 * (interview-duration.mjs PROVIDER_CAP_MIN = GROUNDED_MAX_MIN + 10 headroom): at 30 the
 * director's own end, round(30 × 1.2) + 2 = 38 min, stays inside the provider's 40, while a
 * booking past 32 would put it outside, and the call would be severed mid-answer instead of
 * closed. A kit authored past the band is fitted into 30 minutes, proportionally, exactly
 * as an over-long plan is.
 */
export function kitBookedMin(kit: JobKit, prep?: PrepPayload | null): number {
  const overlay = coerceKitOverlay(prep?.kitOverlay ?? null);
  // The title of an overlay-added block changes nothing about its minutes.
  const spine = applyKitOverlay(kit, overlay, "");
  const kitMin = (spine.competencies ?? []).reduce((n, c) => n + kitCompetencyMin(c), 0);
  const planned = prep && (prep.chronology?.length ?? 0) > 0 ? prep : null;
  const natural = planned
    ? (() => {
        const frame = prepFrame(planned);
        const probes = kitCvProbes(planned, spine, overlay);
        return frame.warmupMin + kitMin + cvProbeBlockMin(probes.length) + frame.roleQaMin + frame.closeMin;
      })()
    : DEFAULT_WARMUP_MIN + kitMin + ROLE_QA_MIN + CLOSE_MIN;
  return Math.min(MAX_DURATION_MIN, Math.max(MIN_DURATION_MIN, Math.round(natural)));
}
