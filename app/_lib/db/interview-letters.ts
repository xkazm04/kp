import { randomId } from "../random-id";
import { ensureDb } from "./core";
import { LETTER_STATES, type InterviewLetter, type LetterDelivery, type LetterDraftSource, type LetterState } from "../interview-letter-types";
import { LETTER_REJECT_EVENT_KINDS, letterTextProblem, type LetterDecidingEvent, type LetterOutcome } from "../interview-letter-policy";

// The interview FEEDBACK LETTER store (spark interview-feedback-letter, WP-alpha). The
// contract is app/_lib/interview-letter-types.ts; who may ask is
// app/_lib/interview-letter-policy.ts.
//
// ONE ROW PER APPLICATION. The unique index (workspace_id, entry_id) is what makes the
// candidate's request door idempotent: a double click, two tabs, a replayed POST all land
// on the same row, because the insert is `ON CONFLICT DO NOTHING` rather than a
// read-then-insert two requests could race.
//
// THE ROW CARRIES CANDIDATE PERSONAL DATA — the draft and the final text are written about
// one person. The GDPR erasure scrub (db/pipeline.ts scrubEntryLinkedPii) blanks both and
// stamps `erased_at`; the row stays as the record that a letter was asked for and what
// became of it. An erased row is closed to every write below (`erased_at IS NULL` in each
// guard), so a draft that finishes after the erasure cannot write the text back.
//
// EVERY WRITE IS A COMPARE-AND-SWAP on the state it moves from (the house rule for a
// read→compute→write: "a compensating precondition in the UPDATE's WHERE plus a
// `changes === 0` skip"). The draft is computed outside any transaction — a Python spawn
// and possibly a model call — so a recruiter who approved or declined in the meantime is
// never overwritten: the late draft finds the row moved and is dropped.
//
// TENANCY: every statement binds workspace_id, point reads included, with NO by-id
// carve-out (interview-letters-tenancy.test.ts, whose exemption list is empty). The only
// statement outside this file that touches the table is the erasure scrub, keyed by the
// entry exactly like every other table it reaches.
//
// NAMES are module-prefixed (`interviewLetter*`) because the route-layer tenancy ratchet
// matches store functions by text across the api tree. None of them defaults its
// workspace: a caller that forgets the tenant fails to compile rather than silently
// reading the default team.

export type InterviewLetterRecord = InterviewLetter & {
  /** The decision the letter follows, fixed at request time. Shapes the draft's frame. */
  outcome: LetterOutcome;
  /** Set when an Art. 17 erasure blanked the texts. The row is then read-only. */
  erasedAt: string | null;
  updatedAt: string;
};

type LetterRow = {
  id: string;
  workspace_id: string;
  entry_id: string;
  state: string;
  outcome: string;
  lang: string;
  requested_at: string;
  draft_text: string | null;
  draft_source: string | null;
  draft_created_at: string | null;
  final_text: string | null;
  decided_by: string | null;
  decided_at: string | null;
  delivery: string | null;
  erased_at: string | null;
  updated_at: string;
};

const STATES: ReadonlySet<string> = new Set(LETTER_STATES);

function rowToLetter(r: LetterRow): InterviewLetterRecord {
  // The CHECK constraints close these at the DB level; narrowed again here so a row an
  // older build wrote can never widen the type its readers rely on.
  const state: LetterState = STATES.has(r.state) ? (r.state as LetterState) : "requested";
  const source: LetterDraftSource = r.draft_source === "model" ? "model" : "template";
  const delivery: LetterDelivery | null =
    r.delivery === "sent" || r.delivery === "queued" || r.delivery === "failed" ? r.delivery : null;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entryId: r.entry_id,
    state,
    lang: r.lang,
    requestedAt: r.requested_at,
    // A draft is present only when its text is — an erased row keeps its source and
    // timestamp columns, but a draft with no text is not a draft anyone can read.
    draft: r.draft_text != null && r.draft_created_at ? { text: r.draft_text, source, createdAt: r.draft_created_at } : null,
    finalText: r.final_text,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    delivery,
    outcome: r.outcome === "hired" ? "hired" : "not_selected",
    erasedAt: r.erased_at,
    updatedAt: r.updated_at,
  };
}

