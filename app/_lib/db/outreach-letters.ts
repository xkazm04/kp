import { randomId } from "../random-id";
import { cleanOutreachBody } from "../outreach-body";
import { ensureDb } from "./core";

// The first-contact OUTREACH letter store (comms scope C2, "approve before first
// outreach"). Every outreach door — the drawer's automation task, the board's batch
// outreach, the sourcing "Reach out" — used to send the letter the moment the model
// wrote it. They now DRAFT a row here, and the letter leaves only when a person approves
// one exact revision and releases it (app/_lib/outreach-release.ts). Modelled on the
// interview feedback letter (db/interview-letters.ts).
//
// ONE ROW PER APPLICATION. The unique index (workspace_id, entry_id) makes the draft door
// idempotent: a re-run of the outreach task lands on the same row (`ON CONFLICT DO
// NOTHING`, never a read-then-insert two runs could race), and a first touch is sent once.
//
// THE MESSAGE IDENTITY is minted HERE, at draft time, and never changes: the release
// hands it to sendComm, so the outbox row (dev_outbox.message_id), the relay envelope's
// messageId and its Idempotency-Key all equal the draft's (comms scope C1). A retried
// release after a dead letter re-sends the SAME message, which the receiver can dedupe.
//
// THE REVISION is the approval's anchor. A redraft of a still-drafted letter bumps it, and
// approval is a compare-and-swap on (id, team, revision, state = 'drafted'): a person who
// read revision 3 cannot approve revision 4 they never saw.
//
// THE ROW CARRIES CANDIDATE PERSONAL DATA — subject and body are written to one named
// person. The GDPR erasure scrub (db/pipeline.ts scrubEntryLinkedPii) blanks both and stamps
// `erased_at`; an erased row is closed to every write below (`erased_at IS NULL` in each
// guard), so a draft that finishes after the erasure cannot write the text back.
//
// TENANCY: every statement binds workspace_id, point reads included, with NO by-id
// carve-out (outreach-letters-tenancy.test.ts). Names are module-prefixed
// (`outreachLetter*`) because the route-layer tenancy ratchet matches store functions by
// text. None defaults its workspace.

/** Longest outreach SUBJECT the store keeps. A subject is one line a mail client shows in
 *  a list; 300 characters is several times any real one. */
export const OUTREACH_SUBJECT_MAX_LENGTH = 300;

/**
 * The plain-text subject line, cleaned the way the body is (outreach-body.ts: markup
 * stripped, invisible/bidi code points removed) and then folded onto ONE line. The body
 * had a send gate and the subject had none: the model writes it from a CV it read, and a
 * person can now edit it (PATCH ../[id]), so a smuggled `<a href>`, a bidi override or a
 * line break reached the relay under the operator's name. Every write below stores it
 * through this function, so a release can only send a cleaned subject. Not length-capped
 * here — the edit door refuses an over-long one and the draft door clips the model's.
 */
export function cleanOutreachSubject(value: string): string {
  return cleanOutreachBody(value).replace(/\s+/g, " ").trim();
}

/** The model's draft subject, cleaned and clipped to the cap. Clipping is safe here and
 *  not on the body: a held draft is read by a person before anything leaves, and no footer
 *  hangs off a subject. */
function draftSubject(value: string): string {
  const clean = cleanOutreachSubject(value);
  return clean.length > OUTREACH_SUBJECT_MAX_LENGTH ? clean.slice(0, OUTREACH_SUBJECT_MAX_LENGTH - 1).trimEnd() + "…" : clean;
}

export const OUTREACH_LETTER_STATES = ["drafted", "approved", "released", "delivery_failed", "suppressed", "discarded"] as const;
export type OutreachLetterState = (typeof OUTREACH_LETTER_STATES)[number];

/** States a release may start from: an approval, or a release that did not land (a dead
 *  letter, or a send gate that refused at the time — both re-checked on the next try). */
export const RELEASABLE_STATES: readonly OutreachLetterState[] = ["approved", "delivery_failed", "suppressed"];

