// Human interview scorecards as a PANEL, not a slot (r09 schedule-interview-prep/A).
//
// The recruiter-filled scorecard (PREP1) used to be ONE key on the prep payload,
// `humanScorecard`, replaced wholesale on every save and used to pre-fill the next
// person's form. A second interviewer — or a second round in a workspace that split its
// Interview column — silently erased the first record, and opened the form anchored on
// it. The registry standard (structured-interview-scorecards, "Independent scoring
// before the debrief"; interview-round-design, "no access to the first rating before
// recording the second") asks the opposite: every assessor commits an independent
// record, and no save destroys another.
//
// So the payload now carries `humanScorecards`: a list of records keyed by
// (author, stage). `humanScorecard` stays, as the HEADLINE MIRROR — the latest saved
// record — so every reader that knew the one key (the drawer, the compare grid, the
// Schedule card flag, the Decisions queue's approval payload) keeps answering, and a
// rollback of this code leaves them reading the most recent human card.
//
// PURE — type imports only — so the client (the transcript modal) and the server store
// read the payload through the same rules.

import type { Scorecard } from "./interview-scorecard";

/** One interviewer's record for one round. `author` is the signed-in user id (null in
 *  open mode, where there is no identity — one slot per stage, today's behaviour);
 *  `stage` is the pipeline column the candidate sat in when it was saved; `savedAt` is
 *  null ONLY on a record lifted from the legacy single key, whose author, round and time
 *  were never recorded. */
export type HumanScorecardRecord = Scorecard & {
  author: string | null;
  authorLabel: string | null;
  stage: string | null;
  savedAt: string | null;
};

/** The key a save is filed under. */
export type HumanScorecardKey = { author: string | null; authorLabel: string | null; stage: string | null };

/** Distinct (author, stage) records one candidate can hold. A panel of four
 *  interviewers across six rounds fits; the bound exists so a payload cannot grow
 *  without limit. At the cap a NEW key is refused — never made room for by dropping an
 *  older record, which is the one thing this module exists to prevent. */
export const MAX_HUMAN_SCORECARDS = 24;

function isObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function toRecord(raw: Record<string, unknown>, legacy: boolean): HumanScorecardRecord {
  return {
    ...(raw as Scorecard),
    author: legacy ? null : strOrNull(raw.author),
    authorLabel: legacy ? null : strOrNull(raw.authorLabel),
    stage: legacy ? null : strOrNull(raw.stage),
    savedAt: legacy ? null : strOrNull(raw.savedAt),
  };
}

/** Every human scorecard a prep payload holds. The list when it exists — the legacy
 *  `humanScorecard` key is then only its headline mirror and is never counted twice;
 *  otherwise the legacy key lifted into ONE unattributed record, so a row written
 *  before this change keeps reading and nothing already saved is lost. */
export function readHumanScorecards(payload: unknown): HumanScorecardRecord[] {
  if (!isObject(payload)) return [];
  const list = payload.humanScorecards;
  if (Array.isArray(list)) return list.filter(isObject).map((r) => toRecord(r, false));
  const legacy = payload.humanScorecard;
  return isObject(legacy) ? [toRecord(legacy, true)] : [];
}

/** A lifted legacy record is nobody's own: its author and round are unknown, so no
 *  save may claim it and replace it. */
function isLegacy(r: HumanScorecardRecord): boolean {
  return r.savedAt === null;
}

function sameKey(r: HumanScorecardRecord, author: string | null, stage: string | null): boolean {
  return !isLegacy(r) && r.author === author && r.stage === stage;
}

/** File `rec` under its (author, stage): replace that record, else append. Every OTHER
 *  record is returned as the same object, untouched. `null` when the list is full and
 *  `rec` would be a new key — the caller refuses rather than evicts. */
export function upsertHumanScorecard(list: HumanScorecardRecord[], rec: HumanScorecardRecord): HumanScorecardRecord[] | null {
  const i = list.findIndex((r) => sameKey(r, rec.author, rec.stage));
  if (i >= 0) return list.map((r, j) => (j === i ? rec : r));
  if (list.length >= MAX_HUMAN_SCORECARDS) return null;
  return [...list, rec];
}

/** The caller's own record for this round — what the scoring form may seed from.
 *  Never another author's: a second interviewer opens an EMPTY form. */
export function ownScorecard(list: HumanScorecardRecord[], author: string | null, stage: string | null): HumanScorecardRecord | null {
  return list.find((r) => sameKey(r, author, stage)) ?? null;
}

/** The headline: the most recently saved record (a legacy record, having no time,
 *  ranks oldest; on a tie the later list position wins). What `humanScorecard` mirrors
 *  and what single-card surfaces show. */
export function headlineScorecard(list: HumanScorecardRecord[]): HumanScorecardRecord | null {
  let best: HumanScorecardRecord | null = null;
  for (const r of list) {
    if (best === null || (r.savedAt ?? "") >= (best.savedAt ?? "")) best = r;
  }
  return best;
}

// ── the read side: what a display surface may carry ─────────────────────────────