/** The letter for one application, or null when none was requested. */
export function interviewLetterByEntry(entryId: string, workspaceId: string): InterviewLetterRecord | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_letters WHERE entry_id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | LetterRow
    | undefined;
  return r ? rowToLetter(r) : null;
}

/** One letter by id, only inside its own team. */
export function interviewLetterById(letterId: string, workspaceId: string): InterviewLetterRecord | null {
  const r = ensureDb().prepare(`SELECT * FROM interview_letters WHERE id = ? AND workspace_id = ?`).get(letterId, workspaceId) as
    | LetterRow
    | undefined;
  return r ? rowToLetter(r) : null;
}

/**
 * Record a candidate's request. IDEMPOTENT: the first call inserts a `requested` row and
 * reports `created: true`; every later call for the same application returns the row that
 * already exists, untouched, with `created: false` — never a second letter.
 *
 * Eligibility is the CALLER's decision (interview-letter.ts) and is not re-derived here:
 * the store records, it does not judge.
 */
export function interviewLetterRequest(
  input: { entryId: string; lang: string; outcome: LetterOutcome },
  workspaceId: string
): { letter: InterviewLetterRecord; created: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  // ON CONFLICT names the uniqueness target, so ONLY the one-letter-per-application
  // collision is absorbed — `INSERT OR IGNORE` would also swallow a CHECK violation (an
  // outcome outside the vocabulary) and report it as "already requested".
  const res = db
    .prepare(
      `INSERT INTO interview_letters (id, workspace_id, entry_id, state, outcome, lang, requested_at, updated_at)
       VALUES (?, ?, ?, 'requested', ?, ?, ?, ?)
       ON CONFLICT(workspace_id, entry_id) DO NOTHING`
    )
    .run(randomId("il"), workspaceId, input.entryId, input.outcome, input.lang, now, now);
  const letter = interviewLetterByEntry(input.entryId, workspaceId);
  if (!letter) throw new Error(`interview letter for entry ${input.entryId} was neither inserted nor found`);
  return { letter, created: res.changes === 1 };
}

/**
 * Store a draft. Allowed from `requested` (the first draft) and from `drafted` (a redraft
 * a recruiter asked for), never once a person has decided and never on an erased row.
 * Returns null when the row moved — the late draft is dropped, the decision stands.
 *
 * Throws on a text the contract forbids (empty, over LETTER_MAX_CHARS): that is a caller
 * bug, not a state the row can be in.
 */
export function interviewLetterSaveDraft(
  letterId: string,
  draft: { text: string; source: LetterDraftSource },
  workspaceId: string
): InterviewLetterRecord | null {
  assertStorableText(draft.text, "draft");
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE interview_letters
          SET state = 'drafted', draft_text = ?, draft_source = ?, draft_created_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND state IN ('requested', 'drafted') AND erased_at IS NULL`
    )
    .run(draft.text, draft.source, now, now, letterId, workspaceId);
  return res.changes === 0 ? null : interviewLetterById(letterId, workspaceId);
}

/**
 * A recruiter approves the FINAL text: the letter becomes `sent` ("a recruiter approved
 * the final text; delivery was attempted"), with `delivery` left null until the caller
 * records what the comms layer reported (interviewLetterRecordDelivery). Allowed from
 * `requested` too — a recruiter may write the letter by hand when no draft exists.
 *
 * `decidedBy` must be a HUMAN actor ("human:…", as humanActor() produces): the contract
 * names the reviewing person, never the drafting machine, and a machine token here would
 * be the one lie this record exists to prevent.
 */
export function interviewLetterApprove(
  letterId: string,
  input: { finalText: string; decidedBy: string },
  workspaceId: string
): InterviewLetterRecord | null {
  assertStorableText(input.finalText, "final");
  assertHumanActor(input.decidedBy);
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE interview_letters
          SET state = 'sent', final_text = ?, decided_by = ?, decided_at = ?, delivery = NULL, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND state IN ('requested', 'drafted') AND erased_at IS NULL`
    )
    .run(input.finalText, input.decidedBy, now, now, letterId, workspaceId);
  return res.changes === 0 ? null : interviewLetterById(letterId, workspaceId);
}

