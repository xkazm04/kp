// The per-candidate OVERLAY on a job interview kit, as the prep modal edits it and as
// the write door checks it (spark interview-kit-template, WP-C).
//
// PURE and CLIENT-SAFE on purpose. The two server modules that own the overlay's
// meaning — interview-kit.ts (`coerceKitOverlay`) and interview-agenda.ts
// (`applyKitOverlay`, `cvProbeId`, the per-candidate probe block) — both import the
// database, so a "use client" modal cannot import either of them without pulling
// better-sqlite3 into the browser bundle. This file therefore carries:
//
//   1. THE CAPS, stated once and read by BOTH the modal (shown before a save is
//      refused) and the write door (the refusal itself), so the two can never
//      disagree about what an overlay may hold;
//   2. A MIRROR of the three agenda rules the modal has to predict — how the overlay
//      rewrites the kit, which of THIS candidate's own probes ride the interview, and
//      the id each probe is addressed by. A mirror is a drift risk, so it is pinned:
//      interview-kit-overlay.test.ts runs every rule here against the real server
//      functions (applyKitOverlay, cvProbeId, and buildInterviewKit end to end) over
//      the same fixtures. The precedent is pipelineAxisDraft.ts, the client echo of the
//      pipeline-axis validator, pinned the same way.
//
// Nothing here decides what the interview asks: the agenda does, at connect. This file
// only lets the recruiter see, before the call, what the agenda WILL do.

import {
  KIT_MAX_MUST_ASKS,
  KIT_MAX_QUESTIONS_PER_COMPETENCY,
  KIT_MAX_TEXT_CHARS,
  type InterviewKit,
  type KitCompetency,
  type KitOverlay,
  type KitQuestion,
} from "./interview-kit-types";

// ---- caps ------------------------------------------------------------------------------

/** How many questions ONE candidate's overlay may add. The agenda applies at most
 *  `MAX_OVERLAY_ADDED_QUESTIONS` (interview-agenda.ts), which is this same constant; the
 *  write door REFUSES more rather than storing additions the interview would silently
 *  ignore. Pinned equal by interview-kit-overlay.test.ts. */
export const KIT_OVERLAY_MAX_ADDED = KIT_MAX_QUESTIONS_PER_COMPETENCY;

/** How many drops, and separately how many rewrites, one overlay may carry. A kit asks
 *  at most 8 x 6 = 48 questions and a prep pack's own probes are a few dozen at most;
 *  120 is room for every one of them with headroom, and a bound on a payload that is
 *  read at every interview connect. */
export const KIT_OVERLAY_MAX_REFS = 120;

/** The longest question id an overlay may name — the kit validator's own id bound, so
 *  an overlay can address every id a stored kit can carry and nothing longer. */
export const KIT_OVERLAY_MAX_ID_CHARS = 64;

/** Added and rewritten questions are asked aloud, so they take the kit's own question
 *  budget. */
export const KIT_OVERLAY_MAX_TEXT_CHARS = KIT_MAX_TEXT_CHARS;

/** How many of THIS candidate's own probes ride a kit-spined agenda. Mirrors
 *  `MAX_KIT_CV_PROBES` in interview-agenda.ts (pinned equal by the test); the modal uses
 *  it to say which probes will actually be asked. */
export const KIT_OVERLAY_CV_PROBES_ASKED = 3;

/** The id the agenda gives the trailing block that holds additions with no competency
 *  (applyKitOverlay). Mirrored so the modal can group them the same way. */
export const KIT_OVERLAY_LOOSE_GROUP_ID = "overlay-added";

/** Why an overlay cannot be stored. A slug, not a sentence: the write door answers the
 *  coded refusal `INTERVIEW_PREP_OVERLAY_INVALID` with this beside it as data, and the
 *  modal renders its own localized line for each. */
export type KitOverlayProblem =
  | "too_many_added"
  | "too_many_refs"
  | "too_many_must_asks"
  | "text_empty"
  | "text_too_long"
  | "id_invalid"
  | "id_duplicate";

const usableId = (id: string) => id.trim() === id && id.length > 0 && id.length <= KIT_OVERLAY_MAX_ID_CHARS;