/** One record as a DISPLAY surface carries it (the candidate drawer, the compare
 *  grid): every field of the record except `author`, the signed-in user id, which is
 *  the store's key and no reader's business — `authorLabel` is what a person reads.
 *  `legacy` names a card lifted from the pre-list single key (author and round were
 *  never recorded), so a surface can say so instead of implying an anonymous save. */
export type HumanScorecardView = Omit<HumanScorecardRecord, "author"> & { legacy: boolean };

/** Every record worth showing, newest first (a legacy record, having no time, last).
 *  An empty artifact — no ratings and no summary — is dropped: it is noise, the same
 *  rule the drawer's parser applied to the single card. */
export function humanScorecardViews(list: HumanScorecardRecord[]): HumanScorecardView[] {
  return list
    .filter((r) => (r.ratings?.length ?? 0) > 0 || Boolean(r.summary))
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (b.r.savedAt ?? "").localeCompare(a.r.savedAt ?? "") || b.i - a.i)
    .map(({ r }) => {
      const view: Omit<HumanScorecardRecord, "author"> & { author?: unknown } = { ...r };
      delete view.author;
      return { ...view, legacy: r.savedAt === null };
    });
}

/** Whose card this is, as three distinct claims: saved before attribution existed,
 *  saved by a named interviewer, or saved with nobody signed in (open mode). */
export type HumanScorecardByline = { kind: "legacy" | "by" | "unnamed"; author: string | null; stage: string | null };

export function humanScorecardByline(v: HumanScorecardView): HumanScorecardByline {
  if (v.legacy) return { kind: "legacy", author: null, stage: null };
  return v.authorLabel ? { kind: "by", author: v.authorLabel, stage: v.stage } : { kind: "unnamed", author: null, stage: v.stage };
}

// ── independent scoring: what a CALLER may read ─────────────────────────────────
//
// ONE projection every reader of the panel passes through. The scorecard GET used to be
// the only door that withheld a colleague's verdict until the caller had filed their own;
// the prep read, the candidate drawer, the compare grid and the role view returned the
// same records to anyone. The rule belongs here, at the read seam, taking the caller.
//
// Only what crosses the wire changes. The gate, the seal and the role-decision computation
// read the FULL set from the store (readHumanScorecards / getHumanScorecards) — this module
// never mutates its input and nothing server-side that decides reads its output.

/** "Has filed": the record carries at least one rating. The POST refuses a card with none,
 *  and a stored zero-rating card (written before that refusal) does not count either — so
 *  the reveal check and the gate check ask the same question. */
export function isFiledScorecard(card: { ratings?: unknown } | null | undefined): boolean {
  return Array.isArray(card?.ratings) && (card.ratings as unknown[]).length > 0;
}

/** Who is reading: the signed-in user id (null with no identity), the label, and whether
 *  they hold `team:manage` (admin, owner, and open mode, which has one identity). */
export type ScorecardViewer = { author: string | null; authorLabel: string | null; canManage: boolean };

export type HumanScorecardProjection = {
  /** The caller's OWN record for this round — what the form may seed from. */
  mine: HumanScorecardRecord | null;
  /** Colleagues' records as display views (no user id), only once the caller may see them. */
  records: HumanScorecardView[];
  /** Records that are not the caller's own; a COUNT is all an unrevealed caller learns. */
  othersCount: number;
  revealed: boolean;
};

/** Apply the independent-scoring rule: colleagues' records stay hidden until the caller has
 *  FILED for this round (`key.stage`), unless they can manage the team. Fails closed: with
 *  no identity (`key.author` null) and no `team:manage` nothing is revealed, and no record
 *  is anyone's "own". */
export function projectHumanScorecards(
  list: HumanScorecardRecord[],
  key: HumanScorecardKey,
  canManage: boolean,
): HumanScorecardProjection {
  const mine = canManage || key.author !== null ? ownScorecard(list, key.author, key.stage) : null;
  const revealed = canManage || (key.author !== null && isFiledScorecard(mine));
  return {
    mine,
    records: revealed ? humanScorecardViews(list) : [],
    othersCount: Math.max(0, list.length - (mine ? 1 : 0)),
    revealed,
  };
}

/** The same projection for a resolved viewer and the round the candidate is in now. A
 *  `null` viewer (identity could not be resolved) is the fail-closed caller. */
export function projectForViewer(
  list: HumanScorecardRecord[],
  viewer: ScorecardViewer | null,
  stage: string | null,
): HumanScorecardProjection {
  return projectHumanScorecards(
    list,
    { author: viewer?.author ?? null, authorLabel: viewer?.authorLabel ?? null, stage },
    viewer?.canManage ?? false,
  );
}

/** A prep payload as a caller may read it: the panel and its headline mirror replaced by the
 *  projection (views, so no author user id), every other key untouched. A payload with no
 *  human records is returned as is. */
export function projectPrepPayload(
  payload: Record<string, unknown>,
  viewer: ScorecardViewer | null,
  stage: string | null,
): Record<string, unknown> {
  const records = readHumanScorecards(payload);
  if (records.length === 0) return payload;
  const { records: views } = projectForViewer(records, viewer, stage);
  const { humanScorecard: _headline, ...rest } = payload;
  void _headline;
  return views.length > 0 ? { ...rest, humanScorecards: views, humanScorecard: views[0] } : { ...rest, humanScorecards: [] };
}
