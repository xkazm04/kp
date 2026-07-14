// The interview scorecard's DATA CONTRACT — one definition of the per-competency
// rating shape and the scorecard wrapper that the LLM synthesis emits, the
// pipeline stores (interview_sessions.scorecard_json), and every surface that
// renders an interview result reads. This shape used to be hand-mirrored in the
// transcript modal, the recruiter compare grid, the candidate drawer, the drawer
// result view and the Decisions review card — four-plus independent copies that
// drift apart silently the moment one adds a field or re-words a name.
//
// Pure types (no React, no node deps) so both client surfaces and server code
// (db.ts, the interview API) import the SAME declaration — exactly like
// interview-recommendation.ts single-sources the advance|hold|reject verdict.
//
// THE SCALE LIVES ELSEWHERE, ON PURPOSE. A rating runs 1..RATING_MAX on the fixed
// rubric, but RATING_MAX and the rating→percent/tone projection live in
// app/_lib/format.ts alongside scoreTone, so a scorecard rating maps onto the
// app-wide 0–100 score scale (and its strong/mid/weak colors) exactly like every
// other score. Re-gearing the rubric is a one-line edit there; this module owns
// only the shape.

import type { InterviewRecommendation } from "@/app/_lib/interview-recommendation";

/** One competency scored on the fixed interview rubric: a 1..RATING_MAX rating
 *  and the verbatim evidence quote behind it. `evidence` is absent on a
 *  not-assessed axis (and on the compact, ratings-only surfaces). */
export type ScorecardRating = {
  competency: string;
  rating: number;
  evidence?: string;
  // Set on a rating whose competency isn't in the entry's CURRENT rubric — the
  // same "off-rubric" concept CompareInterviews surfaces (compareCohorts.ts). The
  // human-scorecard POST flags these at the trust boundary rather than rejecting
  // them: a record outlives rubric revisions by design, so an off-taxonomy or
  // since-renamed axis is KEPT and marked, never silently dropped. Absent (the
  // common case) means on-rubric.
  offRubric?: boolean;
};

/** The structured outcome of the closing READ-BACK exchange (scorecard-v5): the
 *  voice agent reads back the technologies it heard and the candidate confirms or
 *  corrects them, so a recruiter sees that "Rust" in the raw transcript actually
 *  meant React — a cue, not just a line buried in the summary. Present ONLY when an
 *  actual read-back happened; absent (null/undefined) when it didn't, never invented.
 *  Rides on the AI scorecard object, so consent redaction drops it with the rest of
 *  the verbatim synthesis. */
export type ScorecardEntities = {
  /** Technologies the candidate confirmed as heard — the authoritative stack. */
  confirmed: string[];
  /** ASR mishears the candidate fixed in the read-back: heard → what they meant. */
  corrected: { heard: string; meant: string }[];
  /** Mentioned only in earlier, unconfirmed turns and never reached in the read-back
   *  — a possible transcription error, flagged rather than asserted as a skill. */
  unconfirmed: string[];
};

/** Narrow a raw, stored `entities` blob (unvalidated JSON on a persisted scorecard)
 *  to a clean ScorecardEntities, or null when there is no read-back to show.
 *  Defensive at the trust boundary like the modal's cleanRating: a legacy row, a
 *  partial synthesis, or a non-Python provider can carry any shape. Returns null when
 *  every bucket is empty so absence renders no chrome (the "no read-back" signal). */
export function normalizeScorecardEntities(raw: unknown): ScorecardEntities | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];
  const confirmed = strList(r.confirmed);
  const unconfirmed = strList(r.unconfirmed);
  const corrected = (Array.isArray(r.corrected) ? r.corrected : [])
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const o = c as Record<string, unknown>;
      const heard = typeof o.heard === "string" ? o.heard.trim() : "";
      const meant = typeof o.meant === "string" ? o.meant.trim() : "";
      return heard && meant ? { heard, meant } : null;
    })
    .filter((c): c is { heard: string; meant: string } => c !== null);
  if (confirmed.length === 0 && corrected.length === 0 && unconfirmed.length === 0) return null;
  return { confirmed, corrected, unconfirmed };
}

/** The structured interview scorecard: per-competency ratings, a one-line
 *  summary, and the canonical advance|hold|reject verdict. Every field is
 *  optional because a legacy row or a partial/failed synthesis can omit any of
 *  them — consumers guard each one before rendering. */
export type Scorecard = {
  ratings?: ScorecardRating[];
  summary?: string;
  recommendation?: InterviewRecommendation;
  // The structured read-back outcome (scorecard-v5) — present only when the call
  // actually closed with a technologies read-back; consumers guard it before render.
  entities?: ScorecardEntities | null;
  // Who produced this scorecard. Omitted on the AI-synthesized one (treated as
  // "ai" by consumers, the historical default); set to "human" for one a recruiter
  // filled against the rubric (PREP1), so a surface showing both can label them.
  source?: "ai" | "human";
  // The rubric this scorecard was scored against, stamped at write time (Direction
  // 2). `rubricVersion` is a stable content hash of the resolved rubric slice
  // (rubricVersionHash / automation.rubric_version_hash — identical across TS+Python);
  // `rubricKeys` is that slice's competency KEY list. Together they are the minimal
  // shape to re-evaluate off-rubric against the EXACT scale it was scored on, so a
  // later interview-rubrics.json revision can't retroactively mark a once-valid axis
  // off-rubric (flagOffRubricRatingsWithKeys prefers them). BOTH are optional: a
  // legacy row omits them and every consumer falls back to the current rubric,
  // behaving exactly as before.
  rubricVersion?: string;
  rubricKeys?: string[];
};