/**
 * Every reason this overlay would be refused, in the order the reader should fix them.
 * Empty => the write door accepts it.
 *
 * `keptKitMustAsks` is the modal's half of the must-ask rule: the kit caps must-asks
 * kit-wide (KIT_MAX_MUST_ASKS) because every must-ask can hold the call past its booked
 * time, and a recruiter adding required questions for one candidate spends the same
 * budget. The door does not resolve the kit on a write, so it checks the additions alone
 * against the cap; the modal, which has the kit open, passes how many of the kit's own
 * must-asks this candidate still faces.
 */
export function kitOverlayProblems(overlay: KitOverlay, keptKitMustAsks = 0): KitOverlayProblem[] {
  const problems = new Set<KitOverlayProblem>();
  if (overlay.added.length > KIT_OVERLAY_MAX_ADDED) problems.add("too_many_added");
  if (overlay.dropped.length > KIT_OVERLAY_MAX_REFS || overlay.edited.length > KIT_OVERLAY_MAX_REFS) {
    problems.add("too_many_refs");
  }
  const addedMustAsks = overlay.added.filter((a) => a.mustAsk).length;
  if (addedMustAsks > 0 && addedMustAsks + Math.max(0, keptKitMustAsks) > KIT_MAX_MUST_ASKS) {
    problems.add("too_many_must_asks");
  }
  const texts = [...overlay.edited.map((e) => e.text), ...overlay.added.map((a) => a.text)];
  if (texts.some((t) => t.trim() === "")) problems.add("text_empty");
  if (texts.some((t) => t.trim().length > KIT_OVERLAY_MAX_TEXT_CHARS)) problems.add("text_too_long");
  const ids = [...overlay.dropped, ...overlay.edited.map((e) => e.id), ...overlay.added.map((a) => a.id)];
  if (ids.some((id) => !usableId(id))) problems.add("id_invalid");
  // Within each list an id may appear once; an added id must also not name a question
  // the overlay drops or rewrites, or the two entries would argue about one question.
  const dupIn = (list: string[]) => new Set(list).size !== list.length;
  const addedIds = overlay.added.map((a) => a.id);
  const refIds = new Set([...overlay.dropped, ...overlay.edited.map((e) => e.id)]);
  if (dupIn(overlay.dropped) || dupIn(overlay.edited.map((e) => e.id)) || dupIn(addedIds) || addedIds.some((id) => refIds.has(id))) {
    problems.add("id_duplicate");
  }
  return [...problems];
}

// ---- the agenda, mirrored ---------------------------------------------------------------

/** Mirror of `coerceKitOverlay` (interview-kit.ts) for the browser: narrow the stored
 *  `kitOverlay` payload value, falling back to the empty overlay. Same filters, and the
 *  added entries rebuilt from their known keys. Pinned against the real one by the test. */
export function narrowKitOverlay(value: unknown): KitOverlay {
  const empty: KitOverlay = { version: 1, dropped: [], edited: [], added: [] };
  if (value === null || typeof value !== "object") return empty;
  const v = value as Partial<KitOverlay>;
  if (v.version !== 1) return empty;
  const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === "object";
  return {
    version: 1,
    dropped: Array.isArray(v.dropped) ? v.dropped.filter((id): id is string => typeof id === "string") : [],
    edited: Array.isArray(v.edited)
      ? v.edited
          .filter((e): e is { id: string; text: string } => isObj(e) && typeof e.id === "string" && typeof e.text === "string")
          .map((e) => ({ id: e.id, text: e.text }))
      : [],
    added: Array.isArray(v.added)
      ? v.added
          .filter((a) => isObj(a) && typeof a.id === "string" && typeof a.text === "string")
          .map((a) => ({
            id: a.id,
            competencyId: typeof a.competencyId === "string" ? a.competencyId : null,
            text: a.text,
            mustAsk: a.mustAsk === true,
          }))
      : [],
  };
}

const cleanText =(v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);

/** Mirror of `cvProbeId` (interview-agenda.ts): `cv-` + 32-bit FNV-1a over the trimmed
 *  text, iterated by code point. The overlay names a candidate's generated probe by this
 *  id, so the modal must mint exactly the id the agenda will look for. */