export type OutreachLetter = {
  id: string;
  workspaceId: string;
  entryId: string;
  state: OutreachLetterState;
  revision: number;
  /** Null only after an erasure blanked it. */
  subject: string | null;
  body: string | null;
  lang: string;
  /** The delivery identity, minted at draft time and carried to the send. */
  messageId: string;
  /** The human actor ("human:…") who approved this revision. */
  approvedBy: string | null;
  approvedAt: string | null;
  releasedAt: string | null;
  erasedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type LetterRow = {
  id: string;
  workspace_id: string;
  entry_id: string;
  state: string;
  revision: number;
  subject: string | null;
  body: string | null;
  lang: string;
  message_id: string;
  approved_by: string | null;
  approved_at: string | null;
  released_at: string | null;
  erased_at: string | null;
  created_at: string;
  updated_at: string;
};

const STATES: ReadonlySet<string> = new Set(OUTREACH_LETTER_STATES);
const RELEASABLE_SQL = RELEASABLE_STATES.map((s) => `'${s}'`).join(", ");

function rowToLetter(r: LetterRow): OutreachLetter {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    entryId: r.entry_id,
    // The CHECK constraint closes this at the DB level; narrowed again so a row an older
    // build wrote can never widen the type its readers rely on.
    state: STATES.has(r.state) ? (r.state as OutreachLetterState) : "drafted",
    revision: r.revision,
    subject: r.subject,
    body: r.body,
    lang: r.lang,
    messageId: r.message_id,
    approvedBy: r.approved_by,
    approvedAt: r.approved_at,
    releasedAt: r.released_at,
    erasedAt: r.erased_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** The outreach letter for one application, or null when none was drafted. */
export function outreachLetterByEntry(entryId: string, workspaceId: string): OutreachLetter | null {
  const r = ensureDb().prepare(`SELECT * FROM outreach_letters WHERE entry_id = ? AND workspace_id = ?`).get(entryId, workspaceId) as
    | LetterRow
    | undefined;
  return r ? rowToLetter(r) : null;
}

/** One letter by id, only inside its own team. */
export function outreachLetterById(letterId: string, workspaceId: string): OutreachLetter | null {
  const r = ensureDb().prepare(`SELECT * FROM outreach_letters WHERE id = ? AND workspace_id = ?`).get(letterId, workspaceId) as
    | LetterRow
    | undefined;
  return r ? rowToLetter(r) : null;
}

/**
 * Record the machine's draft for an application.
 *
 *   - no row yet          -> a `drafted` row at revision 1 with a fresh message id
 *                            (`created: true`);
 *   - a `drafted` row     -> the new text, revision + 1 (`changed: true`) — unless the
 *                            text is identical, which is not an edit and must not void a
 *                            review in progress;
 *   - any other state, or an erased row -> returned untouched: once a person approved,
 *                            released or the row was erased, a late draft is dropped.
 */
export function outreachLetterDraft(
  input: { entryId: string; subject: string; body: string; lang: string },
  workspaceId: string
): { letter: OutreachLetter; created: boolean; changed: boolean } {
  const db = ensureDb();
  const now = new Date().toISOString();
  input = { ...input, subject: draftSubject(input.subject) };
  // ON CONFLICT names the uniqueness target, so ONLY the one-letter-per-application
  // collision is absorbed — `INSERT OR IGNORE` would also swallow a CHECK violation.
  const ins = db
    .prepare(
      `INSERT INTO outreach_letters (id, workspace_id, entry_id, state, revision, subject, body, lang, message_id, created_at, updated_at)
       VALUES (?, ?, ?, 'drafted', 1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, entry_id) DO NOTHING`
    )
    .run(randomId("ol"), workspaceId, input.entryId, input.subject, input.body, input.lang, randomId("msg"), now, now);
  if (ins.changes === 1) {
    return { letter: mustRead(input.entryId, workspaceId), created: true, changed: true };
  }
  const upd = db
    .prepare(
      `UPDATE outreach_letters
          SET subject = ?, body = ?, lang = ?, revision = revision + 1, updated_at = ?
        WHERE entry_id = ? AND workspace_id = ? AND state = 'drafted' AND erased_at IS NULL
          AND (subject IS NOT ? OR body IS NOT ? OR lang IS NOT ?)`
    )
    .run(input.subject, input.body, input.lang, now, input.entryId, workspaceId, input.subject, input.body, input.lang);
  return { letter: mustRead(input.entryId, workspaceId), created: false, changed: upd.changes === 1 };
}

/**
 * A person edits the text of a still-`drafted` letter. A compare-and-swap on (id, team,
 * revision, `drafted`, not erased): the edit applies only to the revision the editor read,
 * and bumps it, so an approval of the revision they read before the edit fails the same
 * CAS. Identical text is not an edit (null result is for a stale or closed row only; the
 * unchanged letter is returned with `changed: false`).
 */
export function outreachLetterEdit(
  letterId: string,
  input: { revision: number; subject: string; body: string },
  workspaceId: string
): { letter: OutreachLetter; changed: boolean } | null {
  const now = new Date().toISOString();
  input = { ...input, subject: cleanOutreachSubject(input.subject) };
  const res = ensureDb()
    .prepare(
      `UPDATE outreach_letters
          SET subject = ?, body = ?, revision = revision + 1, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND revision = ? AND state = 'drafted' AND erased_at IS NULL
          AND (subject IS NOT ? OR body IS NOT ?)`
    )
    .run(input.subject, input.body, now, letterId, workspaceId, input.revision, input.subject, input.body);
  const letter = outreachLetterById(letterId, workspaceId);
  if (res.changes === 1 && letter) return { letter, changed: true };
  // No change written: either identical text on the revision that was read (fine), or
  // the revision/state moved on (stale).
  if (letter && letter.revision === input.revision && letter.state === "drafted" && !letter.erasedAt) return { letter, changed: false };
  return null;
}

/**
 * A person approves ONE revision. A compare-and-swap on (id, team, revision, `drafted`,
 * not erased): a stale revision, a letter someone else already approved, or an erased row
 * all return null and write nothing.
 *
 * `approvedBy` must be a HUMAN actor ("human:…", as humanActor() produces): approval is the
 * one act this record exists to attribute to a person, never to the drafting machine.
 */
export function outreachLetterApprove(
  letterId: string,
  input: { revision: number; approvedBy: string },
  workspaceId: string
): OutreachLetter | null {
  assertHumanActor(input.approvedBy);
  const now = new Date().toISOString();
  const res = ensureDb()
    .prepare(
      `UPDATE outreach_letters
          SET state = 'approved', approved_by = ?, approved_at = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND revision = ? AND state = 'drafted' AND erased_at IS NULL AND body IS NOT NULL`
    )
    .run(input.approvedBy, now, now, letterId, workspaceId, input.revision);
  return res.changes === 0 ? null : outreachLetterById(letterId, workspaceId);
}

/** The release handed the letter to the channel and it did not fail (`sent` to a relay,
 *  or `queued` in the keyless local outbox). Terminal. */
export function outreachLetterMarkReleased(letterId: string, workspaceId: string): OutreachLetter | null {
  const now = new Date().toISOString();
  return moveFromReleasable(letterId, workspaceId, `state = 'released', released_at = ?, updated_at = ?`, [now, now]);
}

/** The relay dead-lettered the release. The approval stands; a retry re-sends the same
 *  message id. */
export function outreachLetterMarkFailed(letterId: string, workspaceId: string): OutreachLetter | null {
  return moveFromReleasable(letterId, workspaceId, `state = 'delivery_failed', updated_at = ?`, [new Date().toISOString()]);
}

/** The send gate refused the release (consent, erasure, a halted sequence). Nothing left. */
export function outreachLetterMarkSuppressed(letterId: string, workspaceId: string): OutreachLetter | null {
  return moveFromReleasable(letterId, workspaceId, `state = 'suppressed', updated_at = ?`, [new Date().toISOString()]);
}

function moveFromReleasable(letterId: string, workspaceId: string, set: string, args: string[]): OutreachLetter | null {
  const res = ensureDb()
    .prepare(`UPDATE outreach_letters SET ${set} WHERE id = ? AND workspace_id = ? AND state IN (${RELEASABLE_SQL})`)
    .run(...args, letterId, workspaceId);
  return res.changes === 0 ? null : outreachLetterById(letterId, workspaceId);
}

function mustRead(entryId: string, workspaceId: string): OutreachLetter {
  const letter = outreachLetterByEntry(entryId, workspaceId);
  if (!letter) throw new Error(`outreach letter for entry ${entryId} was neither inserted nor found`);
  return letter;
}

function assertHumanActor(actor: string): void {
  if (typeof actor !== "string" || !actor.startsWith("human:") || actor.length <= "human:".length) {
    throw new TypeError("an outreach letter is approved by a human actor (human:…)");
  }
}