/** What delivery reported for a `sent` letter, in the comms layer's own truthful
 *  vocabulary. Only a sent letter has a delivery. */
export function interviewLetterRecordDelivery(letterId: string, delivery: LetterDelivery, workspaceId: string): InterviewLetterRecord | null {
  const res = ensureDb()
    .prepare(`UPDATE interview_letters SET delivery = ?, updated_at = ? WHERE id = ? AND workspace_id = ? AND state = 'sent'`)
    .run(delivery, new Date().toISOString(), letterId, workspaceId);
  return res.changes === 0 ? null : interviewLetterById(letterId, workspaceId);
}

/** A recruiter decides not to send individual feedback. The candidate is told so — the
 *  request is closed, never left pending. Any draft stays on the row as the record of
 *  what was declined. */
export function interviewLetterDecline(letterId: string, input: { decidedBy: string }, workspaceId: string): InterviewLetterRecord | null {
  assertHumanActor(input.decidedBy);
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE interview_letters
          SET state = 'declined', decided_by = ?, decided_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND state IN ('requested', 'drafted') AND erased_at IS NULL`
    )
    .run(input.decidedBy, now, now, letterId, workspaceId);
  return res.changes === 0 ? null : interviewLetterById(letterId, workspaceId);
}

/** The recruiter's review queue: every open letter (requested or drafted, not erased),
 *  OLDEST first — the request that has waited longest is the one a candidate is waiting
 *  on longest. Ties inside one ISO millisecond break on insertion order (rowid), never on
 *  the random id. */
export function interviewLetterQueue(workspaceId: string, limit = 100): InterviewLetterRecord[] {
  const cap = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = ensureDb()
    .prepare(
      `SELECT * FROM interview_letters
        WHERE workspace_id = ? AND state IN ('requested', 'drafted') AND erased_at IS NULL
        ORDER BY requested_at ASC, rowid ASC LIMIT ?`
    )
    .all(workspaceId, cap) as LetterRow[];
  return rows.map(rowToLetter);
}

/** The event that decided a rejection — the NEWEST reject-kind event on the entry (see
 *  LETTER_REJECT_EVENT_KINDS for why that is the one). Read here rather than through
 *  listPipelineEventsForEntry, which returns the OLDEST fifty and would miss it on a
 *  long timeline. */
export function interviewLetterDecidingEvent(entryId: string, workspaceId: string): LetterDecidingEvent | null {
  const slots = LETTER_REJECT_EVENT_KINDS.map(() => "?").join(", ");
  const r = ensureDb()
    .prepare(
      `SELECT kind, actor FROM pipeline_events
        WHERE entry_id = ? AND workspace_id = ? AND kind IN (${slots})
        ORDER BY created_at DESC, id DESC LIMIT 1`
    )
    .get(entryId, workspaceId, ...LETTER_REJECT_EVENT_KINDS) as { kind: string; actor: string | null } | undefined;
  return r ? { kind: r.kind, actor: r.actor ?? null } : null;
}

function assertStorableText(text: string, which: "draft" | "final"): void {
  const problem = letterTextProblem(text);
  if (problem) throw new RangeError(`interview letter ${which} text is ${problem === "empty" ? "empty" : "over the length cap"}`);
}

function assertHumanActor(actor: string): void {
  if (typeof actor !== "string" || !actor.startsWith("human:") || actor.length <= "human:".length) {
    throw new TypeError("an interview letter is decided by a human actor (human:…)");
  }
}