export function kitProbeId(text: string): string {
  let h = 0x811c9dc5;
  for (const ch of text.trim()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `cv-${h.toString(16).padStart(8, "0")}`;
}

/** Mirror of `applyKitOverlay` (interview-agenda.ts): the kit this candidate will face.
 *  Pinned against the real one by the test. */
export function applyOverlayToKit(kit: InterviewKit, overlay: KitOverlay, looseTitle: string): InterviewKit {
  const dropped = new Set(overlay.dropped);
  const edits = new Map(overlay.edited.map((e) => [e.id, e.text]));
  const known = new Set((kit.competencies ?? []).map((c) => c.id));
  const added = overlay.added.slice(0, KIT_OVERLAY_MAX_ADDED).filter((a) => !dropped.has(a.id));
  const byCompetency = new Map<string, KitQuestion[]>();
  const loose: KitQuestion[] = [];
  for (const a of added) {
    const q: KitQuestion = { id: a.id, text: a.text, mustAsk: a.mustAsk === true };
    if (!cleanText(q.text)) continue;
    if (a.competencyId && known.has(a.competencyId)) {
      byCompetency.set(a.competencyId, [...(byCompetency.get(a.competencyId) ?? []), q]);
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
      ...(byCompetency.get(c.id) ?? []),
    ],
  }));
  if (loose.length > 0) {
    competencies.push({
      id: KIT_OVERLAY_LOOSE_GROUP_ID,
      title: looseTitle,
      weight: 1,
      budgetMin: Math.min(4, Math.max(2, loose.length)),
      questions: loose,
    });
  }
  return { ...kit, competencies };
}

/** The questions a kit asks aloud, in kit order — what a probe is de-duplicated against
 *  (mirror of the agenda's kitAloudQuestions: a question with no id asks nothing). */
export function kitAskedTexts(kit: InterviewKit): string[] {
  const out: string[] = [];
  for (const c of kit.competencies ?? []) {
    for (const q of c.questions ?? []) {
      const text = q && typeof q.id === "string" && q.id !== "" ? cleanText(q.text) : null;
      if (text) out.push(text);
    }
  }
  return out;
}

/** The prep-pack fields the probe list is built from. */
export type OverlayPrepSource = { chronology?: unknown; importedQuestions?: unknown };

/** THIS candidate's own probe texts, in the order the agenda considers them, BEFORE the
 *  overlay and the cap: the recruiter's imported questions first, then each chronology
 *  block's aloud questions (its questions, then its follow-up), trimmed, de-duplicated,
 *  and never a question the kit already asks. Mirror of the agenda's cvProbeDraft up to
 *  the point where it applies the overlay. */
export function candidateProbeTexts(prep: OverlayPrepSource | null | undefined, kitAsked: readonly string[]): string[] {
  if (!prep) return [];
  const seen = new Set(kitAsked.map((q) => q.trim()));
  const out: string[] = [];
  const take = (raw: unknown) => {
    const text = cleanText(raw);
    if (!text || seen.has(text)) return;
    seen.add(text);
    out.push(text);
  };
  if (Array.isArray(prep.importedQuestions)) {
    for (const raw of prep.importedQuestions) {
      take(typeof raw === "string" ? raw : raw && typeof raw === "object" ? (raw as { question?: unknown }).question : null);
    }
  }
  if (Array.isArray(prep.chronology)) {
    for (const block of prep.chronology) {
      if (!block || typeof block !== "object") continue;
      const b = block as { questions?: unknown; followUp?: unknown };
      if (Array.isArray(b.questions)) for (const q of b.questions) take(q);
      take(b.followUp);
    }
  }
  return out;
}

/** The probes the agenda will actually ask, after the overlay and the cap — what the
 *  interview's per-candidate block holds. Mirror of the tail of cvProbeDraft. */
export function askedCandidateProbes(probes: readonly string[], overlay: KitOverlay): string[] {
  const dropped = new Set(overlay.dropped);
  const edits = new Map(overlay.edited.map((e) => [e.id, e.text]));
  return probes
    .filter((q) => !dropped.has(kitProbeId(q)))
    .map((q) => cleanText(edits.get(kitProbeId(q)) ?? q))
    .filter((q): q is string => q !== null)
    .slice(0, KIT_OVERLAY_CV_PROBES_ASKED);
}
